import type { Avatar } from "@party/shared";

export const PALETTE = [
  "#1a1a2e", "#ffffff", "#9ca3af", "#ef4444", "#f97316", "#facc15",
  "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#92400e",
] as const;
/**
 * The drawing's fixed bitmap: widescreen 16:9 on every device (TV, phones), so everyone sees the same
 * picture. Strokes and fills are stored normalised (0–1), so this is client-side resolution only.
 * 960×540 costs about what the old 800×600 did (≈8% more pixels to flood fill and redraw) and stays
 * as sharp on a 1080p TV, where the canvas is ~1260 CSS px wide. doodle.css's --dd-ar must match.
 */
export const CANVAS_W = 960;
export const CANVAS_H = 540;
/** Brush widths in bitmap px: the old 4/10/24 on a 600px-tall canvas, scaled to keep the same size relative to the picture height. */
export const BRUSH_SIZES = [3.6, 9, 21.6] as const;
export const CHOOSE_MS = 15_000;
export const REVEAL_MS = 5_000;
export const DRAWER_GRACE_MS = 10_000;
export const MAX_POINTS_PER_BATCH = 400; // numbers (x,y pairs × 2)
export const INK_LIMIT = 120_000; // numbers per turn (keeps a max-ink view well under 1 MB)
export const STROKE_COST = 10; // extra ink charged per strokeBegin/fill for per-object overhead
/**
 * Flood fills accepted per turn. Every viewer replays every fill on each full redraw (a whole-canvas
 * flood each), so cheap-in-ink fills are capped separately. Undo and clear don't give fills back.
 */
export const MAX_FILLS = 60;
export const FEED_KEEP = 60;
export const VIEW_FEED_LIMIT = 30; // feed items sent to each viewer
export const MIN_CONNECTED = 2; // players needed online to start the next turn

export type Difficulty = "easy" | "medium" | "hard" | "mixed";
export interface DoodleSettings { rounds: number; drawTime: number; difficulty: Difficulty; customWords: string[] }
export interface DoodlePlayer { id: string; name: string; avatar: Avatar }
export type Phase = "choosing" | "drawing" | "reveal" | "over";
export type Audience = "all" | "solvers" | { only: string };
export interface FeedItem {
  id: number;
  kind: "chat" | "correct" | "close" | "system";
  playerId: string | null;
  text: string;
  audience: Audience;
}

export type Stroke =
  | { id: number; tool: "pen" | "eraser"; color: number; size: number; points: number[] }
  | { id: number; tool: "fill"; color: number; x: number; y: number };

/**
 * The stroke channel (room `event`s). `seq` is the stroke version (DoodleState.opSeq): each live op
 * moves it by one. "sync" is the whole list at `seq`, sent only to one connection on (re)join or when
 * it asks with `resync`; views carry just `opSeq` and a shape signature so clients can spot gaps.
 */
export type StrokeOp =
  | { op: "begin"; seq: number; stroke: Stroke }
  | { op: "append"; seq: number; strokeId: number; points: number[] }
  | { op: "undo"; seq: number }
  | { op: "clear"; seq: number }
  | { op: "sync"; seq: number; strokes: Stroke[] };

/**
 * `id` on strokeBegin/strokeAppend is the drawer client's own stroke id (0..2^31-1), not the server's
 * Stroke.id: an append only extends the last stroke if that stroke was begun with the same id, so
 * appends whose begin was lost (e.g. dropped across a reconnect) are refused instead of misattached.
 */
export type StrokeAction =
  | { t: "strokeBegin"; id: number; tool: "pen" | "eraser"; color: number; size: number; points: number[] }
  | { t: "strokeAppend"; id: number; points: number[] }
  | { t: "fill"; color: number; x: number; y: number }
  | { t: "undo" }
  | { t: "clear" };

export type DoodleAction = { t: "choose"; index: number } | { t: "guess"; text: string } | StrokeAction;

export interface DoodleState {
  seed: number;
  settings: DoodleSettings;
  players: DoodlePlayer[]; // fixed at setup, join order
  scores: Record<string, number>;
  connected: Record<string, boolean>;
  round: number; // 1-based
  turnOrder: string[];
  turnIndex: number;
  drawerId: string;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  choices: string[];
  word: string | null;
  revealed: number[]; // indices into word
  hintTimes: number[]; // absolute times of pending hint reveals
  solvers: string[]; // in order of guessing
  turnPoints: Record<string, number>;
  strokes: Stroke[];
  opSeq: number; // stroke version: +1 per accepted stroke op and per turn wipe; clients drop stale ops
  nextStrokeId: number;
  /**
   * The drawer's id (`key`) for the last strokeBegin and the server stroke it created. Appends must
   * name `key` and that stroke must still be last. Missing in states saved before stroke ids: appends
   * are refused until the next begin.
   */
  openStroke: { key: number; strokeId: number } | null;
  ink: number; // numbers received this turn
  /** Fills accepted this turn (see MAX_FILLS). Missing in states saved before the cap: read as 0. */
  fills: number;
  feed: FeedItem[];
  nextFeedId: number;
  usedWords: string[];
  drawerGoneAt: number | null;
  /**
   * True while the game waits in "reveal" for at least MIN_CONNECTED players to be
   * connected before the next turn starts. No timers run while paused.
   */
  paused: boolean;
}
