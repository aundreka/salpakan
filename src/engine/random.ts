import type { Placement, Rank, Team } from './types';
import { ALL_RANKS, COLS, PIECE_COUNTS, PIECES_PER_SIDE, setupRows } from './rules';

export type Rng = () => number;

/** Small seeded PRNG for reproducible setups and tests. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rng: Rng = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The 21 ranks a side owns, one entry per piece. */
export function fullRankList(): Rank[] {
  const out: Rank[] = [];
  for (const rank of ALL_RANKS) for (let i = 0; i < PIECE_COUNTS[rank]; i++) out.push(rank);
  return out;
}

/** Piece ids shuffled so an id never hints at a rank. */
export function makePieceIds(team: Team, rng: Rng = Math.random): string[] {
  return shuffle(Array.from({ length: PIECES_PER_SIDE }, (_, i) => `${team}${i.toString().padStart(2, '0')}`), rng);
}

export function randomSetup(team: Team, rng: Rng = Math.random): Placement[] {
  const cells = setupRows(team).flatMap((r) => Array.from({ length: COLS }, (_, c) => ({ c, r })));
  const chosen = shuffle(cells, rng).slice(0, PIECES_PER_SIDE);
  const ranks = shuffle(fullRankList(), rng);
  const ids = makePieceIds(team, rng);
  return chosen.map((pos, i) => ({ id: ids[i], rank: ranks[i], pos }));
}
