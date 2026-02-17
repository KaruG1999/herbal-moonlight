import { Client as HerbalMoonlightClient, type GameSession, type CellRevealResult } from './bindings';
import { NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES, MULTI_SIG_AUTH_TTL_MINUTES } from '@/utils/constants';
import { contract, Address, authorizeEntry, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry } from '@/utils/authEntryUtils';

type ClientOptions = contract.ClientOptions;

export class HerbalMoonlightService {
  private baseClient: HerbalMoonlightClient;
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new HerbalMoonlightClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }

  private createSigningClient(
    publicKey: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): HerbalMoonlightClient {
    return new HerbalMoonlightClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    });
  }

  async getSession(sessionId: number): Promise<GameSession | null> {
    try {
      const tx = await this.baseClient.get_session({ session_id: sessionId });
      const result = await tx.simulate();
      if (result.result.isOk()) {
        return result.result.unwrap();
      }
      return null;
    } catch (err) {
      console.log('[getSession] Error:', err);
      return null;
    }
  }

  // ── Multi-sig start game: Step 1 (Gardener prepares auth entry) ──────

  async prepareStartGame(
    sessionId: number,
    gardener: string,
    creature: string,
    gardenerPoints: bigint,
    creaturePoints: bigint,
    gardenerSigner: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    const buildClient = new HerbalMoonlightClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: creature,
    });

    const tx = await buildClient.start_game({
      session_id: sessionId,
      gardener,
      creature,
      gardener_points: gardenerPoints,
      creature_points: creaturePoints,
    }, DEFAULT_METHOD_OPTIONS);

    if (!tx.simulationData?.result?.auth) {
      throw new Error('No auth entries found in simulation');
    }

    const authEntries = tx.simulationData.result.auth;
    let gardenerAuthEntry = null;

    for (let i = 0; i < authEntries.length; i++) {
      try {
        const entryAddress = authEntries[i].credentials().address().address();
        const entryAddressString = Address.fromScAddress(entryAddress).toString();
        if (entryAddressString === gardener) {
          gardenerAuthEntry = authEntries[i];
          break;
        }
      } catch { continue; }
    }

    if (!gardenerAuthEntry) {
      throw new Error(`No auth entry found for Gardener (${gardener})`);
    }

    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL, authTtlMinutes ?? MULTI_SIG_AUTH_TTL_MINUTES
    );

    if (!gardenerSigner.signAuthEntry) {
      throw new Error('signAuthEntry function not available');
    }

    const signedAuthEntry = await authorizeEntry(
      gardenerAuthEntry,
      async (preimage) => {
        if (!gardenerSigner.signAuthEntry) throw new Error('Wallet does not support auth entry signing');
        const signResult = await gardenerSigner.signAuthEntry(preimage.toXDR('base64'), {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: gardener,
        });
        if (signResult.error) throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      validUntilLedgerSeq,
      NETWORK_PASSPHRASE,
    );

    return signedAuthEntry.toXDR('base64');
  }

  // ── Multi-sig start game: Parse auth entry ───────────────────────────

  parseAuthEntry(authEntryXdr: string) {
    const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
    const addressCreds = authEntry.credentials().address();
    const gardener = Address.fromScAddress(addressCreds.address()).toString();

    const contractFn = authEntry.rootInvocation().function().contractFn();
    const functionName = contractFn.functionName().toString();
    if (functionName !== 'start_game') {
      throw new Error(`Unexpected function: ${functionName}. Expected start_game.`);
    }

    const args = contractFn.args();
    if (args.length !== 2) {
      throw new Error(`Expected 2 arguments, got ${args.length}`);
    }

    return {
      sessionId: args[0].u32(),
      gardener,
      gardenerPoints: args[1].i128().lo().toBigInt(),
      functionName,
    };
  }

  // ── Multi-sig start game: Step 2 (Creature imports & signs) ──────────

  async importAndSignAuthEntry(
    gardenerSignedAuthEntryXdr: string,
    creatureAddress: string,
    creaturePoints: bigint,
    creatureSigner: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    const gameParams = this.parseAuthEntry(gardenerSignedAuthEntryXdr);

    if (creatureAddress === gameParams.gardener) {
      throw new Error('Cannot play against yourself.');
    }

    const buildClient = new HerbalMoonlightClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: creatureAddress,
    });

    const tx = await buildClient.start_game({
      session_id: gameParams.sessionId,
      gardener: gameParams.gardener,
      creature: creatureAddress,
      gardener_points: gameParams.gardenerPoints,
      creature_points: creaturePoints,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL, authTtlMinutes ?? MULTI_SIG_AUTH_TTL_MINUTES
    );

    const txWithInjectedAuth = await injectSignedAuthEntry(
      tx, gardenerSignedAuthEntryXdr, creatureAddress, creatureSigner, validUntilLedgerSeq,
    );

    const creatureClient = this.createSigningClient(creatureAddress, creatureSigner);
    const creatureTx = creatureClient.txFromXDR(txWithInjectedAuth.toXDR());
    const needsSigning = await creatureTx.needsNonInvokerSigningBy();

    if (needsSigning.includes(creatureAddress)) {
      await creatureTx.signAuthEntries({ expiration: validUntilLedgerSeq });
    }

    return creatureTx.toXDR();
  }

  // ── Multi-sig start game: Step 3 (Finalize & submit) ─────────────────

  async finalizeStartGame(
    xdrString: string,
    signerAddress: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = client.txFromXDR(xdrString);
    await tx.simulate();
    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
    return sentTx.result;
  }

  // ── Gardener: commit garden layout ───────────────────────────────────

  async commitGarden(
    sessionId: number,
    gardenCommitment: Buffer,
    signerAddress: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = await client.commit_garden({
      session_id: sessionId,
      garden_commitment: gardenCommitment,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
    return sentTx.result;
  }

  // ── Creature: move on grid ───────────────────────────────────────────

  async creatureMove(
    sessionId: number,
    newX: number,
    newY: number,
    signerAddress: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = await client.creature_move({
      session_id: sessionId,
      new_x: newX,
      new_y: newY,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
    return sentTx.result;
  }

  // ── Gardener: reveal cell with ZK proof ──────────────────────────────

  async revealCell(
    sessionId: number,
    journalBytes: Buffer,
    journalHash: Buffer,
    seal: Buffer,
    signerAddress: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = await client.reveal_cell({
      session_id: sessionId,
      journal_bytes: journalBytes,
      journal_hash: journalHash,
      seal,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);
    return sentTx.result;
  }
}
