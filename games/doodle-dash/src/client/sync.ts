import type { Stroke } from "../rules";

/**
 * A drawer only trusts a view received at least this long after its last stroke action: anything
 * sooner may predate actions still in flight (or still queued in the outbox, whose TTL is 2 s).
 */
export const QUIET_MS = 1500;

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
  if (!i.ownsCanvas) return i.viewOpSeq >= i.localSeq;
  // Drawer: resync only when idle and the server's list has a different shape, e.g. after the
  // outbox dropped actions during a reconnect or the server refused ink past its limit.
  if (i.drawing || i.pendingPoints > 0 || i.msSinceLastSend < QUIET_MS) return false;
  return signature(i.viewStrokes) !== signature(i.localStrokes);
}
