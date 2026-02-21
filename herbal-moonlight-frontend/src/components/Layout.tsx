import { WalletSwitcher } from './WalletSwitcher';
import './Layout.css';

interface LayoutProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Layout({ title, subtitle, children }: LayoutProps) {
  const resolvedTitle = title || import.meta.env.VITE_GAME_TITLE || 'Herbal Moonlight';
  const resolvedSubtitle = subtitle || import.meta.env.VITE_GAME_TAGLINE || 'ZK Garden Defense · Moonlit Realms';

  return (
    <div className="studio">
      {/* Garden + orb background */}
      <div className="studio-background" aria-hidden="true">
        <div
          style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'url(/jardin.png)',
            backgroundSize: 'cover', backgroundPosition: 'center top',
            opacity: 0.08,
          }}
        />
        <div className="studio-orb orb-1" />
        <div className="studio-orb orb-2" />
        <div className="studio-orb orb-3" />
        <div className="studio-grid" />
      </div>

      <header className="studio-header">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img
            src="/brujita.png"
            alt="Gardener"
            style={{ height: '64px', width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(201,168,76,0.5))' }}
          />
          <div>
            <div className="brand-title">{resolvedTitle}</div>
            <p className="brand-subtitle">{resolvedSubtitle}</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="network-pill">Testnet</div>
          <WalletSwitcher />
        </div>
      </header>

      <main className="studio-main">{children}</main>

      <footer className="studio-footer">
        <span>Powered by ZK Magic &amp; Stellar Game Studio</span>
      </footer>
    </div>
  );
}
