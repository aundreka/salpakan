import type { Move, Team } from '../engine/types';
import { COLS, ROWS, goalRow, legalMoves, other } from '../engine/rules';
import { randomSetup } from '../engine/random';
import type { Session } from './session';

/**
 * A practice opponent that plays legal moves with mild preferences: it likes to
 * advance and to challenge, and it keeps its flag at home. It knows nothing about
 * the human's ranks, exactly like a real opponent.
 */
export function attachBot(session: Session, rng: () => number = Math.random): () => void {
  const me: Team = session.me;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let setupSentForGame = -1;

  const step = () => {
    const s = session.state;
    if (s.phase === 'setup' && !session.ready[me]) {
      if (setupSentForGame !== session.game) {
        setupSentForGame = session.game;
        session.submitSetup(randomSetup(me, rng));
      }
      return;
    }
    if (s.phase === 'playing' && session.isMyTurn && !timer) {
      timer = setTimeout(() => {
        timer = null;
        const mv = chooseMove(session, rng);
        if (mv) session.move(mv.from, mv.to);
      }, 600 + rng() * 500);
    }
    if (s.phase === 'ended' && session.rematch[other(me)] && !session.rematch[me]) {
      session.offerRematch();
    }
  };

  const off = session.onChange(step);
  step();
  return () => { off(); if (timer) clearTimeout(timer); };
}

function chooseMove(session: Session, rng: () => number): Move | null {
  const s = session.state;
  const me = session.me;
  const forward = me === 'A' ? -1 : 1;
  const options: { move: Move; weight: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = s.board[r][c];
      if (!piece || piece.team !== me) continue;
      for (const to of legalMoves(s.board, { c, r })) {
        const target = s.board[to.r][to.c];
        let weight = 1;
        if (to.r - r === forward) weight += 0.9;
        if (target) weight *= piece.rank === 'FLG' ? 0.02 : 1.7;
        if (piece.rank === 'FLG') weight *= to.r === goalRow(me) ? 50 : 0.15;
        if (piece.rank === 'SPY' && target) weight *= 1.3;
        options.push({ move: { from: { c, r }, to }, weight });
      }
    }
  }
  if (!options.length) return null;
  const total = options.reduce((acc, o) => acc + o.weight, 0);
  let pick = rng() * total;
  for (const o of options) {
    pick -= o.weight;
    if (pick <= 0) return o.move;
  }
  return options[options.length - 1].move;
}
