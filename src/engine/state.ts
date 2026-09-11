import type { Board, EndReason, GameState, Move, MoveOptions, Piece, Placement, Pos, Rules, Team } from './types';
import {
  COLS, ROWS, PIECE_COUNTS, PIECES_PER_SIDE,
  goalRow, hasAnyLegalMove, inBounds, legalMoves, neighbors, other, posEq, posKey, resolveChallenge, setupRows,
} from './rules';

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Piece | null>(COLS).fill(null));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice());
}

export function createGame(rules: Rules): GameState {
  return {
    board: emptyBoard(),
    phase: 'setup',
    turn: 'A',
    ply: 0,
    pendingFlag: null,
    winner: null,
    endReason: null,
    captured: [],
    history: [],
    rules,
  };
}

/** Returns an error message, or null when the setup is legal. Ranks may be null for an opponent's setup. */
export function validateSetup(team: Team, placements: Placement[]): string | null {
  if (placements.length !== PIECES_PER_SIDE) return `Place all ${PIECES_PER_SIDE} pieces.`;
  const rows = setupRows(team);
  const seenPos = new Set<string>();
  const seenId = new Set<string>();
  const counts: Partial<Record<string, number>> = {};
  for (const p of placements) {
    if (!inBounds(p.pos) || !rows.includes(p.pos.r)) return 'Every piece must be inside your three rows.';
    const k = posKey(p.pos);
    if (seenPos.has(k)) return 'Two pieces share a square.';
    seenPos.add(k);
    if (seenId.has(p.id)) return 'Duplicate piece id.';
    seenId.add(p.id);
    if (p.rank) counts[p.rank] = (counts[p.rank] ?? 0) + 1;
  }
  if (placements.some((p) => p.rank)) {
    for (const rank of Object.keys(PIECE_COUNTS) as (keyof typeof PIECE_COUNTS)[]) {
      if ((counts[rank] ?? 0) !== PIECE_COUNTS[rank]) return `Wrong number of ${rank} pieces.`;
    }
  }
  return null;
}

export function applySetup(state: GameState, team: Team, placements: Placement[]): GameState {
  if (state.phase !== 'setup') throw new Error('Setup is closed.');
  const err = validateSetup(team, placements);
  if (err) throw new Error(err);
  const board = cloneBoard(state.board);
  for (const row of setupRows(team)) for (let c = 0; c < COLS; c++) board[row][c] = null;
  for (const p of placements) board[p.pos.r][p.pos.c] = { id: p.id, team, rank: p.rank };
  return { ...state, board };
}

export function startGame(state: GameState, first: Team): GameState {
  if (state.phase !== 'setup') throw new Error('Game already started.');
  return { ...state, phase: 'playing', turn: first, ply: 0 };
}

export function endGame(state: GameState, winner: Team, reason: EndReason): GameState {
  return { ...state, phase: 'ended', winner, endReason: reason, pendingFlag: null };
}

export function pieceAt(state: GameState, pos: Pos): Piece | null {
  return inBounds(pos) ? state.board[pos.r][pos.c] : null;
}

export function findPiece(board: Board, id: string): { piece: Piece; pos: Pos } | null {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (piece && piece.id === id) return { piece, pos: { c, r } };
    }
  }
  return null;
}

export function isChallenge(state: GameState, move: Move): boolean {
  const target = pieceAt(state, move.to);
  const mover = pieceAt(state, move.from);
  return !!(target && mover && target.team !== mover.team);
}

function adjacentEnemy(board: Board, pos: Pos, team: Team): boolean {
  return neighbors(pos).some((n) => {
    const p = board[n.r][n.c];
    return !!p && p.team !== team;
  });
}

/**
 * Applies one move for the side to move. Pure: returns a new state.
 * A challenge needs both ranks in `opts.ranks`. A flag arriving on the goal row is
 * announced with `opts.declareFlag` so the opponent's client can see it without knowing ranks.
 */
export function applyMove(state: GameState, move: Move, opts: MoveOptions = {}): GameState {
  if (state.phase !== 'playing') throw new Error('The game is not in progress.');
  const mover = pieceAt(state, move.from);
  if (!mover || mover.team !== state.turn) throw new Error('No piece of yours on that square.');
  if (!legalMoves(state.board, move.from).some((p) => posEq(p, move.to))) throw new Error('Illegal move.');

  const team = state.turn;
  const board = cloneBoard(state.board);
  const target = board[move.to.r][move.to.c];
  const captured = state.captured.slice();
  let result: ReturnType<typeof resolveChallenge> | null = null;

  if (target) {
    if (!opts.ranks) throw new Error('Both ranks are needed to resolve a challenge.');
    const attacker: Piece = { ...mover, rank: opts.ranks.attacker };
    const defender: Piece = { ...target, rank: opts.ranks.defender };
    result = resolveChallenge(opts.ranks.attacker, opts.ranks.defender);
    board[move.from.r][move.from.c] = null;
    if (result === 'attacker') {
      board[move.to.r][move.to.c] = attacker;
      captured.push(defender);
    } else if (result === 'defender') {
      board[move.to.r][move.to.c] = defender;
      captured.push(attacker);
    } else {
      board[move.to.r][move.to.c] = null;
      captured.push(attacker, defender);
    }
  } else {
    const moved: Piece = opts.declareFlag ? { ...mover, rank: 'FLG' } : mover;
    board[move.from.r][move.from.c] = null;
    board[move.to.r][move.to.c] = moved;
  }

  let next: GameState = {
    ...state,
    board,
    captured,
    ply: state.ply + 1,
    history: [...state.history, { ply: state.ply + 1, team, from: move.from, to: move.to, result }],
    turn: other(team),
  };

  // 1. A flag was eliminated in this challenge.
  const lostFlag = captured.slice(state.captured.length).find((p) => p.rank === 'FLG');
  if (lostFlag) return endGame(next, other(lostFlag.team), 'flagCaptured');

  // 2. The opponent's flag was waiting on our goal row and we failed to capture it.
  if (state.pendingFlag && state.pendingFlag.team !== team) {
    const p = board[state.pendingFlag.pos.r][state.pendingFlag.pos.c];
    if (p && p.team === state.pendingFlag.team) return endGame(next, state.pendingFlag.team, 'flagHome');
  }
  next = { ...next, pendingFlag: null };

  // 3. Our flag arrived on the goal row.
  const landed = board[move.to.r][move.to.c];
  if (landed && landed.team === team && landed.rank === 'FLG' && move.to.r === goalRow(team)) {
    if (state.rules.flagInstantWin || !adjacentEnemy(board, move.to, team)) {
      return endGame(next, team, 'flagHome');
    }
    next = { ...next, pendingFlag: { team, pos: move.to } };
  }

  // 4. The opponent cannot move at all.
  if (!hasAnyLegalMove(board, other(team))) return endGame(next, team, 'noMoves');

  return next;
}
