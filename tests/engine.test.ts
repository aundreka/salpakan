import { describe, expect, it } from 'vitest';
import type { GameState, Rank, Rules, Team } from '../src/engine/types';
import { ALL_RANKS, OFFICER_ORDER, hasAnyLegalMove, legalMoves, resolveChallenge, toNotation } from '../src/engine/rules';
import { applyMove, applySetup, createGame, startGame, validateSetup } from '../src/engine/state';
import { fullRankList, mulberry32, randomSetup } from '../src/engine/random';

const RULES: Rules = { flagInstantWin: true, timerSeconds: 0 };
const TOURNAMENT: Rules = { flagInstantWin: false, timerSeconds: 0 };

interface P { id: string; team: Team; rank: Rank; c: number; r: number }

/** A playing state holding only the given pieces. */
function position(pieces: P[], turn: Team, rules: Rules = RULES): GameState {
  const s: GameState = { ...createGame(rules), phase: 'playing', turn };
  for (const p of pieces) s.board[p.r][p.c] = { id: p.id, team: p.team, rank: p.rank };
  return s;
}

describe('resolveChallenge', () => {
  it('higher officer beats lower, equal officers eliminate each other', () => {
    for (let i = 0; i < OFFICER_ORDER.length; i++) {
      for (let j = 0; j < OFFICER_ORDER.length; j++) {
        const expected = i === j ? 'both' : i < j ? 'attacker' : 'defender';
        expect(resolveChallenge(OFFICER_ORDER[i], OFFICER_ORDER[j])).toBe(expected);
      }
    }
  });

  it('spy beats every officer but loses to a private', () => {
    for (const rank of OFFICER_ORDER) {
      if (rank === 'PVT') continue;
      expect(resolveChallenge('SPY', rank)).toBe('attacker');
      expect(resolveChallenge(rank, 'SPY')).toBe('defender');
    }
    expect(resolveChallenge('SPY', 'PVT')).toBe('defender');
    expect(resolveChallenge('PVT', 'SPY')).toBe('attacker');
    expect(resolveChallenge('SPY', 'SPY')).toBe('both');
  });

  it('anything captures a flag, and a flag attacking loses except against a flag', () => {
    for (const rank of ALL_RANKS) expect(resolveChallenge(rank, 'FLG')).toBe('attacker');
    for (const rank of ALL_RANKS) {
      if (rank === 'FLG') continue;
      expect(resolveChallenge('FLG', rank)).toBe('defender');
    }
    expect(resolveChallenge('FLG', 'FLG')).toBe('attacker');
  });

  it('covers the whole matrix without throwing', () => {
    for (const a of ALL_RANKS) for (const d of ALL_RANKS) expect(['attacker', 'defender', 'both']).toContain(resolveChallenge(a, d));
  });
});

describe('setup', () => {
  it('random setup is valid and has the right composition', () => {
    const rng = mulberry32(7);
    for (const team of ['A', 'B'] as const) {
      const setup = randomSetup(team, rng);
      expect(validateSetup(team, setup)).toBeNull();
      expect(setup.map((p) => p.rank).sort()).toEqual(fullRankList().sort());
    }
  });

  it('rejects pieces outside the owner rows and wrong counts', () => {
    const setup = randomSetup('A', mulberry32(1));
    setup[0] = { ...setup[0], pos: { c: 0, r: 4 } };
    expect(validateSetup('A', setup)).toMatch(/three rows/);
    const short = randomSetup('A', mulberry32(2)).slice(0, 20);
    expect(validateSetup('A', short)).toMatch(/21/);
    const wrong = randomSetup('A', mulberry32(3)).map((p) => (p.rank === 'FLG' ? { ...p, rank: 'PVT' as Rank } : p));
    expect(validateSetup('A', wrong)).toMatch(/Wrong number/);
  });

  it('accepts an opponent setup with unknown ranks and starts a game', () => {
    let s = createGame(RULES);
    s = applySetup(s, 'A', randomSetup('A', mulberry32(4)));
    const hidden = randomSetup('B', mulberry32(5)).map((p) => ({ ...p, rank: null }));
    expect(validateSetup('B', hidden)).toBeNull();
    s = applySetup(s, 'B', hidden);
    s = startGame(s, 'B');
    expect(s.phase).toBe('playing');
    expect(s.turn).toBe('B');
    expect(s.board.flat().filter(Boolean)).toHaveLength(42);
  });
});

