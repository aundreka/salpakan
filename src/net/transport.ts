import type { Rules, Team } from '../engine/types';
import type { LogMsg, Msg, Players } from './protocol';

/**
 * A room is an append-only log of messages shared by two seats.
 * Every client, including the sender, receives every message in the same order and
 * derives game state only from that log, so reloading a page is just a replay.
 */
export interface Transport {
  readonly code: string;
  readonly uid: string;
  readonly team: Team;
  readonly rules: Rules;
  readonly isLocal: boolean;
  send(msg: Msg): void;
  /** Delivers the existing log with live=false, calls onSynced, then streams new messages with live=true. */
  subscribe(onMsg: (m: LogMsg, live: boolean) => void, onSynced: () => void): () => void;
  onPlayers(cb: (players: Players) => void): () => void;
  /** Server-adjusted clock so both sides agree on deadlines. */
  now(): number;
  leave(): void;
}
