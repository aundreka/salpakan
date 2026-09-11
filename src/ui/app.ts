import type { Placement, Pos, Rank, Rules, Team } from '../engine/types';
import { ALL_RANKS, COLS, PIECE_COUNTS, RANK_INFO, ROWS, other, posEq, posKey, setupRows, toNotation } from '../engine/rules';
import { fullRankList, makePieceIds, randomSetup } from '../engine/random';
import { createLocalPair } from '../net/local';
import { firebaseConfigured, hostRoom, joinRoom } from '../net/firebase';
import { DEFAULT_RULES, TIMER_OPTIONS, normalizeCode } from '../net/protocol';
import { Session, localStorageRankStore, memoryRankStore } from '../net/session';
import { attachBot } from '../net/bot';
import { LOGO_MARK } from '../assets/sprite';
import { BoardView, pieceSvg } from './board';

type Screen = 'home' | 'lobby' | 'setup' | 'play';

const LS_NAME = 'salpakan:name';
const LS_LAST_SETUP = 'salpakan:lastSetup';

const END_TEXT: Record<string, (winner: string, loser: string) => string> = {
  flagCaptured: (w, l) => `${w} captured ${l}'s flag.`,
  flagHome: (w) => `${w}'s flag reached the far side.`,
  resign: (_w, l) => `${l} resigned.`,
  timeout: (_w, l) => `${l} ran out of time.`,
  noMoves: (_w, l) => `${l} had no legal move.`,
};

export class App {
  private session: Session | null = null;
  private detachBot: (() => void) | null = null;
  private board: BoardView | null = null;
  private unsubscribe: (() => void) | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  // setup draft: square → rank
  private draft = new Map<string, Rank>();
  private traySel: Rank | null = null;
  private sel: Pos | null = null;
  private busy = false;
  private screen: Screen = 'home';
  private lastScreen: Screen | null = null;

  constructor(private root: HTMLElement) {
    window.addEventListener('salpakan:error', (e) => this.toast((e as CustomEvent<string>).detail, true));
    window.addEventListener('resize', () => { if (this.board && this.session) this.renderBoard(); });
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    this.renderHome(room ? normalizeCode(room) : '');
    if (room && this.savedName()) void this.join(normalizeCode(room), this.savedName());
    // Dev shortcut: ?practice opens a bot game, ?practice=auto also places pieces and readies.
    if (params.has('practice')) {
      this.practice(this.savedName() || 'You');
      if (params.get('practice') === 'auto' && this.session) {
        for (const p of randomSetup(this.session.me)) this.draft.set(posKey(p.pos), p.rank!);
        this.submitSetup();
      }
    }
  }

  // ---------------------------------------------------------------- home

  private savedName(): string {
    try { return localStorage.getItem(LS_NAME) ?? ''; } catch { return ''; }
  }

