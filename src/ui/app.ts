import type { Placement, Pos, Rank, Rules, Team } from '../engine/types';
import { ALL_RANKS, COLS, OFFICER_ORDER, PIECE_COUNTS, RANK_INFO, ROWS, other, posEq, posKey, setupRows, toNotation } from '../engine/rules';
import { fullRankList, makePieceIds, randomSetup } from '../engine/random';
import { createLocalPair } from '../net/local';
import { firebaseConfigured, hostRoom, joinRoom } from '../net/firebase';
import { DEFAULT_RULES, TIMER_OPTIONS, normalizeCode } from '../net/protocol';
import { Session, localStorageRankStore, memoryRankStore } from '../net/session';
import { attachBot } from '../net/bot';
import { LOGO_MARK } from '../assets/sprite';
import { BoardView, pieceInner, pieceSvg } from './board';
import { Hero } from './hero';
import { sfx } from '../audio';

type Screen = 'home' | 'lobby' | 'setup' | 'play';

const LS_NAME = 'salpakan:name';
const LS_LAST_SETUP = 'salpakan:lastSetup';
const LS_THEME = 'salpakan:theme';

/**
 * Color palettes. Each remaps the theme tokens; team A keeps the "navy" token names
 * and team B the "crimson" ones so every component recolors without changes.
 */
interface Theme { id: string; name: string; dark?: boolean; vars: Record<string, string> }
const THEMES: Theme[] = [
  { id: 'classic', name: 'Navy & Crimson', vars: {} },
  { id: 'ivory', name: 'Ivory & Charcoal', vars: {
    '--navy': '#F3EBD9', '--navy-deep': '#C9BFA8', '--brass': '#243B5A',
    '--crimson': '#2B2F36', '--crimson-deep': '#15181D', '--ivory': '#E4C57A',
    '--board': '#DDE5DC', '--grid': '#BFCABF', '--zone-a': 'rgba(36,59,90,.08)', '--zone-b': 'rgba(43,47,54,.10)',
    '--accent': '#1F8A7A', '--accent-deep': '#166B5F',
  } },
  { id: 'jade', name: 'Jade & Coral', vars: {
    '--navy': '#1F7A6D', '--navy-deep': '#124D44', '--brass': '#F5E6B8',
    '--crimson': '#E0654A', '--crimson-deep': '#963C29', '--ivory': '#FFF3EA',
    '--board': '#EDE7DA', '--grid': '#D3CBB9', '--accent': '#D9A441', '--accent-deep': '#A87A24', '--accent-ink': '#1B2430',
  } },
  { id: 'forest', name: 'Forest & Ochre', vars: {
    '--navy': '#2F5D3A', '--navy-deep': '#1B3A22', '--brass': '#F0D58C',
    '--crimson': '#B7791F', '--crimson-deep': '#7A4E12', '--ivory': '#FFF4DC',
    '--board': '#E6E3D6', '--grid': '#C9C6B4', '--accent': '#1F6F9E', '--accent-deep': '#164F72',
  } },
  { id: 'rose', name: 'Rose & Plum', vars: {
    '--bg': '#F8F0F3', '--panel-2': '#F1E3E9', '--rule': '#E3D0D9', '--muted': '#7A6670',
    '--board': '#F3E4EA', '--grid': '#DCC3CE', '--coord': '#A08A96',
    '--navy': '#E0629A', '--navy-deep': '#9E3F6B', '--brass': '#FFF3F7',
    '--crimson': '#5B2A5E', '--crimson-deep': '#35163A', '--ivory': '#F6C9DC',
    '--zone-a': 'rgba(224,98,154,.12)', '--zone-b': 'rgba(91,42,94,.12)',
    '--accent': '#2A9D8F', '--accent-deep': '#1F7A6F',
  } },
  { id: 'scarlet', name: 'Scarlet & Slate', vars: {
    '--bg': '#F5F1EF', '--panel-2': '#EDE5E1', '--board': '#ECE3DF', '--grid': '#D2C4BE',
    '--navy': '#C8102E', '--navy-deep': '#7E0A1D', '--brass': '#FFE9D6',
    '--crimson': '#3A4048', '--crimson-deep': '#1F242A', '--ivory': '#F1D08A',
    '--zone-a': 'rgba(200,16,46,.10)', '--zone-b': 'rgba(58,64,72,.12)',
    '--accent': '#D9A441', '--accent-deep': '#A87A24', '--accent-ink': '#1B2430',
  } },
  { id: 'sky', name: 'Sky & Indigo', vars: {
    '--bg': '#EEF3F8', '--panel-2': '#E2EAF2', '--rule': '#D0DAE6', '--muted': '#65717F',
    '--board': '#E2EAF2', '--grid': '#C3D0DE', '--coord': '#8794A3',
    '--navy': '#4A90E2', '--navy-deep': '#2C5C9A', '--brass': '#FFF8E1',
    '--crimson': '#2D2F7A', '--crimson-deep': '#1A1C4D', '--ivory': '#FFD86B',
    '--zone-a': 'rgba(74,144,226,.12)', '--zone-b': 'rgba(45,47,122,.12)',
    '--accent': '#F27059', '--accent-deep': '#C24E3A',
  } },
  { id: 'midnight', name: 'Midnight', dark: true, vars: {
    '--bg': '#12161E', '--panel': '#1B2230', '--panel-2': '#232B3A', '--ink': '#E8ECF2', '--muted': '#97A1B1', '--rule': '#2E384A',
    '--board': '#202838', '--grid': '#34405A', '--coord': '#6E7A90',
    '--navy': '#1E5A8A', '--navy-deep': '#123B5C', '--brass': '#F2CF6B',
    '--crimson': '#C2572B', '--crimson-deep': '#7E3617', '--ivory': '#FFF1DE',
    '--zone-a': 'rgba(30,90,138,.18)', '--zone-b': 'rgba(194,87,43,.16)',
    '--accent': '#3BE3F5', '--accent-deep': '#1FB4C4', '--accent-ink': '#0B1410',
    '--shadow': '0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35)',
  } },
];
const THEME_KEYS = Array.from(new Set(THEMES.flatMap((t) => Object.keys(t.vars))));

