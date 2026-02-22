import { useState, useEffect, useRef, useCallback } from 'react';
import { HerbalMoonlightService } from './herbalMoonlightService';
import { useWallet } from '@/hooks/useWallet';
import { HERBAL_MOONLIGHT_CONTRACT } from '@/utils/constants';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import { Buffer } from 'buffer';
import type { GameSession, CellRevealResult } from './bindings';
import { GamePhase } from './bindings';
import {
  createEmptyGarden,
  computeGardenCommitment,
  buildJournal,
  computeJournalHash,
  validateGarden,
  getValidMoves,
  countPlants,
  countPlantsByType,
  moonPhaseLabel,
  moonPhaseEmoji,
  moonPhaseEffect,
  PLANT_NAMES,
  PLANT_EMOJI,
  PLANT_IMG,
  CREATURE_IMG,
  DIED_IMG,
  WITCH_IMG,
  GRID_SIZE,
  MAX_PLANTS,
  type GardenLayout,
} from './gardenUtils';
import { LandingScreen, WoodPanel, WoodButton, GameNavbar } from './LandingScreen';

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    let value = 0;
    const buffer = new Uint32Array(1);
    while (value === 0) {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    }
    return value;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

// ====================================================================
// Garden persistence in localStorage (critical for page refreshes)
// ====================================================================

const GARDEN_STORAGE_PREFIX = 'hm_garden_';

function saveGardenToStorage(sessionId: number, garden: GardenLayout, commitment: Buffer) {
  try {
    const key = GARDEN_STORAGE_PREFIX + sessionId;
    const data = {
      garden,
      commitment: commitment.toString('base64'),
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn('[saveGardenToStorage] Failed:', err);
  }
}

function loadGardenFromStorage(sessionId: number): { garden: GardenLayout; commitment: Buffer } | null {
  try {
    const key = GARDEN_STORAGE_PREFIX + sessionId;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.garden) || !data.commitment) return null;
    return {
      garden: data.garden,
      commitment: Buffer.from(data.commitment, 'base64'),
    };
  } catch (err) {
    console.warn('[loadGardenFromStorage] Failed:', err);
    return null;
  }
}

function clearGardenFromStorage(sessionId: number) {
  try {
    localStorage.removeItem(GARDEN_STORAGE_PREFIX + sessionId);
  } catch {}
}

// ====================================================================
// Pixel-art sprite helper
// ====================================================================

const SPRITE_SIZE = 34;
const spriteStyle: React.CSSProperties = {
  width: SPRITE_SIZE,
  height: SPRITE_SIZE,
  maxWidth: SPRITE_SIZE,
  maxHeight: SPRITE_SIZE,
  objectFit: 'contain',
  imageRendering: 'pixelated',
  pointerEvents: 'none',
  flexShrink: 0,
};

function PlantSprite({ type, className }: { type: number; className?: string }) {
  const src = PLANT_IMG[type];
  if (!src) return null;
  return (
    <img
      src={src}
      alt={PLANT_NAMES[type]}
      className={className}
      style={spriteStyle}
      draggable={false}
    />
  );
}

function CreatureSprite({ className }: { className?: string }) {
  return (
    <img
      src={CREATURE_IMG}
      alt="Creature"
      className={className}
      style={spriteStyle}
      draggable={false}
    />
  );
}

// ====================================================================
// How to Play — collapsible instructions
// ====================================================================

function HowToPlay() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-2 rounded-xl bg-[#0a0e1a]/60 border border-purple-500/15 hover:border-purple-500/30 transition-all flex items-center justify-between"
        style={{ padding: '0.5rem 1rem' }}
      >
        <span className="text-xs font-bold text-purple-300/70">{open ? 'Hide' : 'How to Play'}</span>
        <span className="text-purple-300/40 text-xs">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="mt-2 p-4 bg-[#0a0e1a]/80 border border-purple-500/15 rounded-xl text-xs text-purple-200/70 space-y-2" style={{ animation: 'fadeUp 0.3s ease both' }}>
          <p><strong className="text-purple-200">Two Roles:</strong> The <strong className="text-purple-300">Gardener</strong> (witch) places magical plants in a 5&times;5 garden. The <strong className="text-amber-300">Creature</strong> (ghost) tries to cross it from top to bottom.</p>
          <p><strong className="text-purple-200">ZK Mechanic:</strong> The garden layout is hidden via a SHA-256 commitment. The Creature cannot see where plants are placed. Each cell is only revealed when the Creature steps on it, using a cryptographic proof.</p>
          <p><strong className="text-purple-200">Plants deal damage:</strong> Lavender (1), Mint (2), Mandrake (3). The Creature starts with 10 HP. If HP reaches 0, the Gardener wins. If the Creature reaches row 5 (the house), the Creature wins.</p>
          <p><strong className="text-purple-200">Moon Phases:</strong> Each game has a random moon phase that modifies damage and HP.</p>
          <p><strong className="text-purple-200">Turn Flow:</strong> Creature moves &rarr; Gardener reveals cell (ZK proof) &rarr; damage is applied on-chain &rarr; repeat.</p>
        </div>
      )}
    </div>
  );
}

// ====================================================================
// Service singleton
// ====================================================================

const service = new HerbalMoonlightService(HERBAL_MOONLIGHT_CONTRACT);

// Spirit Sense result type (demo mode — client-side only)
type SpiritSenseResult =
  | { ability: 'peek'; left: string | null; right: string | null }
  | { ability: 'smell'; count: number; rows: string }
  | { ability: 'peek' | 'smell'; noGarden: true };

interface HerbalMoonlightGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

type UIPhase = 'create' | 'garden-setup' | 'play' | 'complete';

