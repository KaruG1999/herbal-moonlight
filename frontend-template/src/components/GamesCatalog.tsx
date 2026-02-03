import { useEffect, useState } from 'react';
import { TwentyOneGame } from '../games/twenty-one/TwentyOneGame';
import { NumberGuessGame } from '../games/number-guess/NumberGuessGame';
import { DiceDuelGame } from '../games/dice-duel/DiceDuelGame';
import { Resources } from './Resources';
import { useWallet } from '@/hooks/useWallet';
import './GamesCatalog.css';

const games = [
  {
    id: 'twenty-one',
    title: 'Twenty-One',
    emoji: '🃏',
    description: 'Card strategy duel where close-to-21 wins without busting.',
    tags: ['2 players', 'Card strategy'],
  },
  {
    id: 'number-guess',
    title: 'Number Guess',
    emoji: '🎯',
    description: 'Pick a number, lock it in, and reveal the closest guess.',
    tags: ['2 players', 'Fast rounds'],
  },
  {
    id: 'dice-duel',
    title: 'Dice Duel',
    emoji: '🎲',
    description: 'Roll two dice each and race for the highest total.',
    tags: ['2 players', 'Quick launch'],
  },
];

export function GamesCatalog() {
  const [selectedGame, setSelectedGame] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    if (window.location.hash === '#docs') return 'docs';
    if (window.location.hash === '#games') return 'library';
    return null;
  });
  const { publicKey, isConnected, isConnecting, error } = useWallet();

  const userAddress = publicKey ?? '';

  const handleSelectGame = (gameId: string) => {
    setSelectedGame(gameId);
  };

  const handleBackToStudio = () => {
    setSelectedGame(null);
  };

  const handleBackToLibrary = () => {
    setSelectedGame('library');
  };

  useEffect(() => {
    if (selectedGame === 'docs') {
      window.location.hash = 'docs';
      return;
    }
    if (selectedGame === 'library') {
      window.location.hash = 'games';
      return;
    }
    if (window.location.hash === '#docs' || window.location.hash === '#games') {
      const next = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, '', next);
    }
  }, [selectedGame]);

  if (selectedGame === 'docs') {
    return <Resources onBack={handleBackToStudio} />;
  }

  if (selectedGame === 'library') {
    return (
      <div className="library-page">
        <div className="library-header">
          <button className="btn-secondary" onClick={handleBackToStudio}>
            Back to Studio
          </button>
          <div className="library-intro">
            <h2>Games Library</h2>
            <p>Choose a template to play now or fork into your own title.</p>
          </div>
        </div>

        {!isConnected && (
          <div className="card wallet-banner">
            {error ? (
              <>
                <h3>Wallet Connection Error</h3>
                <p>{error}</p>
              </>
            ) : (
              <>
                <h3>{isConnecting ? 'Connecting…' : 'Connect a Dev Wallet'}</h3>
                <p>Use the switcher above to auto-connect and swap between demo players.</p>
              </>
            )}
          </div>
        )}

        <div className="games-grid">
          {games.map((game, index) => (
            <button
              key={game.id}
              className="game-card"
              type="button"
              disabled={!isConnected}
              onClick={() => handleSelectGame(game.id)}
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <div className="game-card-header">
                <span className="game-emoji">{game.emoji}</span>
                <span className="game-title">{game.title}</span>
              </div>
              <p className="game-description">{game.description}</p>
              <div className="game-tags">
                {game.tags.map((tag) => (
                  <span key={tag} className="game-tag">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="game-cta">Launch Game</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (selectedGame === 'twenty-one') {
    return (
      <TwentyOneGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  if (selectedGame === 'number-guess') {
    return (
      <NumberGuessGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  if (selectedGame === 'dice-duel') {
    return (
      <DiceDuelGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  return (
    <div className="studio-home">
      <section className="hero">
        <div className="hero-content">
          <h2>Development Tools For Web3 Game Builders On Stellar</h2>
          <p>
            Build with Stellar Game Studio to wire points-based mechanics, deterministic outcomes,
            and multi-player flows.
          </p>
          <div className="hero-actions">
            <button onClick={() => setSelectedGame('library')}>Explore Games</button>
            <button className="btn-secondary" onClick={() => handleSelectGame('docs')}>
              Open Docs
            </button>
          </div>
          <div className="hero-metrics">
            <div>
              <span className="metric-label">Games</span>
              <span className="metric-value">3 templates</span>
            </div>
            <div>
              <span className="metric-label">Network</span>
              <span className="metric-value">Stellar testnet</span>
            </div>
            <div>
              <span className="metric-label">Hooks</span>
              <span className="metric-value">start_game · end_game</span>
            </div>
          </div>
        </div>
        <div className="hero-panel">
          <div className="panel-title">Integration Snapshot</div>
          <pre>
            <code>{`game_hub.start_game(\n  game_id,\n  session_id,\n  player1,\n  player2,\n  player1_points,\n  player2_points,\n);`}</code>
          </pre>
          <div className="panel-footer">
            Use the shared Game Hub contract for points orchestration.
          </div>
        </div>
      </section>

      {!isConnected && (
        <div className="card wallet-banner">
          {error ? (
            <>
              <h3>Wallet Connection Error</h3>
              <p>{error}</p>
            </>
          ) : (
            <>
              <h3>{isConnecting ? 'Connecting…' : 'Connect a Dev Wallet'}</h3>
              <p>Use the switcher above to auto-connect and swap between demo players.</p>
            </>
          )}
        </div>
      )}

      <section id="quickstart" className="quickstart-section">
        <div className="section-header">
          <h3>Quickstart</h3>
          <p>Deploy contracts, generate bindings, and start the studio frontend in minutes.</p>
        </div>
        <div className="quickstart-grid">
          <div className="quickstart-card">
            <h4>1. Fork Repository</h4>
            <p>Fork and clone the Stellar Game Studio repo.</p>
            <code>git clone https://github.com/jamesbachini/Stellar-Game-Studio</code>
          </div>
          <div className="quickstart-card">
            <h4>2. Setup</h4>
            <p>Install dependencies, build, and deploy contracts.</p>
            <code>bun run setup</code>
          </div>
          <div className="quickstart-card">
            <h4>3. Build The Game</h4>
            <p>Export a standalone build for your new game.</p>
            <code>bun run publish my-game</code>
          </div>
        </div>
      </section>

      <section id="commands" className="commands-section">
        <div className="section-header">
          <h3>Bun Commands</h3>
          <p>Automate contracts, bindings, and standalone builds.</p>
        </div>
        <div className="commands-grid">
          <div className="command-card">
            <h4>All-in-one setup</h4>
            <p>Build contracts, deploy to testnet, generate bindings, and start the studio.</p>
            <code>bun run setup</code>
          </div>
          <div className="command-card">
            <h4>Contracts only</h4>
            <p>Build all Soroban contracts or a single game.</p>
            <code>bun run build [game]</code>
          </div>
          <div className="command-card">
            <h4>Deploy + IDs</h4>
            <p>Deploy contracts to testnet (all or one) and write contract IDs.</p>
            <code>bun run deploy [game]</code>
          </div>
          <div className="command-card">
            <h4>Generate bindings</h4>
            <p>Create TypeScript bindings for all or one contract.</p>
            <code>bun run bindings [game]</code>
          </div>
          <div className="command-card">
            <h4>Create a game</h4>
            <p>Scaffold a new contract and standalone frontend.</p>
            <code>bun run create my-game</code>
          </div>
          <div className="command-card">
            <h4>Publish frontend</h4>
            <p>Export a standalone build for hosting.</p>
            <code>bun run publish my-game</code>
          </div>
          <div className="command-card">
            <h4>Studio dev server</h4>
            <p>Run the studio frontend locally.</p>
            <code>bun run dev</code>
          </div>
          <div className="command-card">
            <h4>Build docs</h4>
            <p>Emit the studio site into the repo <code>docs/</code> folder.</p>
            <code>bun --cwd=sgs_frontend run build:docs</code>
          </div>
        </div>
      </section>

      <section className="integration-section">
        <div className="section-header">
          <h3>Why Game Hub?</h3>
          <p>Use a shared contract to coordinate points, sessions, and outcomes.</p>
        </div>
        <div className="integration-grid">
          <div className="integration-card">
            <h4>Reusable Templates</h4>
            <p>Ship faster with pre-built game contract and frontend templates & examples.</p>
          </div>
          <div className="integration-card">
            <h4>Ecosystem Ready</h4>
            <p>Ensure your game is compatible with the emerging Stellar gaming ecosystem.</p>
          </div>
          <div className="integration-card">
            <h4>Zero Knowledge</h4>
            <p>Use Stellar's latest zk integrations to build games with RiscZERO & Noir technology.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