describe('moves', () => {
  it('moves one square orthogonally onto empty or enemy squares only', () => {
    const s = position([
      { id: 'a1', team: 'A', rank: 'PVT', c: 4, r: 5 },
      { id: 'a2', team: 'A', rank: 'SGT', c: 5, r: 5 },
      { id: 'b1', team: 'B', rank: 'PVT', c: 4, r: 4 },
    ], 'A');
    const moves = legalMoves(s.board, { c: 4, r: 5 }).map(toNotation).sort();
    expect(moves).toEqual(['d3', 'e2', 'e4']); // left, down, and the enemy above; own piece to the right is blocked
    expect(() => applyMove(s, { from: { c: 4, r: 5 }, to: { c: 4, r: 3 } })).toThrow(/Illegal/);
    expect(() => applyMove(s, { from: { c: 4, r: 5 }, to: { c: 5, r: 4 } })).toThrow(/Illegal/);
    expect(() => applyMove(s, { from: { c: 4, r: 4 }, to: { c: 4, r: 3 } })).toThrow(/No piece of yours/);
  });

  it('a quiet move switches the turn and records history', () => {
    const s = position([
      { id: 'a1', team: 'A', rank: 'G5', c: 0, r: 5 },
      { id: 'b1', team: 'B', rank: 'PVT', c: 8, r: 2 },
    ], 'A');
    const s2 = applyMove(s, { from: { c: 0, r: 5 }, to: { c: 0, r: 4 } });
    expect(s2.turn).toBe('B');
    expect(s2.ply).toBe(1);
    expect(s2.board[4][0]?.id).toBe('a1');
    expect(s2.board[5][0]).toBeNull();
    expect(s2.history).toEqual([{ ply: 1, team: 'A', from: { c: 0, r: 5 }, to: { c: 0, r: 4 }, result: null }]);
    expect(s).not.toBe(s2); // pure
  });

  it('attacker wins, defender wins, and both eliminated', () => {
    const s = position([
      { id: 'a1', team: 'A', rank: 'COL', c: 2, r: 4 },
      { id: 'a2', team: 'A', rank: 'PVT', c: 8, r: 7 },
      { id: 'b1', team: 'B', rank: 'MAJ', c: 2, r: 3 },
      { id: 'b2', team: 'B', rank: 'PVT', c: 0, r: 0 },
    ], 'A');
    const mv = { from: { c: 2, r: 4 }, to: { c: 2, r: 3 } };
    const win = applyMove(s, mv, { ranks: { attacker: 'COL', defender: 'MAJ' } });
    expect(win.board[3][2]?.id).toBe('a1');
    expect(win.captured.map((p) => p.id)).toEqual(['b1']);
    expect(win.history[0].result).toBe('attacker');

    const lose = applyMove(s, mv, { ranks: { attacker: 'MAJ', defender: 'COL' } });
    expect(lose.board[3][2]?.id).toBe('b1');
    expect(lose.board[4][2]).toBeNull();
    expect(lose.captured.map((p) => p.id)).toEqual(['a1']);

    const both = applyMove(s, mv, { ranks: { attacker: 'COL', defender: 'COL' } });
    expect(both.board[3][2]).toBeNull();
    expect(both.captured).toHaveLength(2);

    expect(() => applyMove(s, mv)).toThrow(/ranks/);
  });
});

