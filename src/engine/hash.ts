import type { GameState } from './types';

/** FNV-1a over the public part of the state (piece ids and positions, not ranks). */
export function stateHash(state: GameState): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  feed(`${state.phase}|${state.turn}|${state.ply}|`);
  state.board.forEach((row, r) => row.forEach((p, c) => { if (p) feed(`${r}${c}${p.id};`); }));
  return h.toString(16).padStart(8, '0');
}
