import { useState, useEffect, useRef } from 'react';
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
  moonPhaseLabel,
  moonPhaseEmoji,
  moonPhaseEffect,
  PLANT_NAMES,
  PLANT_EMOJI,
  GRID_SIZE,
  MAX_PLANTS,
  type GardenLayout,
} from './gardenUtils';

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

const service = new HerbalMoonlightService(HERBAL_MOONLIGHT_CONTRACT);

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
  const { getContractSigner, walletType } = useWallet();

  // Session state
  const [sessionId, setSessionId] = useState<number>(() => createRandomSessionId());
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

  // Garden setup phase (Gardener only)
  const [garden, setGarden] = useState<GardenLayout>(createEmptyGarden);
  const [selectedPlantType, setSelectedPlantType] = useState(1);
  const [gardenCommitment, setGardenCommitment] = useState<Buffer | null>(null);

  // Play phase
  const [lastReveal, setLastReveal] = useState<CellRevealResult | null>(null);
  const [revealingCell, setRevealingCell] = useState(false);

  // General
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const actionLock = useRef(false);
  const isBusy = loading || quickstartLoading;

  const quickstartAvailable = walletType === 'dev'
    && DevWalletService.isDevModeAvailable()
    && DevWalletService.isPlayerAvailable(1)
    && DevWalletService.isPlayerAvailable(2);

  useEffect(() => { setPlayer1Address(userAddress); }, [userAddress]);

  // Determine player roles
  const isGardener = gameState?.gardener === userAddress;
  const isCreature = gameState?.creature === userAddress;

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

  const loadGameState = async () => {
    try {
      const session = await service.getSession(sessionId);
      setGameState(session);
      if (session) {
        if (session.phase === GamePhase.Finished) {
          setUiPhase('complete');
        } else if (session.phase === GamePhase.WaitingForCommitment) {
          setUiPhase('garden-setup');
        } else {
          setUiPhase('play');
        }
      }
    } catch (err) {
      console.log('[loadGameState] Error:', err);
    }
  };

  // Poll game state during play
  useEffect(() => {
    if (uiPhase === 'play' || uiPhase === 'garden-setup') {
      loadGameState();
      const interval = setInterval(loadGameState, 5000);
      return () => clearInterval(interval);
    }
  }, [sessionId, uiPhase]);

  const handleStartNewGame = () => {
    if (gameState?.phase === GamePhase.Finished) onGameComplete();
    actionLock.current = false;
    setUiPhase('create');
    setSessionId(createRandomSessionId());
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

        const signer = getContractSigner();
        const placeholderCreature = await getFundedSimulationSourceAddress([player1Address, userAddress]);

        const authEntryXDR = await service.prepareStartGame(
          sessionId, player1Address, placeholderCreature,
          p1Points, p1Points, signer
        );

        setExportedAuthEntryXDR(authEntryXDR);
        setSuccess('Auth entry signed! Send it to the Creature player.');

        // Poll for game creation
        const pollInterval = setInterval(async () => {
          const game = await service.getSession(sessionId);
          if (game) {
            clearInterval(pollInterval);
            setGameState(game);
            setExportedAuthEntryXDR(null);
            setSuccess('Game created! Creature has joined.');
            setUiPhase('garden-setup');
            onStandingsRefresh();
            setTimeout(() => setSuccess(null), 2000);
          }
        }, 3000);
        setTimeout(() => clearInterval(pollInterval), 300000);
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
        await loadGameState();
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

        const signer = getContractSigner();
        await service.commitGarden(sessionId, userAddress, commitment, signer);

        setSuccess('Garden committed! The game begins.');
        setUiPhase('play');
        await loadGameState();
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

        const signer = getContractSigner();
        await service.creatureMove(sessionId, userAddress, x, y, signer);

        setSuccess(`Moved to (${x}, ${y}). Waiting for Gardener to reveal...`);
        await loadGameState();
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
        setError(null);

        const x = gameState.creature_x;
        const y = gameState.creature_y;

        const journalBytes = buildJournal(gardenCommitment, x, y, garden);
        const journalHash = await computeJournalHash(journalBytes);
        const emptySeal = Buffer.alloc(0); // Dev mode

        const signer = getContractSigner();
        const result = await service.revealCell(
          sessionId, userAddress, journalBytes, journalHash, emptySeal, signer
        );

        setLastReveal(result);
        if (result?.has_plant) {
          setSuccess(`${PLANT_EMOJI[result.plant_type]} ${PLANT_NAMES[result.plant_type]} found! Dealt ${result.damage_dealt} damage.`);
        } else {
          setSuccess('Empty cell - no damage.');
        }
        await loadGameState();
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Reveal failed');
      } finally {
        setRevealingCell(false);
      }
    });
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

  // ====================================================================
  // Render Helpers
  // ====================================================================

  const renderGameBoard = (interactive: boolean, showPlants: boolean) => {
    const validMoves = interactive && isCreature && gameState?.phase === GamePhase.Playing
      ? getValidMoves(gameState.creature_x, gameState.creature_y, Array.from(gameState.revealed_cells))
      : [];

    return (
      <div className="grid grid-cols-5 gap-1 max-w-xs mx-auto">
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, idx) => {
          const x = idx % GRID_SIZE;
          const y = Math.floor(idx / GRID_SIZE);
          const isCreatureHere = gameState && gameState.creature_x === x && gameState.creature_y === y;
          const isRevealed = gameState?.revealed_cells?.includes(idx);
          const isValidMove = validMoves.some(m => m.x === x && m.y === y);
          const plantType = showPlants ? garden[idx] : 0;

          let bgClass = 'bg-green-100 border-green-300';
          if (isCreatureHere) bgClass = 'bg-amber-200 border-amber-500';
          else if (isRevealed) bgClass = 'bg-gray-200 border-gray-400';
          else if (isValidMove) bgClass = 'bg-blue-100 border-blue-400 cursor-pointer hover:bg-blue-200';

          // Bottom row = house
          if (y === 4) bgClass += ' border-b-4 border-b-yellow-500';

          return (
            <button
              key={idx}
              disabled={!isValidMove || isBusy}
              onClick={() => isValidMove && handleCreatureMove(x, y)}
              className={`w-12 h-12 sm:w-14 sm:h-14 rounded-lg border-2 flex items-center justify-center text-lg font-bold transition-all ${bgClass} disabled:cursor-default`}
              title={`(${x}, ${y})${isRevealed ? ' - revealed' : ''}`}
            >
              {isCreatureHere ? '\uD83D\uDC3E' : ''}
              {!isCreatureHere && showPlants && plantType > 0 ? PLANT_EMOJI[plantType] : ''}
              {!isCreatureHere && isRevealed && !showPlants ? '\u2022' : ''}
            </button>
          );
        })}
      </div>
    );
  };

  const renderGardenEditor = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800">Place Your Plants</h3>
        <span className="text-sm font-semibold text-gray-600">
          {countPlants(garden)}/{MAX_PLANTS} plants
        </span>
      </div>

      {/* Plant type selector */}
      <div className="flex gap-2 justify-center">
        {[1, 2, 3].map(type => (
          <button
            key={type}
            onClick={() => setSelectedPlantType(type)}
            className={`px-3 py-2 rounded-lg border-2 font-bold text-sm transition-all ${
              selectedPlantType === type
                ? 'border-purple-500 bg-purple-100 text-purple-800 scale-105'
                : 'border-gray-200 bg-white text-gray-600 hover:border-purple-300'
            }`}
          >
            {PLANT_EMOJI[type]} {PLANT_NAMES[type]} (dmg:{type})
          </button>
        ))}
      </div>

      {/* Garden grid */}
      <div className="grid grid-cols-5 gap-1 max-w-xs mx-auto">
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, idx) => {
          const x = idx % GRID_SIZE;
          const y = Math.floor(idx / GRID_SIZE);
          const cellPlant = garden[idx];

          let bgClass = 'bg-green-50 border-green-200 hover:bg-green-100';
          if (cellPlant > 0) bgClass = 'bg-purple-100 border-purple-400';
          if (y === 4) bgClass += ' border-b-4 border-b-yellow-500';

          return (
            <button
              key={idx}
              onClick={() => handleGardenCellClick(x, y)}
              className={`w-12 h-12 sm:w-14 sm:h-14 rounded-lg border-2 flex items-center justify-center text-lg font-bold transition-all cursor-pointer ${bgClass}`}
              title={`(${x}, ${y}) - ${PLANT_NAMES[cellPlant] || 'Empty'}`}
            >
              {cellPlant > 0 ? PLANT_EMOJI[cellPlant] : ''}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-center text-gray-500">
        Click a cell to place selected plant. Click again to remove. Bottom row = creature's destination (house).
      </p>
    </div>
  );

  // ====================================================================
  // Render
  // ====================================================================

  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border-2 border-green-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-black bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 bg-clip-text text-transparent">
            Herbal Moonlight
          </h2>
          <p className="text-sm text-gray-700 font-semibold mt-1">
            {isGardener ? 'You are the Gardener' : isCreature ? 'You are the Creature' : 'ZK Garden Defense'}
          </p>
          {uiPhase !== 'create' && (
            <p className="text-xs text-gray-500 font-mono mt-1">Session: {sessionId}</p>
          )}
        </div>
        {gameState && (
          <div className="text-right text-sm">
            <div className="font-bold text-gray-700">
              {moonPhaseEmoji(gameState.moon_phase)} {moonPhaseLabel(gameState.moon_phase)}
            </div>
            <div className="text-xs text-gray-500">{moonPhaseEffect(gameState.moon_phase)}</div>
          </div>
        )}
      </div>

      {/* Error / Success */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border-2 border-red-200 rounded-xl">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border-2 border-green-200 rounded-xl">
          <p className="text-sm font-semibold text-green-700">{success}</p>
        </div>
      )}

      {/* ============================================================ */}
      {/* CREATE PHASE */}
      {/* ============================================================ */}
      {uiPhase === 'create' && (
        <div className="space-y-6">
          {/* Mode tabs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 p-2 bg-gray-100 rounded-xl">
            {(['create', 'import', 'load'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => {
                  setCreateMode(mode);
                  setExportedAuthEntryXDR(null);
                  setError(null);
                  setSuccess(null);
                }}
                className={`flex-1 py-2 px-4 rounded-lg font-bold text-sm transition-all ${
                  createMode === mode
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {mode === 'create' ? 'Create (Gardener)' : mode === 'import' ? 'Join (Creature)' : 'Load Game'}
              </button>
            ))}
          </div>

          {/* Quickstart */}
          <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-yellow-900">Quickstart (Dev)</p>
                <p className="text-xs font-semibold text-yellow-800">
                  Creates and signs for both dev wallets in one click.
                </p>
              </div>
              <button
                onClick={handleQuickStart}
                disabled={isBusy || !quickstartAvailable}
                className="px-4 py-2 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-md"
              >
                {quickstartLoading ? 'Starting...' : 'Quickstart'}
              </button>
            </div>
          </div>

          {/* CREATE mode */}
          {createMode === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Your Address (Gardener)</label>
                <input
                  type="text" value={player1Address}
                  onChange={e => setPlayer1Address(e.target.value.trim())}
                  className="w-full px-4 py-2 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-green-400 text-sm font-mono text-gray-700"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Points</label>
                <input
                  type="text" value={player1Points}
                  onChange={e => setPlayer1Points(e.target.value)}
                  placeholder="0.1"
                  className="w-full px-4 py-2 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-green-400 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Available: {(Number(availablePoints) / 10000000).toFixed(2)}
                </p>
              </div>
              <div className="p-3 bg-blue-50 border-2 border-blue-200 rounded-xl">
                <p className="text-xs font-semibold text-blue-800">
                  The Creature player will specify their own address and points when they import your auth entry.
                </p>
              </div>
              <p className="text-xs text-gray-500">Session ID: {sessionId}</p>

              {!exportedAuthEntryXDR ? (
                <button
                  onClick={handlePrepareTransaction}
                  disabled={isBusy}
                  className="w-full py-3 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg"
                >
                  {loading ? 'Preparing...' : 'Prepare & Export Auth Entry'}
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="p-4 bg-green-50 border-2 border-green-200 rounded-xl">
                    <p className="text-xs font-bold uppercase text-green-700 mb-2">Auth Entry XDR (Gardener Signed)</p>
                    <div className="bg-white p-2 rounded-lg border border-green-200 mb-2 max-h-24 overflow-y-auto">
                      <code className="text-xs font-mono text-gray-700 break-all">{exportedAuthEntryXDR}</code>
                    </div>
                    <button
                      onClick={() => copyToClipboard(exportedAuthEntryXDR!)}
                      className="w-full py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white font-bold text-sm transition-all"
                    >
                      {authEntryCopied ? 'Copied!' : 'Copy Auth Entry'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 text-center">
                    Send this to the Creature player. Polling for their signature...
                  </p>
                </div>
              )}
            </div>
          )}

          {/* IMPORT mode */}
          {createMode === 'import' && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-xl space-y-3">
                <p className="text-sm font-semibold text-blue-800">Join as Creature</p>
                <p className="text-xs text-gray-700">
                  Paste the auth entry XDR from the Gardener. Session ID and Gardener info will be auto-extracted.
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
                    } catch { /* ignore parse errors while typing */ }
                  }}
                  placeholder="Paste Gardener's signed auth entry XDR..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl bg-white border-2 border-blue-200 focus:outline-none focus:border-blue-400 text-xs font-mono resize-none"
                />
                {importSessionId && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="font-bold text-gray-500">Session:</span> {importSessionId}
                    </div>
                    <div>
                      <span className="font-bold text-gray-500">Gardener Points:</span> {importPlayer1Points}
                    </div>
                    <div className="col-span-2">
                      <span className="font-bold text-gray-500">Gardener:</span>{' '}
                      <span className="font-mono">{importPlayer1.slice(0, 10)}...{importPlayer1.slice(-4)}</span>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Your Points *</label>
                  <input
                    type="text" value={importPlayer2Points}
                    onChange={e => setImportPlayer2Points(e.target.value)}
                    placeholder="0.1"
                    className="w-full px-3 py-2 rounded-xl bg-white border-2 border-blue-200 focus:outline-none focus:border-blue-400 text-xs"
                  />
                </div>
              </div>
              <button
                onClick={handleImportTransaction}
                disabled={isBusy || !importAuthEntryXDR.trim()}
                className="w-full py-3 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg"
              >
                {loading ? 'Joining...' : 'Join Game as Creature'}
              </button>
            </div>
          )}

          {/* LOAD mode */}
          {createMode === 'load' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border-2 border-emerald-200 rounded-xl">
                <p className="text-sm font-semibold text-emerald-800 mb-2">Load Existing Game</p>
                <input
                  type="text" value={loadSessionId}
                  onChange={e => setLoadSessionId(e.target.value)}
                  placeholder="Enter session ID"
                  className="w-full px-3 py-2 rounded-xl bg-white border-2 border-emerald-200 focus:outline-none focus:border-emerald-400 text-sm font-mono"
                />
              </div>
              <button
                onClick={handleLoadExistingGame}
                disabled={isBusy || !loadSessionId.trim()}
                className="w-full py-3 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg"
              >
                {loading ? 'Loading...' : 'Load Game'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* GARDEN SETUP PHASE */}
      {/* ============================================================ */}
      {uiPhase === 'garden-setup' && gameState && (
        <div className="space-y-6">
          {isGardener && gameState.phase === GamePhase.WaitingForCommitment ? (
            <>
              {renderGardenEditor()}
              <button
                onClick={handleCommitGarden}
                disabled={isBusy || countPlants(garden) === 0}
                className="w-full py-3 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg"
              >
                {loading ? 'Committing...' : 'Commit Garden (ZK Hash)'}
              </button>
              <p className="text-xs text-center text-gray-500">
                Your garden layout will be hashed (SHA-256). The Creature never sees your plants until you reveal each cell with a ZK proof.
              </p>
            </>
          ) : (
            <div className="p-8 text-center">
              <div className="text-5xl mb-4">{isCreature ? '\uD83D\uDC3E' : '\uD83C\uDF3B'}</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">
                {isCreature ? 'Waiting for Gardener...' : 'Garden Committed!'}
              </h3>
              <p className="text-sm text-gray-600">
                {isCreature
                  ? 'The Gardener is placing their plants. The game will begin once they commit their garden layout.'
                  : 'Waiting for the game state to update...'}
              </p>
              <div className="mt-4 inline-block px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold animate-pulse">
                Polling...
              </div>
            </div>
          )}

          {/* Player info */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`p-3 rounded-xl border-2 ${isGardener ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-500">Gardener</div>
              <div className="font-mono text-xs text-gray-700 mt-1 truncate">{gameState.gardener}</div>
              <div className="text-xs text-gray-500 mt-1">
                Points: {(Number(gameState.gardener_points) / 10000000).toFixed(2)}
              </div>
            </div>
            <div className={`p-3 rounded-xl border-2 ${isCreature ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-500">Creature</div>
              <div className="font-mono text-xs text-gray-700 mt-1 truncate">{gameState.creature}</div>
              <div className="text-xs text-gray-500 mt-1">
                HP: {gameState.creature_hp} | Points: {(Number(gameState.creature_points) / 10000000).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* PLAY PHASE */}
      {/* ============================================================ */}
      {uiPhase === 'play' && gameState && (
        <div className="space-y-6">
          {/* Status bar */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
            <div className="text-sm font-bold text-gray-700">
              Turn {gameState.turn_number}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-red-600">
                HP: {gameState.creature_hp}
              </span>
              {gameState.damage_reduction > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold">
                  Calming Mist
                </span>
              )}
            </div>
            <div className={`text-xs font-bold px-2 py-1 rounded-full ${
              gameState.phase === GamePhase.Playing
                ? 'bg-blue-100 text-blue-700'
                : gameState.phase === GamePhase.WaitingForProof
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {gameState.phase === GamePhase.Playing ? "Creature's Turn" :
               gameState.phase === GamePhase.WaitingForProof ? "Gardener Revealing..." :
               'Finished'}
            </div>
          </div>

          {/* Game board */}
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-2">
              {isCreature && gameState.phase === GamePhase.Playing
                ? (gameState.creature_y === 0
                  ? 'Choose any column to enter the garden'
                  : 'Click a highlighted cell to move forward')
                : isGardener && gameState.phase === GamePhase.WaitingForProof
                ? 'Click "Reveal Cell" to prove what is at the creature\'s position'
                : 'Waiting for the other player...'}
            </p>
            {renderGameBoard(true, isGardener)}
          </div>

          {/* Gardener: Reveal button */}
          {isGardener && gameState.phase === GamePhase.WaitingForProof && (
            <button
              onClick={handleRevealCell}
              disabled={revealingCell || isBusy}
              className="w-full py-3 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg"
            >
              {revealingCell ? 'Generating proof & revealing...' : `Reveal Cell (${gameState.creature_x}, ${gameState.creature_y})`}
            </button>
          )}

          {/* Last reveal result */}
          {lastReveal && (
            <div className={`p-3 rounded-xl border-2 text-center ${
              lastReveal.has_plant ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
            }`}>
              <span className="text-lg mr-2">
                {lastReveal.has_plant ? PLANT_EMOJI[lastReveal.plant_type] : '\u2705'}
              </span>
              <span className="text-sm font-bold">
                ({lastReveal.x}, {lastReveal.y}):
                {lastReveal.has_plant
                  ? ` ${PLANT_NAMES[lastReveal.plant_type]} - ${lastReveal.damage_dealt} damage!`
                  : ' Empty cell'}
              </span>
            </div>
          )}

          {/* Player cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`p-3 rounded-xl border-2 ${isGardener ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}>
              <div className="text-xs font-bold uppercase text-gray-500">Gardener</div>
              <div className="font-mono text-xs text-gray-700 mt-1">
                {gameState.gardener.slice(0, 8)}...{gameState.gardener.slice(-4)}
              </div>
            </div>
            <div className={`p-3 rounded-xl border-2 ${isCreature ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
              <div className="text-xs font-bold uppercase text-gray-500">Creature</div>
              <div className="font-mono text-xs text-gray-700 mt-1">
                {gameState.creature.slice(0, 8)}...{gameState.creature.slice(-4)}
              </div>
              <div className="text-sm font-bold text-red-600 mt-1">
                HP: {'*'.repeat(Math.min(gameState.creature_hp, 10))} ({gameState.creature_hp})
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* COMPLETE PHASE */}
      {/* ============================================================ */}
      {uiPhase === 'complete' && gameState && (
        <div className="space-y-6">
          <div className="p-8 text-center bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-300 rounded-2xl">
            <div className="text-6xl mb-4">
              {gameState.creature_hp === 0 ? '\uD83C\uDF3B' : '\uD83D\uDC3E'}
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">Game Over!</h3>
            <p className="text-lg font-bold text-gray-700 mb-4">
              {gameState.creature_hp === 0
                ? 'Gardener wins! The creature was defeated by the plants.'
                : 'Creature wins! It reached the house safely.'}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className={`p-3 rounded-xl border-2 ${
                gameState.creature_hp === 0 ? 'border-green-400 bg-green-100' : 'border-gray-200'
              }`}>
                <div className="text-xs font-bold uppercase text-gray-500">Gardener</div>
                <div className="font-mono text-xs text-gray-700 mt-1">
                  {gameState.gardener.slice(0, 8)}...{gameState.gardener.slice(-4)}
                </div>
                {gameState.creature_hp === 0 && (
                  <div className="mt-2 text-green-700 font-bold">WINNER</div>
                )}
              </div>
              <div className={`p-3 rounded-xl border-2 ${
                gameState.creature_hp > 0 ? 'border-amber-400 bg-amber-100' : 'border-gray-200'
              }`}>
                <div className="text-xs font-bold uppercase text-gray-500">Creature</div>
                <div className="font-mono text-xs text-gray-700 mt-1">
                  {gameState.creature.slice(0, 8)}...{gameState.creature.slice(-4)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Final HP: {gameState.creature_hp} | Turns: {gameState.turn_number}
                </div>
                {gameState.creature_hp > 0 && (
                  <div className="mt-2 text-amber-700 font-bold">WINNER</div>
                )}
              </div>
            </div>

            {((isGardener && gameState.creature_hp === 0) ||
              (isCreature && gameState.creature_hp > 0)) && (
              <p className="text-xl font-black text-green-700">You won!</p>
            )}
          </div>
          <button
            onClick={handleStartNewGame}
            className="w-full py-3 rounded-xl font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 transition-all shadow-lg"
          >
            Start New Game
          </button>
        </div>
      )}
    </div>
  );
}
