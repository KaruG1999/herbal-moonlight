import { useState, useEffect, useRef } from 'react';
import { HerbalMoonlightService } from './herbalMoonlightService';
import { GamePhase, MoonPhase, type GameSession } from './bindings';
import { useWallet } from '@/hooks/useWallet';
import { getContractId } from '@/utils/constants';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { DevWalletService, devWalletService } from '@/services/devWalletService';
import { Buffer } from 'buffer';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const GRID_SIZE = 5;
const MAX_PLANTS = 5;
const POINTS_DECIMALS = 7;
const DEFAULT_POINTS = '0.1';

const PLANT_INFO: Record<number, { name: string; damage: number; image: string; color: string }> = {
  1: { name: 'Lavender', damage: 2, image: '/assets/lavender.png', color: '#a78bfa' },
  2: { name: 'Mint',     damage: 1, image: '/assets/mint.png',     color: '#34d399' },
  3: { name: 'Mandrake', damage: 3, image: '/assets/mandrake.png', color: '#f97316' },
};

const CREATURE_IMAGE = '/assets/creature.png';
const BACKGROUND_IMAGE = '/assets/background.jpeg';

const CONTRACT_ID = getContractId('herbal-moonlight');
const service = new HerbalMoonlightService(CONTRACT_ID);

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    let value = 0;
    const buffer = new Uint32Array(1);
    while (value === 0) { crypto.getRandomValues(buffer); value = buffer[0]; }
    return value;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

async function sha256(data: Uint8Array | Buffer): Promise<Buffer> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
  return Buffer.from(hashBuffer);
}

function saveGardenLayout(sessionId: number, layout: number[]): void {
  localStorage.setItem(`hm-garden-${sessionId}`, JSON.stringify(layout));
}

