import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { DoodleView, Stroke, StrokeOp } from "../rules";
import { applyOp } from "./strokes";
import { shouldAdoptView } from "./sync";

/** What the drawer's pad is doing right now; written by DrawPad, read when a view arrives. */
export interface DrawActivity {
  drawing: boolean;
  pendingPoints: number;
  lastSendAt: number;
}

export type ActivityRef = MutableRefObject<DrawActivity>;

/**
 * Local stroke list. Views are authoritative snapshots; events are live ops with increasing `seq`.
 * The drawer (`ownsCanvas`) keeps its optimistic local list for the current turn, so in-flight points
 * never flicker away, but resyncs to the server's list when it's idle and the two have diverged
 * (see shouldAdoptView). Viewers ignore a view that is older than the live ops they've applied.
 */
export function useStrokes(view: DoodleView, onEvent: (cb: (payload: unknown) => void) => () => void, ownsCanvas: boolean) {
  const [strokes, setStrokes] = useState<Stroke[]>(view.strokes);
  const local = useRef(strokes);
  local.current = strokes;
  const seq = useRef(view.opSeq);
  const turn = useRef(view.turnKey);
  const activity: ActivityRef = useRef<DrawActivity>({ drawing: false, pendingPoints: 0, lastSendAt: 0 });

  useEffect(() => {
    const a = activity.current;
    const adopt = shouldAdoptView({
      ownsCanvas,
      turnChanged: turn.current !== view.turnKey,
      viewOpSeq: view.opSeq,
      localSeq: seq.current,
      viewStrokes: view.strokes,
      localStrokes: local.current,
      drawing: a.drawing,
      pendingPoints: a.pendingPoints,
      msSinceLastSend: Date.now() - a.lastSendAt,
    });
    if (!adopt) return;
    turn.current = view.turnKey;
    seq.current = view.opSeq;
    setStrokes(view.strokes);
  }, [view, ownsCanvas]);

  useEffect(
    () =>
      onEvent((payload) => {
        const op = payload as StrokeOp | null;
        if (typeof op?.seq !== "number" || op.seq <= seq.current) return;
        seq.current = op.seq;
        setStrokes((s) => applyOp(s, op));
      }),
    [onEvent],
  );

  return [strokes, setStrokes, activity] as const;
}
