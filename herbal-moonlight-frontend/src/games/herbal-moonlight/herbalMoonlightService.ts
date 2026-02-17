import { Client as HerbalMoonlightClient, type GameSession, type CellRevealResult } from './bindings';
import { NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES, MULTI_SIG_AUTH_TTL_MINUTES } from '@/utils/constants';
import { contract, Address, authorizeEntry, xdr, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
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
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): HerbalMoonlightClient {
    const options: ClientOptions = {
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    };
    return new HerbalMoonlightClient(options);
  }

  async getSession(sessionId: number): Promise<GameSession | null> {
    try {
      const tx = await this.baseClient.get_session({ session_id: sessionId });
      const result = await tx.simulate();
      if (result.result.isOk()) {
        return result.result.unwrap();
      } else {
        return null;
      }
    } catch (err) {
      console.log('[getSession] Error querying session:', err);
      return null;
    }
  }

  // ====================================================================
  // Multi-sig start_game flow (same pattern as NumberGuess)
  // ====================================================================

  async prepareStartGame(
    sessionId: number,
    gardener: string,
    creature: string,
    gardenerPoints: bigint,
    creaturePoints: bigint,
    gardenerSigner: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
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
      const entry = authEntries[i];
      try {
        const entryAddress = entry.credentials().address().address();
        const entryAddressString = Address.fromScAddress(entryAddress).toString();
        if (entryAddressString === gardener) {
          gardenerAuthEntry = entry;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!gardenerAuthEntry) {
      throw new Error(`No auth entry found for Gardener (${gardener})`);
    }

    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL,
      authTtlMinutes ?? MULTI_SIG_AUTH_TTL_MINUTES
    );

    if (!gardenerSigner.signAuthEntry) {
      throw new Error('signAuthEntry function not available');
    }

    const signedAuthEntry = await authorizeEntry(
      gardenerAuthEntry,
      async (preimage) => {
        if (!gardenerSigner.signAuthEntry) {
          throw new Error('Wallet does not support auth entry signing');
        }
        const signResult = await gardenerSigner.signAuthEntry(
          preimage.toXDR('base64'),
          { networkPassphrase: NETWORK_PASSPHRASE, address: gardener }
        );
        if (signResult.error) {
          throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        }
        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      validUntilLedgerSeq,
      NETWORK_PASSPHRASE
    );

    return signedAuthEntry.toXDR('base64');
  }

  parseAuthEntry(authEntryXdr: string): {
    sessionId: number;
    gardener: string;
    gardenerPoints: bigint;
    functionName: string;
  } {
    try {
      const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
      const credentials = authEntry.credentials();
      const addressCreds = credentials.address();
      const gardenerAddress = addressCreds.address();
      const gardener = Address.fromScAddress(gardenerAddress).toString();

      const rootInvocation = authEntry.rootInvocation();
      const authorizedFunction = rootInvocation.function();
      const contractFn = authorizedFunction.contractFn();
      const functionName = contractFn.functionName().toString();

      if (functionName !== 'start_game') {
        throw new Error(`Unexpected function: ${functionName}. Expected start_game.`);
      }

      const args = contractFn.args();
      if (args.length !== 2) {
        throw new Error(`Expected 2 arguments, got ${args.length}`);
      }

      const sessionId = args[0].u32();
      const gardenerPoints = args[1].i128().lo().toBigInt();

      return { sessionId, gardener, gardenerPoints, functionName };
    } catch (err: any) {
      throw new Error(`Failed to parse auth entry: ${err.message}`);
    }
  }

  async importAndSignAuthEntry(
    gardenerSignedAuthEntryXdr: string,
    creatureAddress: string,
    creaturePoints: bigint,
    creatureSigner: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
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
      RPC_URL,
      authTtlMinutes ?? MULTI_SIG_AUTH_TTL_MINUTES
    );

    const txWithInjectedAuth = await injectSignedAuthEntry(
      tx,
      gardenerSignedAuthEntryXdr,
      creatureAddress,
      creatureSigner,
      validUntilLedgerSeq
    );

    const creatureClient = this.createSigningClient(creatureAddress, creatureSigner);
    const creatureTx = creatureClient.txFromXDR(txWithInjectedAuth.toXDR());

    const needsSigning = await creatureTx.needsNonInvokerSigningBy();
    if (needsSigning.includes(creatureAddress)) {
      await creatureTx.signAuthEntries({ expiration: validUntilLedgerSeq });
    }

    return creatureTx.toXDR();
  }

  async finalizeStartGame(
    txXdr: string,
    signerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = client.txFromXDR(txXdr);
    await tx.simulate();

    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL,
      authTtlMinutes ?? DEFAULT_AUTH_TTL_MINUTES
    );

    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  // ====================================================================
  // Game actions (single-player transactions)
  // ====================================================================

  async commitGarden(
    sessionId: number,
    gardenerAddress: string,
    gardenCommitment: Buffer,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(gardenerAddress, signer);
    const tx = await client.commit_garden({
      session_id: sessionId,
      garden_commitment: gardenCommitment,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL,
      authTtlMinutes ?? DEFAULT_AUTH_TTL_MINUTES
    );

    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  async creatureMove(
    sessionId: number,
    creatureAddress: string,
    newX: number,
    newY: number,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(creatureAddress, signer);
    const tx = await client.creature_move({
      session_id: sessionId,
      new_x: newX,
      new_y: newY,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL,
      authTtlMinutes ?? DEFAULT_AUTH_TTL_MINUTES
    );

    try {
      const sentTx = await signAndSendViaLaunchtube(
        tx,
        DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
        validUntilLedgerSeq
      );
      return sentTx.result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        throw new Error('Move failed - check if it is your turn and the move is valid');
      }
      throw err;
    }
  }

  async revealCell(
    sessionId: number,
    gardenerAddress: string,
    journalBytes: Buffer,
    journalHash: Buffer,
    seal: Buffer,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<CellRevealResult | null> {
    const client = this.createSigningClient(gardenerAddress, signer);
    const tx = await client.reveal_cell({
      session_id: sessionId,
      journal_bytes: journalBytes,
      journal_hash: journalHash,
      seal,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(
      RPC_URL,
      authTtlMinutes ?? DEFAULT_AUTH_TTL_MINUTES
    );

    try {
      const sentTx = await signAndSendViaLaunchtube(
        tx,
        DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
        validUntilLedgerSeq
      );
      return sentTx.result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        throw new Error('Reveal failed - check proof data and game state');
      }
      throw err;
    }
  }
}
