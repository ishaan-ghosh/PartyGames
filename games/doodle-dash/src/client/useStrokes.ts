import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { DoodleView, Stroke, StrokeOp } from "../rules";
import { applyOp } from "./strokes";
import { adoptView, receiveOp, shouldAdoptView, type LiveSeq } from "./sync";

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
 * (see shouldAdoptView). Viewers adopt views and replay the buffered live ops past them (see adoptView).
 */
export function useStrokes(view: DoodleView, onEvent: (cb: (payload: unknown) => void) => () => void, ownsCanvas: boolean) {
  const [strokes, setStrokes] = useState<Stroke[]>(view.strokes);
  const local = useRef(strokes);
  local.current = strokes;
  const live = useRef<LiveSeq>({ seq: view.opSeq, buffer: [] });
  const turn = useRef(view.turnKey);
  const activity: ActivityRef = useRef<DrawActivity>({ drawing: false, pendingPoints: 0, lastSendAt: 0 });

  useEffect(() => {
    const a = activity.current;
    const adopt = shouldAdoptView({
      ownsCanvas,
      turnChanged: turn.current !== view.turnKey,
      viewOpSeq: view.opSeq,
      localSeq: live.current.seq,
      viewStrokes: view.strokes,
      localStrokes: local.current,
      drawing: a.drawing,
      pendingPoints: a.pendingPoints,
      msSinceLastSend: Date.now() - a.lastSendAt,
    });
    if (!adopt) return;
    turn.current = view.turnKey;
    setStrokes(adoptView(live.current, view.strokes, view.opSeq));
  }, [view, ownsCanvas]);

  useEffect(
    () =>
      onEvent((payload) => {
        const op = payload as StrokeOp | null;
        if (typeof op?.seq !== "number" || !receiveOp(live.current, op, Date.now())) return;
        setStrokes((s) => applyOp(s, op));
      }),
    [onEvent],
  );

  return [strokes, setStrokes, activity] as const;
}
