import { config } from './config';
import { Layout } from './components/Layout';
import { useWallet } from './hooks/useWallet';
import { HerbalMoonlightGame } from './games/herbal-moonlight/HerbalMoonlightGame';
import { LandingScreen } from './games/herbal-moonlight/LandingScreen';

const GAME_ID = 'herbal-moonlight';
const GAME_TITLE = import.meta.env.VITE_GAME_TITLE || 'Herbal Moonlight';
const GAME_TAGLINE = import.meta.env.VITE_GAME_TAGLINE || 'ZK Garden Defense · Moonlit Realms';

export default function App() {
  const { publicKey, isConnected, isConnecting, error, isDevModeAvailable } = useWallet();
  const userAddress = publicKey ?? '';
  const contractId = config.contractIds[GAME_ID] || '';
  const hasContract = Boolean(contractId && contractId !== 'YOUR_CONTRACT_ID');
  const devReady = isDevModeAvailable();

  // Pre-game error states use the LandingScreen overlay for visual consistency
  if (!hasContract) {
    return (
      <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
        <LandingScreen>
          <img src="/brujita.png" alt="" style={{ height: 80, objectFit: 'contain', filter: 'drop-shadow(0 0 20px rgba(201,168,76,0.6))', alignSelf: 'center' }} />
          <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem', color: 'var(--color-accent)', margin: 0, textAlign: 'center' }}>
            Contract Not Configured
          </h3>
          <p style={{ color: 'var(--color-ink-muted)', lineHeight: 1.6, fontSize: '0.8rem', textAlign: 'center' }}>
            Run <code style={{ background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 6 }}>bun run setup</code> to deploy testnet contracts and write contract IDs.
          </p>
        </LandingScreen>
      </Layout>
    );
  }

  if (!isConnected) {
    return (
      <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
        <LandingScreen>
          <p style={{ color: 'var(--color-ink-muted)', lineHeight: 1.7, maxWidth: 340, fontSize: '0.8rem', textAlign: 'center', margin: 0 }}>
            El Jardinero esconde hierbas m\u00E1gicas en un jard\u00EDn 5\u00D75.
            La Criatura debe cruzarlo sin ser derrotada.
          </p>
          {error && (
            <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(224,96,96,0.12)', border: '1px solid rgba(224,96,96,0.3)', borderRadius: 12, width: '100%' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-error)', margin: 0 }}>{error}</p>
            </div>
          )}
          {!devReady && (
            <div style={{ padding: '0.55rem 0.85rem', background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 10 }}>
              <p style={{ fontSize: '0.72rem', color: 'rgba(201,168,76,0.75)', margin: 0, textAlign: 'center' }}>
                Modo dev: ejecuta <code style={{ background: 'rgba(255,255,255,0.07)', padding: '1px 5px', borderRadius: 4 }}>bun run setup</code> para generar wallets.
              </p>
            </div>
          )}
          {isConnecting ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-accent)', fontSize: '0.85rem' }}>
              <span className="magic-loading">Conectando wallet\u2026</span>
            </div>
          ) : (
            <div style={{ fontSize: '0.78rem', color: 'var(--color-ink-muted)', textAlign: 'center', padding: '0.35rem 0.75rem', borderRadius: 8, background: 'rgba(0,0,0,0.3)' }}>
              {devReady
                ? '\u2699\uFE0F Usa el selector de jugador en la barra superior para conectar'
                : '\uD83D\uDD10 Conecta tu wallet para continuar'}
            </div>
          )}
        </LandingScreen>
      </Layout>
    );
  }

  return (
    <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
      <HerbalMoonlightGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onStandingsRefresh={() => {}}
        onGameComplete={() => {}}
      />
    </Layout>
  );
}
