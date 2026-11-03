import { describe, expect, it } from "vitest";
import { MIN_SCALE, MIN_SCALE_WITH_LABEL, wordFit } from "./fitWord";

describe("wordFit", () => {
  it("keeps the label and full size when everything fits on one line", () => {
    expect(wordFit(240, 50, 150)).toEqual({ label: true, scale: 1, wrap: false });
    expect(wordFit(240, 50, 190)).toEqual({ label: true, scale: 1, wrap: false });
  });

  it("shrinks the word, keeping the label, while that keeps it reasonably large", () => {
    const fit = wordFit(240, 50, 200);
    expect(fit.label).toBe(true);
    expect(fit.wrap).toBe(false);
    expect(fit.scale).toBeLessThan(1);
    expect(fit.scale).toBeGreaterThanOrEqual(MIN_SCALE_WITH_LABEL);
    expect(50 + 200 * fit.scale).toBeLessThanOrEqual(240);
  });

  it("drops the label before shrinking the word below the labelled minimum", () => {
    const fit = wordFit(240, 50, 300);
    expect(fit.label).toBe(false);
    expect(fit.wrap).toBe(false);
    expect(fit.scale).toBeGreaterThanOrEqual(MIN_SCALE);
    expect(300 * fit.scale).toBeLessThanOrEqual(240);
  });

  it("never grows the word past full size once the label is dropped", () => {
    // Without the label, the word would fit at > 1, but the labelled fit was too small.
    const fit = wordFit(100, 80, 95);
    expect(fit).toEqual({ label: false, scale: 1, wrap: false });
  });

  it("wraps at the smallest size rather than truncating when nothing else fits", () => {
    expect(wordFit(100, 50, 400)).toEqual({ label: false, scale: MIN_SCALE, wrap: true });
  });

  it("leaves the layout alone before it can be measured", () => {
    expect(wordFit(0, 50, 150)).toEqual({ label: true, scale: 1, wrap: false });
    expect(wordFit(240, 50, 0)).toEqual({ label: true, scale: 1, wrap: false });
  });
});
