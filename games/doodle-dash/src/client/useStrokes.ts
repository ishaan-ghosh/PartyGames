import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { DoodleView, Stroke, StrokeOp } from "../rules";
import { applyOp } from "./strokes";
import { RESYNC_RETRY_MS, drawerIdle, receiveOp, receiveSync, receiveView, type LiveSeq } from "./sync";

/** What the drawer's pad is doing right now; written by DrawPad, read when a view arrives. */
export interface DrawActivity {
  drawing: boolean;
  pendingPoints: number;
  lastSendAt: number;
}

export type ActivityRef = MutableRefObject<DrawActivity>;

const isOp = (p: unknown): p is StrokeOp =>
  typeof p === "object" && p !== null && typeof (p as StrokeOp).seq === "number" && typeof (p as StrokeOp).op === "string";

/**
 * Local stroke list. Strokes arrive only on the event channel: live ops with increasing `seq`, plus a
 * full "sync" op on (re)join or when asked with `resync`. Views carry just the version and shape, so
 * a gap or mismatch triggers a resync (retried until one lands). The drawer (`ownsCanvas`) keeps its
 * optimistic local list, so in-flight points never flicker away, and only resyncs when idle.
 */
export function useStrokes(
  view: DoodleView,
  onEvent: (cb: (payload: unknown) => void) => () => void,
  ownsCanvas: boolean,
  resync: () => void,
) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // Viewers' ops are applied here synchronously (several can land before React renders), so a
  // following sync compares against the true local list; each render re-reads the state.
  const local = useRef(strokes);
  local.current = strokes;
  // Starts at the mount view's version with an empty list; a view with ink asks for a sync below.
  const live = useRef<LiveSeq>({ seq: view.opSeq, dirty: false });
  const turn = useRef(view.turnKey);
  const owns = useRef(ownsCanvas);
  owns.current = ownsCanvas;
  const activity: ActivityRef = useRef<DrawActivity>({ drawing: false, pendingPoints: 0, lastSendAt: 0 });
  const resyncRef = useRef(resync);
  resyncRef.current = resync;

  const want = useRef(false);
  const lastAsk = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ask = useCallback(() => {
    clearTimeout(timer.current);
    if (!want.current) return;
    const now = Date.now();
    if (now - lastAsk.current >= RESYNC_RETRY_MS) {
      lastAsk.current = now;
      resyncRef.current();
    }
    // Retry until a sync lands (the room throttles and drops requests while not playing).
    timer.current = setTimeout(ask, RESYNC_RETRY_MS);
  }, []);
  const needSync = useCallback(() => {
    want.current = true;
    ask();
  }, [ask]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const idle = () => {
    const a = activity.current;
    return drawerIdle({ drawing: a.drawing, pendingPoints: a.pendingPoints, msSinceLastSend: Date.now() - a.lastSendAt });
  };

  useEffect(() => {
    const r = receiveView(live.current, {
      ownsCanvas,
      turnChanged: turn.current !== view.turnKey,
      viewOpSeq: view.opSeq,
      viewSig: view.strokeSig,
      localStrokes: local.current,
      idle: idle(),
    });
    turn.current = view.turnKey;
    if (r.strokes) {
      local.current = r.strokes;
      setStrokes(r.strokes);
    }
    if (r.resync) needSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ownsCanvas, needSync]);

  useEffect(
    () =>
      onEvent((payload) => {
        if (!isOp(payload)) return;
        if (payload.op === "sync") {
          const next = receiveSync(live.current, payload, { ownsCanvas: owns.current, idle: idle(), localStrokes: local.current });
          // A busy drawer ignores it and re-checks on a later view; either way this request is done.
          want.current = false;
          clearTimeout(timer.current);
          if (next) {
            local.current = next;
            setStrokes(next);
          }
          return;
        }
        const r = receiveOp(live.current, payload);
        if (r.apply) {
          local.current = applyOp(local.current, payload);
          setStrokes(local.current);
        }
        if (r.resync) needSync();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onEvent, needSync],
  );

  return [strokes, setStrokes, activity] as const;
}
