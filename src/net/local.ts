import type { Rules, Team } from '../engine/types';
import type { LogMsg, Msg, Players } from './protocol';
import type { Transport } from './transport';

/**
 * Two in-memory endpoints sharing one log. Used for practice against the bot,
 * and handy for tests: the same Session code runs unchanged over it.
 */
export function createLocalPair(rules: Rules, names: { A: string; B: string }): { A: Transport; B: Transport } {
  const log: LogMsg[] = [];
  const subs = new Set<(m: LogMsg, live: boolean) => void>();
  const players: Players = {
    A: { uid: 'local-A', name: names.A, connected: true },
    B: { uid: 'local-B', name: names.B, connected: true },
  };
  let seq = 0;

  const make = (team: Team): Transport => ({
    code: 'LOCAL', uid: `local-${team}`, hostUid: 'local-A', team, rules, isLocal: true,
    send(msg: Msg) {
      const entry: LogMsg = { key: String(seq++).padStart(6, '0'), uid: `local-${team}`, t: Date.now(), msg };
      queueMicrotask(() => {
        log.push(entry);
        subs.forEach((cb) => cb(entry, true));
      });
    },
    subscribe(onMsg, onSynced) {
      log.forEach((m) => onMsg(m, false));
      onSynced();
      subs.add(onMsg);
      return () => subs.delete(onMsg);
    },
    onPlayers(cb) {
      cb(players);
      return () => {};
    },
    now: () => Date.now(),
    leave() {},
  });

  return { A: make('A'), B: make('B') };
}