export function HerbalMoonlightGame({
  userAddress,
  availablePoints,
  onStandingsRefresh,
  onGameComplete,
}: HerbalMoonlightGameProps) {
  const DEFAULT_POINTS = '0.1';
  const POINTS_DECIMALS = 7;
  const { getContractSigner, walletType, switchPlayer, getCurrentDevPlayer, isConnecting: walletSwitching } = useWallet();

  // Session state — sessionId starts as 0 (no active session) and is
  // generated lazily when the user actually creates or imports a game.
  const [sessionId, setSessionId] = useState<number>(0);
  const [gameState, setGameState] = useState<GameSession | null>(null);
  const [uiPhase, setUiPhase] = useState<UIPhase>('create');

  // Create phase
  const [createMode, setCreateMode] = useState<'create' | 'import' | 'load'>('create');
  const [player1Address, setPlayer1Address] = useState(userAddress);
  const [player1Points, setPlayer1Points] = useState(DEFAULT_POINTS);
  const [exportedAuthEntryXDR, setExportedAuthEntryXDR] = useState<string | null>(null);
  const [importAuthEntryXDR, setImportAuthEntryXDR] = useState('');
  const [importSessionId, setImportSessionId] = useState('');
  const [importPlayer1, setImportPlayer1] = useState('');
  const [importPlayer1Points, setImportPlayer1Points] = useState('');
  const [importPlayer2Points, setImportPlayer2Points] = useState(DEFAULT_POINTS);
  const [loadSessionId, setLoadSessionId] = useState('');
  const [authEntryCopied, setAuthEntryCopied] = useState(false);
  const [sessionIdCopied, setSessionIdCopied] = useState(false);
  const [devGearOpen, setDevGearOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [welcomeDone, setWelcomeDone] = useState(false);

  // Garden setup phase (Gardener only)
  const [garden, setGarden] = useState<GardenLayout>(createEmptyGarden);
  const [selectedPlantType, setSelectedPlantType] = useState(1);
  const [gardenCommitment, setGardenCommitment] = useState<Buffer | null>(null);

  // Play phase
  const [lastReveal, setLastReveal] = useState<CellRevealResult | null>(null);
  const [lastJournalHash, setLastJournalHash] = useState<string | null>(null);
  const [zkDetailsOpen, setZkDetailsOpen] = useState(false);
  const [revealingCell, setRevealingCell] = useState(false);
  const [zkProofStep, setZkProofStep] = useState(0); // 0=idle 1=hashing 2=encoding 3=proving 4=submitting
  const [hitCellIdx, setHitCellIdx] = useState<number | null>(null);
  const [boardShake, setBoardShake] = useState(false);

  // Spirit Sense (demo mode — client-side info ability for Creature)
  const [spiritSenseHpCost, setSpiritSenseHpCost] = useState(0);
  const [spiritSenseResult, setSpiritSenseResult] = useState<SpiritSenseResult | null>(null);
  const [spiritSenseLoading, setSpiritSenseLoading] = useState(false);

  // General
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const actionLock = useRef(false);
  const autoRevealTurnRef = useRef<number | null>(null);
  const isBusy = loading || quickstartLoading;

  // Polling refs — prevents concurrent requests & leaked intervals
  const pollingInFlight = useRef(false);
  const preparePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const quickstartAvailable = walletType === 'dev'
    && DevWalletService.isDevModeAvailable()
    && DevWalletService.isPlayerAvailable(1)
    && DevWalletService.isPlayerAvailable(2);

  useEffect(() => { setPlayer1Address(userAddress); }, [userAddress]);
  useEffect(() => { if (sessionId > 0) setWelcomeDone(false); }, [sessionId]);

  // Clean up prepare-transaction poll on unmount
  useEffect(() => {
    return () => {
      if (preparePollRef.current) clearInterval(preparePollRef.current);
    };
  }, []);

  // Determine player roles — must come before the auto-reveal useEffect so
  // TypeScript can see the declarations (block-scoped consts are not hoisted).
  const isGardener = gameState?.gardener === userAddress;
  const isCreature = gameState?.creature === userAddress;

  // Auto-reveal: when it's the Gardener's turn (WaitingForProof), trigger reveal
  // automatically — no manual button click needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (
      gameState?.phase === GamePhase.WaitingForProof &&
      isGardener &&
      gardenCommitment &&
      !revealingCell &&
      !actionLock.current &&
      autoRevealTurnRef.current !== gameState.turn_number
    ) {
      autoRevealTurnRef.current = gameState.turn_number;
      handleRevealCell();
    } else if (gameState?.phase !== GamePhase.WaitingForProof) {
      // Reset so next WaitingForProof fires correctly
      autoRevealTurnRef.current = null;
    }
  }, [gameState?.phase, gameState?.turn_number, isGardener, !!gardenCommitment, revealingCell]);

  // Displayed HP accounts for local Spirit Sense cost (resets on each move)
  const displayedCreatureHp = gameState
    ? Math.max(0, gameState.creature_hp - spiritSenseHpCost)
    : 0;

  // ====================================================================
  // Helpers
  // ====================================================================

  const parsePoints = (value: string): bigint | null => {
    try {
      const cleaned = value.replace(/[^\d.]/g, '');
      if (!cleaned || cleaned === '.') return null;
      const [whole = '0', fraction = ''] = cleaned.split('.');
      const paddedFraction = fraction.padEnd(POINTS_DECIMALS, '0').slice(0, POINTS_DECIMALS);
      return BigInt(whole + paddedFraction);
    } catch { return null; }
  };

  const runAction = async (action: () => Promise<void>) => {
    if (actionLock.current || isBusy) return;
    actionLock.current = true;
    try { await action(); }
    finally { actionLock.current = false; }
  };

  // Stable ref values for the polling closure
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const gardenCommitmentRef = useRef(gardenCommitment);
  gardenCommitmentRef.current = gardenCommitment;
  const userAddressRef = useRef(userAddress);
  userAddressRef.current = userAddress;

  /**
   * Fetches game state for a given session ID.
   * Accepts an explicit `sid` parameter to avoid the race condition where
   * the ref hasn't been updated yet after a `setSessionId` call.
   */
  const fetchGameState = useCallback(async (sid?: number) => {
    if (pollingInFlight.current) return;
    pollingInFlight.current = true;
    try {
      const targetSid = sid ?? sessionIdRef.current;
      const session = await service.getSession(targetSid);
      setGameState(session);
      if (session) {
        // Try to restore garden from localStorage if we don't have it in state
        if (!gardenCommitmentRef.current && session.gardener === userAddressRef.current) {
          const stored = loadGardenFromStorage(targetSid);
          if (stored) {
            setGarden(stored.garden);
            setGardenCommitment(stored.commitment);
          }
        }

        if (session.phase === GamePhase.Finished) {
          setUiPhase('complete');
        } else if (session.phase === GamePhase.WaitingForCommitment) {
          setUiPhase('garden-setup');
        } else {
          setUiPhase('play');
        }
      }
    } catch (err) {
      console.log('[fetchGameState] Error:', err);
    } finally {
      pollingInFlight.current = false;
    }
  }, []);

  // Poll game state during play — strict cleanup
  useEffect(() => {
    if (uiPhase !== 'play' && uiPhase !== 'garden-setup') return;

    let cancelled = false;
    const pollSid = sessionIdRef.current;

    const tick = async () => {
      if (cancelled) return;
      await fetchGameState(pollSid);
    };

    tick(); // immediate first fetch
    const interval = setInterval(tick, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, uiPhase, fetchGameState]);

  const handleStartNewGame = () => {
    if (gameState?.phase === GamePhase.Finished) onGameComplete();
    // Clear leaked prepare poll
    if (preparePollRef.current) {
      clearInterval(preparePollRef.current);
      preparePollRef.current = null;
    }
    clearGardenFromStorage(sessionId);
    actionLock.current = false;
    setUiPhase('create');
    setSessionId(0);
    setGameState(null);
    setGarden(createEmptyGarden());
    setGardenCommitment(null);
    setSelectedPlantType(1);
    setLastReveal(null);
    setLoading(false);
    setQuickstartLoading(false);
    setError(null);
    setSuccess(null);
    setCreateMode('create');
    setExportedAuthEntryXDR(null);
    setImportAuthEntryXDR('');
    setImportSessionId('');
    setImportPlayer1('');
    setImportPlayer1Points('');
    setImportPlayer2Points(DEFAULT_POINTS);
    setLoadSessionId('');
    setPlayer1Address(userAddress);
    setPlayer1Points(DEFAULT_POINTS);
  };

  // ====================================================================
  // Create Phase Handlers
  // ====================================================================

  const handlePrepareTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) throw new Error('Enter a valid points amount');

        // Generate session ID lazily at creation time
        const newSessionId = sessionId || createRandomSessionId();
        if (!sessionId) setSessionId(newSessionId);

        const signer = getContractSigner();
        const placeholderCreature = await getFundedSimulationSourceAddress([player1Address, userAddress]);

        const authEntryXDR = await service.prepareStartGame(
          newSessionId, player1Address, placeholderCreature,
          p1Points, p1Points, signer
        );

        setExportedAuthEntryXDR(authEntryXDR);
        setSuccess('Auth entry signed! Send it to the Creature player.');

        // Poll for game creation — stored in ref for cleanup
        if (preparePollRef.current) clearInterval(preparePollRef.current);
        const pollInterval = setInterval(async () => {
          const game = await service.getSession(newSessionId);
          if (game) {
            clearInterval(pollInterval);
            preparePollRef.current = null;
            setGameState(game);
            setExportedAuthEntryXDR(null);
            setSuccess('Game created! Creature has joined.');
            setUiPhase('garden-setup');
            onStandingsRefresh();
            setTimeout(() => setSuccess(null), 2000);
          }
        }, 3000);
        preparePollRef.current = pollInterval;
        setTimeout(() => {
          clearInterval(pollInterval);
          if (preparePollRef.current === pollInterval) preparePollRef.current = null;
        }, 300000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to prepare transaction');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleImportTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        if (!importAuthEntryXDR.trim()) throw new Error('Enter auth entry XDR from Gardener');
        if (!importPlayer2Points.trim()) throw new Error('Enter your points amount');

        const p2Points = parsePoints(importPlayer2Points);
        if (!p2Points || p2Points <= 0n) throw new Error('Invalid points amount');

        const gameParams = service.parseAuthEntry(importAuthEntryXDR.trim());
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.gardener);
        setImportPlayer1Points((Number(gameParams.gardenerPoints) / 10_000_000).toString());

        if (gameParams.gardener === userAddress) {
          throw new Error('You cannot play against yourself');
        }

        const signer = getContractSigner();
        const fullySignedTxXDR = await service.importAndSignAuthEntry(
          importAuthEntryXDR.trim(), userAddress, p2Points, signer
        );
        await service.finalizeStartGame(fullySignedTxXDR, userAddress, signer);

        setSessionId(gameParams.sessionId);
        setSuccess('Game created! Waiting for Gardener to set up garden...');
        setUiPhase('garden-setup');
        await fetchGameState(gameParams.sessionId);
        onStandingsRefresh();
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import transaction');
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
        const parsedId = parseInt(loadSessionId.trim());
        if (isNaN(parsedId) || parsedId <= 0) throw new Error('Enter a valid session ID');

        const game = await service.getSession(parsedId);
        if (!game) throw new Error('Game not found');
        if (game.gardener !== userAddress && game.creature !== userAddress) {
          throw new Error('You are not a player in this game');
        }

        setSessionId(parsedId);
        setGameState(game);

        // Restore garden from localStorage if we're the gardener
        if (game.gardener === userAddress) {
          const stored = loadGardenFromStorage(parsedId);
          if (stored) {
            setGarden(stored.garden);
            setGardenCommitment(stored.commitment);
          }
        }

        if (game.phase === GamePhase.Finished) {
          setUiPhase('complete');
        } else if (game.phase === GamePhase.WaitingForCommitment) {
          setUiPhase('garden-setup');
        } else {
          setUiPhase('play');
        }
        setSuccess('Game loaded!');
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load game');
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

        if (walletType !== 'dev') throw new Error('Quickstart only works with dev wallets');
        if (!DevWalletService.isDevModeAvailable() || !DevWalletService.isPlayerAvailable(1) || !DevWalletService.isPlayerAvailable(2)) {
          throw new Error('Quickstart requires both dev wallets.');
        }

        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) throw new Error('Enter a valid points amount');

        const originalPlayer = devWalletService.getCurrentPlayer();
        let gardenerAddr = '', creatureAddr = '';
        let gardenerSigner: ReturnType<typeof devWalletService.getSigner> | null = null;
        let creatureSigner: ReturnType<typeof devWalletService.getSigner> | null = null;

        try {
          await devWalletService.initPlayer(1);
          gardenerAddr = devWalletService.getPublicKey();
          gardenerSigner = devWalletService.getSigner();
          await devWalletService.initPlayer(2);
          creatureAddr = devWalletService.getPublicKey();
          creatureSigner = devWalletService.getSigner();
        } finally {
          if (originalPlayer) await devWalletService.initPlayer(originalPlayer);
        }

        if (!gardenerSigner || !creatureSigner) throw new Error('Failed to init dev wallets');
        if (gardenerAddr === creatureAddr) throw new Error('Two different dev wallets required');

        const qsSessionId = createRandomSessionId();
        setSessionId(qsSessionId);
        setPlayer1Address(gardenerAddr);

        const placeholderCreature = await getFundedSimulationSourceAddress([gardenerAddr, creatureAddr]);

        const authEntryXDR = await service.prepareStartGame(
          qsSessionId, gardenerAddr, placeholderCreature, p1Points, p1Points, gardenerSigner
        );
        const fullySignedTxXDR = await service.importAndSignAuthEntry(
          authEntryXDR, creatureAddr, p1Points, creatureSigner
        );
        await service.finalizeStartGame(fullySignedTxXDR, creatureAddr, creatureSigner);

        const game = await service.getSession(qsSessionId);
        setGameState(game);
        setUiPhase('garden-setup');
        onStandingsRefresh();
        setSuccess('Quickstart complete! Set up your garden.');
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Quickstart failed');
      } finally {
        setQuickstartLoading(false);
      }
    });
  };

  // ====================================================================
  // Garden Setup
  // ====================================================================

  const handleGardenCellClick = (x: number, y: number) => {
    const idx = y * GRID_SIZE + x;
    setGarden(prev => {
      const next = [...prev];
      if (next[idx] === selectedPlantType) {
        next[idx] = 0; // Remove
      } else {
        // Check max plants
        const currentCount = countPlants(next);
        if (next[idx] === 0 && currentCount >= MAX_PLANTS) return prev;
        next[idx] = selectedPlantType;
      }
      return next;
    });
  };

  const handleCommitGarden = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);

        const validation = validateGarden(garden);
        if (!validation.valid) throw new Error(validation.error);

        const commitment = await computeGardenCommitment(garden);
        setGardenCommitment(commitment);

        // Persist garden + commitment so page refresh doesn't break reveals
        saveGardenToStorage(sessionId, garden, commitment);

        const signer = getContractSigner();
        await service.commitGarden(sessionId, userAddress, commitment, signer);

        setSuccess('Garden committed! The game begins.');
        setUiPhase('play');
        await fetchGameState(sessionId);
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to commit garden');
      } finally {
        setLoading(false);
      }
    });
  };

  // ====================================================================
  // Play Phase - Creature Move
  // ====================================================================

  const handleCreatureMove = async (x: number, y: number) => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setLastReveal(null);
        setSpiritSenseResult(null);

        const signer = getContractSigner();
        await service.creatureMove(sessionId, userAddress, x, y, signer);

        // Spirit Sense cost is "committed" — reset for next turn
        setSpiritSenseHpCost(0);
        setSuccess(`Moved to (${x}, ${y}). Waiting for Gardener to reveal...`);
        await fetchGameState(sessionId);
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Move failed');
      } finally {
        setLoading(false);
      }
    });
  };

  // ====================================================================
  // Play Phase - Gardener Reveal
  // ====================================================================

  const handleRevealCell = async () => {
    if (!gameState || !gardenCommitment) {
      setError('Garden commitment not found. Did you commit your garden in this session?');
      return;
    }

    await runAction(async () => {
      try {
        setRevealingCell(true);
        setZkDetailsOpen(false); // hide previous panel
        setZkProofStep(1); // step 1: hashing garden
        setError(null);

        // Capture calming mist state BEFORE reveal to detect if it fires
        const prevDamageReduction = gameState.damage_reduction;

        const x = gameState.creature_x;
        const y = gameState.creature_y;

        const journalBytes = buildJournal(gardenCommitment, x, y, garden);
        setZkProofStep(2); // step 2: coordinates encoded

        await new Promise(r => setTimeout(r, 350));
        const journalHash = await computeJournalHash(journalBytes);
        setLastJournalHash(journalHash.toString('hex'));
        setZkProofStep(3); // step 3: creating proof

        await new Promise(r => setTimeout(r, 900)); // simulate proof time
        const emptySeal = Buffer.alloc(0); // Dev mode
        setZkProofStep(4); // step 4: submitting to chain

        const signer = getContractSigner();
        const result = await service.revealCell(
          sessionId, userAddress, journalBytes, journalHash, emptySeal, signer
        );

        setLastReveal(result);
        if (result?.has_plant && result.damage_dealt > 0) {
          // Flash the cell + shake the board for dramatic feedback
          const cellIdx = result.y * GRID_SIZE + result.x;
          setHitCellIdx(cellIdx);
          setTimeout(() => setHitCellIdx(null), 600);
          setBoardShake(true);
          setTimeout(() => setBoardShake(false), 500);
          const mistLine = prevDamageReduction > 0
            ? ' \ud83c\udf38 Calming Mist absorbed 1 damage!'
            : '';
          setSuccess(`\u26a1 Magic energy released. Creature takes ${result.damage_dealt} damage.${mistLine}`);
        } else if (result?.has_plant) {
          const mistLine = prevDamageReduction > 0 ? ' \ud83c\udf38 Calming Mist absorbed the hit!' : '';
          setSuccess(`\u2728 Plant whispered, but dealt no damage this time.${mistLine}`);
        } else {
          setSuccess('\u2591 Empty soil. The path stays dark.');
        }
        await fetchGameState(sessionId);
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Reveal failed');
      } finally {
        setRevealingCell(false);
        setZkProofStep(0);
      }
    });
  };

  // ====================================================================
  // Play Phase - Spirit Sense (Demo Mode)
  // Reads garden from localStorage — works same-browser (dev/demo).
  // In production this would generate a ZK mini-proof on the Gardener's side.
  // ====================================================================

  const handleSpiritSense = (ability: 'peek' | 'smell') => {
    if (!gameState) return;
    if (displayedCreatureHp <= 1) {
      setError('Not enough HP to use Spirit Sense (need at least 2 HP).');
      return;
    }

    setSpiritSenseLoading(true);
    setSpiritSenseResult(null);
    // Deduct 1 HP locally — immediately visible in the status bar
    setSpiritSenseHpCost(prev => prev + 1);

    // Simulate the "ZK mini-proof generation" with a short dramatic pause
    setTimeout(() => {
      const stored = loadGardenFromStorage(sessionId);

      if (ability === 'peek') {
        if (!stored) {
          setSpiritSenseResult({ ability: 'peek', noGarden: true });
        } else {
          const cx = gameState.creature_x;
          const nextY = gameState.creature_y + 1;
          const leftX = cx - 1;
          const rightX = cx + 1;
          const left = leftX >= 0 && nextY < GRID_SIZE
            ? (stored.garden[nextY * GRID_SIZE + leftX] > 0 ? 'PLANT' : 'empty')
            : null;
          const right = rightX < GRID_SIZE && nextY < GRID_SIZE
            ? (stored.garden[nextY * GRID_SIZE + rightX] > 0 ? 'PLANT' : 'empty')
            : null;
          setSpiritSenseResult({ ability: 'peek', left, right });
        }
      } else {
        if (!stored) {
          setSpiritSenseResult({ ability: 'smell', noGarden: true });
        } else {
          const cy = gameState.creature_y;
          let plantCount = 0;
          const rowNums: number[] = [];
          for (let row = cy + 1; row <= cy + 2 && row < GRID_SIZE; row++) {
            rowNums.push(row + 1); // 1-indexed display
            for (let col = 0; col < GRID_SIZE; col++) {
              if (stored.garden[row * GRID_SIZE + col] > 0) plantCount++;
            }
          }
          setSpiritSenseResult({
            ability: 'smell',
            count: plantCount,
            rows: rowNums.length === 1 ? `row ${rowNums[0]}` : `rows ${rowNums[0]}-${rowNums[rowNums.length - 1]}`,
          });
        }
      }

      setSpiritSenseLoading(false);
    }, 950);
  };

  // ====================================================================
  // Copy helpers
  // ====================================================================

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setAuthEntryCopied(true);
      setTimeout(() => setAuthEntryCopied(false), 2000);
    } catch { setError('Failed to copy to clipboard'); }
  };

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(String(sessionId));
      setSessionIdCopied(true);
      setTimeout(() => setSessionIdCopied(false), 2000);
    } catch {}
  };

  // ====================================================================
  // Render Helpers — Board using code-rendered dirt tiles (no background
  // image). Each cell is a styled button with a gradient dirt background.
  // State overlays (creature / revealed / valid-move / house row) layer
  // on top via inline style overrides and an absolute <span> tint.
  // ====================================================================

  const boardContainerStyle: React.CSSProperties = {
    // Layout
    width: '100%',
    maxWidth: 370,
    aspectRatio: '1 / 1',
    margin: '0 auto',
    // Stone-border aesthetic matching the prototipo
    background: 'rgba(12,8,22,0.55)',
    border: '3px solid rgba(90,65,40,0.7)',
    borderRadius: 14,
    boxShadow: [
      '0 12px 40px rgba(0,0,0,0.75)',
      'inset 0 0 32px rgba(0,0,0,0.6)',
      '0 0 48px rgba(100,70,180,0.1)',
      '0 2px 0 rgba(180,140,80,0.3)',           // top golden rim
    ].join(', '),
    outline: '1px solid rgba(201,168,76,0.12)',  // outer gold accent
    // CSS Grid — cells sit directly inside this container
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gridTemplateRows: 'repeat(5, 1fr)',
    padding: 8,
    gap: 4,
    boxSizing: 'border-box',
  };

  // Cell button — dirt tile base, state overlays applied per-cell.
  const cellBaseStyle: React.CSSProperties = {
    all: 'unset',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'radial-gradient(ellipse at 28% 28%, rgba(80,52,30,0.55) 0%, transparent 65%), linear-gradient(135deg, #3d2b1f 0%, #2a1d15 100%)',
    border: '1px solid rgba(201,168,76,0.15)',
    borderRadius: 6,
    cursor: 'pointer',
    boxSizing: 'border-box',
    overflow: 'hidden',
    position: 'relative',
  };

  // Sprite sizing — responsive to cell size
  const responsiveSpriteStyle: React.CSSProperties = {
    width: '68%',
    height: '68%',
    objectFit: 'contain',
    imageRendering: 'pixelated',
    pointerEvents: 'none',
  };

  const renderGameBoard = (interactive: boolean, showPlants: boolean) => {
    const validMoves = interactive && isCreature && gameState?.phase === GamePhase.Playing
      ? getValidMoves(gameState.creature_x, gameState.creature_y, Array.from(gameState.revealed_cells))
      : [];

    return (
      // board-shake fires on the container when damage is dealt
      <div style={boardContainerStyle} className={boardShake ? 'board-shake' : undefined}>
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, idx) => {
          const x = idx % GRID_SIZE;
          const y = Math.floor(idx / GRID_SIZE);
          const isCreatureHere = gameState && gameState.creature_x === x && gameState.creature_y === y;
          const isValidMove = validMoves.some(m => m.x === x && m.y === y);
          const plantType = showPlants ? garden[idx] : 0;

          // ── FULL FOG OF WAR ──────────────────────────────────────────
          // revealed_cells is used only for movement validity (above).
          // Nothing in the visual rendering depends on whether a cell has
          // been stepped on — the board stays dark throughout the game.
          let overlayBg  = 'transparent';
          let cellShadow = 'none';

          if (isCreatureHere) {
            overlayBg  = 'rgba(255,213,79,0.22)';
            cellShadow = '0 0 14px rgba(255,213,79,0.6), inset 0 0 8px rgba(255,213,79,0.2)';
          } else if (isValidMove) {
            overlayBg  = 'rgba(129,140,248,0.22)';
            cellShadow = '0 0 12px rgba(129,140,248,0.4), inset 0 0 6px rgba(129,140,248,0.15)';
          }

          // House row (y===4): warm earth tint + golden border
          const isHouseRow = y === 4;
          if (isHouseRow) {
            const goldenGlow = '0 4px 20px rgba(201,168,76,0.5), inset 0 -4px 12px rgba(201,168,76,0.2)';
            cellShadow = cellShadow !== 'none' ? `${cellShadow}, ${goldenGlow}` : goldenGlow;
          }

          const isHit = hitCellIdx === idx;

          return (
            <button
              key={idx}
              disabled={!isValidMove || isBusy}
              onClick={() => isValidMove && handleCreatureMove(x, y)}
              className={`garden-tile${isHit ? ' cell-hit' : ''}`}
              style={{
                ...cellBaseStyle,
                ...(isHouseRow ? { background: 'radial-gradient(ellipse at 30% 30%, rgba(100,72,20,0.5) 0%, transparent 65%), linear-gradient(135deg, #4a3520 0%, #2e1f0d 100%)', border: '2px solid rgba(201,168,76,0.55)' } : {}),
                boxShadow: cellShadow,
                cursor: isValidMove ? 'pointer' : 'default',
              }}
              title={`(${x}, ${y})`}
            >
              {/* State overlay */}
              {overlayBg !== 'transparent' && (
                <span style={{ position: 'absolute', inset: 0, background: overlayBg, borderRadius: 8, pointerEvents: 'none' }} />
              )}

              {/* Creature sprite */}
              {isCreatureHere && (
                <img src={CREATURE_IMG} alt="Creature" className="creature-float" style={responsiveSpriteStyle} draggable={false} />
              )}

              {/* Gardener's own plants — visible only to the Gardener (showPlants=isGardener).
                  Creature always sees darkness. No revealed-cell markers of any kind. */}
              {!isCreatureHere && showPlants && plantType > 0 && (
                <img src={PLANT_IMG[plantType]} alt={PLANT_NAMES[plantType]} className="plant-sway" style={responsiveSpriteStyle} draggable={false} />
              )}
            </button>
          );
        })}
      </div>
    );
  };

  // Glass panel style reused across controls
  const glassPanel: React.CSSProperties = {
    background: 'rgba(10,14,26,0.75)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(201,168,76,0.15)',
    borderRadius: 16,
    padding: '0.75rem 1rem',
  };

  const renderGardenEditor = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1rem', color: 'var(--color-ink)', margin: 0 }}>Place Your Plants</h3>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-accent)', margin: 0 }}>
          {countPlants(garden)}/{MAX_PLANTS}
        </span>
      </div>

      {/* Plant type selector — glass panel */}
      <div style={{ ...glassPanel, display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        {[1, 2, 3].map(type => (
          <button
            key={type}
            onClick={() => setSelectedPlantType(type)}
            title={
              type === 1 ? 'Lavender · 1 DMG · Reduces next damage by 1'
              : type === 2 ? 'Mint · 2 DMG · Standard herb'
              : 'Mandrake · 3 DMG · High-damage root'
            }
            style={{
              all: 'unset',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.4rem 0.7rem',
              borderRadius: 10,
              fontWeight: 700,
              fontSize: '0.75rem',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              color: selectedPlantType === type ? 'var(--color-ink)' : 'var(--color-ink-muted)',
              background: selectedPlantType === type ? 'rgba(123,104,174,0.3)' : 'transparent',
              border: selectedPlantType === type ? '2px solid rgba(179,136,255,0.5)' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            <img src={PLANT_IMG[type]} alt="" style={{ width: 22, height: 22, imageRendering: 'pixelated' as const }} />
            {PLANT_NAMES[type]}
            <span style={{ fontSize: '0.6rem', opacity: 0.5 }}>({type})</span>
          </button>
        ))}
      </div>

      {/* Garden grid — cells are direct children of the board container (CSS Grid) */}
      <div style={boardContainerStyle}>
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, idx) => {
          const x = idx % GRID_SIZE;
          const y = Math.floor(idx / GRID_SIZE);
          const cellPlant = garden[idx];

          const cellShadow = cellPlant === 1 ? '0 0 8px rgba(179,136,255,0.4), inset 0 0 6px rgba(179,136,255,0.15)'
                           : cellPlant === 2 ? '0 0 8px rgba(105,240,174,0.4), inset 0 0 6px rgba(105,240,174,0.15)'
                           : cellPlant === 3 ? '0 0 8px rgba(255,110,64,0.4), inset 0 0 6px rgba(255,110,64,0.15)'
                           : y === 4 ? '0 4px 20px rgba(201,168,76,0.5), inset 0 -4px 12px rgba(201,168,76,0.2)'
                           : 'none';

          const isHouseRow = y === 4;

          return (
            <button
              key={idx}
              onClick={() => handleGardenCellClick(x, y)}
              className="garden-tile"
              style={{
                ...cellBaseStyle,
                ...(isHouseRow ? { background: 'radial-gradient(ellipse at 30% 30%, rgba(100,72,20,0.5) 0%, transparent 65%), linear-gradient(135deg, #4a3520 0%, #2e1f0d 100%)', border: '2px solid rgba(201,168,76,0.55)' } : {}),
                ...(cellPlant > 0 ? { boxShadow: cellShadow } : isHouseRow ? { boxShadow: cellShadow } : {}),
              }}
              title={`(${x}, ${y}) - ${PLANT_NAMES[cellPlant] || 'Empty'}`}
            >
              {cellPlant > 0 && (
                <img src={PLANT_IMG[cellPlant]} alt={PLANT_NAMES[cellPlant]} className="plant-sway" style={responsiveSpriteStyle} draggable={false} />
              )}
            </button>
          );
        })}
      </div>

      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', textAlign: 'center', color: 'var(--color-ink-muted)', lineHeight: 1.8, margin: 0 }}>
        Click to place. Click again to remove. Bottom row = house.
      </p>
    </div>
  );

  // ====================================================================
  // Role indicator with sprite
  // ====================================================================

  const renderRoleSprite = () => {
    if (isGardener) {
      return <img src={WITCH_IMG} alt="Gardener" className="pixel-art" style={{ width: 48, height: 48, objectFit: 'contain' }} />;
    }
    if (isCreature) {
      return <img src={CREATURE_IMG} alt="Creature" className="pixel-art" style={{ width: 40, height: 40, objectFit: 'contain' }} />;
    }
    return null;
  };

  // ====================================================================
  // Render
  // ====================================================================

  // For the create phase, LandingScreen handles everything as a fixed overlay.
  // For other phases, we render the standard game panel.
  if (uiPhase === 'create') {
    return (
      <LandingScreen
        walletAddress={userAddress || undefined}
        navProps={{
          devPlayer: walletType === 'dev' ? (getCurrentDevPlayer() ?? undefined) : undefined,
          onGearClick: walletType === 'dev' ? () => setDevGearOpen(v => !v) : undefined,
          gearOpen: devGearOpen,
          onSwitchPlayer: walletType === 'dev' ? () => { switchPlayer(getCurrentDevPlayer() === 1 ? 2 : 1); setDevGearOpen(false); } : undefined,
          walletSwitching,
        }}
      >
        {/* Error / Success */}
        {error && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(180,60,60,0.2)', border: '1px solid rgba(224,96,96,0.4)', borderRadius: 8 }}>
            <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f87171', margin: 0 }}>{error}</p>
          </div>
        )}
        {success && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(30,100,80,0.25)', border: '1px solid rgba(78,205,196,0.3)', borderRadius: 8 }}>
            <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#4ecdc4', margin: 0 }}>{success}</p>
          </div>
        )}

        {/* ── Main create buttons ── */}
        {createMode === 'create' && !exportedAuthEntryXDR && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', width: '100%', maxWidth: 360, margin: '0 auto' }}>
            <WoodButton onClick={handlePrepareTransaction} disabled={isBusy} variant="green">
              {loading
                ? <span className="magic-loading">{'\u2736'} Opening portal{'\u2026'}</span>
                : 'Start Journey'}
            </WoodButton>

            <WoodButton onClick={() => { setCreateMode('import'); setError(null); setSuccess(null); }} variant="blue">
              {'\uD83D\uDC7B'} Enter the Woods
            </WoodButton>

            {quickstartAvailable && (
              <WoodButton onClick={handleQuickStart} disabled={isBusy} variant="purple">
                {quickstartLoading
                  ? <span className="magic-loading">{'\u2736'} Casting spell{'\u2026'}</span>
                  : '\u26A1 Quickstart (Dev)'}
              </WoodButton>
            )}

            {/* Load existing session row */}
            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', marginTop: '0.15rem' }}>
              <input
                type="text" value={loadSessionId}
                onChange={e => setLoadSessionId(e.target.value)}
                placeholder="Session ID to resume..."
                style={{
                  flex: 1, padding: '0.45rem 0.65rem', borderRadius: 7,
                  background: 'rgba(8,4,1,0.7)', border: '1px solid rgba(130,90,40,0.3)',
                  fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'rgba(230,200,150,0.85)',
                }}
              />
              <button
                onClick={handleLoadExistingGame}
                disabled={isBusy || !loadSessionId.trim()}
                style={{
                  all: 'unset', boxSizing: 'border-box',
                  padding: '0.45rem 0.85rem', borderRadius: 7,
                  fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap',
                  cursor: (isBusy || !loadSessionId.trim()) ? 'not-allowed' : 'pointer',
                  color: (isBusy || !loadSessionId.trim()) ? 'rgba(130,90,40,0.4)' : 'rgba(238,212,158,0.95)',
                  background: (isBusy || !loadSessionId.trim()) ? 'rgba(20,10,4,0.45)' : 'rgba(55,32,10,0.82)',
                  border: '1px solid rgba(150,110,50,0.35)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {loading ? '\u23F3' : 'Load Game'}
              </button>
            </div>
          </div>
        )}

        {/* ── Auth entry XDR (after Gardener signs) ── */}
        {createMode === 'create' && exportedAuthEntryXDR && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', width: '100%', maxWidth: 360, margin: '0 auto' }}>
            <p style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', color: '#4ecdc4', letterSpacing: '0.06em', margin: 0 }}>
              Auth Entry XDR — Gardener Signed
            </p>
            <div style={{ background: 'rgba(5,2,1,0.75)', padding: '0.45rem 0.6rem', borderRadius: 8, border: '1px solid rgba(78,205,196,0.2)', maxHeight: 76, overflowY: 'auto' }}>
              <code style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'rgba(150,200,180,0.8)', wordBreak: 'break-all' }}>{exportedAuthEntryXDR}</code>
            </div>
            <WoodButton onClick={() => copyToClipboard(exportedAuthEntryXDR!)} variant="primary">
              {authEntryCopied ? '\u2713 Copied!' : 'Copy Auth Entry'}
            </WoodButton>
            <p style={{ fontSize: '0.68rem', textAlign: 'center', color: 'rgba(170,130,80,0.6)', fontFamily: 'var(--font-mono)', margin: 0 }}>
              Session #{sessionId} &mdash; Send to the Creature player. Polling&hellip;
            </p>
          </div>
        )}

        {/* ── Import / Join as Creature ── */}
        {createMode === 'import' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', width: '100%', maxWidth: 360, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: '0.82rem', fontWeight: 700, color: 'rgba(228,195,135,0.9)', margin: 0 }}>
                {'\uD83D\uDC7B'} Join as Creature
              </p>
              <button
                onClick={() => { setCreateMode('create'); setError(null); setSuccess(null); }}
                style={{ all: 'unset', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600, color: 'rgba(170,130,80,0.65)', fontFamily: 'var(--font-body)' }}
              >
                &larr; Back
              </button>
            </div>
            <p style={{ fontSize: '0.68rem', color: 'rgba(170,135,90,0.75)', margin: 0 }}>
              Paste the Gardener&apos;s signed auth entry XDR below.
            </p>
            <textarea
              value={importAuthEntryXDR}
              onChange={e => {
                setImportAuthEntryXDR(e.target.value);
                try {
                  const parsed = service.parseAuthEntry(e.target.value.trim());
                  setImportSessionId(parsed.sessionId.toString());
                  setImportPlayer1(parsed.gardener);
                  setImportPlayer1Points((Number(parsed.gardenerPoints) / 10_000_000).toString());
                } catch { /* ignore while typing */ }
              }}
              placeholder="Paste Gardener's signed auth entry XDR..."
              rows={3}
              style={{
                width: '100%', padding: '0.45rem 0.65rem', borderRadius: 8,
                background: 'rgba(8,4,1,0.75)', border: '1px solid rgba(130,90,40,0.3)',
                fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'rgba(230,200,150,0.85)',
                resize: 'none',
              }}
            />
            {importSessionId && (
              <div style={{ fontSize: '0.68rem', color: 'rgba(170,135,90,0.75)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                <span>Session: <strong style={{ color: 'rgba(228,195,135,0.9)' }}>{importSessionId}</strong></span>
                <span>Points: <strong style={{ color: 'rgba(228,195,135,0.9)' }}>{importPlayer1Points}</strong></span>
                <span style={{ gridColumn: '1 / -1' }}>
                  Gardener: <span style={{ fontFamily: 'var(--font-mono)' }}>{importPlayer1.slice(0, 10)}…{importPlayer1.slice(-4)}</span>
                </span>
              </div>
            )}
            <div>
              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, color: 'rgba(170,135,90,0.75)', marginBottom: 3, fontFamily: 'var(--font-body)' }}>Your Points</label>
              <input
                type="text" value={importPlayer2Points}
                onChange={e => setImportPlayer2Points(e.target.value)}
                placeholder="0.1"
                style={{
                  width: '100%', padding: '0.45rem 0.65rem', borderRadius: 7,
                  background: 'rgba(8,4,1,0.75)', border: '1px solid rgba(130,90,40,0.3)',
                  fontSize: '0.72rem', color: 'rgba(230,200,150,0.85)', fontFamily: 'var(--font-body)',
                }}
              />
            </div>
            <WoodButton
              onClick={handleImportTransaction}
              disabled={isBusy || !importAuthEntryXDR.trim()}
              variant="primary"
            >
              {loading
                ? <span className="magic-loading">{'\u2736'} Awakening{'\u2026'}</span>
                : '\uD83D\uDC7B Awaken as Creature'}
            </WoodButton>
          </div>
        )}
      </LandingScreen>
    );
  }

  // Shared button style — full pill shape matching the prototipo
  const actionBtnStyle = (gradient: string, disabled?: boolean): React.CSSProperties => ({
    all: 'unset',
    boxSizing: 'border-box',
    display: 'block',
    width: '100%',
    maxWidth: 320,
    margin: '0 auto',
    padding: '0.85rem 2rem',
    borderRadius: 999,
    fontWeight: 700,
    fontSize: '0.9rem',
    textAlign: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? '#6b7280' : '#f3e8ff',
    background: disabled ? 'rgba(55,65,81,0.75)' : gradient,
    boxShadow: disabled ? 'none' : '0 4px 20px rgba(124,58,237,0.35)',
    transition: 'transform 0.15s, box-shadow 0.15s',
    fontFamily: 'var(--font-body)',
  });

  // Player card component
  const renderPlayerCard = (role: 'gardener' | 'creature', isActive: boolean, address: string, extraInfo?: string) => (
    <div style={{
      ...glassPanel,
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      borderColor: isActive
        ? (role === 'gardener' ? 'rgba(179,136,255,0.4)' : 'rgba(255,213,79,0.4)')
        : 'rgba(201,168,76,0.1)',
      background: isActive
        ? (role === 'gardener' ? 'rgba(88,28,135,0.2)' : 'rgba(120,53,15,0.2)')
        : 'rgba(10,14,26,0.6)',
    }}>
      <img
        src={role === 'gardener' ? WITCH_IMG : CREATURE_IMG}
        alt={role}
        style={{ width: 28, height: 28, objectFit: 'contain', imageRendering: 'pixelated' as const }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.55rem', fontWeight: 700, color: 'var(--color-ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {role === 'gardener' ? 'Gardener' : 'Creature'}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--color-ink)', opacity: 0.82, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {address.slice(0, 4)}&hellip;{address.slice(-4)}
        </div>
        {extraInfo && (
          <div style={{ fontSize: '0.65rem', color: 'var(--color-ink-muted)', marginTop: 2 }}>{extraInfo}</div>
        )}
      </div>
    </div>
  );

  // ====================================================================
  // Shared nav props for GameNavbar (used by early-return screens)
  // ====================================================================

  const sharedNavProps = {
    walletAddress: userAddress || undefined,
    devPlayer: walletType === 'dev' ? (getCurrentDevPlayer() ?? undefined) : undefined,
    onGearClick: walletType === 'dev' ? () => setDevGearOpen(v => !v) : undefined,
    gearOpen: devGearOpen,
    onSwitchPlayer: walletType === 'dev'
      ? () => { switchPlayer(getCurrentDevPlayer() === 1 ? 2 : 1); setDevGearOpen(false); }
      : undefined,
    walletSwitching,
    onInfo: () => setInfoOpen(v => !v),
    showInfo: infoOpen,
    showLogo: true,
  };

  // Helper: background layers (forest + vignette) used by early-return screens
  const forestBgLayers = (
    <>
      <div style={{ position: 'fixed', inset: 0, backgroundImage: 'url(/assets/background.png)', backgroundSize: 'cover', backgroundPosition: 'center top', zIndex: -2 }} />
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(76, 71, 91, 0.4)', zIndex: -1, pointerEvents: 'none' as const }} />
    </>
  );

  // Helper: moon phase image
  const moonPhaseImg = (phase: number) =>
    phase === 0 ? '/assets/FullMoon.png' : phase === 1 ? '/assets/NewMoon.png' : '/assets/MenguantMoon.png';

  // Helper: info panel shown when the navbar Info button is clicked (S2 / S3 / S4)
  const renderInfoPanel = () => infoOpen ? (
    <div style={{
      position: 'fixed', top: 72, left: 0, right: 0,
      zIndex: 190,
      background: 'rgba(6,3,18,0.94)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(140,110,220,0.2)',
      padding: '1.25rem 1.5rem 1.5rem',
      animation: 'fadeUp 0.25s ease both',
    }}>
      <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1rem', color: 'var(--color-accent)', marginBottom: '0.75rem' }}>
        About Herbal Moonlight
      </h3>
      <p style={{ fontSize: '0.78rem', color: 'var(--color-ink-muted)', lineHeight: 1.65, maxWidth: 480 }}>
        A 2-player ZK strategy game on Stellar Soroban. The{' '}
        <strong style={{ color: 'var(--color-lavender)' }}>Gardener</strong> hides magical herbs in a 5&times;5 grid using a SHA-256 commitment. The{' '}
        <strong style={{ color: 'var(--color-creature)' }}>Creature</strong> navigates blind, stepping on cells and taking damage. The garden layout is <em>never fully revealed</em> &mdash; even after the game ends.
      </p>
      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        {([
          ['\uD83C\uDF3F Lavender', '1 HP damage', 'Calming Mist on next hit'],
          ['\uD83C\uDF3F Mint', '2 HP damage', 'Standard herb'],
          ['\uD83C\uDF3F Mandrake', '3 HP damage', 'Rare, powerful'],
        ] as [string, string, string][]).map(([name, dmg, note]) => (
          <div key={name} style={{ fontSize: '0.72rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--color-ink)' }}>{name}</div>
            <div style={{ color: 'var(--color-error)' }}>{dmg}</div>
            <div style={{ color: 'var(--color-ink-muted)' }}>{note}</div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  // ── Screen 2: Welcome (shown first time garden-setup phase starts) ────────
  if (uiPhase === 'garden-setup' && gameState && !welcomeDone) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {forestBgLayers}
        <GameNavbar {...sharedNavProps} />
        {renderInfoPanel()}

        {/* Witch fixed at bottom-left — doesn't affect panel layout */}
        <img
          src="/brujita.png"
          alt="Gardener"
          draggable={false}
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            height: '48vh',
            imageRendering: 'pixelated',
            filter: 'drop-shadow(0 0 24px rgba(201,168,76,0.5))',
            zIndex: 3,
            pointerEvents: 'none',
          }}
        />

        {/* Centered panel — flex centers it vertically ignoring the fixed witch */}
        <div style={{ width: '80%', maxWidth: 700, zIndex: 4, marginTop: '4rem' }}>
          <WoodPanel maxWidth={9999}>
            <h2 style={{ fontFamily: 'var(--font-game)', fontSize: '1.3rem', color: 'rgba(238,212,158,0.95)', margin: 0, textAlign: 'center', textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
              Welcome to Herbal Moonlight!
            </h2>
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: '0.82rem', color: 'rgba(200,175,130,0.82)', textAlign: 'center', fontStyle: 'italic', lineHeight: 1.65, margin: '0.2rem 0 0.4rem' }}>
              &ldquo;Plant your herbs in secret and defend your garden from night creatures!&rdquo;
            </p>
            {/* Baby plant trio */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', padding: '0.25rem 0' }}>
              {[
                ['/assets/lavender2.png', 'Lavender'],
                ['/assets/mint2.png', 'Mint'],
                ['/assets/mandrake2.png', 'Mandrake'],
              ].map(([src, label]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <img src={src} alt={label} draggable={false} style={{ height: 46, imageRendering: 'pixelated', filter: 'drop-shadow(0 0 6px rgba(201,168,76,0.3))' }} />
                  <span style={{ fontSize: '0.52rem', color: 'rgba(200,175,130,0.6)', fontFamily: 'var(--font-body)' }}>{label}</span>
                </div>
              ))}
            </div>
            <WoodButton onClick={() => setWelcomeDone(true)} variant="primary">
              Begin Adventure
            </WoodButton>
          </WoodPanel>
        </div>
      </div>
    );
  }

  // ── Screen 4: Finish (game complete) ────────────────────────────────────
  if (uiPhase === 'complete' && gameState) {
    const gardenerWon = gameState.creature_hp === 0;
    const playerWon = (isGardener && gardenerWon) || (isCreature && !gardenerWon);
    const cellsStepped = Array.isArray(gameState.revealed_cells) ? gameState.revealed_cells.length : 0;
    const foreverHidden = 25 - cellsStepped;
    const startingHp = gameState.moon_phase === 0 ? 8 : 6;
    const damageTaken = Math.max(0, startingHp - gameState.creature_hp);

    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto' }}>
        {forestBgLayers}
        <GameNavbar {...sharedNavProps} />
        {renderInfoPanel()}

        <div style={{ width: '85%', maxWidth: 680, padding: '5.5rem 0 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, justifyContent: 'center', gap: '0.75rem' }}>

          <WoodPanel maxWidth={9999}>
            {/* Single win OR lose display */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-game)', color: playerWon ? '#86efac' : '#f87171', textShadow: `0 0 16px ${playerWon ? 'rgba(134,239,172,0.6)' : 'rgba(248,113,113,0.6)'}` }}>
                {playerWon ? 'You Win!' : 'You lose!'}
              </div>
              <img
                src={playerWon ? '/assets/Win-Troll.png' : '/assets/Lose-died.png'}
                alt={playerWon ? 'Win' : 'Lose'}
                draggable={false}
                style={{ height: 'clamp(70px, 15vw, 110px)', imageRendering: 'pixelated', filter: `drop-shadow(0 0 12px rgba(${playerWon ? '134,239,172' : '240,100,100'},0.4))` }}
              />
            </div>

            {/* Battle Report */}
            <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(8,4,1,0.55)', borderRadius: 8, border: '1px solid rgba(130,90,40,0.25)' }}>
              <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'rgba(195,155,90,0.75)', marginBottom: '0.45rem', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
                Battle Report
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, color: '#4ecdc4', marginBottom: '0.3rem' }}>
                <span>{'\uD83D\uDD12'} Forever Hidden</span>
                <span>{foreverHidden} / 25</span>
              </div>
              {[
                ['Cells stepped', `${cellsStepped}`],
                ['Damage taken', `${damageTaken} HP`],
                ['Turns played', String(gameState.turn_number)],
                ['Moon phase', `${moonPhaseEmoji(gameState.moon_phase)} ${moonPhaseLabel(gameState.moon_phase)}`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'rgba(200,175,130,0.78)', marginBottom: '0.22rem' }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>

            {isGardener && gardenerWon && gardenCommitment && (
              <p style={{ fontSize: '0.62rem', color: 'rgba(200,180,255,0.52)', textAlign: 'center', fontFamily: 'monospace', margin: 0 }}>
                {'\uD83D\uDD10'} Garden hash: {gardenCommitment.toString('hex').slice(0, 8)}&hellip;
              </p>
            )}

            {/* Buttons — outlined-blue + solid-indigo per Figma S4 */}
            <div style={{ display: 'flex', gap: '0.55rem' }}>
              <div style={{ flex: 1 }}>
                <WoodButton onClick={handleStartNewGame} variant="outlined-blue">Try Again</WoodButton>
              </div>
              <div style={{ flex: 1 }}>
                <WoodButton onClick={() => { setUiPhase('create'); setSessionId(0); setGameState(null); }} variant="solid-indigo">Exit</WoodButton>
              </div>
            </div>
          </WoodPanel>
        </div>

        <p style={{ fontSize: '0.65rem', color: 'rgba(200,180,140,0.45)', textAlign: 'center', fontFamily: 'var(--font-serif)', letterSpacing: '0.02em', padding: '0 1rem 1.5rem' }}>
          Powered by ZK Magic &amp; Stellar Game Studio
        </p>
      </div>
    );
  }

  // ====================================================================
  // MAIN RETURN — handles two distinct visual states (S3a + S3b):
  //
  //   S3a — uiPhase === 'garden-setup' (post-welcomeDone)
  //          Gardener: renderGardenEditor() + commit button
  //          Creature: waiting screen
  //
  //   S3b — uiPhase === 'play'
  //          3-column dark panel (Gardener | Board | Creature)
  //
  // Both share: forest background, rgba(76,71,91,0.4) overlay, GameNavbar.
  // contentColStyle.maxWidth: 520 for S3a, 700 for S3b.
  // ====================================================================

  const fullscreenStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    overflowY: 'auto',
  };

  // S3a and S3b share same unified dark panel — wider for 3-col layout
  const contentColStyle: React.CSSProperties = {
    position: 'relative',
    zIndex: 1,
    width: '92%',
    maxWidth: 1100,
    padding: '5.25rem 0 3rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
  };

  // Small info text used for instructions — readable size, ivory contrast
  const dimTextStyle: React.CSSProperties = {
    fontFamily: 'var(--font-body)',
    fontSize: '0.88rem',
    textAlign: 'center' as const,
    color: 'rgba(232,228,240,0.88)',
    margin: 0,
    lineHeight: 1.75,
    padding: '0.4rem 0.9rem',
    borderRadius: 8,
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    maxWidth: 420,
  };

  return (
    <div style={fullscreenStyle}>
      {/* Background layers — same helper as S2 / S4 / LandingScreen */}
      {forestBgLayers}

      {/* ── Navbar (matches all 4 reference screens) ────────────────── */}
      <GameNavbar {...sharedNavProps} />
      {renderInfoPanel()}

      {/* Scrollable content column */}
      <div style={contentColStyle}>

        {/* ── Error / success banners ───────────────────────── */}
        {error && (
          <div style={{ width: '100%', maxWidth: 440, padding: '0.6rem 0.9rem', background: 'rgba(224,96,96,0.12)', border: '1px solid rgba(224,96,96,0.3)', borderRadius: 12 }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-error)', margin: 0 }}>{error}</p>
          </div>
        )}
        {success && (
          <div style={{ width: '100%', maxWidth: 440, padding: '0.6rem 0.9rem', background: 'rgba(78,205,196,0.12)', border: '1px solid rgba(78,205,196,0.3)', borderRadius: 12 }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-success)', margin: 0 }}>{success}</p>
          </div>
        )}

        {/* ============================================================ */}
        {/* UNIFIED GAME PANEL — garden-setup + play share same dark panel */}
        {/* ============================================================ */}
        {gameState && (() => {
          const plantsByType = isGardener ? countPlantsByType(garden) : null;
          const phase = gameState.moon_phase;
          const perTypeMax = 3;
          return (
            <div style={{
              width: '100%',
              background: 'rgba(22, 26, 66, 0.5)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              borderRadius: 50,
              border: '1px solid rgba(140, 100, 220, 0.3)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 60px rgba(100,60,200,0.12)',
              overflow: 'hidden',
              animation: 'fadeUp 0.5s ease both',
            }}>

              {/* ── Header: Moon + Session + Phase badge ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.55rem', padding: '0.55rem 0.75rem', borderBottom: '1px solid rgba(140,100,220,0.15)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <img src={moonPhaseImg(phase)} alt="" draggable={false} style={{ height: 'clamp(20px, 4vw, 30px)', imageRendering: 'pixelated' }} />
                  <div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.55rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.08em', lineHeight: 1.4, textTransform: 'uppercase' as const }}>{moonPhaseLabel(phase)}</div>
                    <button onClick={copySessionId} style={{ all: 'unset', fontSize: '0.55rem', color: 'rgba(200,180,255,0.45)', fontFamily: 'var(--font-mono)', cursor: 'pointer', display: 'block', lineHeight: 1.3 }}>
                      {sessionIdCopied ? '\u2713 Copied!' : `#${sessionId}`}
                    </button>
                  </div>
                </div>
                <div style={{ width: 1, height: 20, background: 'rgba(140,100,220,0.2)' }} />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: 999, color: uiPhase === 'garden-setup' ? '#c4b5fd' : (gameState.phase === GamePhase.Playing ? '#a5b4fc' : '#f0c850'), background: uiPhase === 'garden-setup' ? 'rgba(99,102,241,0.15)' : (gameState.phase === GamePhase.Playing ? 'rgba(99,102,241,0.2)' : 'rgba(201,168,76,0.2)') }}>
                  {uiPhase === 'garden-setup' ? '\uD83C\uDF3F Garden Setup' : (gameState.phase === GamePhase.Playing ? '\uD83D\uDC7B Creature Turn' : '\uD83C\uDF3F ZK Reveal')}
                </span>
                {uiPhase === 'play' && gameState.damage_reduction > 0 && (
                  <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: 999, background: 'rgba(78,205,196,0.15)', border: '1px solid rgba(78,205,196,0.35)', color: '#4ecdc4' }}>
                    {'\uD83C\uDF38'} Calming Mist
                  </span>
                )}
                {uiPhase === 'play' && (
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', fontWeight: 600, color: 'rgba(200,180,255,0.5)' }}>
                    Turn {gameState.turn_number}
                  </span>
                )}
              </div>

              {/* ── 3-column body ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.75fr 1fr', overflow: 'hidden' }}>

                {/* LEFT: Gardener */}
                <div style={{ padding: '0.75rem 0.4rem 0.75rem 0.75rem', borderRight: '1px solid rgba(140,100,220,0.12)', display: 'flex', flexDirection: 'column', gap: '0.45rem', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
                  <img src={WITCH_IMG} alt="Gardener" draggable={false} style={{ height: 'clamp(30px, 5vw, 44px)', imageRendering: 'pixelated', filter: 'drop-shadow(0 0 8px rgba(179,136,255,0.4))' }} />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.55rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>Gardener</span>
                  <div style={{ width: '100%', height: 1, background: 'rgba(140,100,220,0.12)' }} />
                  {([1, 2, 3] as const).map(pType => (
                    <div key={pType} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: '100%' }}>
                      <img
                        src={pType === 1 ? '/assets/lavender2.png' : pType === 2 ? '/assets/mint2.png' : '/assets/mandrake2.png'}
                        alt={PLANT_NAMES[pType]}
                        draggable={false}
                        style={{ height: 'clamp(34px, 7vw, 52px)', imageRendering: 'pixelated', filter: 'drop-shadow(0 0 5px rgba(140,80,200,0.3))' }}
                      />
                      <span style={{ fontSize: '0.72rem', color: 'rgba(200,180,255,0.9)', fontWeight: 700 }}>
                        {isGardener && plantsByType ? `${plantsByType[pType]}/${perTypeMax}` : '?/?'}
                      </span>
                      <span style={{ fontSize: '0.6rem', color: 'rgba(180,155,220,0.62)', fontWeight: 500 }}>{PLANT_NAMES[pType]}</span>
                    </div>
                  ))}
                </div>

                {/* CENTER: Garden editor (S3a) or Game board (S3b) */}
                <div style={{ padding: '0.75rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', alignItems: 'center', minWidth: 0 }}>
                  {uiPhase === 'garden-setup' ? (
                    isGardener && gameState.phase === GamePhase.WaitingForCommitment ? (
                      <>
                        {renderGardenEditor()}
                        <WoodButton
                          onClick={handleCommitGarden}
                          disabled={isBusy || countPlants(garden) === 0}
                          variant="green"
                        >
                          {loading
                            ? <span className="magic-loading">{'\u2736'} Sealing Garden{'\u2026'}</span>
                            : '\uD83C\uDF3F Seal Garden'}
                        </WoodButton>
                        <p style={dimTextStyle}>
                          Click to plant &mdash; click again to remove. The bottom row is your home.
                        </p>
                      </>
                    ) : (
                      <div style={{ ...glassPanel, textAlign: 'center', padding: '1.5rem 1rem', width: '100%' }}>
                        <img
                          src={isCreature ? CREATURE_IMG : WITCH_IMG}
                          alt=""
                          style={{ width: 72, height: 72, objectFit: 'contain', imageRendering: 'pixelated' as const, margin: '0 auto 0.75rem', display: 'block', filter: 'drop-shadow(0 0 16px rgba(201,168,76,0.4))' }}
                        />
                        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1rem', color: 'var(--color-ink)', margin: '0 0 0.5rem', lineHeight: 1.5, textAlign: 'center' }}>
                          {isCreature ? '\u23f3 Awaiting Gardener\u2026' : '\uD83C\uDF3F Garden Sealed!'}
                        </h3>
                        <p style={{ fontSize: '0.78rem', color: 'var(--color-ink-muted)', margin: '0 0 1rem', maxWidth: 320, textAlign: 'center', lineHeight: 1.6 }}>
                          {isCreature
                            ? 'The Gardener is planting magical herbs. The match will begin shortly.'
                            : 'Syncing with the contract\u2026'}
                        </p>
                        <div style={{ display: 'inline-block', padding: '0.35rem 1rem', borderRadius: 999, background: 'rgba(201,168,76,0.15)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-accent)', animation: 'fadeUp 1.5s ease-in-out infinite alternate' }}>
                          <span className="magic-loading">{'\u2736'} Polling\u2026</span>
                        </div>
                      </div>
                    )
                  ) : (
                    <>
                      {renderGameBoard(true, isGardener)}

                      {/* ZK Proof progress bar */}
                      {revealingCell && (
                        <div style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'rgba(30,15,60,0.88)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 10, animation: 'fadeUp 0.3s ease both' }}>
                          <div style={{ fontSize: '0.6rem', color: '#c4b5fd', marginBottom: '0.3rem' }}>
                            <span className="magic-loading">{'\u26A1'} Invoking ZK protection\u2026</span>
                          </div>
                          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(100, zkProofStep * 25)}%`, background: 'linear-gradient(90deg, #7c3aed, #db2777)', transition: 'width 0.55s ease', borderRadius: 2 }} />
                          </div>
                        </div>
                      )}

                      {/* Instruction area */}
                      <div style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'rgba(15,7,32,0.55)', borderRadius: 10, border: '1px solid rgba(120,80,200,0.2)', textAlign: 'center' }}>
                        <p style={{ fontSize: '0.7rem', color: 'rgba(220,210,255,0.82)', margin: 0, lineHeight: 1.5 }}>
                          {isCreature && gameState.phase === GamePhase.Playing
                            ? (gameState.creature_y === 0
                              ? '\uD83D\uDC7B Choose a column to enter the garden'
                              : '\uD83D\uDC7B Step into a lit cell')
                            : isGardener && gameState.phase === GamePhase.WaitingForProof
                            ? revealingCell
                              ? '\u26A1 Invoking ZK protection\u2026'
                              : '\u2728 Preparing the reveal\u2026'
                            : '\u23F3 Waiting for the other player\u2026'}
                        </p>
                      </div>

                      {/* ZK proof details (collapsible) */}
                      {isGardener && lastReveal && !revealingCell && lastJournalHash && (
                        <div style={{ width: '100%' }}>
                          <button
                            onClick={() => setZkDetailsOpen(v => !v)}
                            style={{ all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(30,15,60,0.5)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: zkDetailsOpen ? '8px 8px 0 0' : 8, padding: '0.28rem 0.55rem', cursor: 'pointer', color: 'rgba(196,181,253,0.7)', fontSize: '0.6rem', fontFamily: 'monospace' }}
                          >
                            <span>{'\uD83D\uDD10'} ZK Details</span>
                            <span style={{ fontSize: '0.48rem', opacity: 0.6 }}>{zkDetailsOpen ? '\u25B2' : '\u25BC'}</span>
                          </button>
                          {zkDetailsOpen && (
                            <div style={{ background: 'rgba(15,8,40,0.85)', border: '1px solid rgba(167,139,250,0.2)', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '0.45rem 0.6rem', fontFamily: 'monospace', fontSize: '0.56rem', animation: 'fadeUp 0.2s ease both' }}>
                              {([
                                ['Hash', lastJournalHash.slice(0, 10) + '\u2026'],
                                ['Cell', `(${lastReveal.x}, ${lastReveal.y})`],
                                ['Result', lastReveal.has_plant ? `${PLANT_NAMES[lastReveal.plant_type] ?? 'Plant'} \u2014 ${lastReveal.damage_dealt} dmg` : 'Empty'],
                              ] as [string, string][]).map(([k, v]) => (
                                <div key={k} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.12rem' }}>
                                  <span style={{ color: 'rgba(167,139,250,0.55)', minWidth: 36 }}>{k}</span>
                                  <span style={{ color: 'rgba(230,220,255,0.8)' }}>{v}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* RIGHT: Creature */}
                <div style={{ padding: '0.75rem 0.75rem 0.75rem 0.4rem', borderLeft: '1px solid rgba(140,100,220,0.12)', display: 'flex', flexDirection: 'column', gap: '0.45rem', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
                  <img src={CREATURE_IMG} alt="Creature" draggable={false} style={{ height: 'clamp(30px, 5vw, 44px)', imageRendering: 'pixelated', filter: 'drop-shadow(0 0 8px rgba(255,213,79,0.4))' }} />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.55rem', fontWeight: 700, color: '#fde68a', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>Creature</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: displayedCreatureHp <= 2 ? '#f87171' : '#fde68a', textShadow: `0 0 12px ${displayedCreatureHp <= 2 ? 'rgba(248,113,113,0.6)' : 'rgba(253,230,138,0.5)'}` }}>
                    HP {displayedCreatureHp}
                  </div>
                  <div style={{ width: '100%', height: 1, background: 'rgba(140,100,220,0.12)' }} />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 600, color: 'rgba(200,180,255,0.55)', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Abilities</span>

                  {/* Smell */}
                  <button
                    onClick={() => handleSpiritSense('smell')}
                    disabled={!isCreature || gameState.phase !== GamePhase.Playing || displayedCreatureHp <= 1 || spiritSenseLoading || isBusy}
                    title="Count plants in next 2 rows — costs 1 HP"
                    style={{
                      all: 'unset', boxSizing: 'border-box',
                      width: '100%', padding: '0.4rem 0.3rem', borderRadius: 9,
                      border: '1px solid rgba(167,139,250,0.22)',
                      background: (!isCreature || gameState.phase !== GamePhase.Playing) ? 'rgba(15,8,32,0.4)' : 'rgba(60,30,120,0.35)',
                      cursor: (!isCreature || gameState.phase !== GamePhase.Playing || displayedCreatureHp <= 1 || isBusy) ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                      opacity: (!isCreature || gameState.phase !== GamePhase.Playing) ? 0.4 : 1,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    <img src="/assets/smell.png" alt="Smell" draggable={false} style={{ height: 'clamp(30px, 6vw, 44px)', imageRendering: 'pixelated' }} />
                    <span style={{ fontSize: '0.65rem', color: '#c4b5fd', fontWeight: 600 }}>Smell</span>
                    <span style={{ fontSize: '0.58rem', color: 'rgba(200,180,255,0.55)' }}>{'\u22121'} HP</span>
                  </button>

                  {/* Instinct / Peek */}
                  <button
                    onClick={() => handleSpiritSense('peek')}
                    disabled={!isCreature || gameState.phase !== GamePhase.Playing || displayedCreatureHp <= 1 || spiritSenseLoading || isBusy}
                    title="Peek at adjacent cells — costs 1 HP"
                    style={{
                      all: 'unset', boxSizing: 'border-box',
                      width: '100%', padding: '0.4rem 0.3rem', borderRadius: 9,
                      border: '1px solid rgba(167,139,250,0.22)',
                      background: (!isCreature || gameState.phase !== GamePhase.Playing) ? 'rgba(15,8,32,0.4)' : 'rgba(60,30,120,0.35)',
                      cursor: (!isCreature || gameState.phase !== GamePhase.Playing || displayedCreatureHp <= 1 || isBusy) ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                      opacity: (!isCreature || gameState.phase !== GamePhase.Playing) ? 0.4 : 1,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    <img src="/assets/adivine.png" alt="Instinct" draggable={false} style={{ height: 'clamp(30px, 6vw, 44px)', imageRendering: 'pixelated' }} />
                    <span style={{ fontSize: '0.65rem', color: '#c4b5fd', fontWeight: 600 }}>Instinct</span>
                    <span style={{ fontSize: '0.58rem', color: 'rgba(200,180,255,0.55)' }}>{'\u22121'} HP</span>
                  </button>

                  {/* Sense result (compact) */}
                  {spiritSenseResult && !spiritSenseLoading && (
                    <div style={{ width: '100%', padding: '0.35rem 0.4rem', background: 'rgba(10,5,30,0.5)', borderRadius: 8, border: '1px solid rgba(167,139,250,0.15)', animation: 'fadeUp 0.3s ease both', fontSize: '0.58rem', lineHeight: 1.45 }}>
                      {'noGarden' in spiritSenseResult ? (
                        <span style={{ color: '#fde68a' }}>Garden not found</span>
                      ) : spiritSenseResult.ability === 'smell' ? (
                        <span style={{ color: spiritSenseResult.count > 0 ? '#fde68a' : '#86efac' }}>
                          {spiritSenseResult.count === 0 ? '\u2714 Clear ahead' : `\uD83C\uDF3F ${spiritSenseResult.count} plant(s) nearby`}
                        </span>
                      ) : (
                        <div>
                          <div style={{ color: spiritSenseResult.left === 'PLANT' ? '#86efac' : '#a78bfa' }}>L: {spiritSenseResult.left === 'PLANT' ? '\uD83C\uDF3F Plant' : spiritSenseResult.left === 'empty' ? '\u25CB Clear' : 'N/A'}</div>
                          <div style={{ color: spiritSenseResult.right === 'PLANT' ? '#86efac' : '#a78bfa' }}>R: {spiritSenseResult.right === 'PLANT' ? '\uD83C\uDF3F Plant' : spiritSenseResult.right === 'empty' ? '\u25CB Clear' : 'N/A'}</div>
                        </div>
                      )}
                    </div>
                  )}
                  {spiritSenseLoading && (
                    <span className="magic-loading" style={{ fontSize: '0.58rem', color: '#c4b5fd' }}>{'\u26A1'} Sensing\u2026</span>
                  )}
                </div>
              </div>

              {/* Footer: error / success */}
              {(error || success) && (
                <div style={{ padding: '0.45rem 0.75rem', borderTop: '1px solid rgba(140,100,220,0.12)' }}>
                  {error && <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-error)', margin: 0 }}>{error}</p>}
                  {success && <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-success)', margin: 0 }}>{success}</p>}
                </div>
              )}
            </div>
          );
        })()}

      </div>{/* end contentCol */}
    </div>
  );
}
