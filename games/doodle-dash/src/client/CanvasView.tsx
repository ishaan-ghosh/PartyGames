import { useEffect, useRef, type CanvasHTMLAttributes } from "react";
import type { Stroke } from "../rules";
import { CANVAS_H, CANVAS_W, renderStrokes } from "./strokes";

type PointerProps = Pick<
  CanvasHTMLAttributes<HTMLCanvasElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture"
>;

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
  latest.current = strokes;

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const ctx = ref.current?.getContext("2d", { willReadFrequently: true });
      if (ctx) renderStrokes(ctx, latest.current);
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
