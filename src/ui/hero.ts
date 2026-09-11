import type { Rank } from '../engine/types';
import { RANK_INFO, resolveChallenge } from '../engine/rules';
import { fullRankList, shuffle } from '../engine/random';
import { pieceInner } from './board';

/**
 * The landing-page stage: a 6×4 slice of the front line you can poke at.
 * Navy pieces are yours and show their ranks. Red pieces hide theirs until
 * you attack one, and then a real challenge is resolved with the real rules.
 */

const CELL = 100;
const COLS = 6;
const ROWS = 4;
const NS = 'http://www.w3.org/2000/svg';

interface HeroPiece {
  id: string;
  team: 'A' | 'B';
  rank: Rank;
  c: number;
  r: number;
  alive: boolean;
  el: SVGGElement;
  inner: SVGGElement;
}

const NAVY_LAYOUT: { rank: Rank; c: number; r: number }[] = [
  { rank: 'PVT', c: 0, r: 3 }, { rank: 'SGT', c: 1, r: 3 }, { rank: 'G5', c: 2, r: 3 },
  { rank: 'FLG', c: 3, r: 3 }, { rank: 'COL', c: 4, r: 3 }, { rank: 'SPY', c: 5, r: 3 },
  { rank: 'PVT', c: 1, r: 2 }, { rank: 'MAJ', c: 4, r: 2 },
];
const RED_CELLS: { c: number; r: number }[] = [
  { c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 }, { c: 4, r: 0 }, { c: 5, r: 0 },
  { c: 1, r: 1 }, { c: 3, r: 1 }, { c: 4, r: 1 },
];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export class Hero {
  private svg: SVGSVGElement;
  private cells = el('g', { class: 'hero-cells' });
  private fx = el('g', { class: 'hero-fx' });
  private layer = el('g', { class: 'hero-pieces' });
  private pieces: HeroPiece[] = [];
  private busy = false;
  private touched = false;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private idleRing: SVGCircleElement | null = null;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private host: HTMLElement, private caption: HTMLElement, private stage: HTMLElement) {
    this.svg = el('svg', { class: 'hero-svg', viewBox: `-10 -10 ${COLS * CELL + 20} ${ROWS * CELL + 20}`, 'aria-label': 'Interactive board preview', role: 'img' });
    this.svg.append(this.cells, this.fx, this.layer);
    host.replaceChildren(this.svg);
    this.buildCells();
    this.populate(true);
    this.svg.addEventListener('click', (e) => this.onClick(e));
    this.svg.addEventListener('pointerover', (e) => this.onHover(e, true));
    this.svg.addEventListener('pointerout', (e) => this.onHover(e, false));
    this.bindParallax();
    this.setCaption('Tap a navy piece to move it forward. Attack a red piece to see a challenge.', true);
  }

  destroy(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
  }

  // ---------------------------------------------------------------- build

  private buildCells(): void {
    this.cells.append(el('rect', { x: -10, y: -10, width: COLS * CELL + 20, height: ROWS * CELL + 20, rx: 14, class: 'hero-frame' }));
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const zone = r <= 1 ? 'zone-b' : 'zone-a';
        this.cells.append(el('rect', { x: c * CELL, y: r * CELL, width: CELL, height: CELL, class: `cell ${zone}`, 'data-c': c, 'data-r': r }));
      }
    }
    for (let i = 0; i <= COLS; i++) this.cells.append(el('line', { x1: i * CELL, y1: 0, x2: i * CELL, y2: ROWS * CELL, class: 'grid' }));
    for (let i = 0; i <= ROWS; i++) this.cells.append(el('line', { x1: 0, y1: i * CELL, x2: COLS * CELL, y2: i * CELL, class: 'grid' }));
  }

  private populate(entrance: boolean): void {
    this.layer.replaceChildren();
    this.fx.replaceChildren();
    this.pieces = [];
    const redRanks = shuffle(fullRankList()).filter((r) => r !== 'FLG').slice(0, RED_CELLS.length);
    let i = 0;
    const add = (team: 'A' | 'B', rank: Rank, c: number, r: number) => {
      const g = el('g', { class: `piece hero-piece team-${team.toLowerCase()} ${team === 'A' ? 'mine' : 'theirs'}`, 'data-idx': this.pieces.length });
      g.style.transform = `translate(${c * CELL}px, ${r * CELL}px)`;
      const inner = el('g', { class: 'inner' });
      inner.style.setProperty('--i', String(i++));
      if (entrance && !this.reduced) {
        inner.classList.add('drop');
        inner.addEventListener('animationend', () => inner.classList.remove('drop'), { once: true });
      }
      inner.innerHTML = pieceInner(team === 'A' ? rank : null, true);
      g.append(inner);
      this.layer.append(g);
      this.pieces.push({ id: `${team}${this.pieces.length}`, team, rank, c, r, alive: true, el: g, inner });
    };
    RED_CELLS.forEach((cell, k) => add('B', redRanks[k], cell.c, cell.r));
    NAVY_LAYOUT.forEach((p) => add('A', p.rank, p.c, p.r));
    this.placeIdleRing();
  }

  /** A soft pulse on one navy piece that can attack right now, until the visitor touches anything. */
  private placeIdleRing(): void {
    this.idleRing?.remove();
    this.idleRing = null;
    if (this.touched || this.reduced) return;
    const ready = this.pieces.find((p) => p.team === 'A' && p.alive && this.at(p.c, p.r - 1)?.team === 'B');
    if (!ready) return;
    this.idleRing = el('circle', { cx: ready.c * CELL + CELL / 2, cy: ready.r * CELL + CELL / 2, r: 54, class: 'idle-ring' });
    this.fx.append(this.idleRing);
  }

  private at(c: number, r: number): HeroPiece | undefined {
    return this.pieces.find((p) => p.alive && p.c === c && p.r === r);
  }

  private pieceFrom(target: EventTarget | null): HeroPiece | null {
    const g = (target as Element | null)?.closest<SVGGElement>('.hero-piece');
    if (!g) return null;
    return this.pieces[Number(g.dataset.idx)] ?? null;
  }

  // ---------------------------------------------------------- interaction

  private onHover(e: Event, over: boolean): void {
    const p = this.pieceFrom(e.target);
    if (!p || !p.alive) return;
    p.inner.classList.toggle('lift', over && !this.busy);
  }

  private async onClick(e: Event): Promise<void> {
    if (this.busy) return;
    const p = this.pieceFrom(e.target);
    if (!p || !p.alive) return;
    this.touch();
    if (p.team === 'B') {
      this.nudge(p);
      this.setCaption('Their ranks are hidden. Attack one with a navy piece to find out.');
      return;
    }
    const ahead = p.r - 1;
    if (ahead < 0) return;
    const target = this.at(p.c, ahead);
    if (target?.team === 'A') { this.nudge(p); return; }
    if (target) await this.challenge(p, target);
    else await this.move(p, p.c, ahead);
  }

  private touch(): void {
    if (this.touched) return;
    this.touched = true;
    this.idleRing?.remove();
    this.idleRing = null;
    this.stage.classList.add('touched');
  }

  private nudge(p: HeroPiece): void {
    p.inner.classList.remove('nudge');
    void p.inner.getBoundingClientRect();
    p.inner.classList.add('nudge');
  }

  private async move(p: HeroPiece, c: number, r: number): Promise<void> {
    this.busy = true;
    p.c = c; p.r = r;
    p.el.style.transform = `translate(${c * CELL}px, ${r * CELL}px)`;
    p.inner.classList.remove('lift');
    await wait(this.reduced ? 0 : 240);
    this.busy = false;
  }

  private async challenge(att: HeroPiece, def: HeroPiece): Promise<void> {
    this.busy = true;
    this.layer.append(att.el); // on top while it slides
    att.inner.classList.remove('lift');
    att.el.style.transform = `translate(${def.c * CELL}px, ${def.r * CELL}px)`;
    this.setCaption(`Your ${RANK_INFO[att.rank].name} challenges…`);
    await wait(this.reduced ? 0 : 320);

    // Clash: a burst at the contested square, and the red piece shows its rank.
    const cx = def.c * CELL + CELL / 2, cy = def.r * CELL + CELL / 2;
    const burst = el('circle', { cx, cy, r: 56, class: 'burst' });
    this.fx.append(burst);
    def.inner.innerHTML = pieceInner(def.rank, true);
    def.inner.classList.add('reveal');
    await wait(this.reduced ? 0 : 420);

    const result = resolveChallenge(att.rank, def.rank);
    const a = RANK_INFO[att.rank].name, d = RANK_INFO[def.rank].name;
    if (result === 'attacker') {
      def.alive = false; def.inner.classList.add('gone');
      this.setCaption(def.rank === 'FLG' ? `${a} captures the flag!` : `${a} beats ${d}. The square is yours.`);
    } else if (result === 'defender') {
      att.alive = false; att.inner.classList.add('gone');
      this.setCaption(att.rank === 'FLG' ? `Your flag fell to a ${d}. Never attack with the flag.` : `${d} beats your ${a}. Only the result is shown in a real game.`);
    } else {
      att.alive = false; def.alive = false;
      att.inner.classList.add('gone'); def.inner.classList.add('gone');
      this.setCaption(`${a} meets ${d}: equal ranks, both fall.`);
    }
    if (result !== 'defender') { att.c = def.c; att.r = def.r; }
    await wait(this.reduced ? 0 : 500);
    burst.remove();
    this.busy = false;

    // Bring in a fresh line after a pause, with new hidden ranks.
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      if (this.busy) return;
      this.populate(true);
      this.setCaption('New line, new secrets. Try another piece.');
    }, 3200);
  }

  private setCaption(text: string, hint = false): void {
    this.caption.textContent = text;
    this.caption.classList.toggle('hint', hint);
    this.caption.classList.remove('flash');
    void this.caption.offsetWidth;
    if (!hint) this.caption.classList.add('flash');
  }

  /** Slight 3D tilt following the pointer, reset when it leaves. */
  private bindParallax(): void {
    if (this.reduced) return;
    const s = this.stage;
    s.addEventListener('pointermove', (e) => {
      const rect = s.getBoundingClientRect();
      const tx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ty = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      s.style.setProperty('--tx', tx.toFixed(3));
      s.style.setProperty('--ty', ty.toFixed(3));
    });
    s.addEventListener('pointerleave', () => {
      s.style.setProperty('--tx', '0');
      s.style.setProperty('--ty', '0');
    });
  }
}
