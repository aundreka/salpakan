import type { GameState, MoveRecord, Pos, Team } from '../engine/types';
import { COLS, ROWS, RANK_INFO, posEq, posKey, setupRows } from '../engine/rules';

const CELL = 100;
const NS = 'http://www.w3.org/2000/svg';

export interface BoardProps {
  state: GameState;
  /** Whose side sits at the bottom. */
  me: Team;
  selected: Pos | null;
  targets: Pos[];
  /** During setup, the rows this player may use are emphasized. */
  setupFor: Team | null;
  lastMove: MoveRecord | null;
  /** Show rank labels under own insignia (hidden on very small boards). */
  labels: boolean;
  onCell: (pos: Pos) => void;
}

/** Screen position of a board square, with the viewer's own side at the bottom. */
export function toScreen(pos: Pos, me: Team): { x: number; y: number } {
  const c = me === 'A' ? pos.c : COLS - 1 - pos.c;
  const r = me === 'A' ? pos.r : ROWS - 1 - pos.r;
  return { x: c * CELL, y: r * CELL };
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * SVG board with keyed piece elements, so a move is a transform change the CSS can animate
 * instead of a re-render. Everything else (highlights, zone tints) is rebuilt per render.
 */
export class BoardView {
  private svg: SVGSVGElement;
  private cellsLayer = el('g', { class: 'cells' });
  private hlLayer = el('g', { class: 'hl' });
  private piecesLayer = el('g', { class: 'pieces' });
  private fxLayer = el('g', { class: 'fx' });
  private coordsLayer = el('g', { class: 'coords' });
  private pieceEls = new Map<string, SVGGElement>();
  private builtFor: Team | null = null;
  private props: BoardProps | null = null;

  constructor(host: HTMLElement) {
    this.svg = el('svg', {
      class: 'board',
      viewBox: `-34 -6 ${COLS * CELL + 40} ${ROWS * CELL + 40}`,
      role: 'grid',
      'aria-label': 'Salpakan board',
    });
    this.svg.append(this.cellsLayer, this.hlLayer, this.piecesLayer, this.fxLayer, this.coordsLayer);
    host.replaceChildren(this.svg);
    this.svg.addEventListener('click', (e) => {
      const hit = (e.target as Element).closest<SVGElement>('[data-c]');
      if (!hit || !this.props) return;
      this.props.onCell({ c: Number(hit.dataset.c), r: Number(hit.dataset.r) });
    });
  }

  /** Dim one piece while it is being dragged as a ghost. */
  setHidden(pos: Pos | null): void {
    for (const g of this.pieceEls.values()) {
      const match = !!pos && Number(g.dataset.c) === pos.c && Number(g.dataset.r) === pos.r;
      g.classList.toggle('dragging-src', match);
    }
  }

  render(props: BoardProps): void {
    this.props = props;
    if (this.builtFor !== props.me) this.buildCells(props.me);
    this.renderZones(props);
    this.renderHighlights(props);
    this.renderPieces(props);
  }

  private buildCells(me: Team): void {
    this.builtFor = me;
    this.cellsLayer.replaceChildren();
    this.coordsLayer.replaceChildren();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { x, y } = toScreen({ c, r }, me);
        const rect = el('rect', { x, y, width: CELL, height: CELL, class: 'cell', 'data-c': c, 'data-r': r, role: 'gridcell' });
        this.cellsLayer.append(rect);
      }
    }
    // Grid lines drawn once on top of the cell fills.
    for (let i = 0; i <= COLS; i++) this.cellsLayer.append(el('line', { x1: i * CELL, y1: 0, x2: i * CELL, y2: ROWS * CELL, class: 'grid' }));
    for (let i = 0; i <= ROWS; i++) this.cellsLayer.append(el('line', { x1: 0, y1: i * CELL, x2: COLS * CELL, y2: i * CELL, class: 'grid' }));
    // Coordinates: letters under columns, numbers beside rows, following the viewer's orientation.
    for (let c = 0; c < COLS; c++) {
      const { x } = toScreen({ c, r: 0 }, me);
      const t = el('text', { x: x + CELL / 2, y: ROWS * CELL + 24, class: 'coord', 'text-anchor': 'middle' });
      t.textContent = 'abcdefghi'[c];
      this.coordsLayer.append(t);
    }
    for (let r = 0; r < ROWS; r++) {
      const { y } = toScreen({ c: 0, r }, me);
      const t = el('text', { x: -14, y: y + CELL / 2 + 5, class: 'coord', 'text-anchor': 'middle' });
      t.textContent = String(8 - r);
      this.coordsLayer.append(t);
    }
  }

  private renderZones(props: BoardProps): void {
    const cells = this.cellsLayer.querySelectorAll<SVGRectElement>('rect.cell');
    cells.forEach((rect) => {
      const r = Number(rect.dataset.r);
      const zone = setupRows('A').includes(r) ? 'A' : setupRows('B').includes(r) ? 'B' : null;
      rect.classList.toggle('zone-a', zone === 'A');
      rect.classList.toggle('zone-b', zone === 'B');
      rect.classList.toggle('zone-active', props.setupFor !== null && zone === props.setupFor);
      rect.classList.toggle('zone-muted', props.setupFor !== null && zone !== props.setupFor);
    });
  }

  private renderHighlights(props: BoardProps): void {
    this.hlLayer.replaceChildren();
    const { me, state } = props;
    if (props.lastMove) {
      for (const p of [props.lastMove.from, props.lastMove.to]) {
        const { x, y } = toScreen(p, me);
        this.hlLayer.append(el('rect', { x, y, width: CELL, height: CELL, class: 'last' }));
      }
    }
    if (props.selected) {
      const { x, y } = toScreen(props.selected, me);
      this.hlLayer.append(el('rect', { x: x + 3, y: y + 3, width: CELL - 6, height: CELL - 6, rx: 8, class: 'sel' }));
    }
    for (const t of props.targets) {
      const { x, y } = toScreen(t, me);
      const occupied = state.board[t.r][t.c];
      if (occupied) {
        this.hlLayer.append(el('rect', { x: x + 3, y: y + 3, width: CELL - 6, height: CELL - 6, rx: 8, class: 'target', 'data-c': t.c, 'data-r': t.r }));
      } else {
        this.hlLayer.append(el('circle', { cx: x + CELL / 2, cy: y + CELL / 2, r: 11, class: 'dot', 'data-c': t.c, 'data-r': t.r }));
      }
    }
  }

  private renderPieces(props: BoardProps): void {
    const { state, me } = props;
    const clash = props.lastMove?.result ? props.lastMove : null;
    const seen = new Set<string>();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = state.board[r][c];
        if (!piece) continue;
        seen.add(piece.id);
        const { x, y } = toScreen({ c, r }, me);
        let g = this.pieceEls.get(piece.id);
        if (!g) {
          g = el('g', { class: 'piece', 'data-id': piece.id });
          g.style.transform = `translate(${x}px, ${y}px)`;
          this.pieceEls.set(piece.id, g);
          this.piecesLayer.append(g);
        }
        g.style.transform = `translate(${x}px, ${y}px)`;
        g.dataset.c = String(c);
        g.dataset.r = String(r);
        g.classList.remove('gone');
        const mine = piece.team === me;
        const rank = mine ? piece.rank : null;
        const key = `${piece.team}|${rank ?? '-'}|${props.labels ? 1 : 0}`;
        if (g.dataset.key !== key) {
          g.dataset.key = key;
          g.setAttribute('class', `piece team-${piece.team.toLowerCase()} ${mine ? 'mine' : 'theirs'}`);
          g.innerHTML = `<g class="body">${pieceInner(rank, props.labels)}</g>`;
        }
        // Keep the moved piece on top so it slides over neighbours.
        if (props.lastMove && posEq(props.lastMove.to, { c, r })) {
          this.piecesLayer.append(g);
          if (clash && g.dataset.hitPly !== String(state.ply)) {
            g.dataset.hitPly = String(state.ply);
            this.impact(g, clash.to, me);
          }
        }
      }
    }
    for (const [id, g] of this.pieceEls) {
      if (seen.has(id)) continue;
      this.pieceEls.delete(id);
      if (clash) this.breakPiece(g, clash, me);
      else {
        g.classList.add('gone');
        setTimeout(() => g.remove(), 320);
      }
    }
  }

  /** The survivor recoils and a burst flashes on the contested square, timed to the attacker's arrival. */
  private impact(g: SVGGElement, at: Pos, me: Team): void {
    const { x, y } = toScreen(at, me);
    setTimeout(() => {
      const body = g.querySelector('.body');
      body?.classList.remove('hit');
      void (body as SVGGElement | null)?.getBBox?.();
      body?.classList.add('hit');
      const burst = el('circle', { cx: x + CELL / 2, cy: y + CELL / 2, r: 60, class: 'burst' });
      const flash = el('rect', { x: x + 3, y: y + 3, width: CELL - 6, height: CELL - 6, rx: 8, class: 'clash-flash' });
      this.fxLayer.append(flash, burst);
      setTimeout(() => { burst.remove(); flash.remove(); body?.classList.remove('hit'); }, 650);
    }, SLIDE_MS);
  }

  /** A losing piece slides into the fight if it attacked, then shatters into fragments. */
  private breakPiece(g: SVGGElement, clash: MoveRecord, me: Team): void {
    const wasAttacker = Number(g.dataset.c) === clash.from.c && Number(g.dataset.r) === clash.from.r;
    if (wasAttacker) {
      const { x, y } = toScreen(clash.to, me);
      g.style.transform = `translate(${x}px, ${y}px)`;
      this.piecesLayer.append(g);
    }
    g.style.pointerEvents = 'none';
    setTimeout(() => {
      const body = g.querySelector('.body');
      const html = body?.innerHTML ?? '';
      body?.remove();
      SHARDS.forEach((shard, i) => {
        const frag = el('g', { class: 'frag' });
        frag.style.clipPath = `polygon(${shard.poly})`;
        frag.style.setProperty('--dx', `${shard.dx}px`);
        frag.style.setProperty('--dy', `${shard.dy}px`);
        frag.style.setProperty('--rot', `${shard.rot}deg`);
        frag.style.setProperty('--d', `${i * 18}ms`);
        frag.innerHTML = html;
        g.append(frag);
      });
      g.classList.add('shattering');
      setTimeout(() => g.remove(), 950);
    }, SLIDE_MS + 40);
  }
}

