import type { GameState, Move, Placement, Pos, Rank, Rules, Team } from '../engine/types';
import { goalRow, legalMoves, other, posEq } from '../engine/rules';
import { applyMove, applySetup, createGame, endGame, pieceAt, startGame, validateSetup } from '../engine/state';
import type { LogMsg, Msg, Players } from './protocol';
import type { Transport } from './transport';

/** Where this client keeps the ranks of its own pieces, which never travel over the wire. */
export interface RankStore {
  load(game: number): Record<string, Rank> | null;
  save(game: number, ranks: Record<string, Rank>): void;
}

export function localStorageRankStore(code: string, uid: string): RankStore {
  const key = (game: number) => `salpakan:ranks:${code}:${uid}:${game}`;
  return {
    load(game) {
      try { const raw = localStorage.getItem(key(game)); return raw ? (JSON.parse(raw) as Record<string, Rank>) : null; } catch { return null; }
    },
    save(game, ranks) {
      try { localStorage.setItem(key(game), JSON.stringify(ranks)); } catch { /* private mode: play on, reload will not recover */ }
    },
  };
}

export function memoryRankStore(): RankStore {
  const m = new Map<number, Record<string, Rank>>();
  return { load: (g) => m.get(g) ?? null, save: (g, r) => { m.set(g, r); } };
}

/** A challenge waiting for the defender's rank. `answered` means this client already sent its reveal. */
interface PendingChallenge { move: Move; team: Team; attackerRank: Rank; answered: boolean }

/**
 * Turns the room log into game state and turns player intent into messages.
 * Nothing changes local state directly: every action becomes a message, and the
 * state changes when that message comes back from the log. Both clients therefore
 * run the same sequence of engine calls.
 */
export class Session {
  state: GameState;
  game = 0;
  ready: Record<Team, boolean> = { A: false, B: false };
  rematch: Record<Team, boolean> = { A: false, B: false };
  pending: PendingChallenge | null = null;
  /** Server time of the message that started the current turn. */
  turnStartedAt = 0;
  synced = false;
  players: Players = {};
  error: string | null = null;
  readonly me: Team;
  readonly rules: Rules;

