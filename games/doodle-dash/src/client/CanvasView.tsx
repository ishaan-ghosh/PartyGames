import { useEffect, useRef, type CanvasHTMLAttributes } from "react";
import type { Stroke } from "../rules";
import { CANVAS_H, CANVAS_W, clearCanvas, drawStroke, planRender } from "./strokes";

type PointerProps = Pick<
  CanvasHTMLAttributes<HTMLCanvasElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture"
>;

/** Offscreen copy of every committed stroke, so a new point never re-runs earlier strokes or fills. */
interface Snapshot {
  ctx: CanvasRenderingContext2D;
  strokes: readonly Stroke[];
}

function makeSnapshot(): Snapshot | null {
  const c = document.createElement("canvas");
  c.width = CANVAS_W;
  c.height = CANVAS_H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  clearCanvas(ctx);
  return { ctx, strokes: [] };
}

/** Fixed 800×600 backing store, CSS-scaled, so every device renders identical pixels. */
export function CanvasView({
  strokes,
  testId,
  className = "",
  blockTouch = false,
  label = "Drawing",
  ...pointer
}: {
  strokes: readonly Stroke[];
  testId?: string;
  className?: string;
  /** Stop touches on the canvas from scrolling, zooming or pulling to refresh the page. */
  blockTouch?: boolean;
  label?: string;
} & PointerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(strokes);
  const frame = useRef(0);
  const snap = useRef<Snapshot | null>(null);
  latest.current = strokes;

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const ctx = ref.current?.getContext("2d");
      if (!ctx) return;
      snap.current ??= makeSnapshot();
      const s = snap.current;
      if (!s) return;
      const next = latest.current;
      const plan = planRender(s.strokes, next);
      if (plan.rebuild) clearCanvas(s.ctx);
      for (const st of plan.commit) drawStroke(s.ctx, st);
      s.strokes = plan.tail ? next.slice(0, -1) : next;
      ctx.drawImage(s.ctx.canvas, 0, 0);
      if (plan.tail) drawStroke(ctx, plan.tail);
    });
  }, [strokes]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // touch-action: none (CSS) covers modern browsers; a non-passive touch listener is the
  // fallback for browsers that still scroll or pull-to-refresh. React's touch props are passive.
  useEffect(() => {
    const el = ref.current;
    if (!blockTouch || !el) return;
    const stop = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchstart", stop, { passive: false });
    el.addEventListener("touchmove", stop, { passive: false });
    return () => {
      el.removeEventListener("touchstart", stop);
      el.removeEventListener("touchmove", stop);
    };
  }, [blockTouch]);

  return (
    <canvas
      ref={ref}
      width={CANVAS_W}
      height={CANVAS_H}
      role="img"
      aria-label={label}
      data-testid={testId}
      className={`dd-canvas ${className}`}
      {...pointer}
    />
  );
}
