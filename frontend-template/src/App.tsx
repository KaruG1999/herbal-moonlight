import { config } from './config';
import { Layout } from './components/Layout';
import { GamesCatalog } from './components/GamesCatalog';

function App() {
  const hasAnyContracts = Object.keys(config.contractIds).length > 0;

  return (
    <Layout>
      {!hasAnyContracts && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3>Setup Required</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '1rem' }}>
            Contract IDs not configured. Please run <code>bun run setup</code> from the repo root
            to deploy contracts and configure the studio frontend.
          </p>
        </div>
      )}
      <GamesCatalog />
    </Layout>
  );
}

export default App;
