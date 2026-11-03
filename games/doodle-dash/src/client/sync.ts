import type { Stroke, StrokeOp } from "../rules";
import { applyOp } from "./strokes";

/**
 * A drawer only trusts a view received at least this long after its last stroke action: anything
 * sooner may predate actions still in flight (or still queued in the outbox). Must exceed the
 * outbox's 2 s action TTL, or a view older than a just-flushed action could be adopted.
 */
export const QUIET_MS = 2500;

/**
 * Live ops reach useStrokes synchronously, but a view only after a React render, so ops can arrive
 * before the view they follow. Every received op is buffered (bounded by time and count), including
 * ones rejected as stale, and replayed on top of each adopted view. That makes adopting a view that
 * is behind the local seq safe, whether live ops overtook it or the server restarted from an older save.
 */
export const BUFFER_MS = 5000;
export const BUFFER_MAX = 500;

export interface BufferedOp {
  op: StrokeOp;
  /** Local receive time, ms. */
  at: number;
}

/** Highest op seq applied locally, plus the recently received ops. */
export interface LiveSeq {
  seq: number;
  buffer: BufferedOp[];
}

/**
 * Buffers a live op and reports whether to apply it now: only the next op in sequence applies.
 * Duplicates and stale ops are ignored; an op after a gap waits for the next view to resync.
 */
export function receiveOp(live: LiveSeq, op: StrokeOp, now: number): boolean {
  live.buffer = live.buffer.filter((b) => now - b.at <= BUFFER_MS);
  live.buffer.push({ op, at: now });
  if (live.buffer.length > BUFFER_MAX) live.buffer.splice(0, live.buffer.length - BUFFER_MAX);
  if (op.seq !== live.seq + 1) return false;
  live.seq = op.seq;
  return true;
}

/**
 * The stroke list for an adopted view: its strokes plus buffered ops continuing its seq without gaps
 * (the most recently received op wins if a seq repeats). Sets the local seq to the last one applied.
 */
export function adoptView(live: LiveSeq, viewStrokes: readonly Stroke[], viewOpSeq: number): Stroke[] {
  const bySeq = new Map<number, StrokeOp>();
  for (const b of live.buffer) bySeq.set(b.op.seq, b.op);
  let strokes = [...viewStrokes];
  let seq = viewOpSeq;
  for (let op = bySeq.get(seq + 1); op; op = bySeq.get(seq + 1)) {
    strokes = applyOp(strokes, op);
    seq = op.seq;
  }
  live.seq = seq;
  return strokes;
}

export interface SyncInput {
  /** The local user is the drawer and keeps an optimistic stroke list. */
  ownsCanvas: boolean;
  turnChanged: boolean;
  viewOpSeq: number;
  /** Highest op seq already applied locally (from a view or a live event). */
  localSeq: number;
  viewStrokes: readonly Stroke[];
  localStrokes: readonly Stroke[];
  /** Drawer only: a pointer is down. */
  drawing: boolean;
  /** Drawer only: points buffered but not yet sent. */
  pendingPoints: number;
  /** Drawer only: time since the last stroke action was handed to `send`. */
  msSinceLastSend: number;
}

/** Cheap shape signature: stroke count plus total point numbers. Catches dropped begins and appends. */
function signature(strokes: readonly Stroke[]): string {
  let points = 0;
  for (const s of strokes) points += s.tool === "fill" ? 2 : s.points.length;
  return `${strokes.length}:${points}`;
}

/** Whether to replace the local stroke list with a view's authoritative snapshot. */
export function shouldAdoptView(i: SyncInput): boolean {
  if (i.turnChanged) return true;
  // Viewer: adopt unless the view is at the local seq with the same shape: adopting an identical list
  // would hand the renderer new stroke objects and force a full redraw (fills included). A view behind
  // the local seq is adopted too; adoptView replays the buffered live ops past it.
  if (!i.ownsCanvas) {
    return i.viewOpSeq !== i.localSeq || signature(i.viewStrokes) !== signature(i.localStrokes);
  }
  // The drawer never receives its own ops (they go to the others) and compares shapes, not seqs, so
  // a reset server is picked up by the shape check below once the drawer is idle.
  // Drawer: resync only when idle and the server's list has a different shape, e.g. after the
  // outbox dropped actions during a reconnect or the server refused ink past its limit.
  if (i.drawing || i.pendingPoints > 0 || i.msSinceLastSend < QUIET_MS) return false;
  return signature(i.viewStrokes) !== signature(i.localStrokes);
}
