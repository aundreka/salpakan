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
    this.svg.append(this.cellsLayer, this.hlLayer, this.piecesLayer, this.coordsLayer);
    host.replaceChildren(this.svg);
    this.svg.addEventListener('click', (e) => {
      const hit = (e.target as Element).closest<SVGElement>('[data-c]');
      if (!hit || !this.props) return;
      this.props.onCell({ c: Number(hit.dataset.c), r: Number(hit.dataset.r) });
    });
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
          g.innerHTML = pieceInner(rank, props.labels);
        }
        // Keep the moved piece on top so it slides over neighbours.
        if (props.lastMove && posEq(props.lastMove.to, { c, r })) this.piecesLayer.append(g);
      }
    }
    for (const [id, g] of this.pieceEls) {
      if (seen.has(id)) continue;
      this.pieceEls.delete(id);
      g.classList.add('gone');
      setTimeout(() => g.remove(), 320);
    }
  }
}

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
