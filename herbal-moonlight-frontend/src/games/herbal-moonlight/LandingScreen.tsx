/**
 * LandingScreen — Shared components for the forest-night aesthetic.
 *
 * Exports:
 *  - GameNavbar   : top bar (Info | logo | Connect Wallet)
 *  - WoodPanel    : ornate wood-frame card using panel-inicio.png
 *  - WoodButton   : button styled for inside WoodPanel
 *  - LandingScreen: full-screen overlay (background + navbar + WoodPanel)
 */
import { useState } from 'react';

// ─── Shared nav pill style ──────────────────────────────────────────────────
const NAV_PILL: React.CSSProperties = {
  all: 'unset',
  boxSizing: 'border-box',
  display: 'inline-block',
  padding: '0.3rem 0.85rem',
  borderRadius: 6,
  background: 'rgba(8, 5, 22, 0.65)',
  border: '1px solid rgba(140, 110, 220, 0.35)',
  color: 'rgba(220, 210, 255, 0.88)',
  fontSize: '0.72rem',
  fontFamily: 'var(--font-body)',
  fontWeight: 600,
  cursor: 'pointer',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
};

// ─── GameNavbar ─────────────────────────────────────────────────────────────
export interface GameNavbarProps {
  walletAddress?: string;
  /** Player number shown in wallet pill, dev mode only */
  devPlayer?: number;
  /** Show gear icon for dev switcher */
  onGearClick?: () => void;
  gearOpen?: boolean;
  onSwitchPlayer?: () => void;
  walletSwitching?: boolean;
  /** "Info" opens how-to-play panel */
  onInfo?: () => void;
  showInfo?: boolean;
}

export function GameNavbar({
  walletAddress,
  devPlayer,
  onGearClick,
  gearOpen,
  onSwitchPlayer,
  walletSwitching,
  onInfo,
  showInfo,
}: GameNavbarProps) {
  return (
    <nav style={{
      position: 'fixed',
      top: 0, left: 0, right: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0.55rem 1rem',
      background: 'rgba(4, 2, 14, 0.6)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      borderBottom: '1px solid rgba(120, 90, 200, 0.12)',
      zIndex: 200,
      gap: '0.5rem',
    }}>
      {/* Left: Info */}
      <button style={NAV_PILL as React.CSSProperties} onClick={onInfo}>
        {showInfo ? 'Close' : 'Info'}
      </button>

      {/* Center: small logo */}
      <img
        src="/assets/logo.png"
        alt="Herbal Moonlight"
        style={{
          height: 38, width: 'auto', objectFit: 'contain',
          filter: 'drop-shadow(0 0 10px rgba(201,168,76,0.45))',
        }}
        draggable={false}
      />

      {/* Right: wallet pill or Connect Wallet */}
      <div style={{ position: 'relative' }}>
        {walletAddress ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.3rem 0.75rem',
            borderRadius: 6,
            background: 'rgba(8, 5, 22, 0.65)',
            border: '1px solid rgba(201,168,76,0.2)',
            color: 'rgba(220, 210, 255, 0.75)',
            fontSize: '0.68rem',
            fontFamily: 'var(--font-mono)',
            backdropFilter: 'blur(6px)',
          }}>
            {devPlayer && (
              <span style={{ fontWeight: 700, color: 'var(--color-teal)', fontSize: '0.6rem' }}>
                P{devPlayer}
              </span>
            )}
            <span>{walletAddress.slice(0, 4)}&hellip;{walletAddress.slice(-4)}</span>
            {onGearClick && (
              <button
                onClick={onGearClick}
                title="Dev tools"
                style={{
                  all: 'unset', boxSizing: 'border-box',
                  padding: '0.1rem 0.3rem', borderRadius: 4,
                  fontSize: '0.68rem', cursor: 'pointer', lineHeight: 1,
                  color: gearOpen ? '#99f6e4' : 'rgba(200,180,255,0.45)',
                  background: gearOpen ? 'rgba(13,148,136,0.2)' : 'transparent',
                  border: '1px solid rgba(78,205,196,0.18)',
                  transition: 'all 0.15s',
                }}
              >
                {'\u2699\uFE0F'}
              </button>
            )}
          </div>
        ) : (
          <button style={NAV_PILL as React.CSSProperties}>
            Connect Wallet
          </button>
        )}

        {/* Gear dropdown */}
        {gearOpen && onSwitchPlayer && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            zIndex: 300,
            background: 'rgba(8,5,22,0.98)',
            border: '1px solid rgba(78,205,196,0.3)',
            borderRadius: 10,
            padding: '0.55rem 0.7rem',
            minWidth: 150,
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}>
            <div style={{ fontSize: '0.52rem', color: 'rgba(200,180,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>
              Debug — Dev Wallets
            </div>
            <button
              onClick={onSwitchPlayer}
              disabled={walletSwitching}
              style={{
                width: '100%', padding: '0.38rem 0.55rem',
                borderRadius: 7, border: '1px solid rgba(78,205,196,0.3)',
                background: 'rgba(13,148,136,0.15)',
                color: walletSwitching ? 'rgba(200,180,255,0.3)' : '#99f6e4',
                fontSize: '0.68rem', fontWeight: 600,
                cursor: walletSwitching ? 'not-allowed' : 'pointer',
              }}
            >
              {walletSwitching ? 'Switching...' : `Switch to P${devPlayer === 1 ? 2 : 1}`}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

// ─── WoodPanel ──────────────────────────────────────────────────────────────
// Uses panel-inicio.png (ornate wood frame with ivy, gems) as the background.
// The image stretches to fill the wrapper; generous padding keeps content
// inside the inner wood rectangle (away from the ornate frame/ivy).

interface WoodPanelProps {
  children: React.ReactNode;
  maxWidth?: number;
}

export function WoodPanel({ children, maxWidth = 480 }: WoodPanelProps) {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth, margin: '0 auto' }}>
      {/* Wood frame image — stretched to fill, content padding compensates */}
      <img
        src="/assets/panel-inicio.png"
        alt=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          zIndex: 0,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
        draggable={false}
      />
      {/* Content — padded to sit inside the wood rectangle */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        padding: '2.75rem 2.5rem 3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
        minHeight: 120,
      }}>
        {children}
      </div>
    </div>
  );
}

