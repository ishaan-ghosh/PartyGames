import type { Stroke } from "../rules";

/**
 * A drawer only trusts a view received at least this long after its last stroke action: anything
 * sooner may predate actions still in flight (or still queued in the outbox). Must exceed the
 * outbox's 2 s action TTL, or a view older than a just-flushed action could be adopted.
 */
export const QUIET_MS = 2500;

/**
 * Live ops are delivered synchronously, but a view only reaches useStrokes after a React render, so
 * ops sent just after a view can be applied before it. Ops that arrived within this window can explain
 * a view that is behind; anything older can't (a reconnect takes longer than this), so a view behind
 * the local seq without that explanation means the server restarted from an older save.
 */
export const RACE_MS = 1000;

export interface RecentOp {
  seq: number;
  /** Local receive time, ms. */
  at: number;
}

/** Highest op seq applied locally, plus the ops accepted within the last RACE_MS. */
export interface LiveSeq {
  seq: number;
  recent: RecentOp[];
}

/** Whether to apply a live op; records it when accepted. Stale and duplicate ops are dropped. */
export function acceptOp(live: LiveSeq, seq: number, now: number): boolean {
  if (seq <= live.seq) return false;
  live.seq = seq;
  live.recent = live.recent.filter((o) => now - o.at <= RACE_MS);
  live.recent.push({ seq, at: now });
  return true;
}

/** After adopting a view: its op seq becomes the local seq, so the server's next ops are accepted. */
export function resetLive(live: LiveSeq, viewOpSeq: number): void {
  live.seq = viewOpSeq;
  live.recent = [];
}

/** Every op after the view arrived within RACE_MS of `now`, i.e. the view was merely overtaken. */
function overtakenByLiveOps(viewOpSeq: number, localSeq: number, recentOps: readonly RecentOp[], now: number): boolean {
  const seen = new Set(recentOps.filter((o) => now - o.at <= RACE_MS).map((o) => o.seq));
  for (let q = viewOpSeq + 1; q <= localSeq; q++) if (!seen.has(q)) return false;
  return true;
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
  /** Viewer only: live ops accepted within the last RACE_MS (see LiveSeq). */
  recentOps: readonly RecentOp[];
  now: number;
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
  // Viewer: a newer view always wins. At the same op seq, adopt only if the shapes differ: adopting an
  // identical list would hand the renderer new stroke objects and force a full redraw (fills included).
  if (!i.ownsCanvas) {
    if (i.viewOpSeq > i.localSeq) return true;
    if (i.viewOpSeq === i.localSeq) return signature(i.viewStrokes) !== signature(i.localStrokes);
    // Behind: fine if live ops just overtook it; otherwise the server restarted from an older save
    // (stroke actions are never saved) and only adopting it un-freezes the canvas.
    return !overtakenByLiveOps(i.viewOpSeq, i.localSeq, i.recentOps, i.now);
  }
  // The drawer never receives its own ops (they go to the others) and compares shapes, not seqs, so
  // a reset server is picked up by the shape check below once the drawer is idle.
  // Drawer: resync only when idle and the server's list has a different shape, e.g. after the
  // outbox dropped actions during a reconnect or the server refused ink past its limit.
  if (i.drawing || i.pendingPoints > 0 || i.msSinceLastSend < QUIET_MS) return false;
  return signature(i.viewStrokes) !== signature(i.localStrokes);
}
