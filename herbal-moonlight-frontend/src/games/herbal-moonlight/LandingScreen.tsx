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

// ─── Shared nav pill style (Figma: 4px solid #312e81 border, transparent bg) ─
const NAV_PILL: React.CSSProperties = {
  all: 'unset',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.5rem 1.1rem',
  borderRadius: 16,
  background: 'transparent',
  border: '2px solid #312e81',
  color: '#ffffff',
  fontSize: '0.85rem',
  fontFamily: 'var(--font-serif)',
  fontWeight: 600,
  cursor: 'pointer',
  letterSpacing: '0.03em',
  whiteSpace: 'nowrap',
  transition: 'border-color 0.15s, background 0.15s',
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
  /** Show centered game logo in navbar (S2/S3/S4 only, not S1) */
  showLogo?: boolean;
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
  showLogo,
}: GameNavbarProps) {
  return (
    <nav style={{
      position: 'fixed',
      top: 0, left: 0, right: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0.85rem 1.5rem',
      background: 'rgba(27, 27, 40, 0.5)',
      boxShadow: 'inset 0px 4px 4px 0px rgba(0,0,0,0.25)',
      zIndex: 200,
      gap: '0.75rem',
      minHeight: 72,
    }}>
      {/* Left: Info */}
      <button style={NAV_PILL as React.CSSProperties} onClick={onInfo}>
        {showInfo ? 'Close' : 'Info'}
      </button>

      {/* Center: Logo — only in S2/S3/S4 (not S1 where logo sits above panel) */}
      {showLogo && (
        <img
          src="/assets/logo.png"
          alt="Herbal Moonlight"
          draggable={false}
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            height: 44,
            objectFit: 'contain',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 2px 8px rgba(201,168,76,0.4))',
          }}
        />
      )}

      {/* Right: wallet pill or Connect Wallet */}
      <div style={{ position: 'relative' }}>
        {walletAddress ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.5rem 1rem',
            borderRadius: 16,
            border: '2px solid #312e81',
            color: '#ffffff',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-mono)',
          }}>
            {devPlayer && (
              <span style={{ fontWeight: 700, color: 'var(--color-teal)', fontSize: '0.65rem' }}>
                P{devPlayer}
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: '0.85rem' }}>
              {walletAddress.slice(0, 4)}&hellip;{walletAddress.slice(-4)}
            </span>
            {onGearClick && (
              <button
                onClick={onGearClick}
                title="Dev tools"
                style={{
                  all: 'unset', boxSizing: 'border-box',
                  padding: '0.1rem 0.3rem', borderRadius: 4,
                  fontSize: '0.68rem', cursor: 'pointer', lineHeight: 1,
                  color: gearOpen ? '#99f6e4' : 'rgba(200,180,255,0.6)',
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
      {/* Image sets the panel height naturally — no objectFit:fill, no distortion */}
      <img
        src="/assets/panel-inicio.png"
        alt=""
        aria-hidden="true"
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
        draggable={false}
      />
      {/* Content overlaid on top of the image.
          Padding uses % so it scales with the panel width (% always = % of element width in CSS).
          Panel ratio 1280:853. Top ornament ≈ 30% of height = 20% of width.
          Bottom ornament ≈ 15% of height = 10% of width. Sides ≈ 12% each. */}
      <div style={{
        position: 'absolute',
        inset: 0,
        padding: '20% 12% 10%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.55rem',
        overflowY: 'auto',
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
  /**
   * 'primary'       — warm wood (default)
   * 'secondary'     — dimmer wood
   * 'ghost'         — transparent
   * 'green'         — Figma: rgba(75,95,32,0.6), border #4b5f20
   * 'blue'          — Figma: rgba(22,26,66,0.6), border #161a42
   * 'purple'        — Figma: rgba(116,57,171,0.6), border #7439ab
   * 'outlined-blue' — Figma S4: transparent, 3px solid #5c8ae5
   * 'solid-indigo'  — Figma S4: #495099, no border
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'green' | 'blue' | 'purple' | 'outlined-blue' | 'solid-indigo';
}

export function WoodButton({ children, onClick, disabled, variant = 'primary' }: WoodButtonProps) {
  const [hovered, setHovered] = useState(false);
  const isFigmaColor = ['green', 'blue', 'purple', 'outlined-blue', 'solid-indigo'].includes(variant);

  const bgBase =
    variant === 'green' ? 'rgba(75, 95, 32, 0.6)'
    : variant === 'blue' ? 'rgba(22, 26, 66, 0.6)'
    : variant === 'purple' ? 'rgba(116, 57, 171, 0.6)'
    : variant === 'outlined-blue' ? 'transparent'
    : variant === 'solid-indigo' ? '#495099'
    : variant === 'primary' ? 'rgba(55, 32, 10, 0.82)'
    : variant === 'secondary' ? 'rgba(38, 22, 8, 0.72)'
    : 'transparent'; // ghost

  const bgHover =
    variant === 'green' ? 'rgba(75, 95, 32, 0.8)'
    : variant === 'blue' ? 'rgba(22, 26, 66, 0.8)'
    : variant === 'purple' ? 'rgba(116, 57, 171, 0.8)'
    : variant === 'outlined-blue' ? 'rgba(92, 138, 229, 0.15)'
    : variant === 'solid-indigo' ? '#5a61aa'
    : variant === 'primary' ? 'rgba(75, 45, 15, 0.9)'
    : variant === 'secondary' ? 'rgba(55, 32, 10, 0.85)'
    : 'rgba(60, 40, 10, 0.15)'; // ghost

  const bg = disabled ? 'rgba(20, 10, 4, 0.45)' : hovered ? bgHover : bgBase;

  const border = disabled
    ? '1px solid rgba(100, 70, 30, 0.2)'
    : variant === 'green' ? '3px solid #4b5f20'
    : variant === 'blue' ? '3px solid #161a42'
    : variant === 'purple' ? '3px solid #7439ab'
    : variant === 'outlined-blue' ? '3px solid #5c8ae5'
    : variant === 'solid-indigo' ? 'none'
    : variant === 'ghost' ? '1px solid rgba(150, 110, 50, 0.25)'
    : variant === 'primary' ? '1px solid rgba(190, 140, 55, 0.55)'
    : '1px solid rgba(150, 110, 50, 0.35)'; // secondary

  const color = disabled
    ? 'rgba(130, 100, 60, 0.4)'
    : isFigmaColor
      ? '#ffffff'
      : variant === 'ghost'
        ? 'rgba(190, 160, 100, 0.65)'
        : 'rgba(255, 235, 185, 1)';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        all: 'unset',
        boxSizing: 'border-box',
        display: 'block',
        width: '100%',
        padding: isFigmaColor ? '0.5rem 1.2rem' : '0.55rem 1.2rem',
        borderRadius: isFigmaColor ? 14 : 8,
        fontWeight: 600,
        fontSize: isFigmaColor ? '0.88rem' : '0.85rem',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: isFigmaColor ? 'var(--font-serif)' : 'var(--font-body)',
        letterSpacing: isFigmaColor ? '0.05em' : '0.04em',
        color,
        background: bg,
        border,
        textShadow: (!disabled && !isFigmaColor) ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
        boxShadow: disabled || variant === 'ghost'
          ? 'none'
          : isFigmaColor
            ? `0 2px 12px rgba(0,0,0,0.35)${hovered ? ', 0 4px 20px rgba(0,0,0,0.45)' : ''}`
            : 'inset 0 1px 0 rgba(210,170,80,0.18), 0 2px 8px rgba(0,0,0,0.3)',
        transform: hovered && !disabled ? 'translateY(-1px)' : 'none',
        transition: 'background 0.15s, transform 0.12s, box-shadow 0.15s, opacity 0.15s',
        opacity: disabled ? 0.5 : 1,
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
      justifyContent: 'center',
      overflowY: 'auto',
    }}>
      {/* Forest background */}
      <div style={{
        position: 'fixed', inset: 0,
        backgroundImage: 'url(/assets/background.png)',
        backgroundSize: 'cover', backgroundPosition: 'center top',
        zIndex: -2,
      }} />
      {/* Figma overlay: rgba(76,71,91,0.4) flat purple-grey tint */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(76, 71, 91, 0.4)',
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
          position: 'fixed', top: 72, left: 0, right: 0,
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

      {/* Page content — capped at 1000px, centered by parent flex */}
      <div style={{
        width: '90%',
        maxWidth: 1000,
        padding: '72px 0 1.5rem',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 0,
      }}>
        {/* Logo — ~56% wide, bottom overlaps panel top (reference: herbs sit on top wood border) */}
        {showLogo && (
          <img
            src="/assets/logo.png"
            alt="Herbal Moonlight"
            style={{
              width: '56%', maxWidth: 560, height: 'auto',
              objectFit: 'contain',
              filter: 'drop-shadow(0 4px 32px rgba(201,168,76,0.6)) drop-shadow(0 0 80px rgba(100,80,180,0.3))',
              marginBottom: '-5rem', // logo bottom (herbs) sits over panel top frame
              position: 'relative', zIndex: 2,
            }}
            draggable={false}
          />
        )}

        {/* Wood panel — fills container width, matching ~95vw reference */}
        {/* ZkTutorial va al final para no ocultar los botones de acción */}
        <WoodPanel maxWidth={9999}>
          {children}
          <ZkTutorial />
        </WoodPanel>

        {/* Footer */}
        <p style={{
          marginTop: '1rem',
          fontSize: '0.65rem', color: 'rgba(200, 180, 140, 0.45)',
          textAlign: 'center', fontFamily: 'var(--font-serif)',
          letterSpacing: '0.02em',
        }}>
          Powered by ZK Magic &amp; Stellar Game Studio
        </p>
      </div>
    </div>
  );
}