describe('win conditions', () => {
  it('capturing the flag ends the game', () => {
    const s = position([
      { id: 'a1', team: 'A', rank: 'PVT', c: 0, r: 4 },
      { id: 'b1', team: 'B', rank: 'FLG', c: 0, r: 3 },
      { id: 'b2', team: 'B', rank: 'PVT', c: 8, r: 0 },
    ], 'A');
    const s2 = applyMove(s, { from: { c: 0, r: 4 }, to: { c: 0, r: 3 } }, { ranks: { attacker: 'PVT', defender: 'FLG' } });
    expect(s2.phase).toBe('ended');
    expect(s2.winner).toBe('A');
    expect(s2.endReason).toBe('flagCaptured');
  });

  it('a flag that attacks a non-flag is eliminated and loses the game', () => {
    const s = position([
      { id: 'a1', team: 'A', rank: 'FLG', c: 0, r: 4 },
      { id: 'a2', team: 'A', rank: 'PVT', c: 8, r: 7 },
      { id: 'b1', team: 'B', rank: 'PVT', c: 0, r: 3 },
    ], 'A');
    const s2 = applyMove(s, { from: { c: 0, r: 4 }, to: { c: 0, r: 3 } }, { ranks: { attacker: 'FLG', defender: 'PVT' } });
    expect(s2.winner).toBe('B');
    expect(s2.endReason).toBe('flagCaptured');
  });

  it('flag attacking a flag wins for the attacker', () => {
    const s = position([
      { id: 'a1', team: 'A', rank: 'FLG', c: 4, r: 4 },
      { id: 'b1', team: 'B', rank: 'FLG', c: 4, r: 3 },
    ], 'A');
    const s2 = applyMove(s, { from: { c: 4, r: 4 }, to: { c: 4, r: 3 } }, { ranks: { attacker: 'FLG', defender: 'FLG' } });
    expect(s2.winner).toBe('A');
  });

  it('instant flag rule: a declared flag on the far row wins at once', () => {
    const s = position([
      { id: 'a1', team: 'A', rank: 'FLG', c: 8, r: 1 },
      { id: 'b1', team: 'B', rank: 'G5', c: 7, r: 0 }, // adjacent enemy does not matter under the instant rule
      { id: 'b2', team: 'B', rank: 'PVT', c: 0, r: 2 },
    ], 'A');
    const s2 = applyMove(s, { from: { c: 8, r: 1 }, to: { c: 8, r: 0 } }, { declareFlag: true });
    expect(s2.phase).toBe('ended');
    expect(s2.winner).toBe('A');
    expect(s2.endReason).toBe('flagHome');
    // On the opponent's client the mover's rank is unknown, so without the declaration play continues.
    const oppView: GameState = { ...s, board: s.board.map((row) => row.slice()) };
    oppView.board[1][8] = { id: 'a1', team: 'A', rank: null };
    const quiet = applyMove(oppView, { from: { c: 8, r: 1 }, to: { c: 8, r: 0 } });
    expect(quiet.phase).toBe('playing');
    const declared = applyMove(oppView, { from: { c: 8, r: 1 }, to: { c: 8, r: 0 } }, { declareFlag: true });
    expect(declared.winner).toBe('A');
  });

  it('team B flag heads to row 7', () => {
    const s = position([
      { id: 'b1', team: 'B', rank: 'FLG', c: 3, r: 6 },
      { id: 'a1', team: 'A', rank: 'PVT', c: 0, r: 7 },
    ], 'B');
    const s2 = applyMove(s, { from: { c: 3, r: 6 }, to: { c: 3, r: 7 } }, { declareFlag: true });
    expect(s2.winner).toBe('B');
    expect(s2.endReason).toBe('flagHome');
  });

  it('tournament flag rule: waits one turn when an enemy is adjacent', () => {
    const s = position([
      { id: 'flagA', team: 'A', rank: 'FLG', c: 4, r: 1 },
      { id: 'aOther', team: 'A', rank: 'PVT', c: 0, r: 7 },
      { id: 'bGuard', team: 'B', rank: 'PVT', c: 3, r: 0 },
      { id: 'bOther', team: 'B', rank: 'PVT', c: 8, r: 2 },
    ], 'A', TOURNAMENT);

    const reached = applyMove(s, { from: { c: 4, r: 1 }, to: { c: 4, r: 0 } }, { declareFlag: true });
    expect(reached.phase).toBe('playing');
    expect(reached.pendingFlag).toEqual({ team: 'A', pos: { c: 4, r: 0 } });

    // B ignores it: A wins at the end of B's move.
    const ignored = applyMove(reached, { from: { c: 8, r: 2 }, to: { c: 8, r: 3 } });
    expect(ignored.phase).toBe('ended');
    expect(ignored.winner).toBe('A');
    expect(ignored.endReason).toBe('flagHome');

    // B captures it instead.
    const captured = applyMove(reached, { from: { c: 3, r: 0 }, to: { c: 4, r: 0 } }, { ranks: { attacker: 'PVT', defender: 'FLG' } });
    expect(captured.winner).toBe('B');
    expect(captured.endReason).toBe('flagCaptured');
  });

  it('tournament flag rule: wins on arrival when no enemy is adjacent', () => {
    const s = position([
      { id: 'flagA', team: 'A', rank: 'FLG', c: 4, r: 1 },
      { id: 'bOther', team: 'B', rank: 'PVT', c: 8, r: 2 },
    ], 'A', TOURNAMENT);
    const arrived = applyMove(s, { from: { c: 4, r: 1 }, to: { c: 4, r: 0 } }, { declareFlag: true });
    expect(arrived.winner).toBe('A');
    expect(arrived.endReason).toBe('flagHome');
  });

  it('hasAnyLegalMove is false only when every piece is boxed in by friends or edges', () => {
    const boxed = position([
      { id: 'b1', team: 'B', rank: 'PVT', c: 0, r: 0 },
      { id: 'a1', team: 'A', rank: 'G5', c: 5, r: 5 },
    ], 'B');
    expect(hasAnyLegalMove(boxed.board, 'B')).toBe(true);
    // Fill the entire board with B: no empty or enemy neighbour anywhere.
    const full: GameState = { ...createGame(RULES), phase: 'playing', turn: 'B' };
    full.board.forEach((row, r) => row.forEach((_, c) => { full.board[r][c] = { id: `b${r}${c}`, team: 'B', rank: 'PVT' }; }));
    expect(hasAnyLegalMove(full.board, 'B')).toBe(false);
  });
});