function currentTheme(): string {
  try { return localStorage.getItem(LS_THEME) ?? 'classic'; } catch { return 'classic'; }
}

function applyTheme(id: string): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  for (const k of THEME_KEYS) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.vars['--navy'] ?? '#1F3A5F');
  try { localStorage.setItem(LS_THEME, theme.id); } catch { /* ignore */ }
}

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
  private hero: Hero | null = null;
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
    applyTheme(currentTheme());
    this.bindPalette();
    sfx.preload();
    window.addEventListener('salpakan:error', (e) => this.toast((e as CustomEvent<string>).detail, true));
    window.addEventListener('resize', () => { if (this.board && this.session) this.renderBoard(); });
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    if (room) this.renderJoin(normalizeCode(room));
    else this.renderHome();
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

  /** A palette chip with a popover of swatches. Works anywhere thanks to delegated events on the root. */
  private paletteMarkup(compact = false): string {
    const cur = currentTheme();
    const swatch = (t: Theme) => {
      const a = t.vars['--navy'] ?? '#1F3A5F', b = t.vars['--crimson'] ?? '#B8352F', bg = t.vars['--board'] ?? '#E9E4D9';
      return `<span class="pal-swatch" style="--sa:${a};--sb:${b};--sbg:${bg}"><i class="a"></i><i class="b"></i></span>`;
    };
    return `
      <div class="palette">
        <button type="button" class="${compact ? 'chip' : 'link-btn'} palette-btn" aria-haspopup="true" aria-expanded="false">${swatch(THEMES.find((t) => t.id === cur) ?? THEMES[0])}<span>Palette</span></button>
        <div class="palette-pop" hidden role="menu">
          ${THEMES.map((t) => `<button type="button" class="pal-opt ${t.id === cur ? 'active' : ''}" data-theme="${t.id}" role="menuitemradio" aria-checked="${t.id === cur}">${swatch(t)}<span>${t.name}</span></button>`).join('')}
        </div>
      </div>`;
  }

  private soundMarkup(compact = false): string {
    const on = sfx.enabled;
    const icon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/>${on ? '<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>' : '<path d="M17 9l4 6M21 9l-4 6"/>'}</svg>`;
    return `<button type="button" class="${compact ? 'chip' : 'link-btn'} sound-btn" aria-pressed="${on}" title="${on ? 'Turn sound off' : 'Turn sound on'}">${icon}<span>${on ? 'Sound on' : 'Sound off'}</span></button>`;
  }

  /** Minimal corner gear: practice, palette swatches, and sound in one small menu. */
  private settingsMarkup(withPractice: boolean, open = false, inline = false): string {
    const cur = currentTheme();
    const dot = (t: Theme) => {
      const a = t.vars['--navy'] ?? '#1F3A5F', b = t.vars['--crimson'] ?? '#B8352F', bg = t.vars['--board'] ?? '#E9E4D9';
      return `<button type="button" class="sfab-pal ${t.id === cur ? 'active' : ''}" data-theme="${t.id}" title="${t.name}" aria-label="${t.name}" aria-pressed="${t.id === cur}"><span class="pal-swatch" style="--sa:${a};--sb:${b};--sbg:${bg}"><i class="a"></i><i class="b"></i></span></button>`;
    };
    return `
      <div class="sfab ${inline ? 'inline' : ''}" data-practice="${withPractice}" data-inline="${inline}">
        <button type="button" class="sfab-btn" aria-label="Settings" aria-haspopup="true" aria-expanded="${open}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
        </button>
        <div class="sfab-menu" role="menu" ${open ? '' : 'hidden'}>
          ${withPractice ? '<button type="button" class="sfab-item sfab-practice" role="menuitem">Practice against the bot</button>' : ''}
          <div class="sfab-row"><span class="sfab-label">Palette</span><span class="sfab-dots">${THEMES.map(dot).join('')}</span></div>
          <button type="button" class="sfab-row sfab-sound" role="menuitemcheckbox" aria-checked="${sfx.enabled}"><span class="sfab-label">Sound</span><span class="switch ${sfx.enabled ? 'on' : ''}" aria-hidden="true"><i></i></span></button>
        </div>
      </div>`;
  }

  private refreshFab(open: boolean): void {
    this.root.querySelectorAll<HTMLElement>('.sfab').forEach((f) => { f.outerHTML = this.settingsMarkup(f.dataset.practice === 'true', open, f.dataset.inline === 'true'); });
  }

  private bindPalette(): void {
    this.root.addEventListener('click', (e) => {
      const target = e.target as Element;
      const fab = target.closest<HTMLElement>('.sfab');
      if (fab) {
        if (target.closest('.sfab-btn')) {
          const menu = fab.querySelector<HTMLElement>('.sfab-menu')!;
          menu.hidden = !menu.hidden;
          fab.querySelector('.sfab-btn')!.setAttribute('aria-expanded', String(!menu.hidden));
          sfx.play('click');
        } else if (target.closest('.sfab-pal')) {
          applyTheme(target.closest<HTMLElement>('.sfab-pal')!.dataset.theme!);
          sfx.play('click');
          this.refreshFab(true);
        } else if (target.closest('.sfab-sound')) {
          const on = sfx.toggle();
          if (on) sfx.play('click');
          this.refreshFab(true);
        } else if (target.closest('.sfab-practice')) {
          const n = this.root.querySelector<HTMLInputElement>('#name')?.value.trim() || this.savedName() || 'You';
          try { localStorage.setItem(LS_NAME, n); } catch { /* ignore */ }
          this.practice(n);
        }
        return;
      }
      this.root.querySelectorAll<HTMLElement>('.sfab-menu').forEach((m) => { m.hidden = true; });
      this.root.querySelectorAll('.sfab-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      const soundBtn = target.closest<HTMLButtonElement>('.sound-btn');
      if (soundBtn) {
        const on = sfx.toggle();
        this.root.querySelectorAll<HTMLElement>('.sound-btn').forEach((b) => { b.outerHTML = this.soundMarkup(b.classList.contains('chip')); });
        if (on) sfx.play('click');
        return;
      }
      const opt = target.closest<HTMLButtonElement>('.pal-opt');
      if (opt) {
        applyTheme(opt.dataset.theme!);
        this.root.querySelectorAll<HTMLElement>('.palette').forEach((p) => {
          p.outerHTML = this.paletteMarkup(p.querySelector('.palette-btn')?.classList.contains('chip') ?? false);
        });
        this.toast(`${THEMES.find((t) => t.id === opt.dataset.theme)?.name ?? 'Palette'} applied.`);
        return;
      }
      const btn = target.closest<HTMLButtonElement>('.palette-btn');
      const pops = this.root.querySelectorAll<HTMLElement>('.palette-pop');
      if (btn) {
        const pop = btn.parentElement!.querySelector<HTMLElement>('.palette-pop')!;
        const open = pop.hidden;
        pops.forEach((p) => { p.hidden = true; });
        pop.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        return;
      }
      if (!target.closest('.palette')) pops.forEach((p) => { p.hidden = true; });
    });
  }

  /** Decorative landing background: soft team-colored glows, a faint grid, and drifting ghost insignia. */
  private bgMarkup(): string {
    const glyph = (rank: string, cls: string) => `<svg class="bg-glyph ${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#ins-${rank}"/></svg>`;
    return `<div class="bg" aria-hidden="true">${glyph('G5', 'g1')}${glyph('SGT', 'g2')}${glyph('SPY', 'g3')}${glyph('COL', 'g4')}${glyph('FLG', 'g5')}</div>`;
  }

  private brandMarkup(): string {
    return `<a class="brand" href="${location.pathname}">${LOGO_MARK}<span class="brand-name">Salpakan</span></a>`;
  }

  private renderHome(): void {
    this.teardownSession();
    this.hero?.destroy();
    this.hero = null;
    this.screen = 'home';
    history.replaceState(null, '', location.pathname);
    const online = firebaseConfigured();
    const name = this.savedName();
    this.root.innerHTML = `
      ${this.bgMarkup()}
      ${this.settingsMarkup(true)}
      <main class="home">
        <section class="hero">
          <div class="hero-copy">
            ${this.brandMarkup()}
            <h1>Every piece<br>is a secret.</h1>
            <div class="cta">
              <input id="name" class="name-input" type="text" maxlength="18" autocomplete="nickname" placeholder="Your name" aria-label="Your name" value="${escapeHtml(name)}">
              <div class="cta-row">
                <button class="btn primary big" id="create-btn" type="button" ${online ? '' : 'disabled'}>Create room</button>
                <form id="join" class="join-inline">
                  <input id="code" class="code-input" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="5" placeholder="CODE" aria-label="Room code">
                  <button class="btn big" type="submit" ${online ? '' : 'disabled'}>Join</button>
                </form>
              </div>
              ${online ? '' : '<p class="warn small">Online play is not configured on this build.</p>'}
            </div>
          </div>

          <div class="hero-stage" id="hero-stage">
            <div class="stage-3d"><div id="hero-board"></div></div>
            <p class="hero-caption" id="hero-caption"></p>
          </div>
        </section>

        ${this.rulesMarkup()}
      </main>
      <div id="toasts" class="toasts"></div>`;

    const q = <T extends Element>(sel: string) => this.root.querySelector<T>(sel)!;
    const nameInput = q<HTMLInputElement>('#name');
    const codeInput = q<HTMLInputElement>('#code');
    codeInput.addEventListener('input', () => { codeInput.value = normalizeCode(codeInput.value); });

    q<HTMLButtonElement>('#create-btn').addEventListener('click', () => {
      const n = this.takeName(nameInput);
      if (n) void this.create({ ...DEFAULT_RULES }, n);
    });
    q<HTMLFormElement>('#join').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = normalizeCode(codeInput.value);
      if (code.length !== 5) { codeInput.focus(); this.toast('Room codes are five letters.'); return; }
      const n = this.takeName(nameInput);
      if (n) void this.join(code, n);
    });
    this.hero = new Hero(q<HTMLElement>('#hero-board'), q<HTMLElement>('#hero-caption'), q<HTMLElement>('#hero-stage'));
    if (!name) nameInput.focus();
  }

  /** Landing for an invite link: the room is fixed, the visitor only has to give a name. */
  private renderJoin(code: string): void {
    this.teardownSession();
    this.hero?.destroy();
    this.hero = null;
    this.screen = 'home';
    const valid = code.length === 5;
    const name = this.savedName();
    this.root.innerHTML = `
      ${this.bgMarkup()}
      ${this.settingsMarkup(false)}
      <main class="home invite-page">
        <section class="invite">
          ${this.brandMarkup()}
          ${valid ? `
            <p class="eyebrow">You are invited to room</p>
            <p class="big-code">${code.split('').map((ch) => `<span>${ch}</span>`).join('')}</p>
            <form id="invite-form" class="invite-form">
              <label class="field"><span>Your name</span><input id="name" class="name-input" type="text" maxlength="18" autocomplete="nickname" placeholder="What should your opponent call you?" value="${escapeHtml(name)}"></label>
              <button class="btn primary big" type="submit">Join the game</button>
            </form>` : `
            <p class="eyebrow">Invite link</p>
            <h2>That link is missing a valid room code.</h2>
            <p class="muted">Ask your opponent to copy the invite again.</p>`}
          <a class="link-btn" href="${location.pathname}">Not this room? Start your own</a>
        </section>
      </main>
      <div id="toasts" class="toasts"></div>`;
    const form = this.root.querySelector<HTMLFormElement>('#invite-form');
    const nameInput = this.root.querySelector<HTMLInputElement>('#name');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = this.takeName(nameInput!);
      if (n) void this.join(code, n);
    });
    nameInput?.focus();
  }

  private takeName(input: HTMLInputElement): string | null {
    const n = input.value.trim();
    if (!n) {
      input.focus();
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 400);
      this.toast('Enter a name first.');
      return null;
    }
    try { localStorage.setItem(LS_NAME, n); } catch { /* ignore */ }
    return n;
  }

  private rulesMarkup(): string {
    const navy = (r: Rank, size = 44) => pieceSvg('A', r, size, false);
    const red = (r: Rank | null, size = 44) => pieceSvg('B', r, size, false);
    const ladder = OFFICER_ORDER.map((r, i) => `
      <li class="rung" style="--i:${i}">
        ${navy(r, 46)}
        <span class="rung-name">${RANK_INFO[r].name}</span>
      </li>`).join('<li class="rung-sep" aria-hidden="true"><svg viewBox="0 0 12 20"><path d="M2 2l8 8-8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></li>');

    const moveIcon = `<svg viewBox="0 0 120 120" class="howto-ico" aria-hidden="true">
      <g class="piece team-a" transform="translate(10,10)">${pieceInner('SGT', false)}</g>
      <g class="arrows" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M60 4v-2M55 8l5-6 5 6"/><path d="M60 114l-5-6h10z" fill="var(--accent)" stroke="none"/><path d="M6 60l6-5v10z" fill="var(--accent)" stroke="none"/><path d="M114 60l-6-5v10z" fill="var(--accent)" stroke="none"/>
      </g></svg>`;
    const clashIcon = `<svg viewBox="0 0 170 120" class="howto-ico" aria-hidden="true">
      <g class="piece team-b" transform="translate(70,12) scale(.95)">${pieceInner(null, false)}</g>
      <g class="piece team-a" transform="translate(8,20) scale(.95)">${pieceInner('CPT', false)}</g>
      <g fill="var(--brass)"><polygon points="103,16 108,32 124,30 111,41 118,56 103,47 88,56 95,41 82,30 98,32"/></g></svg>`;
    const winIcon = `<svg viewBox="0 0 170 120" class="howto-ico" aria-hidden="true">
      <rect x="4" y="6" width="162" height="44" rx="8" fill="color-mix(in srgb, var(--board), var(--accent) 30%)"/>
      <g class="piece team-a" transform="translate(38,20) scale(.9)">${pieceInner('FLG', false)}</g>
      <path d="M140 100V64M130 74l10-10 10 10" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    return `
        <section class="howto" id="how-to-play">
          <div class="howto-head">
            <p class="eyebrow">How to play</p>
            <h2>Outrank them, or make them guess.</h2>
          </div>

          <div class="howto-cards">
            <article class="howto-card">${moveIcon}<h3>Move</h3><p>One square up, down, left or right. Every piece moves the same way, so a move never gives a rank away.</p></article>
            <article class="howto-card">${clashIcon}<h3>Challenge</h3><p>Step onto an enemy piece. The higher rank stays, the lower one is removed. You learn only who survived, never the rank.</p></article>
            <article class="howto-card">${winIcon}<h3>Win</h3><p>Capture their flag, or walk your own flag to the far row. Twenty-one pieces each, and only one of them matters in the end.</p></article>
          </div>

          <div class="ladder-block">
            <div class="ladder-labels"><span>Strongest</span><span class="ladder-title">Chain of command</span><span>Weakest</span></div>
            <ol class="ladder">${ladder}</ol>
            <div class="ladder-bar" aria-hidden="true"></div>
          </div>

          <div class="exceptions">
            <div class="exc">
              <div class="exc-vis">${navy('SPY', 50)}<span class="beats">beats</span><span class="exc-group">${['G5', 'G3', 'COL', 'CPT', 'SGT'].map((r) => red(r as Rank, 30)).join('')}</span></div>
              <p><strong>The Spy</strong> defeats every officer, Sergeant through 5-Star General.</p>
            </div>
            <div class="exc">
              <div class="exc-vis">${navy('PVT', 50)}<span class="beats">beats</span>${red('SPY', 50)}</div>
              <p><strong>Only a Private</strong> can catch a Spy. Six of them guard the line.</p>
            </div>
            <div class="exc">
              <div class="exc-vis">${red(null, 50)}<span class="beats">captures</span>${navy('FLG', 50)}</div>
              <p><strong>Any piece takes the Flag.</strong> A flag that attacks the other flag wins.</p>
            </div>
            <div class="exc">
              <div class="exc-vis">${navy('COL', 50)}<span class="beats">meets</span>${red('COL', 50)}</div>
              <p><strong>Equal ranks</strong> eliminate each other. Both leave the board.</p>
            </div>
          </div>
        </section>`;
  }

  private async create(rules: Rules, name: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    sfx.play('cta');
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
    sfx.play('cta');
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
    sfx.play('cta');
    const pair = createLocalPair({ ...DEFAULT_RULES, timerSeconds: 0 }, { A: name, B: 'Bot' });
    const botSession = new Session(pair.B, memoryRankStore());
    this.detachBot = attachBot(botSession);
    this.startSession(new Session(pair.A, memoryRankStore()));
  }

  // ------------------------------------------------------------- session

  private startSession(session: Session): void {
    this.hero?.destroy();
    this.hero = null;
    this.session = session;
    this.draft.clear();
    this.traySel = null;
    this.sel = null;
    this.lastScreen = null;
    if (!session.transport.isLocal) history.replaceState(null, '', `${location.pathname}?room=${session.transport.code}`);
    this.prev = this.snapshot(session);
    this.unsubscribe = session.onChange(() => { this.playSessionSounds(); this.render(); });
    this.ticker = setInterval(() => this.tick(), 250);
    this.render();
  }

  private prev: ReturnType<App['snapshot']> | null = null;
  private lowPly = -1;

  private snapshot(s: Session) {
    return {
      phase: s.state.phase, ply: s.state.ply, historyLen: s.state.history.length,
      hasB: !!s.players.B, oppReady: s.ready[s.opp], oppRematch: s.rematch[s.opp], game: s.game,
    };
  }

  /** Compare the session with its previous snapshot and play whatever just happened. */
  private playSessionSounds(): void {
    const s = this.session;
    if (!s) return;
    const now = this.snapshot(s);
    const was = this.prev ?? now;
    this.prev = now;
    if (!s.synced) return;
    if (!was.hasB && now.hasB && !s.transport.isLocal) sfx.play('joined');
    if (!was.oppReady && now.oppReady && now.phase === 'setup') sfx.play('joined', { volume: 0.6 });
    if (was.phase === 'setup' && now.phase !== 'setup') sfx.play('start');
    if (now.historyLen > was.historyLen && now.game === was.game) {
      const last = s.state.history[s.state.history.length - 1];
      if (!last.result) sfx.play('move');
      else {
        sfx.play('clash', { delay: 190 });
        const lost = s.state.captured.slice(-(last.result === 'both' ? 2 : 1));
        const mineLost = lost.some((p) => p.team === s.me);
        const theirsLost = lost.some((p) => p.team !== s.me);
        sfx.play(mineLost && theirsLost ? 'both' : mineLost ? 'bad' : 'good', { delay: 520 });
      }
    }
    if (was.phase !== 'ended' && now.phase === 'ended') sfx.play(s.state.winner === s.me ? 'win' : 'lose', { delay: 700 });
    if (!was.oppRematch && now.oppRematch) sfx.play('joined');
  }

  private draftKey(): string {
    return [...this.draft].map(([k, v]) => `${k}:${v}`).join('|');
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
      ${this.bgMarkup()}
      <main class="home lobby">
        ${this.topbar()}
        <section class="panel center lobby-panel">
          <p class="eyebrow">Room code</p>
          <p class="big-code" id="big-code">${s.transport.code.split('').map((ch) => `<span>${ch}</span>`).join('')}</p>
          <div class="row center-row">
            <button class="btn primary" id="copy-link">Copy invite link</button>
            <button class="btn" id="copy-code">Copy code</button>
          </div>
          <p class="waiting"><span class="pulse"></span> Waiting for your opponent…</p>
          <div class="lobby-settings" id="lobby-settings">${this.lobbySettingsMarkup()}</div>
          <button class="btn ghost" id="leave">Cancel and go home</button>
        </section>
      </main>
      <div id="toasts" class="toasts"></div>`;
    this.root.querySelector('#copy-link')!.addEventListener('click', () => this.copy(link, 'Invite link copied.'));
    this.root.querySelector('#copy-code')!.addEventListener('click', () => this.copy(s.transport.code, 'Code copied.'));
    this.root.querySelector('#leave')!.addEventListener('click', () => this.renderHome());
    const box = this.root.querySelector<HTMLElement>('#lobby-settings')!;
    box.addEventListener('click', (e) => {
      const opt = (e.target as Element).closest<HTMLButtonElement>('.seg-opt');
      if (!opt) return;
      const key = opt.closest<HTMLElement>('.seg')!.dataset.key;
      const next: Rules = { ...s.rules };
      if (key === 'timer') next.timerSeconds = Number(opt.dataset.value);
      else next.flagInstantWin = opt.dataset.value === 'instant';
      sfx.play('click');
      s.rules = next; // optimistic; the log echo re-applies the same values
      s.setRules(next);
      box.innerHTML = this.lobbySettingsMarkup();
    });
  }

  private lobbySettingsMarkup(): string {
    const r = this.session!.rules;
    const seg = (key: string, opts: { value: string; label: string; active: boolean }[]) =>
      `<div class="seg" role="radiogroup" data-key="${key}">${opts.map((o) => `<button type="button" class="seg-opt ${o.active ? 'active' : ''}" data-value="${o.value}" role="radio" aria-checked="${o.active}">${o.label}</button>`).join('')}</div>`;
    return `
      <div class="setting">
        <div class="setting-text"><span class="setting-name">Turn timer</span><span class="setting-hint">${r.timerSeconds ? `${r.timerSeconds} seconds per move` : 'No clock'}</span></div>
        ${seg('timer', TIMER_OPTIONS.map((t) => ({ value: String(t), label: t ? `${t}s` : 'Off', active: t === r.timerSeconds })))}
      </div>
      <div class="setting">
        <div class="setting-text"><span class="setting-name">Flag rule</span><span class="setting-hint">${r.flagInstantWin ? 'Wins the moment it reaches the far row' : 'Must be unthreatened, or survive one turn'}</span></div>
        ${seg('flag', [{ value: 'instant', label: 'Instant', active: r.flagInstantWin }, { value: 'tournament', label: 'Tournament', active: !r.flagInstantWin }])}
      </div>`;
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
          ${this.settingsMarkup(false, false, true)}
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
    this.bindSetupDrag();
  }

  private rulesLine(): string {
    const r = this.session!.rules;
    return `${r.timerSeconds ? `${r.timerSeconds} s per move` : 'No clock'} · ${r.flagInstantWin ? 'flag wins on arrival' : 'tournament flag rule'}`;
  }

  // ------------------------------------------------------- drag and drop

  /**
   * Setup-phase dragging with pointer events: from the tray onto the board, between
   * squares, and off the board to return a piece. A press that barely moves is left
   * to the click handlers so tapping keeps working.
   */
  private bindSetupDrag(): void {
    const side = this.root.querySelector<HTMLElement>('#side')!;
    const boardHost = this.root.querySelector<HTMLElement>('#board')!;
    let drag: { rank: Rank; from: Pos | null; ghost: HTMLElement; startX: number; startY: number; moved: boolean; hover: Element | null } | null = null;

    const cellAt = (x: number, y: number): Pos | null => {
      const hit = document.elementFromPoint(x, y)?.closest<SVGElement>('#board [data-c]');
      return hit ? { c: Number(hit.dataset.c), r: Number(hit.dataset.r) } : null;
    };
    const rectAt = (pos: Pos | null): Element | null =>
      pos ? boardHost.querySelector(`rect.cell[data-c="${pos.c}"][data-r="${pos.r}"]`) : null;

    const begin = (e: PointerEvent, rank: Rank, from: Pos | null) => {
      const s = this.session;
      if (!s || this.screen !== 'setup' || s.ready[s.me] || e.button !== 0) return;
      const cellPx = boardHost.clientWidth * 100 / 940;
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.innerHTML = pieceSvg(s.me, rank, Math.max(40, cellPx * 0.9), cellPx > 46);
      ghost.style.width = ghost.style.height = `${Math.max(40, cellPx * 0.9)}px`;
      drag = { rank, from, ghost, startX: e.clientX, startY: e.clientY, moved: false, hover: null };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    };
    const moveTo = (x: number, y: number) => {
      if (!drag) return;
      drag.ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -60%)`;
      const pos = cellAt(x, y);
      const rect = rectAt(pos);
      if (rect !== drag.hover) {
        drag.hover?.classList.remove('drop-hover');
        const s = this.session!;
        if (rect && pos && setupRows(s.me).includes(pos.r)) rect.classList.add('drop-hover');
        drag.hover = rect;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
        drag.moved = true;
        document.body.append(drag.ghost);
        document.body.classList.add('dragging');
        if (drag.from) this.board?.setHidden(drag.from);
      }
      moveTo(e.clientX, e.clientY);
    };
    const finish = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      d.hover?.classList.remove('drop-hover');
      document.body.classList.remove('dragging');
      this.board?.setHidden(null);
      if (!d.moved) return; // a tap: click handlers take it from here
      d.ghost.remove();
      const s = this.session!;
      const before = this.draftKey();
      queueMicrotask(() => { if (this.draftKey() !== before) sfx.play('place'); });
      const pos = cellAt(e.clientX, e.clientY);
      const inZone = !!pos && setupRows(s.me).includes(pos.r);
      if (d.from) {
        const fromKey = posKey(d.from);
        if (!pos) {
          this.draft.delete(fromKey); // dropped off the board: back to the tray
        } else if (inZone && !posEq(pos, d.from)) {
          const here = this.draft.get(posKey(pos));
          this.draft.delete(fromKey);
          if (here) this.draft.set(fromKey, here);
          this.draft.set(posKey(pos), d.rank);
        }
      } else if (inZone && pos) {
        if (this.trayCounts()[d.rank] <= 0) return;
        this.draft.set(posKey(pos), d.rank);
      }
      this.sel = null;
      this.traySel = null;
      this.render();
    };

    side.addEventListener('pointerdown', (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>('.tray-piece');
      if (!btn || btn.disabled) return;
      begin(e, btn.dataset.rank as Rank, null);
    });
    boardHost.addEventListener('pointerdown', (e) => {
      const g = (e.target as Element).closest<SVGGElement>('g.piece.mine');
      if (!g) return;
      const from = { c: Number(g.dataset.c), r: Number(g.dataset.r) };
      const rank = this.draft.get(posKey(from));
      if (rank) begin(e, rank, from);
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
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
    const before = this.draftKey();
    queueMicrotask(() => { if (this.draftKey() !== before) sfx.play('place'); });
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
        <p class="muted">Drag pieces onto your three rows, or tap a piece and then a square. Drag a piece off the board to return it.</p>
        <p class="opp-status">${oppReady ? `${escapeHtml(this.oppName())} is ready.` : `${escapeHtml(this.oppName())} is placing…`}</p>
        <p class="rules-line">${this.rulesLine()}</p>
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
      sfx.play('click');
      this.traySel = this.traySel === rank ? null : rank;
      this.sel = null;
      this.render();
    });
    side.querySelector('#random')!.addEventListener('click', () => {
      sfx.play('place');
      this.draft.clear();
      for (const p of randomSetup(s.me)) this.draft.set(posKey(p.pos), p.rank!);
      this.traySel = null; this.sel = null;
      this.render();
    });
    side.querySelector('#clear')!.addEventListener('click', () => { this.draft.clear(); this.traySel = null; this.sel = null; this.render(); });
    side.querySelector('#ready')!.addEventListener('click', () => { sfx.play('cta'); this.submitSetup(); });
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
      sfx.play('click');
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
        if (team === s.me && secs === 10 && this.lowPly !== s.state.ply) { this.lowPly = s.state.ply; sfx.play('timerLow'); }
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
