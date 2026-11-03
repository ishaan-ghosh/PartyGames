import { useLayoutEffect, type RefObject } from "react";

/** Smallest word size (of its full size) worth keeping the "Draw:" label for. */
export const MIN_SCALE_WITH_LABEL = 0.8;
/** Smallest word size at all; below this the word wraps instead (never truncated). */
export const MIN_SCALE = 0.55;

export interface WordFit {
  /** Show the visible "Draw:" label (it stays readable by screen readers either way). */
  label: boolean;
  /** Word font size as a fraction of its full size. */
  scale: number;
  /** Last resort: let the word wrap (at MIN_SCALE) rather than cut any of it off. */
  wrap: boolean;
}

const FULL: WordFit = { label: true, scale: 1, wrap: false };
const floor2 = (n: number) => Math.floor(n * 100) / 100;

/**
 * How to keep the drawer's "Draw: <word>" on one line in `avail` px, given the label's and the
 * word's widths at full size. Text width scales with font size, so this is plain arithmetic:
 * shrink the word, then drop the label, then (only for absurdly narrow space) wrap.
 */
export function wordFit(avail: number, labelWidth: number, wordWidth: number): WordFit {
  if (avail <= 0 || wordWidth <= 0 || labelWidth + wordWidth <= avail) return FULL;
  const withLabel = floor2((avail - labelWidth) / wordWidth);
  if (withLabel >= MIN_SCALE_WITH_LABEL) return { label: true, scale: withLabel, wrap: false };
  const alone = Math.min(1, floor2(avail / wordWidth));
  if (alone >= MIN_SCALE) return { label: false, scale: alone, wrap: false };
  return { label: false, scale: MIN_SCALE, wrap: true };
}

/**
 * Fits the secret word line (`.dd-secret`, holding `.dd-secret-label` and `strong`) to its width,
 * via the `--dd-word-scale` custom property and `data-fit` ("nolabel" | "wrap"). Runs before
 * paint and again when the line's width changes (rotation) or web fonts finish loading. The
 * line's height is fixed in CSS, so the fit never moves the canvas. `fitKey` changes whenever
 * the line is (re)mounted with a new word, e.g. the turn key plus the word; null when not shown.
 */
export function useFitWord(ref: RefObject<HTMLElement | null>, fitKey: string | null): void {
  useLayoutEffect(() => {
    const el = ref.current;
    const label = el?.querySelector<HTMLElement>(".dd-secret-label");
    const strong = el?.querySelector<HTMLElement>("strong");
    if (!el || !label || !strong) return;
    let cancelled = false;
    let lastWidth = el.clientWidth;
    const fit = () => {
      if (cancelled) return;
      // Measure at full size, label shown, on one line.
      el.style.removeProperty("--dd-word-scale");
      delete el.dataset.fit;
      const f = wordFit(el.clientWidth, label.getBoundingClientRect().width, strong.getBoundingClientRect().width);
      if (f.scale !== 1) el.style.setProperty("--dd-word-scale", String(f.scale));
      if (f.wrap) el.dataset.fit = "wrap";
      else if (!f.label) el.dataset.fit = "nolabel";
    };
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return; // a height change (e.g. wrapping) needs no refit
      lastWidth = el.clientWidth;
      fit();
    });
    ro?.observe(el);
    void document.fonts?.ready.then(fit);
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [ref, fitKey]);
}
