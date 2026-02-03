#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function usage() {
  console.log(`\nUsage: bun run create <game-slug> [--force]\n`);
}

function isValidSlug(slug: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug);
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function pascalFromSlug(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function camelFromSlug(slug: string): string {
  const pascal = pascalFromSlug(slug);
  return pascal ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : pascal;
}

function toEnvKey(slug: string): string {
  return slug.replace(/-/g, '_').toUpperCase();
}

function shouldSkip(name: string): boolean {
  const skipNames = new Set([
    'node_modules',
    'dist',
    'dist-node',
    '.turbo',
    '.git',
  ]);
  if (skipNames.has(name)) return true;
  if (name === 'tsconfig.tsbuildinfo') return true;
  return false;
}

function copyDir(src: string, dest: string) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      const contents = readFileSync(srcPath);
      writeFileSync(destPath, contents);
    }
  }
}

function replaceAll(text: string, replacements: Record<string, string>): string {
  let out = text;
  for (const [from, to] of Object.entries(replacements)) {
    out = out.split(from).join(to);
  }
  return out;
}

function updateWorkspaceMembers(repoRoot: string, gameSlug: string) {
  const cargoPath = path.join(repoRoot, 'Cargo.toml');
  const cargoText = readFileSync(cargoPath, 'utf8');
  const memberLine = `  "contracts/${gameSlug}",`;

  if (cargoText.includes(memberLine)) return;

  const membersMatch = cargoText.match(/members\s*=\s*\[[\s\S]*?\]/m);
  if (!membersMatch) {
    throw new Error('Unable to locate workspace members in Cargo.toml');
  }

  const block = membersMatch[0];
  const insertIndex = block.lastIndexOf(']');
  if (insertIndex < 0) {
    throw new Error('Malformed workspace members list in Cargo.toml');
  }

  const updatedBlock = `${block.slice(0, insertIndex)}${memberLine}\n${block.slice(insertIndex)}`;
  const updatedCargo = cargoText.replace(block, updatedBlock);
  writeFileSync(cargoPath, updatedCargo);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const gameSlug = args[0];
const force = args.includes('--force');

if (!isValidSlug(gameSlug)) {
  console.error(`\n❌ Invalid game slug: ${gameSlug}`);
  console.error('Use lowercase letters, numbers, and dashes only, starting with a letter (e.g. my-game).');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const contractsRoot = path.join(repoRoot, 'contracts');
const templateContractDir = path.join(contractsRoot, 'template');
const newContractDir = path.join(contractsRoot, gameSlug);
const frontendTemplateDir = path.join(repoRoot, 'frontend-template');
const frontendSlug = `${gameSlug}-frontend`;
const newFrontendDir = path.join(repoRoot, frontendSlug);

if (!existsSync(templateContractDir)) {
  console.error(`\n❌ Missing template contract at ${templateContractDir}`);
  process.exit(1);
}

if (!existsSync(frontendTemplateDir)) {
  console.error(`\n❌ Missing frontend template at ${frontendTemplateDir}`);
  process.exit(1);
}

if (existsSync(newContractDir)) {
  if (!force) {
    console.error(`\n❌ Contract already exists: ${newContractDir}`);
    console.error('Use --force to overwrite.');
    process.exit(1);
  }
  rmSync(newContractDir, { recursive: true, force: true });
}

if (existsSync(newFrontendDir)) {
  if (!force) {
    console.error(`\n❌ Frontend already exists: ${newFrontendDir}`);
    console.error('Use --force to overwrite.');
    process.exit(1);
  }
  rmSync(newFrontendDir, { recursive: true, force: true });
}

console.log(`\n🧩 Creating game: ${gameSlug}`);

console.log('  • Copying contract template...');
copyDir(templateContractDir, newContractDir);

const pascalName = pascalFromSlug(gameSlug);
const titleName = titleCaseFromSlug(gameSlug);
const camelName = camelFromSlug(gameSlug);
const envKey = toEnvKey(gameSlug);

const replacements = {
  'template-game': gameSlug,
  'TemplateGame': pascalName || 'Game',
  'Template Game': titleName || 'Game',
};

for (const relPath of ['Cargo.toml', 'src/lib.rs', 'src/test.rs']) {
  const filePath = path.join(newContractDir, relPath);
  if (!existsSync(filePath)) continue;
  const text = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, replaceAll(text, replacements));
}

console.log('  • Registering contract in workspace...');
updateWorkspaceMembers(repoRoot, gameSlug);

console.log('  • Generating standalone frontend...');
copyDir(frontendTemplateDir, newFrontendDir);

const frontendPackagePath = path.join(newFrontendDir, 'package.json');
if (existsSync(frontendPackagePath)) {
  const pkg = JSON.parse(readFileSync(frontendPackagePath, 'utf8')) as {
    name?: string;
    scripts?: Record<string, string>;
  };
  pkg.name = `${gameSlug}-frontend`;
  if (pkg.scripts && pkg.scripts['build:docs']) {
    delete pkg.scripts['build:docs'];
  }
  writeFileSync(frontendPackagePath, JSON.stringify(pkg, null, 2) + '\n');
}

const gamesDir = path.join(newFrontendDir, 'src', 'games');
if (existsSync(gamesDir)) {
  rmSync(gamesDir, { recursive: true, force: true });
}
mkdirSync(gamesDir, { recursive: true });

const newGameDir = path.join(gamesDir, gameSlug);
mkdirSync(newGameDir, { recursive: true });

const componentName = `${pascalName}Game`;
const serviceClassName = `${pascalName}Service`;
const serviceFileBase = `${camelName}Service`;
const cssFileBase = `${camelName}Game`;

const gameComponent = `import { useMemo, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { ${serviceClassName} } from './${serviceFileBase}';
import './${cssFileBase}.css';

export interface ${componentName}Props {
  userAddress: string;
  contractId: string;
  currentEpoch: number;
  availablePoints: bigint;
  onGameComplete: () => void;
}

export function ${componentName}({
  userAddress,
  contractId,
  currentEpoch,
  availablePoints,
  onGameComplete,
}: ${componentName}Props) {
  const { getContractSigner } = useWallet();
  const [sessionId, setSessionId] = useState(1);
  const [player2, setPlayer2] = useState('');
  const [player1Points, setPlayer1Points] = useState(10);
  const [player2Points, setPlayer2Points] = useState(10);
  const [status, setStatus] = useState<'idle' | 'started' | 'finished'>('idle');
  const [error, setError] = useState<string | null>(null);

  const service = useMemo(() => new ${serviceClassName}(contractId), [contractId]);

  const handleStart = async () => {
    if (!contractId) {
      setError('Contract ID missing. Run bun run setup or update your config.');
      return;
    }

    setError(null);
    try {
      const signer = getContractSigner();
      await service.startGame(
        sessionId,
        userAddress,
        player2,
        BigInt(player1Points),
        BigInt(player2Points),
        signer
      );
      setStatus('started');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start game');
    }
  };

  const handleFinish = async () => {
    if (!contractId) {
      setError('Contract ID missing. Run bun run setup or update your config.');
      return;
    }

    setError(null);
    try {
      const signer = getContractSigner();
      await service.finishGame(sessionId, userAddress, true, signer);
      setStatus('finished');
      onGameComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to finish game');
    }
  };

  return (
    <div className="card template-game">
      <div className="template-header">
        <div>
          <h3>${titleName}</h3>
          <p className="template-subtitle">Template game flow wired to Game Hub.</p>
        </div>
        <div className={\`template-status status-\${status}\`}>
          <span className="pulse-dot" aria-hidden="true" />
          <span>{status === 'idle' ? 'Ready' : status === 'started' ? 'In progress' : 'Completed'}</span>
        </div>
      </div>

      <div className="template-grid">
        <label>
          Session ID
          <input
            type="number"
            min={1}
            value={sessionId}
            onChange={(event) => setSessionId(Number(event.target.value))}
          />
        </label>
        <label>
          Player 1 (you)
          <input type="text" value={userAddress} readOnly />
        </label>
        <label>
          Player 2
          <input
            type="text"
            placeholder="G..."
            value={player2}
            onChange={(event) => setPlayer2(event.target.value)}
          />
        </label>
        <label>
          Player 1 Points
          <input
            type="number"
            min={1}
            value={player1Points}
            onChange={(event) => setPlayer1Points(Number(event.target.value))}
          />
        </label>
        <label>
          Player 2 Points
          <input
            type="number"
            min={1}
            value={player2Points}
            onChange={(event) => setPlayer2Points(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="template-meta">
        <div>
          <span className="meta-label">Epoch</span>
          <span className="meta-value">{currentEpoch}</span>
        </div>
        <div>
          <span className="meta-label">Available Points</span>
          <span className="meta-value">{availablePoints.toString()}</span>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="template-actions">
        <button onClick={handleStart} disabled={!contractId || !player2}>
          Start Game
        </button>
        <button
          className="btn-secondary"
          onClick={handleFinish}
          disabled={!contractId || status !== 'started'}
        >
          Finish Game
        </button>
      </div>
    </div>
  );
}
`;

const gameStyles = `.template-game {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.template-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.template-subtitle {
  color: var(--color-ink-muted);
  font-size: 0.9rem;
}

.template-status {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-weight: 600;
  padding: 0.4rem 0.8rem;
  border-radius: 999px;
  background: rgba(0, 167, 181, 0.15);
  color: var(--color-ink);
}

.template-status.status-finished {
  background: rgba(0, 167, 181, 0.25);
}

.pulse-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--color-teal);
  box-shadow: 0 0 0 rgba(0, 167, 181, 0.6);
  animation: pulse 1.6s ease infinite;
}

@keyframes pulse {
  0% {
    transform: scale(0.9);
    box-shadow: 0 0 0 0 rgba(0, 167, 181, 0.5);
  }
  70% {
    transform: scale(1.2);
    box-shadow: 0 0 0 8px rgba(0, 167, 181, 0);
  }
  100% {
    transform: scale(0.9);
    box-shadow: 0 0 0 0 rgba(0, 167, 181, 0);
  }
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}

.template-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.85rem;
  font-weight: 600;
}

.template-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}

.template-meta div {
  background: rgba(255, 255, 255, 0.8);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  padding: 0.8rem 1rem;
}

.meta-label {
  display: block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-ink-muted);
  margin-bottom: 0.4rem;
}

.meta-value {
  font-weight: 600;
}

.template-actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
`;

const serviceFile = `import { Client as ${pascalName}Client } from './bindings';
import { NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS } from '@/utils/constants';
import { contract } from '@stellar/stellar-sdk';

type ClientOptions = contract.ClientOptions;

/**
 * Service wrapper for ${titleName}
 *
 * For multi-sig start_game flows, see number-guess in the studio frontend.
 */
export class ${serviceClassName} {
  private contractId: string;
  private baseClient: ${pascalName}Client;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new ${pascalName}Client({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }

  private createSigningClient(
    publicKey: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const options: ClientOptions = {
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    };
    return new ${pascalName}Client(options);
  }

  async startGame(
    sessionId: number,
    player1: string,
    player2: string,
    player1Points: bigint,
    player2Points: bigint,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player1, signer);
    const tx: any = await client.start_game(
      {
        session_id: sessionId,
        player1,
        player2,
        player1_points: player1Points,
        player2_points: player2Points,
      },
      DEFAULT_METHOD_OPTIONS as any
    );

    if (tx?.signAndSend) {
      return tx.signAndSend();
    }

    return tx;
  }

  async finishGame(
    sessionId: number,
    player: string,
    player1Won: boolean,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx: any = await client.finish_game(
      {
        session_id: sessionId,
        player,
        player1_won: player1Won,
      },
      DEFAULT_METHOD_OPTIONS as any
    );

    if (tx?.signAndSend) {
      return tx.signAndSend();
    }

    return tx;
  }
}
`;

const bindingsFile = `export interface ClientOptions {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  publicKey?: string;
}

export interface Game {
  player1: string;
  player2: string;
  player1_points: bigint;
  player2_points: bigint;
  winner: string | null;
}

export class Client {
  constructor(_options: ClientOptions) {
  }

  async start_game(_args: Record<string, unknown>, _opts?: Record<string, unknown>) {
    return {
      signAndSend: async () => ({ result: undefined }),
    };
  }

  async finish_game(_args: Record<string, unknown>, _opts?: Record<string, unknown>) {
    return {
      signAndSend: async () => ({ result: undefined }),
    };
  }

  async get_game(_args: Record<string, unknown>) {
    return {
      simulate: async () => ({ result: { isOk: () => false } }),
    };
  }
}
`;

writeFileSync(path.join(newGameDir, `${componentName}.tsx`), gameComponent);
writeFileSync(path.join(newGameDir, `${cssFileBase}.css`), gameStyles);
writeFileSync(path.join(newGameDir, `${serviceFileBase}.ts`), serviceFile);
writeFileSync(path.join(newGameDir, 'bindings.ts'), bindingsFile);

const appTemplate = `import { config } from './config';
import { Layout } from './components/Layout';
import { useWallet } from './hooks/useWallet';
import { ${componentName} } from './games/${gameSlug}/${componentName}';

const GAME_ID = '${gameSlug}';
const GAME_TITLE = import.meta.env.VITE_GAME_TITLE || '${titleName}';
const GAME_TAGLINE = import.meta.env.VITE_GAME_TAGLINE || 'On-chain game on Stellar';

export default function App() {
  const { publicKey, isConnected, isConnecting, error, isDevModeAvailable } = useWallet();
  const userAddress = publicKey ?? '';
  const contractId = config.contractIds[GAME_ID] || '';
  const hasContract = contractId && contractId !== 'YOUR_CONTRACT_ID';
  const devReady = isDevModeAvailable();

  return (
    <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
      {!hasContract ? (
        <div className="card">
          <h3 className="gradient-text">Contract Not Configured</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '1rem' }}>
            Run <code>bun run setup</code> to deploy and configure testnet contract IDs, or set
            <code>VITE_${envKey}_CONTRACT_ID</code> in the root <code>.env</code>.
          </p>
        </div>
      ) : !devReady ? (
        <div className="card">
          <h3 className="gradient-text">Dev Wallets Missing</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
            Run <code>bun run setup</code> to generate dev wallets for Player 1 and Player 2.
          </p>
        </div>
      ) : !isConnected ? (
        <div className="card">
          <h3 className="gradient-text">Connecting Dev Wallet</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
            The dev wallet switcher auto-connects Player 1. Use the switcher to toggle players.
          </p>
          {error && <div className="notice error" style={{ marginTop: '1rem' }}>{error}</div>}
          {isConnecting && <div className="notice info" style={{ marginTop: '1rem' }}>Connecting...</div>}
        </div>
      ) : (
        <${componentName}
          userAddress={userAddress}
          contractId={contractId}
          currentEpoch={1}
          availablePoints={1000000000n}
          onGameComplete={() => {}}
        />
      )}
    </Layout>
  );
}
`;

writeFileSync(path.join(newFrontendDir, 'src', 'App.tsx'), appTemplate);

const indexPath = path.join(newFrontendDir, 'index.html');
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8');
  let updatedHtml = html;

  if (updatedHtml.includes('<title>')) {
    updatedHtml = updatedHtml.replace(/<title>.*<\/title>/, `<title>${titleName}</title>`);
  }

  if (updatedHtml !== html) {
    writeFileSync(indexPath, updatedHtml);
  }
}

console.log('✅ Contract and frontend created');
console.log('Next steps:');
console.log(`  1) Review contracts/${gameSlug}/src/lib.rs`);
console.log(`  2) bun run build ${gameSlug}`);
console.log(`  3) bun run deploy ${gameSlug}`);
console.log(`  4) bun run bindings ${gameSlug}`);
console.log(`  5) bun run dev:game ${gameSlug}`);
console.log(`     (or cd ${frontendSlug} && bun install && bun run dev)`);