// ─── WoodButton ─────────────────────────────────────────────────────────────
interface WoodButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** 'primary' is the highlighted variant, 'secondary' is dimmer */
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function WoodButton({ children, onClick, disabled, variant = 'primary' }: WoodButtonProps) {
  const bg = disabled
    ? 'rgba(20, 10, 4, 0.45)'
    : variant === 'primary'
      ? 'rgba(55, 32, 10, 0.82)'
      : variant === 'secondary'
        ? 'rgba(38, 22, 8, 0.72)'
        : 'transparent';

  const border = disabled
    ? '1px solid rgba(100, 70, 30, 0.2)'
    : variant === 'ghost'
      ? '1px solid rgba(150, 110, 50, 0.25)'
      : variant === 'primary'
        ? '1px solid rgba(190, 140, 55, 0.55)'
        : '1px solid rgba(150, 110, 50, 0.35)';

  const color = disabled
    ? 'rgba(130, 100, 60, 0.4)'
    : variant === 'ghost'
      ? 'rgba(190, 160, 100, 0.65)'
      : 'rgba(238, 212, 158, 0.95)';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        all: 'unset',
        boxSizing: 'border-box',
        display: 'block',
        width: '100%',
        padding: '0.65rem 1.5rem',
        borderRadius: 8,
        fontWeight: 600,
        fontSize: '0.9rem',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-body)',
        letterSpacing: '0.04em',
        color,
        background: bg,
        border,
        boxShadow: disabled || variant === 'ghost'
          ? 'none'
          : 'inset 0 1px 0 rgba(210,170,80,0.18), 0 2px 8px rgba(0,0,0,0.3)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {children}
    </button>
  );
}

