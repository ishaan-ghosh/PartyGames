import { useLayoutEffect, type RefObject } from "react";
import { CANVAS_H, CANVAS_W } from "../rules";

/**
 * Sideways drawer layout (phones held landscape; see the matching block in doodle.css). The canvas
 * takes the largest 16:9 box it can; everything else lives in a rail on the right, with the full
 * palette and tools in a pull-out panel. Two arrangements, whichever leaves the bigger canvas:
 *
 * - "rail": the canvas fills the full height; the word sits at the top of the rail. Wins on long
 *   screens (e.g. 844×390, 852×340), where a full-height 16:9 canvas leaves a column to spare.
 * - "top": the word (and in phones-only mode the latest guess) sits in a slim strip above the canvas
 *   and the rail shrinks to one button wide. Wins on 16:9 screens (667×375, 568×320), where the
 *   canvas is width-bound and the height has room for a strip anyway.
 */
export type SideMode = "rail" | "top";

export interface SidewaysLayout {
  side: SideMode;
  /** Rail column width, CSS px. */
  rail: number;
  /** The canvas's CSS size in this arrangement. */
  canvasW: number;
  canvasH: number;
}

const AR = CANVAS_W / CANVAS_H;
/** Column gap between canvas and rail (doodle.css: column-gap). */
export const SIDE_GAP = 6;
/** The word strip's height plus the row gap below it (doodle.css: 28px row, 4px row-gap). */
export const WORD_ROW = 32;
/** Narrowest rail that holds the word, round/score/timer and the tool buttons side by side. */
export const RAIL_MIN = 140;
/** Widest rail; past this the canvas is height-bound and spare width just centres it. */
export const RAIL_MAX = 320;
/** The one-button rail of the "top" arrangement: 48px buttons and the 52px timer. */
export const RAIL_SLIM = 60;

function fit(w: number, h: number): [number, number] {
  const cw = Math.max(0, Math.min(w, h * AR));
  return [Math.floor(cw), Math.floor(cw / AR)];
}

/** Layout for a drawer whose content box is `w`×`h` CSS px. */
export function sidewaysLayout(w: number, h: number): SidewaysLayout {
  const railA = Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN, w - SIDE_GAP - h * AR)));
  const [aw, ah] = fit(w - SIDE_GAP - railA, h);
  const [bw, bh] = fit(w - SIDE_GAP - RAIL_SLIM, h - WORD_ROW);
  return aw * ah >= bw * bh
    ? { side: "rail", rail: railA, canvasW: aw, canvasH: ah }
    : { side: "top", rail: RAIL_SLIM, canvasW: bw, canvasH: bh };
}

/** doodle.css's sideways media query; the layout only applies (and is only measured) inside it. */
export const SIDEWAYS_QUERY = "(orientation: landscape) and (max-height: 500px)";
const RAIL_VAR = "--dd-rail";

/**
 * Keeps `data-side` on the drawer element and `--dd-rail` on the document root (the shell's host
 * bar, a sibling of the game view, lines up with the pull-out panel by it) in step with the
 * element's content box. Runs before paint and on every resize, so a rotation never shows a frame
 * of the wrong arrangement.
 */
export function useSidewaysLayout(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const root = document.documentElement;
    const apply = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const l = sidewaysLayout(w, h);
      if (el.dataset.side !== l.side) el.dataset.side = l.side;
      root.style.setProperty(RAIL_VAR, `${l.rail}px`);
    };
    apply();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    ro?.observe(el);
    const mq = typeof matchMedia === "undefined" ? null : matchMedia(SIDEWAYS_QUERY);
    mq?.addEventListener?.("change", apply);
    return () => {
      ro?.disconnect();
      mq?.removeEventListener?.("change", apply);
      root.style.removeProperty(RAIL_VAR);
      delete el.dataset.side;
    };
  }, [ref, active]);
}
