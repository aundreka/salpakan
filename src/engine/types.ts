export type Team = 'A' | 'B';

export type Rank =
  | 'G5' | 'G4' | 'G3' | 'G2' | 'G1'
  | 'COL' | 'LTC' | 'MAJ' | 'CPT' | 'LT1' | 'LT2' | 'SGT' | 'PVT'
  | 'SPY' | 'FLG';

export interface Pos { c: number; r: number }

/** A piece on the board. `rank` is null when this client does not know it (opponent piece). */
export interface Piece { id: string; team: Team; rank: Rank | null }

export type Cell = Piece | null;
/** Indexed as board[r][c]. Row 0 is team B's back row, row 7 is team A's back row. */
export type Board = Cell[][];

export type Phase = 'setup' | 'playing' | 'ended';
export type ChallengeResult = 'attacker' | 'defender' | 'both';
export type EndReason = 'flagCaptured' | 'flagHome' | 'resign' | 'timeout' | 'noMoves';

export interface Rules {
  /** Flag wins the moment it reaches the far row. When false, tournament rule: only if no enemy is adjacent, or it survives one turn. */
  flagInstantWin: boolean;
  /** Seconds per move, 0 for no clock. */
  timerSeconds: number;
}

export interface Move { from: Pos; to: Pos }

export interface MoveRecord {
  ply: number;
  team: Team;
  from: Pos;
  to: Pos;
  result: ChallengeResult | null;
}

export interface Placement { id: string; rank: Rank | null; pos: Pos }

export interface GameState {
  board: Board;
  phase: Phase;
  turn: Team;
  ply: number;
  /** A flag standing on its goal row that must survive the opponent's next move. */
  pendingFlag: { team: Team; pos: Pos } | null;
  winner: Team | null;
  endReason: EndReason | null;
  /** Eliminated pieces in order of elimination. */
  captured: Piece[];
  history: MoveRecord[];
  rules: Rules;
}

export interface MoveOptions {
  /** Both ranks, required when the destination holds an enemy piece. */
  ranks?: { attacker: Rank; defender: Rank };
  /** The mover declares that the piece moved is their flag arriving on the goal row. */
  declareFlag?: boolean;
}
