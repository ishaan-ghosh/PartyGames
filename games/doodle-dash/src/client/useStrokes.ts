import { useEffect, useRef, useState } from "react";
import type { DoodleView, Stroke, StrokeOp } from "../rules";
import { applyOp } from "./strokes";

/**
 * Local stroke list. Views are authoritative snapshots; events are live ops with increasing `seq`.
 * The drawer (`ownsCanvas`) keeps its optimistic local list for the current turn instead of
 * replacing it with every view, so in-flight points never flicker away.
 */
export function useStrokes(view: DoodleView, onEvent: (cb: (payload: unknown) => void) => () => void, ownsCanvas: boolean) {
  const [strokes, setStrokes] = useState<Stroke[]>(view.strokes);
  const seq = useRef(view.opSeq);
  const turn = useRef(view.turnKey);

  useEffect(() => {
    if (ownsCanvas && turn.current === view.turnKey) return;
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

  return [strokes, setStrokes] as const;
}