function loadGardenLayout(sessionId: number): number[] | null {
  try {
    const raw = localStorage.getItem(`hm-garden-${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function isValidCreatureMove(fromX: number, fromY: number, toX: number, toY: number): boolean {
  return (toY - fromY) === 1
    && Math.abs(toX - fromX) <= 1
    && toX >= 0 && toX < GRID_SIZE
    && toY >= 0 && toY < GRID_SIZE;
}

function cellIsRevealed(revealedCells: number[], x: number, y: number): boolean {
  return revealedCells.includes(y * GRID_SIZE + x);
}

function moonEmoji(m: MoonPhase) {
  return m === MoonPhase.FullMoon ? '\uD83C\uDF15' : m === MoonPhase.NewMoon ? '\uD83C\uDF11' : '\uD83C\uDF17';
}

function moonLabel(m: MoonPhase) {
  return m === MoonPhase.FullMoon ? 'Full Moon' : m === MoonPhase.NewMoon ? 'New Moon' : 'Balanced';
}

function phaseLabel(p: GamePhase) {
  switch (p) {
    case GamePhase.WaitingForCommitment: return 'Awaiting Garden Commit';
    case GamePhase.WaitingForProof: return "Gardener's Turn (Reveal)";
    case GamePhase.Playing: return "Creature's Turn";
    case GamePhase.Finished: return 'Game Over';
  }
}

function parsePoints(value: string): bigint | null {
  try {
    const cleaned = value.replace(/[^\d.]/g, '');
    if (!cleaned || cleaned === '.') return null;
    const [whole = '0', fraction = ''] = cleaned.split('.');
    return BigInt(whole + fraction.padEnd(POINTS_DECIMALS, '0').slice(0, POINTS_DECIMALS));
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════
// Board Sub-Component
// ═══════════════════════════════════════════════════════════════════════

interface BoardProps {
  session: GameSession;
  role: 'gardener' | 'creature' | null;
  gardenLayout: number[];
  loading: boolean;
  onCellClick: (x: number, y: number) => void;
}

function HerbalMoonlightBoard({ session, role, gardenLayout, loading, onCellClick }: BoardProps) {
  const renderCell = (x: number, y: number) => {
    const idx = y * GRID_SIZE + x;
    const isCreature = session.creature_x === x && session.creature_y === y;
    const revealed = cellIsRevealed(session.revealed_cells, x, y);
    const isHouseRow = y === 4;
    const isStartRow = y === 0;
    const plantType = gardenLayout[idx];
    const plantInfo = PLANT_INFO[plantType];

    const gardenerCanSee = role === 'gardener' && plantType > 0;
    const isValidTarget = role === 'creature'
      && session.phase === GamePhase.Playing
      && isValidCreatureMove(session.creature_x, session.creature_y, x, y);
    const showFog = role === 'creature' && !revealed && !isStartRow && !(isCreature && y === 0);
    const isPlacementMode = session.phase === GamePhase.WaitingForCommitment && role === 'gardener';

    return (
      <div
        key={idx}
        onClick={() => onCellClick(x, y)}
        className={`relative aspect-square rounded-[10px] overflow-hidden transition-all duration-300 ${
          (isValidTarget || isPlacementMode) && !loading ? 'cursor-pointer' : 'cursor-default'
        }`}
        style={{
          background: isHouseRow
            ? 'linear-gradient(135deg, rgba(180,140,60,0.18) 0%, rgba(120,90,30,0.12) 100%)'
            : isStartRow
              ? 'rgba(60,50,100,0.25)'
              : 'rgba(30,20,60,0.45)',
          border: isValidTarget
            ? '2px solid rgba(120,200,255,0.6)'
            : isHouseRow
              ? '1px solid rgba(200,160,60,0.35)'
              : '1px solid rgba(140,120,255,0.12)',
          animation: isValidTarget ? 'hm-glow 2s ease-in-out infinite' : undefined,
        }}
      >
        {isHouseRow && (
          <div className="absolute bottom-0.5 right-1 text-xs opacity-50 pointer-events-none" style={{ color: '#d4a44a' }}>
            {'\uD83C\uDFE0'}
          </div>
        )}

        {showFog && (
          <div
            className="absolute inset-0 z-[3]"
            style={{
              background: 'radial-gradient(ellipse at 35% 45%, rgba(50,35,100,0.88) 0%, rgba(20,12,50,0.92) 100%)',
              animation: 'hm-fogPulse 4s ease-in-out infinite',
            }}
          >
            <div className="absolute inset-0 opacity-15" style={{
              backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(160,140,255,0.3) 1px, transparent 1px), radial-gradient(circle at 70% 70%, rgba(160,140,255,0.2) 1px, transparent 1px)',
              backgroundSize: '18px 18px, 24px 24px',
            }} />
          </div>
        )}

        {plantInfo && (gardenerCanSee || (revealed && plantType > 0)) && (
          <img
            src={plantInfo.image}
            alt={plantInfo.name}
            className="absolute z-[2]"
            style={{
              inset: '12%', width: '76%', height: '76%',
              objectFit: 'contain',
              animation: revealed ? 'hm-fadeIn 0.5s ease-out' : undefined,
              opacity: isPlacementMode ? 0.9 : (gardenerCanSee && !revealed ? 0.45 : 0.85),
              filter: `drop-shadow(0 0 6px ${plantInfo.color}55)`,
            }}
          />
        )}

        {isPlacementMode && plantType === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-[1] opacity-15 text-[28px] pointer-events-none" style={{ color: '#c4b5fd' }}>
            +
          </div>
        )}

        {isCreature && (
          <img
            src={CREATURE_IMAGE}
            alt="Creature"
            className="absolute z-[8]"
            style={{
              inset: '8%', width: '84%', height: '84%',
              objectFit: 'contain',
              animation: 'hm-creatureFloat 3s ease-in-out infinite',
              filter: 'drop-shadow(0 0 10px rgba(255,180,50,0.55))',
              transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        )}

        {revealed && plantType === 0 && !isCreature && (
          <div className="absolute inset-0 flex items-center justify-center z-[1] opacity-25 text-lg pointer-events-none" style={{ color: '#a78bfa' }}>
            {'\u2714'}
          </div>
        )}

        <span className="absolute top-0.5 left-1 text-[9px] pointer-events-none z-[1]" style={{ color: 'rgba(160,140,220,0.3)' }}>
          {x},{y}
        </span>
      </div>
    );
  };

  const cells = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      cells.push(renderCell(x, y));
    }
  }

  return (
    <div
      className="grid gap-[5px] w-full max-w-[420px] aspect-square"
      style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}
    >
      {cells}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════

interface HerbalMoonlightGameProps {
  userAddress: string;
  currentEpoch?: number;
  availablePoints?: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onBack: () => void;
  onStandingsRefresh?: () => void;
  onGameComplete?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════

export function HerbalMoonlightGame({
  userAddress,
  availablePoints = 0n,
  initialXDR,
  initialSessionId,
  onBack,
  onStandingsRefresh,
  onGameComplete,
}: HerbalMoonlightGameProps) {
  const { getContractSigner, walletType } = useWallet();

  // ─── Session / Create state ─────────────────────────────────────────
  const [sessionId, setSessionId] = useState(() => createRandomSessionId());
  const [player1Address, setPlayer1Address] = useState(userAddress);
  const [player1Points, setPlayer1Points] = useState(DEFAULT_POINTS);
  const [session, setSession] = useState<GameSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ─── Phase / Mode (matches TwentyOne / NumberGuess pattern) ─────────
  const [gamePhase, setGamePhase] = useState<'create' | 'play' | 'complete'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'import' | 'load'>('create');

  // ─── Export / Import state ──────────────────────────────────────────
  const [exportedAuthEntryXDR, setExportedAuthEntryXDR] = useState<string | null>(null);
  const [importAuthEntryXDR, setImportAuthEntryXDR] = useState('');
  const [importSessionId, setImportSessionId] = useState('');
  const [importPlayer1, setImportPlayer1] = useState('');
  const [importPlayer1Points, setImportPlayer1Points] = useState('');
  const [importPlayer2Points, setImportPlayer2Points] = useState(DEFAULT_POINTS);
  const [loadSessionId, setLoadSessionId] = useState('');
  const [authEntryCopied, setAuthEntryCopied] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  const [xdrParsing, setXdrParsing] = useState(false);
  const [xdrParseError, setXdrParseError] = useState<string | null>(null);
  const [xdrParseSuccess, setXdrParseSuccess] = useState(false);

  // ─── Garden state ───────────────────────────────────────────────────
  const [gardenLayout, setGardenLayout] = useState<number[]>(new Array(25).fill(0));
  const [selectedPlant, setSelectedPlant] = useState(1);
  const [gardenCommitment, setGardenCommitment] = useState<Buffer | null>(null);

  // ─── Derived ────────────────────────────────────────────────────────
  const isBusy = loading || quickstartLoading;
  const actionLock = useRef(false);
  const quickstartAvailable = walletType === 'dev'
    && DevWalletService.isDevModeAvailable()
    && DevWalletService.isPlayerAvailable(1)
    && DevWalletService.isPlayerAvailable(2);

  const role = session
    ? (userAddress === session.gardener ? 'gardener' as const : userAddress === session.creature ? 'creature' as const : null)
    : null;

  const isMyTurn = !!(session && role && (
    (session.phase === GamePhase.WaitingForCommitment && role === 'gardener') ||
    (session.phase === GamePhase.Playing && role === 'creature') ||
    (session.phase === GamePhase.WaitingForProof && role === 'gardener')
  ));

  const plantCount = gardenLayout.filter(p => p > 0).length;

  // ─── Sync wallet address ────────────────────────────────────────────
  useEffect(() => {
    setPlayer1Address(userAddress);
  }, [userAddress]);

  useEffect(() => {
    if (createMode === 'import' && !importPlayer2Points.trim()) {
      setImportPlayer2Points(DEFAULT_POINTS);
    }
  }, [createMode, importPlayer2Points]);

  // ─── Action wrapper (prevents double-submit) ───────────────────────
  const runAction = async (action: () => Promise<void>) => {
    if (actionLock.current || isBusy) return;
    actionLock.current = true;
    try { await action(); }
    finally { actionLock.current = false; }
  };

  // ─── Load session from chain ────────────────────────────────────────
  const loadSessionState = async () => {
    try {
      const s = await service.getSession(sessionId);
      if (s) {
        setSession(s);
        if (s.phase === GamePhase.Finished) {
          setGamePhase('complete');
        } else {
          setGamePhase('play');
        }
      }
    } catch {
      setSession(null);
    }
  };

  // ─── Poll for state when waiting for opponent ───────────────────────
  useEffect(() => {
    if (gamePhase === 'create') return;
    if (!session || !role) return;
    if (isMyTurn || session.phase === GamePhase.Finished) return;

    const interval = setInterval(async () => {
      const s = await service.getSession(sessionId);
      if (s) {
        setSession(s);
        if (s.phase === GamePhase.Finished) setGamePhase('complete');
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [session, sessionId, role, isMyTurn, gamePhase]);

  // ─── Load garden from localStorage when gardener ────────────────────
  useEffect(() => {
    if (!session || role !== 'gardener') return;
    const stored = loadGardenLayout(sessionId);
    if (stored) {
      setGardenLayout(stored);
      sha256(new Uint8Array(stored)).then(setGardenCommitment);
    }
  }, [session, role, sessionId]);

  // ─── Auto-refresh standings on completion ───────────────────────────
  useEffect(() => {
    if (gamePhase === 'complete' && session?.phase === GamePhase.Finished) {
      onStandingsRefresh?.();
    }
  }, [gamePhase, session?.phase]);

  // ─── Deep-link / initial values ─────────────────────────────────────
  useEffect(() => {
    if (initialXDR) {
      try {
        const parsed = service.parseAuthEntry(initialXDR);
        service.getSession(parsed.sessionId)
          .then((s) => {
            if (s) {
              setSession(s);
              setSessionId(parsed.sessionId);
              setGamePhase('play');
            } else {
              setCreateMode('import');
              setImportAuthEntryXDR(initialXDR);
              setImportSessionId(parsed.sessionId.toString());
              setImportPlayer1(parsed.gardener);
              setImportPlayer1Points((Number(parsed.gardenerPoints) / 10_000_000).toString());
              setImportPlayer2Points(DEFAULT_POINTS);
            }
          })
          .catch(() => {
            setCreateMode('import');
            setImportAuthEntryXDR(initialXDR);
            setImportPlayer2Points(DEFAULT_POINTS);
          });
      } catch {
        setCreateMode('import');
        setImportAuthEntryXDR(initialXDR);
        setImportPlayer2Points(DEFAULT_POINTS);
      }
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const authEntry = urlParams.get('auth');
    const urlSessionId = urlParams.get('session-id');

    if (authEntry) {
      try {
        const parsed = service.parseAuthEntry(authEntry);
        service.getSession(parsed.sessionId)
          .then((s) => {
            if (s) {
              setSession(s);
              setSessionId(parsed.sessionId);
              setGamePhase('play');
            } else {
              setCreateMode('import');
              setImportAuthEntryXDR(authEntry);
              setImportSessionId(parsed.sessionId.toString());
              setImportPlayer1(parsed.gardener);
              setImportPlayer1Points((Number(parsed.gardenerPoints) / 10_000_000).toString());
              setImportPlayer2Points(DEFAULT_POINTS);
            }
          })
          .catch(() => {
            setCreateMode('import');
            setImportAuthEntryXDR(authEntry);
            setImportPlayer2Points(DEFAULT_POINTS);
          });
      } catch {
        setCreateMode('import');
        setImportAuthEntryXDR(authEntry);
        setImportPlayer2Points(DEFAULT_POINTS);
      }
    } else if (urlSessionId) {
      setCreateMode('load');
      setLoadSessionId(urlSessionId);
    } else if (initialSessionId) {
      setCreateMode('load');
      setLoadSessionId(initialSessionId.toString());
    }
  }, [initialXDR, initialSessionId]);

  // ─── Auto-parse Auth Entry XDR (debounced) ─────────────────────────
  useEffect(() => {
    if (createMode !== 'import' || !importAuthEntryXDR.trim()) {
      if (!importAuthEntryXDR.trim()) {
        setXdrParsing(false);
        setXdrParseError(null);
        setXdrParseSuccess(false);
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      }
      return;
    }

    const parseXDR = async () => {
      setXdrParsing(true);
      setXdrParseError(null);
      setXdrParseSuccess(false);
      try {
        const gameParams = service.parseAuthEntry(importAuthEntryXDR.trim());
        if (gameParams.gardener === userAddress) {
          throw new Error('You cannot play against yourself. This auth entry was created by you (Gardener).');
        }
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.gardener);
        setImportPlayer1Points((Number(gameParams.gardenerPoints) / 10_000_000).toString());
        setXdrParseSuccess(true);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Invalid auth entry XDR';
        setXdrParseError(errorMsg);
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      } finally {
        setXdrParsing(false);
      }
    };

    const timeoutId = setTimeout(parseXDR, 500);
    return () => clearTimeout(timeoutId);
  }, [importAuthEntryXDR, createMode, userAddress]);

  // ═════════════════════════════════════════════════════════════════════
  // Create / Session Actions
  // ═════════════════════════════════════════════════════════════════════

  const handlePrepareTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) throw new Error('Enter a valid points amount');

        const signer = getContractSigner();
        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([player1Address, userAddress]);

        const authEntryXDR = await service.prepareStartGame(
          sessionId, player1Address, placeholderPlayer2Address,
          p1Points, p1Points, signer
        );

        setExportedAuthEntryXDR(authEntryXDR);
        setSuccess('Auth entry signed! Copy and send to the Creature player. Waiting for them to sign...');

        const pollInterval = setInterval(async () => {
          try {
            const s = await service.getSession(sessionId);
            if (s) {
              clearInterval(pollInterval);
              setSession(s);
              setExportedAuthEntryXDR(null);
              setSuccess('Game created! The Creature player has signed and submitted.');
              setGamePhase('play');
              onStandingsRefresh?.();
              setTimeout(() => setSuccess(null), 2000);
            }
          } catch { /* keep polling */ }
        }, 3000);
        setTimeout(() => clearInterval(pollInterval), 300000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to prepare transaction');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setQuickstartLoading(true);
        setError(null);
        setSuccess(null);
        if (walletType !== 'dev') throw new Error('Quickstart only works with dev wallets in the Games Library.');
        if (!DevWalletService.isDevModeAvailable() || !DevWalletService.isPlayerAvailable(1) || !DevWalletService.isPlayerAvailable(2)) {
          throw new Error('Quickstart requires both dev wallets. Run "bun run setup" and connect a dev wallet.');
        }

        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) throw new Error('Enter a valid points amount');

        const originalPlayer = devWalletService.getCurrentPlayer();
        let player1Addr = '';
        let player2Addr = '';
        let player1Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
        let player2Signer: ReturnType<typeof devWalletService.getSigner> | null = null;

        try {
          await devWalletService.initPlayer(1);
          player1Addr = devWalletService.getPublicKey();
          player1Signer = devWalletService.getSigner();

          await devWalletService.initPlayer(2);
          player2Addr = devWalletService.getPublicKey();
          player2Signer = devWalletService.getSigner();
        } finally {
          if (originalPlayer) await devWalletService.initPlayer(originalPlayer);
        }

        if (!player1Signer || !player2Signer) throw new Error('Quickstart failed to initialize dev wallet signers.');
        if (player1Addr === player2Addr) throw new Error('Quickstart requires two different dev wallets.');

        const quickstartSessionId = createRandomSessionId();
        setSessionId(quickstartSessionId);
        setPlayer1Address(player1Addr);
        setCreateMode('create');
        setExportedAuthEntryXDR(null);
        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);
        setLoadSessionId('');

        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([player1Addr, player2Addr]);

        const authEntryXDR = await service.prepareStartGame(
          quickstartSessionId, player1Addr, placeholderPlayer2Address,
          p1Points, p1Points, player1Signer
        );

        const fullySignedTxXDR = await service.importAndSignAuthEntry(
          authEntryXDR, player2Addr, p1Points, player2Signer
        );

        await service.finalizeStartGame(fullySignedTxXDR, player2Addr, player2Signer);

        try {
          const s = await service.getSession(quickstartSessionId);
          setSession(s);
        } catch { /* not ready yet */ }

        setGamePhase('play');
        onStandingsRefresh?.();
        setSuccess('Quickstart complete! Both players signed and the game is ready.');
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Quickstart failed');
      } finally {
        setQuickstartLoading(false);
      }
    });
  };

  const handleImportTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        if (!importAuthEntryXDR.trim()) throw new Error('Enter auth entry XDR from the Gardener');
        if (!importPlayer2Points.trim()) throw new Error('Enter your points amount (Creature)');

        const p2Points = parsePoints(importPlayer2Points);
        if (!p2Points || p2Points <= 0n) throw new Error('Invalid Creature points');

        const gameParams = service.parseAuthEntry(importAuthEntryXDR.trim());
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.gardener);
        setImportPlayer1Points((Number(gameParams.gardenerPoints) / 10_000_000).toString());

        if (gameParams.gardener === userAddress) {
          throw new Error('Invalid game: You cannot play against yourself');
        }

        const signer = getContractSigner();
        const fullySignedTxXDR = await service.importAndSignAuthEntry(
          importAuthEntryXDR.trim(), userAddress, p2Points, signer
        );
        await service.finalizeStartGame(fullySignedTxXDR, userAddress, signer);

        setSessionId(gameParams.sessionId);
        setSuccess('Game created successfully! Both players signed.');
        setGamePhase('play');

        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);

        await loadSessionState();
        onStandingsRefresh?.();
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import and sign transaction');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleLoadExistingGame = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        const parsedSessionId = parseInt(loadSessionId.trim());
        if (isNaN(parsedSessionId) || parsedSessionId <= 0) throw new Error('Enter a valid session ID');

        const s = await service.getSession(parsedSessionId);
        if (!s) throw new Error('Session not found');
        if (s.gardener !== userAddress && s.creature !== userAddress) {
          throw new Error('You are not a player in this game');
        }

        setSessionId(parsedSessionId);
        setSession(s);
        setLoadSessionId('');

        if (s.phase === GamePhase.Finished) {
          setGamePhase('complete');
          const gardenerWon = s.creature_hp === 0;
          const isGardener = s.gardener === userAddress;
          const youWon = (gardenerWon && isGardener) || (!gardenerWon && !isGardener);
          setSuccess(youWon ? 'You won this game!' : 'Game complete.');
        } else {
          setGamePhase('play');
          setSuccess('Game loaded! Continue playing.');
        }
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load game');
      } finally {
        setLoading(false);
      }
    });
  };

  const copyAuthEntryToClipboard = async () => {
    if (!exportedAuthEntryXDR) return;
    try {
      await navigator.clipboard.writeText(exportedAuthEntryXDR);
      setAuthEntryCopied(true);
      setTimeout(() => setAuthEntryCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const copyShareGameUrlWithAuthEntry = async () => {
    if (!exportedAuthEntryXDR) return;
    try {
      const params = new URLSearchParams({ game: 'herbal-moonlight', auth: exportedAuthEntryXDR });
      const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
      await navigator.clipboard.writeText(shareUrl);
      setShareUrlCopied(true);
      setTimeout(() => setShareUrlCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  // ═════════════════════════════════════════════════════════════════════
  // Game-play Actions
  // ═════════════════════════════════════════════════════════════════════

  const handlePlacePlant = (x: number, y: number) => {
    if (!session || session.phase !== GamePhase.WaitingForCommitment || role !== 'gardener') return;
    const idx = y * GRID_SIZE + x;
    const next = [...gardenLayout];
    if (next[idx] === selectedPlant) {
      next[idx] = 0;
    } else if (next[idx] > 0) {
      next[idx] = selectedPlant;
    } else {
      if (plantCount >= MAX_PLANTS) { setError(`Max ${MAX_PLANTS} plants.`); return; }
      next[idx] = selectedPlant;
    }
    setGardenLayout(next);
    setError(null);
  };

  const handleCommitGarden = () => runAction(async () => {
    if (role !== 'gardener' || !session) return;
    setError(null); setSuccess(null); setLoading(true);
    try {
      if (plantCount === 0) throw new Error('Place at least one plant before committing.');
      const signer = getContractSigner();
      const commitment = await sha256(new Uint8Array(gardenLayout));
      await service.commitGarden(sessionId, commitment, userAddress, signer);
      saveGardenLayout(sessionId, gardenLayout);
      setGardenCommitment(commitment);
      const updated = await service.getSession(sessionId);
      if (updated) { setSession(updated); setSuccess('Garden committed! Waiting for Creature to move.'); }
    } catch (err: any) {
      setError(err.message || 'Failed to commit garden');
    } finally { setLoading(false); }
  });

  const handleCreatureMove = (x: number, y: number) => runAction(async () => {
    if (role !== 'creature' || !session || session.phase !== GamePhase.Playing) return;
    if (!isValidCreatureMove(session.creature_x, session.creature_y, x, y)) return;
    setError(null); setSuccess(null); setLoading(true);
    try {
      const signer = getContractSigner();
      await service.creatureMove(sessionId, x, y, userAddress, signer);
      const updated = await service.getSession(sessionId);
      if (updated) { setSession(updated); setSuccess('Moved! Waiting for Gardener to reveal...'); }
    } catch (err: any) {
      setError(err.message || 'Move failed');
    } finally { setLoading(false); }
  });

  const handleRevealCell = () => runAction(async () => {
    if (role !== 'gardener' || !session || session.phase !== GamePhase.WaitingForProof) return;
    setError(null); setSuccess(null); setLoading(true);
    try {
      const layout = gardenLayout.some(v => v > 0) ? gardenLayout : loadGardenLayout(sessionId);
      if (!layout) throw new Error('Garden layout not found locally. Cannot reveal.');
      const commitment = gardenCommitment || await sha256(new Uint8Array(layout));

      const cx = session.creature_x;
      const cy = session.creature_y;
      const cellIdx = cy * GRID_SIZE + cx;
      const pType = layout[cellIdx];
      const hasPlant = pType > 0;
      const damage = hasPlant ? (PLANT_INFO[pType]?.damage ?? 0) : 0;

      // Build mock journal (73 bytes): commitment(32) + x + y + has_plant + plant_type + damage + padding(36)
      const journalBytes = Buffer.alloc(73);
      commitment.copy(journalBytes, 0);
      journalBytes[32] = cx;
      journalBytes[33] = cy;
      journalBytes[34] = hasPlant ? 1 : 0;
      journalBytes[35] = pType;
      journalBytes[36] = damage;

      const journalHash = await sha256(journalBytes);
      const emptySeal = Buffer.alloc(0);

      const signer = getContractSigner();
      await service.revealCell(sessionId, journalBytes, journalHash, emptySeal, userAddress, signer);

      const updated = await service.getSession(sessionId);
      if (updated) {
        setSession(updated);
        if (updated.phase === GamePhase.Finished) {
          const gardenerWon = updated.creature_hp === 0;
          setGamePhase('complete');
          setSuccess(gardenerWon
            ? 'The Creature has fallen! The garden is safe.'
            : 'The Creature reached the house. Game over.');
          onGameComplete?.();
        } else {
          setSuccess(hasPlant
            ? `${PLANT_INFO[pType]?.name} dealt ${damage} damage!`
            : 'Empty cell. The Creature advances unscathed.');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Reveal failed');
    } finally { setLoading(false); }
  });

  const handleCellClick = (x: number, y: number) => {
    if (!session || loading) return;
    if (session.phase === GamePhase.WaitingForCommitment && role === 'gardener') {
      handlePlacePlant(x, y);
    } else if (session.phase === GamePhase.Playing && role === 'creature') {
      if (isValidCreatureMove(session.creature_x, session.creature_y, x, y)) {
        handleCreatureMove(x, y);
      }
    }
  };

  // ═════════════════════════════════════════════════════════════════════
  // Render helpers
  // ═════════════════════════════════════════════════════════════════════

  const renderHpBar = () => {
    if (!session) return null;
    const maxHp = session.moon_phase === MoonPhase.FullMoon ? 8 : 6;
    const hp = session.creature_hp;
    const pct = Math.round((hp / maxHp) * 100);
    const color = pct > 50 ? '#4ade80' : pct > 25 ? '#facc15' : '#ef4444';
    const warn = hp <= 2 && hp > 0;

    return (
      <div className="w-full">
        <div className="flex justify-between mb-1 text-[13px]" style={{ color: '#c4b5fd' }}>
          <span>Creature HP</span>
          <span style={{ animation: warn ? 'hm-hpWarn 1s ease-in-out infinite' : undefined }}>{hp}/{maxHp}</span>
        </div>
        <div className="h-2.5 rounded-[5px] overflow-hidden" style={{ background: 'rgba(30,20,60,0.6)', border: '1px solid rgba(140,120,255,0.15)' }}>
          <div
            className="h-full rounded-[5px]"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${color}cc, ${color})`,
              boxShadow: `0 0 8px ${color}60`,
              transition: 'width 0.6s ease, background 0.6s ease',
            }}
          />
        </div>
      </div>
    );
  };

  const renderPlantPalette = () => {
    if (!session || session.phase !== GamePhase.WaitingForCommitment || role !== 'gardener') return null;

    return (
      <div className="flex flex-col gap-2 p-3.5 rounded-xl" style={{ background: 'rgba(20,14,50,0.7)', border: '1px solid rgba(140,120,255,0.15)' }}>
        <div className="text-[13px] font-semibold mb-0.5" style={{ color: '#c4b5fd' }}>
          Plant Palette ({plantCount}/{MAX_PLANTS})
        </div>
        {Object.entries(PLANT_INFO).map(([id, info]) => {
          const pid = Number(id);
          const active = selectedPlant === pid;
          const count = gardenLayout.filter(p => p === pid).length;
          return (
            <button
              key={pid}
              onClick={() => setSelectedPlant(pid)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-left transition-all duration-200"
              style={{
                background: active ? `${info.color}22` : 'transparent',
                outline: active ? `2px solid ${info.color}88` : '1px solid rgba(140,120,255,0.08)',
                border: 'none', color: '#e2d8ff',
              }}
            >
              <img src={info.image} alt={info.name} className="w-7 h-7 object-contain" />
              <div className="flex-1">
                <div className="font-medium">{info.name}</div>
                <div className="text-[11px] opacity-60">Dmg: {info.damage} | Placed: {count}</div>
              </div>
            </button>
          );
        })}
        <button
          onClick={handleCommitGarden}
          disabled={loading || plantCount === 0}
          className="mt-2 py-2.5 px-4 rounded-lg font-semibold text-sm transition-all duration-200"
          style={{
            background: plantCount > 0 ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'rgba(60,50,80,0.4)',
            color: plantCount > 0 ? '#fff' : '#888',
            border: 'none',
            cursor: plantCount > 0 && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? 'Committing...' : 'Commit Garden'}
        </button>
      </div>
    );
  };

  const renderActionPanel = () => {
    if (!session || !role) return null;

    if (!isMyTurn && session.phase !== GamePhase.Finished) {
      return (
        <div className="p-4 rounded-xl text-center text-sm" style={{
          background: 'rgba(20,14,50,0.7)', border: '1px solid rgba(140,120,255,0.12)', color: '#a78bfa',
        }}>
          <div className="inline-block w-4 h-4 border-2 border-t-transparent rounded-full mr-2 align-middle" style={{
            borderColor: '#a78bfa', borderTopColor: 'transparent',
            animation: 'hm-spin 0.8s linear infinite',
          }} />
          {session.phase === GamePhase.WaitingForCommitment && role === 'creature'
            ? 'Waiting for Gardener to commit the garden...'
            : session.phase === GamePhase.Playing && role === 'gardener'
              ? 'Waiting for Creature to move...'
              : session.phase === GamePhase.WaitingForProof && role === 'creature'
                ? 'Waiting for Gardener to reveal the cell...'
                : 'Waiting...'}
        </div>
      );
    }

    if (session.phase === GamePhase.WaitingForProof && role === 'gardener') {
      return (
        <button
          onClick={handleRevealCell}
          disabled={loading}
          className="w-full py-3 px-5 rounded-[10px] font-semibold text-[15px] transition-all duration-200"
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Revealing...' : `Reveal Cell (${session.creature_x}, ${session.creature_y})`}
        </button>
      );
    }

    if (session.phase === GamePhase.Playing && role === 'creature') {
      return (
        <div className="p-3.5 rounded-xl text-center text-sm" style={{
          background: 'rgba(20,14,50,0.7)', border: '1px solid rgba(120,200,255,0.2)', color: '#93c5fd',
        }}>
          Click a glowing cell to move the Creature forward.
        </div>
      );
    }

    return null;
  };

  // ═════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div
      className="min-h-screen relative p-8"
      style={{
        backgroundImage: `url(${BACKGROUND_IMAGE})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(180deg, rgba(8,4,24,0.90) 0%, rgba(15,8,40,0.82) 50%, rgba(8,4,24,0.90) 100%)',
      }} />

      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-5xl font-black mb-2 drop-shadow-lg" style={{ color: '#e2d8ff' }}>
              {'\uD83C\uDF3F'} Herbal Moonlight
            </h1>
            <p className="text-xl font-semibold" style={{ color: '#a78bfa' }}>
              Asymmetric ZK strategy on a 5x5 moonlit grid
            </p>
            <p className="text-sm font-mono mt-1" style={{ color: '#6b5f99' }}>
              Session ID: {sessionId}
            </p>
          </div>
          <button
            onClick={() => {
              if (session?.phase === GamePhase.Finished) onGameComplete?.();
              onBack();
            }}
            className="px-6 py-3 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
            style={{
              background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)',
              color: '#e2d8ff', border: '1px solid rgba(140,120,255,0.2)',
            }}
          >
            {'\u2190'} Back to Games
          </button>
        </div>

        {/* Error & Success Messages */}
        {error && (
          <div className="mb-6 p-4 rounded-xl" style={{
            background: 'rgba(239,68,68,0.15)', border: '2px solid rgba(239,68,68,0.4)',
          }}>
            <p className="font-semibold" style={{ color: '#fca5a5' }}>{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 rounded-xl" style={{
            background: 'rgba(74,222,128,0.1)', border: '2px solid rgba(74,222,128,0.3)',
          }}>
            <p className="font-semibold" style={{ color: '#86efac' }}>{success}</p>
          </div>
        )}

        {/* ═══ CREATE PHASE ═══════════════════════════════════════════ */}
        {gamePhase === 'create' && (
          <div className="rounded-2xl p-8 shadow-2xl" style={{
            background: 'rgba(20,14,50,0.85)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(140,120,255,0.12)',
          }}>
            {/* Mode Toggle */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 p-2 rounded-xl mb-6" style={{ background: 'rgba(10,6,30,0.6)' }}>
              <button
                onClick={() => {
                  setCreateMode('create');
                  setExportedAuthEntryXDR(null);
                  setImportAuthEntryXDR('');
                  setImportSessionId('');
                  setImportPlayer1('');
                  setImportPlayer1Points('');
                  setImportPlayer2Points(DEFAULT_POINTS);
                  setLoadSessionId('');
                }}
                className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                  createMode === 'create' ? 'shadow-lg' : 'hover:opacity-80'
                }`}
                style={{
                  background: createMode === 'create'
                    ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'rgba(255,255,255,0.05)',
                  color: createMode === 'create' ? '#fff' : '#8b7fbb',
                  border: 'none',
                }}
              >
                Create & Export
              </button>
              <button
                onClick={() => {
                  setCreateMode('import');
                  setExportedAuthEntryXDR(null);
                  setLoadSessionId('');
                }}
                className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                  createMode === 'import' ? 'shadow-lg' : 'hover:opacity-80'
                }`}
                style={{
                  background: createMode === 'import'
                    ? 'linear-gradient(135deg, #2563eb, #0891b2)' : 'rgba(255,255,255,0.05)',
                  color: createMode === 'import' ? '#fff' : '#8b7fbb',
                  border: 'none',
                }}
              >
                Import Auth Entry
              </button>
              <button
                onClick={() => {
                  setCreateMode('load');
                  setExportedAuthEntryXDR(null);
                  setImportAuthEntryXDR('');
                  setImportSessionId('');
                  setImportPlayer1('');
                  setImportPlayer1Points('');
                  setImportPlayer2Points(DEFAULT_POINTS);
                }}
                className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                  createMode === 'load' ? 'shadow-lg' : 'hover:opacity-80'
                }`}
                style={{
                  background: createMode === 'load'
                    ? 'linear-gradient(135deg, #7c3aed, #a855f7)' : 'rgba(255,255,255,0.05)',
                  color: createMode === 'load' ? '#fff' : '#8b7fbb',
                  border: 'none',
                }}
              >
                Load Existing Game
              </button>
            </div>

            {/* Quickstart Banner */}
            <div className="p-4 rounded-xl mb-6" style={{
              background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)',
            }}>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold" style={{ color: '#c4b5fd' }}>{'\u26A1'} Quickstart (Dev)</p>
                  <p className="text-xs font-semibold" style={{ color: '#8b7fbb' }}>
                    Creates and signs for both dev wallets in one click. Works only in the Games Library.
                  </p>
                </div>
                <button
                  onClick={handleQuickStart}
                  disabled={isBusy || !quickstartAvailable}
                  className="px-4 py-3 rounded-xl font-bold text-sm transition-all shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none"
                  style={{
                    background: !isBusy && quickstartAvailable
                      ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'rgba(60,50,80,0.4)',
                    color: !isBusy && quickstartAvailable ? '#fff' : '#666',
                    border: 'none',
                    cursor: !isBusy && quickstartAvailable ? 'pointer' : 'not-allowed',
                  }}
                >
                  {quickstartLoading ? 'Quickstarting...' : '\u26A1 Quickstart Game'}
                </button>
              </div>
            </div>

            {/* ─── CREATE MODE ─────────────────────────────────────── */}
            {createMode === 'create' ? (
              <div className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold mb-2" style={{ color: '#c4b5fd' }}>
                      Your Address (Gardener)
                    </label>
                    <input
                      type="text"
                      value={player1Address}
                      onChange={(e) => setPlayer1Address(e.target.value.trim())}
                      placeholder="G..."
                      className="w-full px-4 py-3 rounded-xl text-sm font-medium focus:outline-none"
                      style={{
                        background: 'rgba(10,6,30,0.6)', border: '1px solid rgba(140,120,255,0.2)',
                        color: '#e2d8ff',
                      }}
                    />
                    <p className="text-xs font-semibold mt-1" style={{ color: '#6b5f99' }}>
                      Pre-filled from your connected wallet. If you change it, you must be able to sign as that address.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold mb-2" style={{ color: '#c4b5fd' }}>
                      Your Points
                    </label>
                    <input
                      type="text"
                      value={player1Points}
                      onChange={(e) => setPlayer1Points(e.target.value)}
                      placeholder="0.1"
                      className="w-full px-4 py-3 rounded-xl text-sm font-medium focus:outline-none"
                      style={{
                        background: 'rgba(10,6,30,0.6)', border: '1px solid rgba(140,120,255,0.2)',
                        color: '#e2d8ff',
                      }}
                    />
                    <p className="text-xs font-semibold mt-1" style={{ color: '#6b5f99' }}>
                      Available: {(Number(availablePoints) / 10000000).toFixed(2)} Points
                    </p>
                  </div>

                  <div className="p-3 rounded-xl" style={{ background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)' }}>
                    <p className="text-xs font-semibold" style={{ color: '#93c5fd' }}>
                      The Creature player will specify their own address and points when they import your auth entry.
                    </p>
                  </div>
                </div>

                <div className="pt-4 space-y-4" style={{ borderTop: '1px solid rgba(140,120,255,0.1)' }}>
                  <p className="text-xs font-semibold" style={{ color: '#6b5f99' }}>
                    Session ID: {sessionId}
                  </p>

                  {!exportedAuthEntryXDR ? (
                    <button
                      onClick={handlePrepareTransaction}
                      disabled={isBusy}
                      className="w-full py-4 rounded-xl font-bold text-lg transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                      style={{
                        background: !isBusy ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'rgba(60,50,80,0.4)',
                        color: !isBusy ? '#fff' : '#666',
                        border: 'none',
                        cursor: !isBusy ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {loading ? 'Preparing...' : 'Prepare & Export Auth Entry'}
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="p-4 rounded-xl" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
                        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#86efac' }}>
                          Auth Entry XDR (Gardener Signed)
                        </p>
                        <div className="p-3 rounded-lg mb-3" style={{ background: 'rgba(10,6,30,0.6)', border: '1px solid rgba(74,222,128,0.15)' }}>
                          <code className="text-xs font-mono break-all" style={{ color: '#c4b5fd' }}>
                            {exportedAuthEntryXDR}
                          </code>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <button
                            onClick={copyAuthEntryToClipboard}
                            className="py-3 rounded-lg font-bold text-sm transition-all shadow-md hover:shadow-lg transform hover:scale-105"
                            style={{ background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', border: 'none', cursor: 'pointer' }}
                          >
                            {authEntryCopied ? '\u2713 Copied!' : 'Copy Auth Entry'}
                          </button>
                          <button
                            onClick={copyShareGameUrlWithAuthEntry}
                            className="py-3 rounded-lg font-bold text-sm transition-all shadow-md hover:shadow-lg transform hover:scale-105"
                            style={{ background: 'linear-gradient(135deg, #2563eb, #0891b2)', color: '#fff', border: 'none', cursor: 'pointer' }}
                          >
                            {shareUrlCopied ? '\u2713 Copied!' : 'Share URL'}
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-center font-semibold" style={{ color: '#6b5f99' }}>
                        Copy the auth entry XDR or share URL with the Creature player to complete the transaction
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : createMode === 'import' ? (
              /* ─── IMPORT MODE ──────────────────────────────────── */
              <div className="space-y-4">
                <div className="p-4 rounded-xl" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)' }}>
                  <p className="text-sm font-semibold mb-2" style={{ color: '#93c5fd' }}>
                    Import Auth Entry from Gardener
                  </p>
                  <p className="text-xs mb-4" style={{ color: '#8b7fbb' }}>
                    Paste the auth entry XDR from the Gardener. Session ID and Gardener info will be auto-extracted. You only need to enter your points amount.
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="flex items-center gap-2 text-xs font-bold mb-1" style={{ color: '#c4b5fd' }}>
                        Auth Entry XDR
                        {xdrParsing && <span className="animate-pulse" style={{ color: '#60a5fa' }}>Parsing...</span>}
                        {xdrParseSuccess && <span style={{ color: '#86efac' }}>{'\u2713'} Parsed successfully</span>}
                        {xdrParseError && <span style={{ color: '#fca5a5' }}>{'\u2717'} Parse failed</span>}
                      </label>
                      <textarea
                        value={importAuthEntryXDR}
                        onChange={(e) => setImportAuthEntryXDR(e.target.value)}
                        placeholder="Paste Gardener's signed auth entry XDR here..."
                        rows={4}
                        className="w-full px-4 py-3 rounded-xl text-xs font-mono resize-none focus:outline-none"
                        style={{
                          background: 'rgba(10,6,30,0.6)',
                          border: `1px solid ${xdrParseError ? 'rgba(239,68,68,0.4)' : xdrParseSuccess ? 'rgba(74,222,128,0.4)' : 'rgba(37,99,235,0.3)'}`,
                          color: '#e2d8ff',
                        }}
                      />
                      {xdrParseError && (
                        <p className="text-xs font-semibold mt-1" style={{ color: '#fca5a5' }}>{xdrParseError}</p>
                      )}
                    </div>
                    {/* Auto-populated fields (read-only) */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold mb-1" style={{ color: '#6b5f99' }}>Session ID (auto-filled)</label>
                        <input type="text" value={importSessionId} readOnly placeholder="Auto-filled from auth entry"
                          className="w-full px-4 py-2 rounded-xl text-xs font-mono cursor-not-allowed"
                          style={{ background: 'rgba(10,6,30,0.4)', border: '1px solid rgba(140,120,255,0.1)', color: '#8b7fbb' }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1" style={{ color: '#6b5f99' }}>Gardener Points (auto-filled)</label>
                        <input type="text" value={importPlayer1Points} readOnly placeholder="Auto-filled from auth entry"
                          className="w-full px-4 py-2 rounded-xl text-xs cursor-not-allowed"
                          style={{ background: 'rgba(10,6,30,0.4)', border: '1px solid rgba(140,120,255,0.1)', color: '#8b7fbb' }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1" style={{ color: '#6b5f99' }}>Gardener Address (auto-filled)</label>
                      <input type="text" value={importPlayer1} readOnly placeholder="Auto-filled from auth entry"
                        className="w-full px-4 py-2 rounded-xl text-xs font-mono cursor-not-allowed"
                        style={{ background: 'rgba(10,6,30,0.4)', border: '1px solid rgba(140,120,255,0.1)', color: '#8b7fbb' }}
                      />
                    </div>
                    {/* User inputs */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold mb-1" style={{ color: '#6b5f99' }}>Creature (You)</label>
                        <input type="text" value={userAddress} readOnly
                          className="w-full px-4 py-2 rounded-xl text-xs font-mono cursor-not-allowed"
                          style={{ background: 'rgba(10,6,30,0.4)', border: '1px solid rgba(140,120,255,0.1)', color: '#8b7fbb' }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1" style={{ color: '#c4b5fd' }}>Your Points *</label>
                        <input
                          type="text"
                          value={importPlayer2Points}
                          onChange={(e) => setImportPlayer2Points(e.target.value)}
                          placeholder="e.g., 0.1"
                          className="w-full px-4 py-2 rounded-xl text-xs focus:outline-none"
                          style={{ background: 'rgba(10,6,30,0.6)', border: '1px solid rgba(37,99,235,0.3)', color: '#e2d8ff' }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleImportTransaction}
                  disabled={isBusy || !importAuthEntryXDR.trim() || !importPlayer2Points.trim()}
                  className="w-full py-4 rounded-xl font-bold text-lg transition-all shadow-xl"
                  style={{
                    background: !isBusy && importAuthEntryXDR.trim() && importPlayer2Points.trim()
                      ? 'linear-gradient(135deg, #2563eb, #0891b2)' : 'rgba(60,50,80,0.4)',
                    color: !isBusy && importAuthEntryXDR.trim() ? '#fff' : '#666',
                    border: 'none',
                    cursor: !isBusy && importAuthEntryXDR.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  {loading ? 'Importing & Signing...' : 'Import & Sign Auth Entry'}
                </button>
              </div>
            ) : (
              /* ─── LOAD MODE ────────────────────────────────────── */
              <div className="space-y-4">
                <div className="p-4 rounded-xl" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
                  <p className="text-sm font-semibold mb-2" style={{ color: '#c4b5fd' }}>
                    Load Existing Game by Session ID
                  </p>
                  <p className="text-xs mb-4" style={{ color: '#8b7fbb' }}>
                    Enter a session ID to load and continue an existing game. You must be the Gardener or Creature.
                  </p>
                  <input
                    type="text"
                    value={loadSessionId}
                    onChange={(e) => setLoadSessionId(e.target.value)}
                    placeholder="Enter session ID (e.g., 123456789)"
                    className="w-full px-4 py-3 rounded-xl text-sm font-mono focus:outline-none"
                    style={{ background: 'rgba(10,6,30,0.6)', border: '1px solid rgba(140,120,255,0.2)', color: '#e2d8ff' }}
                  />
                </div>

                <div className="p-4 rounded-xl" style={{ background: 'rgba(124,58,237,0.05)', border: '1px solid rgba(140,120,255,0.1)' }}>
                  <p className="text-xs font-bold mb-2" style={{ color: '#c4b5fd' }}>Requirements</p>
                  <ul className="text-xs space-y-1 list-disc list-inside" style={{ color: '#8b7fbb' }}>
                    <li>You must be the Gardener or Creature in the game</li>
                    <li>Valid session ID from an existing game</li>
                  </ul>
                </div>

                <button
                  onClick={handleLoadExistingGame}
                  disabled={isBusy || !loadSessionId.trim()}
                  className="w-full py-4 rounded-xl font-bold text-lg transition-all shadow-xl"
                  style={{
                    background: !isBusy && loadSessionId.trim()
                      ? 'linear-gradient(135deg, #7c3aed, #a855f7)' : 'rgba(60,50,80,0.4)',
                    color: !isBusy && loadSessionId.trim() ? '#fff' : '#666',
                    border: 'none',
                    cursor: !isBusy && loadSessionId.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  {loading ? 'Loading...' : 'Load Game'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ PLAY PHASE ═════════════════════════════════════════════ */}
        {gamePhase === 'play' && session && (
          <div className="space-y-4">
            {/* Game info header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="text-sm" style={{ color: '#8b7fbb' }}>
                You are the <strong style={{ color: role === 'gardener' ? '#a78bfa' : '#fb923c' }}>{role ?? 'spectator'}</strong>
                {' \u00B7 '}Turn {session.turn_number}
                {session.moon_phase === MoonPhase.FullMoon && ' \u00B7 Creature has +2 HP (Full Moon)'}
                {session.moon_phase === MoonPhase.NewMoon && ' \u00B7 Plants deal +1 damage (New Moon)'}
              </div>
              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-full text-[13px] font-medium" style={{
                  background: 'rgba(20,14,50,0.7)', border: '1px solid rgba(140,120,255,0.15)', color: '#e2d8ff',
                }}>
                  {moonEmoji(session.moon_phase)} {moonLabel(session.moon_phase)}
                </div>
                <div className="px-3 py-1.5 rounded-full text-xs font-medium" style={{
                  background: isMyTurn ? 'rgba(124,58,237,0.3)' : 'rgba(20,14,50,0.7)',
                  border: isMyTurn ? '1px solid rgba(124,58,237,0.5)' : '1px solid rgba(140,120,255,0.12)',
                  color: isMyTurn ? '#c4b5fd' : '#8b7fbb',
                }}>
                  {phaseLabel(session.phase)}
                </div>
              </div>
            </div>

            {/* HP Bar */}
            <div>{renderHpBar()}</div>

            {/* Grid + Side panel */}
            <div className="flex gap-5 flex-1 items-start flex-wrap">
              <div className="flex-[1_1_320px] relative">
                <HerbalMoonlightBoard
                  session={session}
                  role={role}
                  gardenLayout={gardenLayout}
                  loading={loading}
                  onCellClick={handleCellClick}
                />
              </div>

              {/* Side panel */}
              <div className="flex-[0_0_200px] flex flex-col gap-3">
                {renderPlantPalette()}
                {renderActionPanel()}

                {/* Player info */}
                <div className="p-3.5 rounded-xl text-xs flex flex-col gap-1.5" style={{
                  background: 'rgba(20,14,50,0.7)', border: '1px solid rgba(140,120,255,0.1)', color: '#8b7fbb',
                }}>
                  <div>
                    <span style={{ color: '#a78bfa' }}>Gardener:</span>{' '}
                    <span className="font-mono text-[11px]">{session.gardener.slice(0, 8)}...{session.gardener.slice(-4)}</span>
                  </div>
                  <div>
                    <span style={{ color: '#fb923c' }}>Creature:</span>{' '}
                    <span className="font-mono text-[11px]">{session.creature.slice(0, 8)}...{session.creature.slice(-4)}</span>
                  </div>
                  <div style={{ color: '#6b5f99' }}>
                    Points: {(Number(session.gardener_points) / 10000000).toFixed(2)} / {(Number(session.creature_points) / 10000000).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center pt-3" style={{ borderTop: '1px solid rgba(140,120,255,0.08)' }}>
              <button
                onClick={onBack}
                className="px-4 py-2 rounded-lg text-[13px]"
                style={{ background: 'transparent', border: '1px solid rgba(140,120,255,0.2)', color: '#8b7fbb', cursor: 'pointer' }}
              >
                Back
              </button>
              <div className="text-[11px]" style={{ color: '#4a4370' }}>
                Contract: {CONTRACT_ID.slice(0, 8)}...
              </div>
            </div>
          </div>
        )}

        {/* ═══ COMPLETE PHASE ═════════════════════════════════════════ */}
        {gamePhase === 'complete' && session && (() => {
          const creatureDied = session.creature_hp === 0;
          const gardenerWon = creatureDied;
          const youWon = (gardenerWon && role === 'gardener') || (!gardenerWon && role === 'creature');

          return (
            <div className="rounded-2xl p-10 shadow-2xl text-center" style={{
              background: 'rgba(20,14,50,0.9)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(140,120,255,0.15)',
            }}>
              <div className="text-7xl mb-6" style={{ animation: 'hm-victoryGlow 2s ease-in-out infinite' }}>
                {youWon ? '\u2728' : '\uD83D\uDC80'}
              </div>
              <h3 className="text-3xl font-black mb-4" style={{ color: '#e2d8ff' }}>
                Game Complete!
              </h3>
              <div className="text-xl font-bold mb-6" style={{ color: youWon ? '#fbbf24' : '#ef4444' }}>
                {youWon ? 'Victory!' : 'Defeat'}
              </div>

              {/* Player summary */}
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div className="p-6 rounded-xl" style={{ background: 'rgba(10,6,30,0.6)', border: '1px solid rgba(140,120,255,0.1)' }}>
                  <div className="text-sm font-bold mb-2" style={{ color: '#a78bfa' }}>Gardener</div>
                  <div className="font-mono text-xs mb-2" style={{ color: '#8b7fbb' }}>
                    {session.gardener.slice(0, 8)}...{session.gardener.slice(-4)}
                  </div>
                  <div className="text-xs" style={{ color: '#6b5f99' }}>
                    Points: {(Number(session.gardener_points) / 10000000).toFixed(2)}
                  </div>
                </div>
                <div className="p-6 rounded-xl" style={{ background: 'rgba(10,6,30,0.6)', border: '1px solid rgba(140,120,255,0.1)' }}>
                  <div className="text-sm font-bold mb-2" style={{ color: '#fb923c' }}>Creature</div>
                  <div className="font-mono text-xs mb-2" style={{ color: '#8b7fbb' }}>
                    {session.creature.slice(0, 8)}...{session.creature.slice(-4)}
                  </div>
                  <div className="text-xs" style={{ color: '#6b5f99' }}>
                    HP: {session.creature_hp} | Points: {(Number(session.creature_points) / 10000000).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Result */}
              <div className="p-5 rounded-xl shadow-lg mb-6" style={{
                background: youWon ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${youWon ? 'rgba(74,222,128,0.2)' : 'rgba(239,68,68,0.2)'}`,
              }}>
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#8b7fbb' }}>Result</p>
                <p className="text-lg font-bold" style={{ color: youWon ? '#86efac' : '#fca5a5' }}>
                  {creatureDied
                    ? 'The Creature succumbed to the herbal defenses.'
                    : 'The Creature reached the house under moonlight.'}
                </p>
                <p className="text-sm font-bold mt-2" style={{ color: '#c4b5fd' }}>
                  Winner: {gardenerWon ? 'Gardener' : 'Creature'}
                </p>
              </div>

              <button
                onClick={onBack}
                className="w-full py-4 rounded-xl font-bold text-lg transition-all shadow-xl hover:shadow-2xl"
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(140,120,255,0.2)', color: '#e2d8ff', cursor: 'pointer' }}
              >
                Back to Games
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
