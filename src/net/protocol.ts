import type { Pos, Rank, Rules, Team } from '../engine/types';

export const PROTOCOL_VERSION = 1;

/** No 0/O or 1/I so codes survive being read aloud. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').slice(0, CODE_LENGTH);
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

export type Msg =
  | { type: 'rules'; rules: Rules }
  | { type: 'ready'; team: Team; cells: { id: string; c: number; r: number }[] }
  | { type: 'start'; first: Team; game: number }
  | { type: 'move'; team: Team; from: Pos; to: Pos; attackerRank?: Rank; declareFlag?: boolean }
  | { type: 'reveal'; team: Team; rank: Rank }
  | { type: 'resign'; team: Team }
  | { type: 'timeout'; team: Team }
  | { type: 'rematch'; team: Team }
  | { type: 'newGame'; game: number };

export interface LogMsg {
  key: string;
  uid: string;
  /** Server-adjusted milliseconds since epoch. */
  t: number;
  msg: Msg;
}

export interface PlayerInfo {
  uid: string;
  name: string;
  connected: boolean;
}

export type Players = Partial<Record<Team, PlayerInfo>>;

export interface RoomMeta {
  hostUid: string;
  rules: Rules;
  createdAt: number;
  protocol: number;
}

export const DEFAULT_RULES: Rules = { flagInstantWin: true, timerSeconds: 60 };
export const TIMER_OPTIONS = [0, 30, 60, 120] as const;