// ─── ZK Tutorial collapsible ─────────────────────────────────────────────────
function ZkTutorial() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ width: '100%' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          all: 'unset', boxSizing: 'border-box',
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.38rem 0.65rem', borderRadius: 6,
          background: 'rgba(12, 6, 2, 0.55)', border: '1px solid rgba(130, 90, 40, 0.25)',
          cursor: 'pointer',
          fontSize: '0.68rem', fontWeight: 700, color: 'rgba(195, 155, 90, 0.75)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <span>How does it work?</span>
        <span style={{ fontSize: '0.5rem', opacity: 0.6 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div style={{
          marginTop: '0.3rem', padding: '0.65rem 0.8rem',
          background: 'rgba(8, 4, 1, 0.7)', border: '1px solid rgba(130, 90, 40, 0.2)',
          borderRadius: 6, display: 'flex', flexDirection: 'column', gap: '0.4rem',
          animation: 'fadeUp 0.25s ease both',
        }}>
          {([
            ['1', '\uD83C\uDF3F Gardener plants in secret', 'Place herbs in the 5\u00D75 grid. Layout committed via SHA-256 — the Creature cannot see where they are.'],
            ['2', '\uD83D\uDC7B Creature crosses the garden', 'The Creature moves cell by cell toward the house. Each step may reveal a hidden plant.'],
            ['3', '\uD83D\uDD2E ZK Validation (SHA-256)', 'Gardener generates a cryptographic proof for each reveal. The Soroban contract verifies on-chain — no cheating possible.'],
          ] as [string, string, string][]).map(([num, title, desc]) => (
            <div key={num} style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start' }}>
              <span style={{
                flex: '0 0 auto', width: 16, height: 16, borderRadius: '50%',
                background: 'rgba(80, 50, 20, 0.7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.48rem', fontWeight: 700, color: 'rgba(200, 165, 100, 0.85)',
              }}>{num}</span>
              <div>
                <div style={{ fontSize: '0.63rem', fontWeight: 700, color: 'rgba(228, 195, 135, 0.9)', lineHeight: 1.35 }}>{title}</div>
                <div style={{ fontSize: '0.58rem', color: 'rgba(170, 135, 90, 0.75)', lineHeight: 1.45 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LandingScreen ───────────────────────────────────────────────────────────
interface LandingScreenProps {
  children: React.ReactNode;
  walletAddress?: string;
  showLogo?: boolean;
  /** Passed through to GameNavbar */
  navProps?: Omit<GameNavbarProps, 'walletAddress'>;
}

export function LandingScreen({
  children,
  walletAddress,
  showLogo = true,
  navProps,
}: LandingScreenProps) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      overflowY: 'auto',
    }}>
      {/* Forest background */}
      <div style={{
        position: 'fixed', inset: 0,
        backgroundImage: 'url(/assets/background.png)',
        backgroundSize: 'cover', backgroundPosition: 'center top',
        zIndex: -2,
      }} />
      {/* Dark vignette */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'linear-gradient(180deg, rgba(4,2,14,0.25) 0%, rgba(4,2,14,0.55) 100%)',
        zIndex: -1,
      }} />

      {/* Navbar */}
      <GameNavbar
        walletAddress={walletAddress}
        onInfo={() => setShowInfo(v => !v)}
        showInfo={showInfo}
        {...navProps}
      />

      {/* Info panel (collapsible) */}
      {showInfo && (
        <div style={{
          position: 'fixed', top: 52, left: 0, right: 0,
          zIndex: 190,
          background: 'rgba(6, 3, 18, 0.94)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(140,110,220,0.2)',
          padding: '1.25rem 1.5rem 1.5rem',
          animation: 'fadeUp 0.25s ease both',
        }}>
          <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1rem', color: 'var(--color-accent)', marginBottom: '0.75rem' }}>
            About Herbal Moonlight
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-ink-muted)', lineHeight: 1.65, maxWidth: 480 }}>
            A 2-player ZK strategy game on Stellar Soroban. The <strong style={{ color: 'var(--color-lavender)' }}>Gardener</strong> hides magical herbs in a 5&times;5 grid using a SHA-256 commitment. The <strong style={{ color: 'var(--color-creature)' }}>Creature</strong> navigates blind, stepping on cells and taking damage. The garden layout is <em>never fully revealed</em> — even after the game ends.
          </p>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            {[
              ['\uD83C\uDF3F Lavender', '1 HP damage', 'Calming Mist on next hit'],
              ['\uD83C\uDF3F Mint', '2 HP damage', 'Standard herb'],
              ['\uD83C\uDF3F Mandrake', '3 HP damage', 'Rare, powerful'],
            ].map(([name, dmg, note]) => (
              <div key={name} style={{ fontSize: '0.72rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--color-ink)' }}>{name}</div>
                <div style={{ color: 'var(--color-error)' }}>{dmg}</div>
                <div style={{ color: 'var(--color-ink-muted)' }}>{note}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Page content */}
      <div style={{
        width: '100%', maxWidth: 520,
        padding: '5.5rem 1rem 3rem',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '0.5rem',
      }}>
        {/* Large logo above the panel */}
        {showLogo && (
          <img
            src="/assets/logo.png"
            alt="Herbal Moonlight"
            style={{
              width: '100%', maxWidth: 340, height: 'auto',
              objectFit: 'contain',
              filter: 'drop-shadow(0 4px 32px rgba(201,168,76,0.55)) drop-shadow(0 0 60px rgba(100,80,180,0.2))',
              marginBottom: '-0.75rem', // slight overlap with panel top
            }}
            draggable={false}
          />
        )}

        {/* Wood panel — main card */}
        <WoodPanel maxWidth={460}>
          <ZkTutorial />
          {children}
        </WoodPanel>

        {/* Footer */}
        <p style={{
          marginTop: '0.6rem',
          fontSize: '0.58rem', color: 'rgba(170, 140, 90, 0.32)',
          textAlign: 'center', fontFamily: 'var(--font-body)',
        }}>
          Powered by ZK Magic &amp; Stellar Game Studio
        </p>
      </div>
    </div>
  );
}