  private renderHome(prefillCode = ''): void {
    this.teardownSession();
    this.screen = 'home';
    history.replaceState(null, '', location.pathname);
    const online = firebaseConfigured();
    const name = this.savedName();
    this.root.innerHTML = `
      <main class="home">
        <header class="brand">
          ${LOGO_MARK}
          <div>
            <h1>Salpakan</h1>
            <p class="tagline">Game of the Generals for two, in the browser.</p>
          </div>
        </header>

        <section class="panel">
          <label class="field">
            <span>Your name</span>
            <input id="name" type="text" maxlength="18" autocomplete="nickname" placeholder="e.g. Aundreka" value="${escapeHtml(name)}">
          </label>

          <div class="split">
            <form id="create" class="card">
              <h2>Create a room</h2>
              <label class="field">
                <span>Turn timer</span>
                <select id="timer">${TIMER_OPTIONS.map((t) => `<option value="${t}" ${t === DEFAULT_RULES.timerSeconds ? 'selected' : ''}>${t ? `${t} seconds per move` : 'No clock'}</option>`).join('')}</select>
              </label>
              <label class="check">
                <input id="instant" type="checkbox" checked>
                <span>Flag wins the moment it reaches the far row</span>
                <small>Off: tournament rule. It must have no enemy beside it, or survive one turn.</small>
              </label>
              <button class="btn primary" type="submit" ${online ? '' : 'disabled'}>Create room</button>
              ${online ? '' : '<small class="warn">Online play is not configured on this build.</small>'}
            </form>

            <form id="join" class="card">
              <h2>Join a room</h2>
              <label class="field">
                <span>Room code</span>
                <input id="code" class="code-input" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="5" placeholder="ABCDE" value="${escapeHtml(prefillCode)}">
              </label>
              <button class="btn" type="submit" ${online ? '' : 'disabled'}>Join</button>
            </form>
          </div>

          <button id="practice" class="btn ghost">Practice against the bot</button>
        </section>

        <details class="rules">
          <summary>How to play</summary>
          <div class="rules-body">
            <p>Each side hides 21 pieces on its three back rows. Pieces move one square up, down, left or right. Moving onto an enemy piece is a <strong>challenge</strong>: the higher rank stays, the lower is removed, and equal ranks remove each other. Only the outcome is shown, never the ranks.</p>
            <ul>
              <li><strong>Generals</strong> (5 to 1 star) outrank <strong>Colonel</strong>, <strong>Lt. Colonel</strong>, <strong>Major</strong>, <strong>Captain</strong>, <strong>1st Lt.</strong>, <strong>2nd Lt.</strong>, <strong>Sergeant</strong>, then <strong>Private</strong>.</li>
              <li>The <strong>Spy</strong> beats every officer from Sergeant up. The <strong>Private</strong> is the only piece that beats the Spy.</li>
              <li>Any piece captures the <strong>Flag</strong>. A flag that attacks another flag wins.</li>
              <li>Win by capturing the enemy flag, or by walking your own flag to the far row.</li>
            </ul>
            <div class="rank-strip">${ALL_RANKS.map((r) => `<div class="rank-chip">${pieceSvg('A', r, 40)}<span>${RANK_INFO[r].name}${PIECE_COUNTS[r] > 1 ? ` ×${PIECE_COUNTS[r]}` : ''}</span></div>`).join('')}</div>
          </div>
        </details>
      </main>
      <div id="toasts" class="toasts"></div>`;

    const nameInput = this.root.querySelector<HTMLInputElement>('#name')!;
    const codeInput = this.root.querySelector<HTMLInputElement>('#code')!;
    codeInput.addEventListener('input', () => { codeInput.value = normalizeCode(codeInput.value); });

    const takeName = (): string | null => {
      const n = nameInput.value.trim();
      if (!n) { nameInput.focus(); this.toast('Enter a name first.'); return null; }
      try { localStorage.setItem(LS_NAME, n); } catch { /* ignore */ }
      return n;
    };

    this.root.querySelector<HTMLFormElement>('#create')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = takeName();
      if (!n) return;
      const rules: Rules = {
        timerSeconds: Number(this.root.querySelector<HTMLSelectElement>('#timer')!.value),
        flagInstantWin: this.root.querySelector<HTMLInputElement>('#instant')!.checked,
      };
      void this.create(rules, n);
    });
    this.root.querySelector<HTMLFormElement>('#join')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = takeName();
      if (!n) return;
      void this.join(normalizeCode(codeInput.value), n);
    });
    this.root.querySelector('#practice')!.addEventListener('click', () => {
      const n = nameInput.value.trim() || 'You';
      try { localStorage.setItem(LS_NAME, n); } catch { /* ignore */ }
      this.practice(n);
    });
    if (prefillCode) codeInput.focus();
    else if (!name) nameInput.focus();
  }

  private async create(rules: Rules, name: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.toast('Creating room…');
    try {
      const transport = await hostRoom(rules, name);
      this.startSession(new Session(transport, localStorageRankStore(transport.code, transport.uid)));
    } catch (e) {
      this.toast((e as Error).message, true);
    } finally {
      this.busy = false;
    }
  }

  private async join(code: string, name: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.toast(`Joining ${code}…`);
    try {
      const transport = await joinRoom(code, name);
      this.startSession(new Session(transport, localStorageRankStore(transport.code, transport.uid)));
    } catch (e) {
      this.toast((e as Error).message, true);
    } finally {
      this.busy = false;
    }
  }

  private practice(name: string): void {
    const pair = createLocalPair({ ...DEFAULT_RULES, timerSeconds: 0 }, { A: name, B: 'Bot' });
    const botSession = new Session(pair.B, memoryRankStore());
    this.detachBot = attachBot(botSession);
    this.startSession(new Session(pair.A, memoryRankStore()));
  }

  // ------------------------------------------------------------- session

  private startSession(session: Session): void {
    this.session = session;
    this.draft.clear();
    this.traySel = null;
    this.sel = null;
    this.lastScreen = null;
    if (!session.transport.isLocal) history.replaceState(null, '', `${location.pathname}?room=${session.transport.code}`);
    this.unsubscribe = session.onChange(() => this.render());
    this.ticker = setInterval(() => this.tick(), 250);
    this.render();
  }

  private teardownSession(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.detachBot?.();
    this.detachBot = null;
    this.session?.destroy();
    this.session = null;
    this.board = null;
  }

  private currentScreen(): Screen {
    const s = this.session!;
    if (!s.transport.isLocal && s.me === 'A' && !s.players.B) return 'lobby';
    if (s.state.phase === 'setup') return 'setup';
    return 'play';
  }

  private render(): void {
    const s = this.session;
    if (!s) return;
    if (s.error) this.toast(s.error, true);
    const screen = this.currentScreen();
    if (screen !== this.lastScreen) {
      this.lastScreen = screen;
      this.screen = screen;
      if (screen === 'lobby') this.renderLobby();
      else this.renderGameShell(screen);
      if (screen === 'setup' && this.draft.size === 0) this.loadLastSetup();
    }
    if (screen === 'setup') this.renderSetupPanel();
    if (screen === 'play') this.renderPlayPanel();
    if (screen !== 'lobby') this.renderBoard();
  }

  // --------------------------------------------------------------- lobby

  private renderLobby(): void {
    const s = this.session!;
    const link = `${location.origin}${location.pathname}?room=${s.transport.code}`;
    this.root.innerHTML = `
      <main class="home lobby">
        ${this.topbar()}
        <section class="panel center">
          <p class="eyebrow">Room code</p>
          <p class="big-code" id="big-code">${s.transport.code.split('').map((ch) => `<span>${ch}</span>`).join('')}</p>
          <p class="muted">Send this code or the link to your opponent. The game starts as soon as they join.</p>
          <div class="row">
            <button class="btn primary" id="copy-link">Copy invite link</button>
            <button class="btn" id="copy-code">Copy code</button>
          </div>
          <p class="waiting"><span class="pulse"></span> Waiting for your opponent…</p>
          <dl class="settings">
            <dt>Turn timer</dt><dd>${s.rules.timerSeconds ? `${s.rules.timerSeconds} s per move` : 'No clock'}</dd>
            <dt>Flag rule</dt><dd>${s.rules.flagInstantWin ? 'Wins on reaching the far row' : 'Tournament: must be safe or survive a turn'}</dd>
          </dl>
          <button class="btn ghost" id="leave">Cancel and go home</button>
        </section>
      </main>
      <div id="toasts" class="toasts"></div>`;
    this.root.querySelector('#copy-link')!.addEventListener('click', () => this.copy(link, 'Invite link copied.'));
    this.root.querySelector('#copy-code')!.addEventListener('click', () => this.copy(s.transport.code, 'Code copied.'));
    this.root.querySelector('#leave')!.addEventListener('click', () => this.renderHome());
  }

  private topbar(): string {
    const s = this.session!;
    const opp = s.players[s.opp];
    const oppStatus = s.transport.isLocal ? 'Bot' : opp ? `${escapeHtml(opp.name)} <i class="presence ${opp.connected ? 'on' : 'off'}" title="${opp.connected ? 'connected' : 'disconnected'}"></i>` : 'No opponent yet';
    return `
      <header class="topbar">
        <a class="brand-small" href="${location.pathname}">${LOGO_MARK}<span>Salpakan</span></a>
        <div class="topbar-right">
          ${s.transport.isLocal ? '<span class="chip">Practice</span>' : `<button class="chip code-chip" id="chip-code" title="Copy invite link">Room ${s.transport.code}</button>`}
          <span class="chip opp">${oppStatus}</span>
        </div>
      </header>`;
  }

  // ----------------------------------------------------------- game shell

  private renderGameShell(screen: Screen): void {
    this.root.innerHTML = `
      <div class="game ${screen}">
        ${this.topbar()}
        <div class="game-grid">
          <div class="board-wrap"><div id="board"></div></div>
          <aside class="side" id="side"></aside>
        </div>
        <div id="overlay"></div>
      </div>
      <div id="toasts" class="toasts"></div>`;
    this.root.querySelector('#chip-code')?.addEventListener('click', () => {
      const s = this.session!;
      this.copy(`${location.origin}${location.pathname}?room=${s.transport.code}`, 'Invite link copied.');
    });
    this.board = new BoardView(this.root.querySelector<HTMLElement>('#board')!);
  }

  private renderBoard(): void {
    const s = this.session;
    if (!s || !this.board) return;
    const state = this.screen === 'setup' ? this.setupPreviewState() : s.state;
    const small = (this.root.querySelector('#board')?.clientWidth ?? 600) < 460;
    this.board.render({
      state,
      me: s.me,
      selected: this.sel,
      targets: this.screen === 'play' && this.sel ? s.legalTargets(this.sel) : [],
      setupFor: this.screen === 'setup' ? s.me : null,
      lastMove: this.screen === 'play' ? s.state.history[s.state.history.length - 1] ?? null : null,
      labels: !small,
      onCell: (pos) => this.onCell(pos),
    });
  }

  private onCell(pos: Pos): void {
    if (this.screen === 'setup') this.onSetupCell(pos);
    else if (this.screen === 'play') this.onPlayCell(pos);
  }

  // --------------------------------------------------------------- setup

  private setupPreviewState() {
    const s = this.session!;
    const board = s.state.board.map((row) => row.slice());
    if (!s.ready[s.me]) {
      for (const r of setupRows(s.me)) for (let c = 0; c < COLS; c++) board[r][c] = null;
      let i = 0;
      for (const [k, rank] of this.draft) {
        const [c, r] = k.split(',').map(Number);
        board[r][c] = { id: `draft-${i++}-${rank}`, team: s.me, rank };
      }
    }
    return { ...s.state, board };
  }

  private trayCounts(): Record<Rank, number> {
    const counts = { ...PIECE_COUNTS };
    for (const rank of this.draft.values()) counts[rank]--;
    return counts;
  }

  private onSetupCell(pos: Pos): void {
    const s = this.session!;
    if (s.ready[s.me]) return;
    if (!setupRows(s.me).includes(pos.r)) { this.sel = null; this.traySel = null; this.render(); return; }
    const key = posKey(pos);
    const here = this.draft.get(key);
    if (this.traySel) {
      if (here) this.draft.delete(key); // returns the old piece to the tray
      this.draft.set(key, this.traySel);
      if (this.trayCounts()[this.traySel] <= 0) this.traySel = null;
    } else if (this.sel) {
      const fromKey = posKey(this.sel);
      const moving = this.draft.get(fromKey);
      if (posEq(this.sel, pos)) {
        if (moving) this.draft.delete(fromKey); // tap again: back to tray
      } else if (moving) {
        this.draft.delete(fromKey);
        if (here) this.draft.set(fromKey, here);
        this.draft.set(key, moving);
      }
      this.sel = null;
    } else if (here) {
      this.sel = pos;
    }
    this.render();
  }

  private renderSetupPanel(): void {
    const s = this.session!;
    const side = this.root.querySelector<HTMLElement>('#side')!;
    const counts = this.trayCounts();
    const placed = this.draft.size;
    const oppReady = s.ready[s.opp];
    if (s.ready[s.me]) {
      side.innerHTML = `
        <section class="side-block">
          <p class="eyebrow">Setup</p>
          <h2>You are ready</h2>
          <p class="muted">${oppReady ? 'Both sides are set. Starting…' : `Waiting for ${escapeHtml(this.oppName())} to finish placing.`}</p>
          <p class="waiting"><span class="pulse"></span> ${oppReady ? 'Flipping the coin' : 'Opponent is placing pieces'}</p>
        </section>`;
      return;
    }
    side.innerHTML = `
      <section class="side-block">
        <p class="eyebrow">Setup · ${placed} of 21 placed</p>
        <h2>Place your pieces</h2>
        <p class="muted">Tap a piece below, then a square in your three rows. Tap a placed piece to move it, or tap it twice to return it.</p>
        <p class="opp-status">${oppReady ? `${escapeHtml(this.oppName())} is ready.` : `${escapeHtml(this.oppName())} is placing…`}</p>
      </section>
      <section class="tray" id="tray">
        ${ALL_RANKS.map((r) => `
          <button class="tray-piece ${this.traySel === r ? 'active' : ''} ${counts[r] === 0 ? 'empty' : ''}" data-rank="${r}" ${counts[r] === 0 ? 'disabled' : ''} title="${RANK_INFO[r].name}">
            ${pieceSvg(s.me, r, 44)}
            <span class="tray-name">${RANK_INFO[r].short}</span>
            ${PIECE_COUNTS[r] > 1 ? `<span class="count">${counts[r]}</span>` : ''}
          </button>`).join('')}
      </section>
      <section class="side-actions">
        <button class="btn" id="random">Random</button>
        <button class="btn" id="clear" ${placed ? '' : 'disabled'}>Clear</button>
        <button class="btn primary" id="ready" ${placed === 21 ? '' : 'disabled'}>Ready</button>
      </section>`;
    side.querySelector('#tray')!.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>('.tray-piece');
      if (!btn || btn.disabled) return;
      const rank = btn.dataset.rank as Rank;
      this.traySel = this.traySel === rank ? null : rank;
      this.sel = null;
      this.render();
    });
    side.querySelector('#random')!.addEventListener('click', () => {
      this.draft.clear();
      for (const p of randomSetup(s.me)) this.draft.set(posKey(p.pos), p.rank!);
      this.traySel = null; this.sel = null;
      this.render();
    });
    side.querySelector('#clear')!.addEventListener('click', () => { this.draft.clear(); this.traySel = null; this.sel = null; this.render(); });
    side.querySelector('#ready')!.addEventListener('click', () => this.submitSetup());
  }

  private submitSetup(): void {
    const s = this.session!;
    const ids = makePieceIds(s.me);
    const placements: Placement[] = [];
    let i = 0;
    for (const [k, rank] of this.draft) {
      const [c, r] = k.split(',').map(Number);
      placements.push({ id: ids[i++], rank, pos: { c, r } });
    }
    try {
      s.submitSetup(placements);
      this.saveLastSetup(s.me);
      this.sel = null; this.traySel = null;
    } catch (e) {
      this.toast((e as Error).message, true);
    }
  }

  /** Last setup is stored in team-A coordinates so it can be reused from either seat. */
  private saveLastSetup(me: Team): void {
    const out: Record<string, Rank> = {};
    for (const [k, rank] of this.draft) {
      const [c, r] = k.split(',').map(Number);
      out[posKey(me === 'A' ? { c, r } : { c: COLS - 1 - c, r: ROWS - 1 - r })] = rank;
    }
    try { localStorage.setItem(LS_LAST_SETUP, JSON.stringify(out)); } catch { /* ignore */ }
  }

  private loadLastSetup(): void {
    const s = this.session!;
    try {
      const raw = localStorage.getItem(LS_LAST_SETUP);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, Rank>;
      const draft = new Map<string, Rank>();
      for (const [k, rank] of Object.entries(saved)) {
        const [c, r] = k.split(',').map(Number);
        const pos = s.me === 'A' ? { c, r } : { c: COLS - 1 - c, r: ROWS - 1 - r };
        draft.set(posKey(pos), rank);
      }
      const ranks = [...draft.values()].sort();
      if (ranks.length === 21 && ranks.join() === fullRankList().sort().join()) this.draft = draft;
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- play

  private onPlayCell(pos: Pos): void {
    const s = this.session!;
    if (!s.isMyTurn) return;
    const piece = s.state.board[pos.r][pos.c];
    if (this.sel) {
      if (s.legalTargets(this.sel).some((t) => posEq(t, pos))) {
        s.move(this.sel, pos);
        this.sel = null;
      } else if (piece && piece.team === s.me && !posEq(this.sel, pos)) {
        this.sel = pos;
      } else {
        this.sel = null;
      }
    } else if (piece && piece.team === s.me) {
      this.sel = pos;
    }
    this.renderBoard();
  }

  private oppName(): string {
    const s = this.session!;
    return s.players[s.opp]?.name ?? (s.transport.isLocal ? 'Bot' : 'Opponent');
  }
  private myName(): string {
    const s = this.session!;
    return s.players[s.me]?.name ?? 'You';
  }

  private renderPlayPanel(): void {
    const s = this.session!;
    const side = this.root.querySelector<HTMLElement>('#side')!;
    const st = s.state;
    const myLost = st.captured.filter((p) => p.team === s.me);
    const theirLost = st.captured.filter((p) => p.team !== s.me);
    const turnText = st.phase !== 'playing' ? '' : s.pending ? 'Resolving a challenge…' : st.turn === s.me ? 'Your move' : `${escapeHtml(this.oppName())} is thinking`;

    const playerCard = (team: Team) => {
      const mine = team === s.me;
      const lost = mine ? myLost : theirLost;
      const active = st.phase === 'playing' && st.turn === team;
      return `
        <div class="player ${active ? 'active' : ''} team-${team.toLowerCase()}">
          <div class="player-head">
            <span class="swatch"></span>
            <span class="player-name">${escapeHtml(mine ? this.myName() : this.oppName())}${mine ? ' <small>(you)</small>' : ''}</span>
            <span class="clock" data-team="${team}">${s.rules.timerSeconds ? '–' : ''}</span>
          </div>
          <div class="clockbar" data-bar="${team}"><i></i></div>
          <div class="lost" title="${lost.length} pieces lost">
            ${lost.length ? lost.map((p) => pieceSvg(team, mine ? p.rank : null, 26)).join('') : '<span class="muted small">No losses yet</span>'}
          </div>
        </div>`;
    };

    const log = st.history.slice().reverse().slice(0, 40).map((h) => {
      const res = h.result === null ? '' : h.result === 'attacker' ? ' ⚔ wins' : h.result === 'defender' ? ' ⚔ falls' : ' ⚔ both fall';
      return `<li class="team-${h.team.toLowerCase()}"><span class="ply">${h.ply}.</span> ${toNotation(h.from)}→${toNotation(h.to)}${res}</li>`;
    }).join('');

    side.innerHTML = `
      <section class="side-block turn ${st.phase === 'playing' && st.turn === s.me ? 'mine' : ''}">
        <p class="eyebrow">${st.phase === 'playing' ? `Move ${st.ply + 1}` : 'Game over'}</p>
        <h2>${turnText || this.endHeadline()}</h2>
        ${st.pendingFlag ? `<p class="flag-alert">A flag stands on its goal row. It wins unless it is captured this turn.</p>` : ''}
      </section>
      ${playerCard(s.opp)}
      ${playerCard(s.me)}
      <section class="side-block log-block">
        <p class="eyebrow">Moves</p>
        <ol class="log">${log || '<li class="muted">No moves yet.</li>'}</ol>
      </section>
      <section class="side-actions">
        ${st.phase === 'playing' ? '<button class="btn danger ghost" id="resign">Resign</button>' : '<button class="btn ghost" id="home">Home</button>'}
      </section>`;

    side.querySelector('#resign')?.addEventListener('click', () => {
      if (confirm('Resign this game?')) s.resign();
    });
    side.querySelector('#home')?.addEventListener('click', () => this.renderHome());
    this.renderOverlay();
    this.tick();
  }

  private endHeadline(): string {
    const s = this.session!;
    const st = s.state;
    if (st.phase !== 'ended' || !st.winner) return '';
    return st.winner === s.me ? 'Victory' : 'Defeat';
  }

  private renderOverlay(): void {
    const s = this.session!;
    const st = s.state;
    const overlay = this.root.querySelector<HTMLElement>('#overlay')!;
    if (st.phase !== 'ended' || !st.winner) { overlay.innerHTML = ''; return; }
    const winnerName = st.winner === s.me ? this.myName() : this.oppName();
    const loserName = st.winner === s.me ? this.oppName() : this.myName();
    const reason = END_TEXT[st.endReason ?? '']?.(escapeHtml(winnerName), escapeHtml(loserName)) ?? '';
    const mineOffered = s.rematch[s.me];
    const theirsOffered = s.rematch[s.opp];
    overlay.innerHTML = `
      <div class="end ${st.winner === s.me ? 'won' : 'lost'}" role="dialog" aria-modal="true">
        <p class="eyebrow">${st.winner === s.me ? 'Victory' : 'Defeat'}</p>
        <h2>${st.winner === s.me ? 'You win' : `${escapeHtml(winnerName)} wins`}</h2>
        <p class="muted">${reason}</p>
        <div class="row">
          <button class="btn primary" id="rematch" ${mineOffered ? 'disabled' : ''}>${mineOffered ? 'Waiting for opponent…' : theirsOffered ? 'Accept rematch' : 'Rematch'}</button>
          <button class="btn" id="review">Review board</button>
          <button class="btn ghost" id="end-home">Home</button>
        </div>
        ${theirsOffered && !mineOffered ? `<p class="small">${escapeHtml(this.oppName())} wants a rematch.</p>` : ''}
      </div>`;
    overlay.querySelector('#rematch')!.addEventListener('click', () => s.offerRematch());
    overlay.querySelector('#review')!.addEventListener('click', () => { overlay.innerHTML = ''; });
    overlay.querySelector('#end-home')!.addEventListener('click', () => this.renderHome());
  }

  private tick(): void {
    const s = this.session;
    if (!s || this.screen !== 'play') return;
    const now = s.transport.now();
    s.tick(now);
    if (!s.rules.timerSeconds) return;
    const rem = s.remaining(now);
    for (const team of ['A', 'B'] as Team[]) {
      const clock = this.root.querySelector<HTMLElement>(`.clock[data-team="${team}"]`);
      const bar = this.root.querySelector<HTMLElement>(`.clockbar[data-bar="${team}"] i`);
      if (!clock || !bar) continue;
      const active = s.state.phase === 'playing' && s.state.turn === team && !s.pending;
      if (active && rem !== null) {
        const secs = Math.max(0, Math.ceil(rem / 1000));
        clock.textContent = `${secs}s`;
        bar.style.width = `${Math.max(0, Math.min(100, (rem / (s.rules.timerSeconds * 1000)) * 100))}%`;
        clock.classList.toggle('low', secs <= 10);
      } else {
        clock.textContent = `${s.rules.timerSeconds}s`;
        bar.style.width = '100%';
        clock.classList.remove('low');
      }
    }
  }

  // ------------------------------------------------------------- helpers

  private copy(text: string, done: string): void {
    navigator.clipboard?.writeText(text).then(() => this.toast(done), () => this.toast(text));
  }

  private toast(text: string, isError = false): void {
    const host = this.root.querySelector('#toasts') ?? this.root;
    const node = document.createElement('div');
    node.className = `toast ${isError ? 'error' : ''}`;
    node.textContent = text;
    host.append(node);
    setTimeout(() => node.classList.add('show'), 10);
    setTimeout(() => { node.classList.remove('show'); setTimeout(() => node.remove(), 300); }, isError ? 6000 : 2600);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

export { other };