  private myRanks: Record<string, Rank> = {};
  private startSent = false;
  private newGameSent = false;
  private timeoutSentPly = -1;
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];

  constructor(readonly transport: Transport, private rankStore: RankStore) {
    this.me = transport.team;
    this.rules = transport.rules;
    this.state = createGame(this.rules);
    this.myRanks = rankStore.load(0) ?? {};
    this.offs.push(transport.subscribe((m, live) => this.handle(m, live), () => this.onSynced()));
    this.offs.push(transport.onPlayers((p) => { this.players = p; this.emit(); }));
  }

  get opp(): Team { return other(this.me); }
  get isMyTurn(): boolean { return this.state.phase === 'playing' && this.state.turn === this.me && !this.pending; }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  destroy(): void {
    this.offs.forEach((f) => f());
    this.transport.leave();
    this.listeners.clear();
  }

  // ---- player actions -------------------------------------------------

  submitSetup(placements: Placement[]): void {
    if (this.state.phase !== 'setup' || this.ready[this.me]) return;
    const err = validateSetup(this.me, placements);
    if (err) throw new Error(err);
    const ranks: Record<string, Rank> = {};
    for (const p of placements) ranks[p.id] = p.rank!;
    this.myRanks = ranks;
    this.rankStore.save(this.game, ranks);
    this.transport.send({ type: 'ready', team: this.me, cells: placements.map((p) => ({ id: p.id, c: p.pos.c, r: p.pos.r })) });
  }

  legalTargets(from: Pos): Pos[] {
    const piece = pieceAt(this.state, from);
    if (!this.isMyTurn || !piece || piece.team !== this.me) return [];
    return legalMoves(this.state.board, from);
  }

  move(from: Pos, to: Pos): void {
    if (!this.isMyTurn) return;
    const piece = pieceAt(this.state, from);
    if (!piece || piece.team !== this.me || !piece.rank) return;
    if (!legalMoves(this.state.board, from).some((p) => posEq(p, to))) return;
    const target = pieceAt(this.state, to);
    const msg: Msg = { type: 'move', team: this.me, from, to };
    if (target) msg.attackerRank = piece.rank;
    else if (piece.rank === 'FLG' && to.r === goalRow(this.me)) msg.declareFlag = true;
    this.transport.send(msg);
  }

  resign(): void {
    if (this.state.phase !== 'playing') return;
    this.transport.send({ type: 'resign', team: this.me });
  }

  offerRematch(): void {
    if (this.state.phase !== 'ended' || this.rematch[this.me]) return;
    this.transport.send({ type: 'rematch', team: this.me });
  }

  /** Milliseconds left on the current turn, or null when there is no clock running. */
  remaining(now: number): number | null {
    if (!this.rules.timerSeconds || this.state.phase !== 'playing' || !this.synced) return null;
    return this.turnStartedAt + this.rules.timerSeconds * 1000 - now;
  }

  /** Called on an interval by the UI. Reports our own timeout at once, the opponent's after a grace period. */
  tick(now: number): void {
    const rem = this.remaining(now);
    if (rem === null || rem > 0 || this.pending) return;
    if (this.timeoutSentPly === this.state.ply) return;
    const mine = this.state.turn === this.me;
    if (mine || rem < -3000) {
      this.timeoutSentPly = this.state.ply;
      this.transport.send({ type: 'timeout', team: this.state.turn });
    }
  }

  // ---- log handling ----------------------------------------------------

  private teamOf(uid: string): Team | null {
    if (this.transport.isLocal) return uid === 'local-A' ? 'A' : uid === 'local-B' ? 'B' : null;
    if (this.players.A?.uid === uid) return 'A';
    if (this.players.B?.uid === uid) return 'B';
    return uid === this.transport.uid ? this.me : null;
  }

  private handle(lm: LogMsg, live: boolean): void {
    const m = lm.msg;
    const s = this.state;
    const sender = this.teamOf(lm.uid);
    if ('team' in m && sender && m.team !== sender) return; // a seat may only speak for itself
    try {
      switch (m.type) {
        case 'ready': {
          if (s.phase !== 'setup' || this.ready[m.team]) return;
          const placements: Placement[] = m.cells.map((c) => ({
            id: c.id, pos: { c: c.c, r: c.r },
            rank: m.team === this.me ? this.myRanks[c.id] ?? null : null,
          }));
          if (m.team === this.me && placements.some((p) => !p.rank)) {
            this.error = 'Your piece ranks were not found on this device, so this game cannot continue here.';
          }
          this.state = applySetup(s, m.team, placements);
          this.ready[m.team] = true;
          this.maybeStart();
          break;
        }
        case 'start': {
          if (s.phase !== 'setup' || !this.ready.A || !this.ready.B || m.game !== this.game) return;
          this.state = startGame(s, m.first);
          this.turnStartedAt = lm.t;
          break;
        }
        case 'move': {
          if (s.phase !== 'playing' || m.team !== s.turn || this.pending) return;
          const mover = pieceAt(s, m.from);
          if (!mover || mover.team !== m.team) return;
          if (!legalMoves(s.board, m.from).some((p) => posEq(p, m.to))) return;
          const target = pieceAt(s, m.to);
          if (target) {
            if (!m.attackerRank) return;
            this.pending = { move: { from: m.from, to: m.to }, team: m.team, attackerRank: m.attackerRank, answered: false };
            if (live) this.answerChallenge();
          } else {
            this.state = applyMove(s, { from: m.from, to: m.to }, { declareFlag: m.declareFlag });
            this.turnStartedAt = lm.t;
          }
          break;
        }
        case 'reveal': {
          const p = this.pending;
          if (!p || m.team === p.team) return;
          this.state = applyMove(s, p.move, { ranks: { attacker: p.attackerRank, defender: m.rank } });
          this.pending = null;
          this.turnStartedAt = lm.t;
          break;
        }
        case 'resign': {
          if (s.phase !== 'playing') return;
          this.state = endGame(s, other(m.team), 'resign');
          this.pending = null;
          break;
        }
        case 'timeout': {
          if (s.phase !== 'playing' || m.team !== s.turn || this.pending) return;
          this.state = endGame(s, other(m.team), 'timeout');
          break;
        }
        case 'rematch': {
          if (s.phase !== 'ended') return;
          this.rematch[m.team] = true;
          if (this.rematch.A && this.rematch.B && this.me === 'A' && !this.newGameSent) {
            this.newGameSent = true;
            this.transport.send({ type: 'newGame', game: this.game + 1 });
          }
          break;
        }
        case 'newGame': {
          if (m.game !== this.game + 1) return;
          this.game = m.game;
          this.state = createGame(this.rules);
          this.ready = { A: false, B: false };
          this.rematch = { A: false, B: false };
          this.pending = null;
          this.startSent = false;
          this.newGameSent = false;
          this.timeoutSentPly = -1;
          this.myRanks = this.rankStore.load(this.game) ?? {};
          break;
        }
      }
    } catch (e) {
      console.error('bad message ignored', m, e);
    }
    this.emit();
  }

  private onSynced(): void {
    this.synced = true;
    this.maybeStart();
    this.answerChallenge();
    this.emit();
  }

  /** Team A's client is the one that flips the coin once both setups are in. */
  private maybeStart(): void {
    if (!this.synced || this.startSent || this.me !== 'A') return;
    if (this.state.phase !== 'setup' || !this.ready.A || !this.ready.B) return;
    this.startSent = true;
    const first: Team = Math.random() < 0.5 ? 'A' : 'B';
    this.transport.send({ type: 'start', first, game: this.game });
  }

  /** If the pending challenge targets one of our pieces, tell the log its rank. */
  private answerChallenge(): void {
    const p = this.pending;
    if (!this.synced || !p || p.team === this.me || p.answered) return;
    const defender = pieceAt(this.state, p.move.to);
    if (!defender || defender.team !== this.me || !defender.rank) return;
    p.answered = true; // the state changes only when the log echoes this message back
    this.transport.send({ type: 'reveal', team: this.me, rank: defender.rank });
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb());
  }
}
