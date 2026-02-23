import { Buffer } from 'buffer';

// Plant types matching the contract
export const PLANT_TYPES = {
  EMPTY: 0,
  LAVENDER: 1,
  MINT: 2,
  MANDRAKE: 3,
} as const;

export type PlantType = typeof PLANT_TYPES[keyof typeof PLANT_TYPES];

export const PLANT_NAMES: Record<number, string> = {
  0: 'Empty',
  1: 'Lavender',
  2: 'Mint',
  3: 'Mandrake',
};

export const PLANT_EMOJI: Record<number, string> = {
  0: '',
  1: '\uD83D\uDC9C', // purple heart for Lavender
  2: '\uD83C\uDF3F', // herb for Mint
  3: '\u2620\uFE0F', // skull for Mandrake
};

/** Pixel-art sprite paths — served from public/assets/ */
export const PLANT_IMG: Record<number, string> = {
  0: '',
  1: '/assets/lavender2.png',
  2: '/assets/mint2.png',
  3: '/assets/mandrake2.png',
};

export const CREATURE_IMG = '/assets/ghost.png';
export const DIED_IMG = '/assets/died.png';
export const WITCH_IMG = '/brujita.png';

export const PLANT_DAMAGE: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
};

export const GRID_SIZE = 5;
export const MAX_PLANTS = 8;

// Garden layout: 25 bytes (5x5), each byte is the plant type (0-3)
export type GardenLayout = number[];

export function createEmptyGarden(): GardenLayout {
  return new Array(GRID_SIZE * GRID_SIZE).fill(0);
}

export function gardenToBytes(garden: GardenLayout): Buffer {
  return Buffer.from(garden);
}

export function countPlants(garden: GardenLayout): number {
  return garden.filter(cell => cell > 0).length;
}

export function countPlantsByType(garden: GardenLayout): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  garden.forEach(cell => {
    if (cell > 0 && cell <= 3) {
      counts[cell]++;
    }
  });
  return counts;
}

// Compute SHA256 commitment of the garden layout
export async function computeGardenCommitment(garden: GardenLayout): Promise<Buffer> {
  const gardenBytes = new Uint8Array(garden);
  const hashBuffer = await crypto.subtle.digest('SHA-256', gardenBytes);
  return Buffer.from(hashBuffer);
}

// Build a 73-byte journal for dev mode cell reveal
// Format: [commitment:32][x:1][y:1][has_plant:1][plant_type:1][damage:1][padding:36]
export function buildJournal(
  commitment: Buffer,
  x: number,
  y: number,
  garden: GardenLayout
): Buffer {
  const cellIndex = y * GRID_SIZE + x;
  const plantType = garden[cellIndex] || 0;
  const hasPlant = plantType > 0;
  const damage = hasPlant ? (PLANT_DAMAGE[plantType] || 0) : 0;

  const journal = Buffer.alloc(73);
  commitment.copy(journal, 0, 0, 32);
  journal[32] = x;
  journal[33] = y;
  journal[34] = hasPlant ? 1 : 0;
  journal[35] = plantType;
  journal[36] = damage;
  // Bytes 37-72 remain zero (padding)

  return journal;
}

// Compute SHA256 hash of journal bytes (for dev mode verification)
export async function computeJournalHash(journalBytes: Buffer): Promise<Buffer> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(journalBytes));
  return Buffer.from(hashBuffer);
}

// Validate garden placement rules
export function validateGarden(garden: GardenLayout): { valid: boolean; error?: string } {
  const plantCount = countPlants(garden);
  if (plantCount === 0) {
    return { valid: false, error: 'Place at least 1 plant in your garden' };
  }
  if (plantCount > MAX_PLANTS) {
    return { valid: false, error: `Too many plants (${plantCount}/${MAX_PLANTS})` };
  }
  
  // Note: Home row (y===4) is now valid for planting as a defensive strategy
  // No restrictions on home row placement
  
  // Validate that all cells contain valid plant types (0-3)
  for (let i = 0; i < garden.length; i++) {
    const cell = garden[i];
    if (!Number.isInteger(cell) || cell < 0 || cell > 3) {
      return { valid: false, error: `Invalid plant type at position ${i}: ${cell}` };
    }
  }
  
  // Validate garden is complete and correct size
  if (garden.length !== GRID_SIZE * GRID_SIZE) {
    return { valid: false, error: `Garden size mismatch: expected ${GRID_SIZE * GRID_SIZE} cells, got ${garden.length}` };
  }
  
  return { valid: true };
}

// Get valid moves for the creature at a given position
export function getValidMoves(
  creatureX: number,
  creatureY: number,
  revealedCells: number[]
): { x: number; y: number }[] {
  const moves: { x: number; y: number }[] = [];
  const nextY = creatureY + 1;

  if (nextY >= GRID_SIZE) return moves;

  if (creatureY === 0) {
    // First move: can enter any column
    for (let x = 0; x < GRID_SIZE; x++) {
      moves.push({ x, y: nextY });
    }
  } else {
    // Subsequent moves: forward + at most 1 column diagonal
    for (let dx = -1; dx <= 1; dx++) {
      const newX = creatureX + dx;
      if (newX >= 0 && newX < GRID_SIZE) {
        moves.push({ x: newX, y: nextY });
      }
    }
  }

  return moves;
}

// Moon phase display
export function moonPhaseLabel(phase: number): string {
  switch (phase) {
    case 0: return 'Full Moon';
    case 1: return 'New Moon';
    case 2: return 'Balanced';
    default: return 'Unknown';
  }
}

export function moonPhaseEmoji(phase: number): string {
  switch (phase) {
    case 0: return '\uD83C\uDF15'; // full moon
    case 1: return '\uD83C\uDF11'; // new moon
    case 2: return '\u2696\uFE0F'; // balance
    default: return '\uD83C\uDF19'; // crescent moon
  }
}

export function moonPhaseEffect(phase: number): string {
  switch (phase) {
    case 0: return 'Creature +2 HP, plant damage -1';
    case 1: return 'Plant damage +1';
    case 2: return 'No modifier';
    default: return '';
  }
}
