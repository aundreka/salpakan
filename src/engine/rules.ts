import type { Board, ChallengeResult, Pos, Rank, Team } from './types';

export const COLS = 9;
export const ROWS = 8;

/** Officers and privates, strongest first. Spy and Flag are outside this order. */
export const OFFICER_ORDER: Rank[] = ['G5', 'G4', 'G3', 'G2', 'G1', 'COL', 'LTC', 'MAJ', 'CPT', 'LT1', 'LT2', 'SGT', 'PVT'];
export const ALL_RANKS: Rank[] = [...OFFICER_ORDER, 'SPY', 'FLG'];

export const PIECE_COUNTS: Record<Rank, number> = {
  G5: 1, G4: 1, G3: 1, G2: 1, G1: 1,
  COL: 1, LTC: 1, MAJ: 1, CPT: 1, LT1: 1, LT2: 1, SGT: 1, PVT: 6,
  SPY: 2, FLG: 1,
};
export const PIECES_PER_SIDE = 21;

export const RANK_INFO: Record<Rank, { name: string; short: string }> = {
  G5: { name: '5-Star General', short: '5★ GEN' },
  G4: { name: '4-Star General', short: '4★ GEN' },
  G3: { name: '3-Star General', short: '3★ GEN' },
  G2: { name: '2-Star General', short: '2★ GEN' },
  G1: { name: '1-Star General', short: '1★ GEN' },
  COL: { name: 'Colonel', short: 'COL' },
  LTC: { name: 'Lt. Colonel', short: 'LT COL' },
  MAJ: { name: 'Major', short: 'MAJ' },
  CPT: { name: 'Captain', short: 'CPT' },
  LT1: { name: '1st Lieutenant', short: '1ST LT' },
  LT2: { name: '2nd Lieutenant', short: '2ND LT' },
  SGT: { name: 'Sergeant', short: 'SGT' },
  PVT: { name: 'Private', short: 'PVT' },
  SPY: { name: 'Spy', short: 'SPY' },
  FLG: { name: 'Flag', short: 'FLAG' },
};

export function other(team: Team): Team {
  return team === 'A' ? 'B' : 'A';
}

/** Rows a team may place its pieces on during setup. */
export function setupRows(team: Team): number[] {
  return team === 'A' ? [5, 6, 7] : [0, 1, 2];
}

/** The row a team's flag must reach to win. */
export function goalRow(team: Team): number {
  return team === 'A' ? 0 : 7;
}

export function inBounds(p: Pos): boolean {
  return p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS;
}

export function posEq(a: Pos, b: Pos): boolean {
  return a.c === b.c && a.r === b.r;
}

export function posKey(p: Pos): string {
  return `${p.c},${p.r}`;
}

/** Algebraic name: columns a–i, rows 1–8 counted from team A's back row. */
export function toNotation(p: Pos): string {
  return `${'abcdefghi'[p.c]}${8 - p.r}`;
}

export function neighbors(p: Pos): Pos[] {
  return [
    { c: p.c, r: p.r - 1 },
    { c: p.c, r: p.r + 1 },
    { c: p.c - 1, r: p.r },
    { c: p.c + 1, r: p.r },
  ].filter(inBounds);
}

export function legalMoves(board: Board, from: Pos): Pos[] {
  const piece = inBounds(from) ? board[from.r][from.c] : null;
  if (!piece) return [];
  return neighbors(from).filter((n) => {
    const target = board[n.r][n.c];
    return !target || target.team !== piece.team;
  });
}

export function hasAnyLegalMove(board: Board, team: Team): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (piece && piece.team === team && legalMoves(board, { c, r }).length > 0) return true;
    }
  }
  return false;
}

/**
 * Who survives when `attacker` moves onto `defender`.
 * - Any piece captures the flag; a flag attacking a flag wins.
 * - A flag attacking anything else is eliminated.
 * - Spy beats every officer and private ranks beat the spy.
 * - Equal ranks eliminate each other.
 */
export function resolveChallenge(attacker: Rank, defender: Rank): ChallengeResult {
  if (defender === 'FLG') return 'attacker';
  if (attacker === 'FLG') return 'defender';
  if (attacker === defender) return 'both';
  if (attacker === 'SPY') return defender === 'PVT' ? 'defender' : 'attacker';
  if (defender === 'SPY') return attacker === 'PVT' ? 'attacker' : 'defender';
  return OFFICER_ORDER.indexOf(attacker) < OFFICER_ORDER.indexOf(defender) ? 'attacker' : 'defender';
}