const SLIDE_MS = 190;

/** Six shards covering the tile, each thrown away from the centre with a little gravity. */
const SHARDS = [
  { poly: '0% 0%, 55% 0%, 40% 45%, 0% 35%', dx: -34, dy: -30, rot: -28 },
  { poly: '55% 0%, 100% 0%, 100% 40%, 40% 45%', dx: 36, dy: -26, rot: 24 },
  { poly: '0% 35%, 40% 45%, 30% 100%, 0% 100%', dx: -38, dy: 26, rot: -18 },
  { poly: '40% 45%, 100% 40%, 70% 65%', dx: 30, dy: 4, rot: 30 },
  { poly: '40% 45%, 70% 65%, 65% 100%, 30% 100%', dx: 6, dy: 42, rot: -12 },
  { poly: '70% 65%, 100% 40%, 100% 100%, 65% 100%', dx: 40, dy: 34, rot: 20 },
];

export function pieceInner(rank: string | null, label: boolean): string {
  const tile = `<rect class="tile" x="8" y="6" width="84" height="86" rx="10"/>`;
  if (!rank) return `${tile}<use href="#ins-BACK" x="14" y="12" width="72" height="72"/>`;
  const glyphY = label ? 4 : 13;
  const glyph = `<use href="#ins-${rank}" x="14" y="${glyphY}" width="72" height="72"/>`;
  const text = label ? `<text class="lbl" x="50" y="86" text-anchor="middle">${RANK_INFO[rank as keyof typeof RANK_INFO].short}</text>` : '';
  return tile + glyph + text;
}

/** Small standalone piece for trays and lists. */
export function pieceSvg(team: Team, rank: string | null, size = 44, label = false): string {
  return `<svg class="piece piece-static team-${team.toLowerCase()}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">${pieceInner(rank, label)}</svg>`;
}

export { posKey };
