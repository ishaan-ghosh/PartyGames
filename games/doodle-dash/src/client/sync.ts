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
 * before the view they follow. Received ops are buffered (bounded by time and count), including ones
 * rejected as stale, and the recent ones are replayed on top of each adopted view. That makes adopting
 * a view behind the local seq safe, whether live ops overtook it or the server restarted.
 */
export const BUFFER_MS = 5000;
export const BUFFER_MAX = 500;
/**
 * Only ops received this recently are replayed. The render race lasts milliseconds, while a reconnect
 * to a restarted server takes at least PartySocket's 3 s minimum delay, so pre-restart ops (ghosts on
 * the restored view) are never replayed.
 */
export const REPLAY_MS = 1000;

export interface BufferedOp {
  op: StrokeOp;
  /** Local receive time, ms. */
  at: number;
}

/** Highest op seq applied locally, the recently received ops, and whether an op was applied after a gap. */
export interface LiveSeq {
  seq: number;
  buffer: BufferedOp[];
  /** The local list may be wrong (an op was applied after a gap): adopt the next view regardless. */
  dirty: boolean;
}

/**
 * Buffers a live op and reports whether to apply it. Duplicates and stale ops are ignored. An op after
 * a gap (e.g. ops missed before subscribing) is applied best-effort and marks the list dirty, so the
 * canvas keeps moving and the next view resyncs it.
 */
export function receiveOp(live: LiveSeq, op: StrokeOp, now: number): boolean {
  live.buffer = live.buffer.filter((b) => now - b.at <= BUFFER_MS);
  live.buffer.push({ op, at: now });
  if (live.buffer.length > BUFFER_MAX) live.buffer.splice(0, live.buffer.length - BUFFER_MAX);
  if (op.seq <= live.seq) return false;
  if (op.seq !== live.seq + 1) live.dirty = true;
  live.seq = op.seq;
  return true;
}

/** A view's strokes plus the recent buffered ops continuing its seq without gaps (latest op wins per seq). */
function replay(live: LiveSeq, viewStrokes: readonly Stroke[], viewOpSeq: number, now: number): { strokes: Stroke[]; seq: number } {
  const bySeq = new Map<number, StrokeOp>();
  for (const b of live.buffer) if (now - b.at <= REPLAY_MS) bySeq.set(b.op.seq, b.op);
  let strokes = [...viewStrokes];
  let seq = viewOpSeq;
  for (let op = bySeq.get(seq + 1); op; op = bySeq.get(seq + 1)) {
    strokes = applyOp(strokes, op);
    seq = op.seq;
  }
  return { strokes, seq };
}

/** Adopts a view: returns its strokes plus replayed ops, and sets the local seq to the last one applied. */
export function adoptView(live: LiveSeq, viewStrokes: readonly Stroke[], viewOpSeq: number, now: number): Stroke[] {
  const r = replay(live, viewStrokes, viewOpSeq, now);
  live.seq = r.seq;
  live.dirty = false;
  return r.strokes;
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

/**
 * Handles an incoming view: the stroke list to set, or null to keep the local one. A dirty list always
 * adopts. A viewer keeps its list when the replayed result matches it (same seq and shape), so a view
 * merely overtaken by live ops doesn't hand the renderer new objects and force a full redraw.
 */
export function syncView(live: LiveSeq, i: SyncInput, now: number): Stroke[] | null {
  if (live.dirty) return adoptView(live, i.viewStrokes, i.viewOpSeq, now);
  if (!shouldAdoptView(i)) return null;
  if (!i.ownsCanvas && !i.turnChanged) {
    const r = replay(live, i.viewStrokes, i.viewOpSeq, now);
    if (r.seq === i.localSeq && signature(r.strokes) === signature(i.localStrokes)) return null;
  }
  return adoptView(live, i.viewStrokes, i.viewOpSeq, now);
}
