import { useMemo, useState } from "react";

/**
 * On-device touch debugging for the drawer's canvas, off unless the page URL has `?debugdraw=1`.
 * Shows the last pointerdown's numbers and a crosshair where the browser registered it, so a
 * finger/ink offset (seen on iOS Safari) can be read off a real phone. Local only: nothing is sent.
 */
export interface DebugInfo {
  clientX: number;
  clientY: number;
  /** The canvas's bounding rect at the time. */
  rectLeft: number;
  rectTop: number;
  rectW: number;
  rectH: number;
  /** Where the registered point falls inside the canvas cell (crosshair position). */
  cellX: number;
  cellY: number;
  scrollY: number;
  vvTop: number | null;
  vvLeft: number | null;
  vvScale: number | null;
  innerH: number;
}

export function debugDrawEnabled(search: string): boolean {
  return new URLSearchParams(search).get("debugdraw") === "1";
}

export function debugLines(i: DebugInfo): string[] {
  const n = (v: number | null, d = 1) => (v === null ? "–" : v.toFixed(d));
  return [
    `client x ${n(i.clientX)} y ${n(i.clientY)}`,
    `canvas left ${n(i.rectLeft)} top ${n(i.rectTop)} ${n(i.rectW, 0)}×${n(i.rectH, 0)}`,
    `scrollY ${n(i.scrollY)} innerH ${n(i.innerH, 0)}`,
    `vv top ${n(i.vvTop)} left ${n(i.vvLeft)} scale ${n(i.vvScale, 3)}`,
  ];
}

/** `record` takes the pointerdown and the drawer's canvas (the touch may start in the margin around it). */
export function useDebugDraw(): { info: DebugInfo | null; record(e: { clientX: number; clientY: number }, canvas: HTMLCanvasElement): void } | null {
  const enabled = useMemo(() => typeof location !== "undefined" && debugDrawEnabled(location.search), []);
  const [info, setInfo] = useState<DebugInfo | null>(null);
  if (!enabled) return null;
  return {
    info,
    record(e, canvas) {
      const r = canvas.getBoundingClientRect();
      const cell = (canvas.parentElement ?? canvas).getBoundingClientRect();
      const vv = window.visualViewport;
      setInfo({
        clientX: e.clientX,
        clientY: e.clientY,
        rectLeft: r.left,
        rectTop: r.top,
        rectW: r.width,
        rectH: r.height,
        cellX: e.clientX - cell.left,
        cellY: e.clientY - cell.top,
        scrollY: window.scrollY,
        vvTop: vv ? vv.offsetTop : null,
        vvLeft: vv ? vv.offsetLeft : null,
        vvScale: vv ? vv.scale : null,
        innerH: window.innerHeight,
      });
    },
  };
}

export function DebugOverlay({ info }: { info: DebugInfo | null }) {
  return (
    <>
      <pre className="dd-debug" data-testid="debug-draw">{info ? debugLines(info).join("\n") : "debugdraw: tap the canvas"}</pre>
      {info && (
        <span className="dd-debug-cross" aria-hidden style={{ left: info.cellX, top: info.cellY }} />
      )}
    </>
  );
}
