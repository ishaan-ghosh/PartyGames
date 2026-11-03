import { EMPTY_SIG, strokeSignature, type Stroke, type StrokeOp } from "../rules";

/**
 * A drawer only trusts a view received at least this long after its last stroke action: anything
 * sooner may predate actions still in flight (or still queued in the outbox). Must exceed the
 * outbox's 2 s action TTL, or a view older than a just-flushed action could be adopted.
 */
export const QUIET_MS = 2500;

/**
 * How often a client may ask for (and re-ask for, until one lands) a full stroke sync. Longer than
 * the room's per-member resync throttle (RESYNC_MIN_MS, 1 s), so a retry is never refused.
 */
export const RESYNC_RETRY_MS = 1500;

/**
 * The local stroke version. Views carry no strokes, only the server's version (`opSeq`) and shape
 * (`strokeSig`); the drawing itself arrives as live ops plus a full "sync" op on (re)join or request.
 */
export interface LiveSeq {
  /** Server stroke version the local list is believed to match. */
  seq: number;
  /** The local list may be wrong (a gap or a mismatch was seen): a sync is wanted. */
  dirty: boolean;
}

export interface ViewInput {
  /** The local user is the drawer and keeps an optimistic stroke list. */
  ownsCanvas: boolean;
  turnChanged: boolean;
  viewOpSeq: number;
  viewSig: string;
  localStrokes: readonly Stroke[];
  /** Drawer only: no pointer down, nothing buffered, and the last send is older than QUIET_MS. */
  idle: boolean;
}

/** What to do after a view: a list to show now (or null to keep the local one) and whether to ask for a sync. */
export interface ViewOutcome {
  strokes: Stroke[] | null;
  resync: boolean;
}

export function drawerIdle(a: { drawing: boolean; pendingPoints: number; msSinceLastSend: number }): boolean {
  return !a.drawing && a.pendingPoints === 0 && a.msSinceLastSend >= QUIET_MS;
}

/**
 * Handles a live op (not "sync"). Duplicates and stale ops are ignored. An op after a gap is applied
 * best-effort (so the canvas keeps moving) and marks the list dirty: the caller asks for a sync.
 */
export function receiveOp(live: LiveSeq, op: StrokeOp): { apply: boolean; resync: boolean } {
  if (op.seq <= live.seq) return { apply: false, resync: false };
  const gap = op.seq !== live.seq + 1;
  if (gap) live.dirty = true;
  live.seq = op.seq;
  return { apply: true, resync: gap };
}

/**
 * Handles a "sync" op: the server's whole list at `seq`. Always authoritative for viewers (it also
 * resets the version after a server restart). A busy drawer keeps its optimistic list (the sync may
 * predate its in-flight actions) and re-checks on a later view. Returns the list to show, or null.
 */
export function receiveSync(
  live: LiveSeq,
  op: Extract<StrokeOp, { op: "sync" }>,
  i: { ownsCanvas: boolean; idle: boolean; localStrokes: readonly Stroke[] },
): Stroke[] | null {
  if (i.ownsCanvas && !i.idle) return null;
  const wasDirty = live.dirty;
  live.seq = op.seq;
  live.dirty = false;
  // Same shape and nothing suspected: keep the local objects so the canvas isn't fully redrawn.
  if (!wasDirty && strokeSignature(op.strokes) === strokeSignature(i.localStrokes)) return null;
  return op.strokes;
}

/**
 * Compares a view's stroke version and shape with the local list.
 * - New turn: the canvas starts empty at the view's version (unless the view already shows ink).
 * - Viewer: a view behind the local version was overtaken by live ops (they reach us before React
 *   renders the view) and says nothing. At or ahead of it, the shapes must match; a match ahead of it
 *   fast-forwards the version (e.g. a former drawer, who never receives its own ops).
 * - Drawer: only checked when idle; shape match only.
 */
export function receiveView(live: LiveSeq, i: ViewInput): ViewOutcome {
  if (i.turnChanged) {
    live.seq = i.viewOpSeq;
    live.dirty = i.viewSig !== EMPTY_SIG;
    return { strokes: [], resync: live.dirty };
  }
  if (i.ownsCanvas && !i.idle) return { strokes: null, resync: false };
  if (!i.ownsCanvas && i.viewOpSeq < live.seq) return { strokes: null, resync: live.dirty };
  if (strokeSignature(i.localStrokes) !== i.viewSig) {
    live.dirty = true;
    return { strokes: null, resync: true };
  }
  // A drawer's own list is the reference, so a match settles it. A viewer that saw a gap waits for
  // the sync it asked for: a matching shape doesn't prove the best-effort ops were the right ones.
  if (i.ownsCanvas) live.dirty = false;
  if (!live.dirty) live.seq = Math.max(live.seq, i.viewOpSeq);
  return { strokes: null, resync: live.dirty };
}
