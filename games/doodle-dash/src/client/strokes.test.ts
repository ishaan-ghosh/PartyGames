import { describe, expect, it } from "vitest";
import { MAX_FILLS, MAX_POINTS_PER_BATCH, type Stroke } from "../rules";
import {
  MAX_STROKE_KEY,
  applyOp,
  chunkPoints,
  fillBadge,
  fillsRemaining,
  firstStrokeKey,
  floodFillData,
  hexToRgb,
  inBleed,
  nextStrokeKey,
  normalizePoint,
  planRender,
} from "./strokes";

const pen = (id: number, points: number[]): Stroke => ({ id, tool: "pen", color: 0, size: 0, points });

describe("applyOp", () => {
  it("begins, appends, undoes and clears without mutating input", () => {
    const a: Stroke[] = [];
    const b = applyOp(a, { op: "begin", seq: 1, stroke: pen(1, [0, 0]) });
    const c = applyOp(b, { op: "append", seq: 2, strokeId: 1, points: [0.5, 0.5] });
    expect(a).toEqual([]);
    expect(b[0]).toMatchObject({ points: [0, 0] });
    expect(c[0]).toMatchObject({ points: [0, 0, 0.5, 0.5] });
    expect(applyOp(c, { op: "undo", seq: 3 })).toEqual([]);
    expect(applyOp(c, { op: "clear", seq: 3 })).toEqual([]);
  });

  it("ignores appends for a stroke that is not the latest", () => {
    const s = [pen(1, [0, 0]), pen(2, [1, 1])];
    expect(applyOp(s, { op: "append", seq: 3, strokeId: 1, points: [0.5, 0.5] })).toBe(s);
  });

  it("ignores appends onto a fill", () => {
    const s: Stroke[] = [{ id: 1, tool: "fill", color: 0, x: 0.5, y: 0.5 }];
    expect(applyOp(s, { op: "append", seq: 2, strokeId: 1, points: [0.5, 0.5] })).toBe(s);
  });
});

describe("floodFillData", () => {
  it("fills the connected region and stops at walls", () => {
    // 3x3 white image with a black vertical wall in the middle column
    const w = 3, h = 3;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) data.set([0, 0, 0, 255], (y * w + 1) * 4);
    floodFillData(data, w, h, 0, 0, [255, 0, 0]);
    const px = (x: number, y: number) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
    expect(px(0, 2)).toEqual([255, 0, 0]);
    expect(px(1, 1)).toEqual([0, 0, 0]);
    expect(px(2, 0)).toEqual([255, 255, 255]);
  });

  it("does nothing when filling with the same color", () => {
    const data = new Uint8ClampedArray(4).fill(255);
    floodFillData(data, 1, 1, 0, 0, [255, 255, 255]);
    expect(Array.from(data)).toEqual([255, 255, 255, 255]);
  });

  it("ignores a start point outside the image", () => {
    const data = new Uint8ClampedArray(4).fill(255);
    floodFillData(data, 1, 1, 5, -1, [0, 0, 0]);
    expect(Array.from(data)).toEqual([255, 255, 255, 255]);
  });

  it("parses hex colors", () => {
    expect(hexToRgb("#ff8906")).toEqual([255, 137, 6]);
  });
});

describe("inBleed", () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 };

  it("is true on the canvas and in the margin around it", () => {
    expect(inBleed(300, 200, rect, 24)).toBe(true);
    expect(inBleed(90, 200, rect, 24)).toBe(true); // 10px left of the left edge
    expect(inBleed(510, 200, rect, 24)).toBe(true); // 10px right of the right edge
    expect(inBleed(76, 26, rect, 24)).toBe(true); // the corner of the margin
    expect(inBleed(524, 374, rect, 24)).toBe(true);
  });

  it("is false past the margin", () => {
    expect(inBleed(75, 200, rect, 24)).toBe(false);
    expect(inBleed(300, 375, rect, 24)).toBe(false);
    expect(inBleed(300, 25, rect, 24)).toBe(false);
    expect(inBleed(525, 200, rect, 24)).toBe(false);
  });

  it("is false for an empty (hidden) canvas", () => {
    expect(inBleed(0, 0, { left: 0, top: 0, width: 0, height: 0 }, 24)).toBe(false);
  });

  it("pairs with normalizePoint: a margin point maps to the nearest edge", () => {
    expect(inBleed(90, 200, rect, 24) && normalizePoint(90, 200, rect)).toEqual([0, 0.5]);
    expect(inBleed(520, 360, rect, 24) && normalizePoint(520, 360, rect)).toEqual([1, 1]);
  });
});

describe("normalizePoint", () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 };

  it("maps client coordinates into 0–1 on the canvas box", () => {
    expect(normalizePoint(100, 50, rect)).toEqual([0, 0]);
    expect(normalizePoint(300, 200, rect)).toEqual([0.5, 0.5]);
    expect(normalizePoint(500, 350, rect)).toEqual([1, 1]);
  });

  it("clamps points dragged outside the canvas", () => {
    expect(normalizePoint(0, 1000, rect)).toEqual([0, 1]);
    expect(normalizePoint(9999, -20, rect)).toEqual([1, 0]);
  });

  it("returns the origin for a zero-size box instead of NaN", () => {
    expect(normalizePoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual([0, 0]);
  });

  it("rounds to 3 decimals like the server, so the drawer renders what viewers see", () => {
    expect(normalizePoint(1, 2, { left: 0, top: 0, width: 3, height: 3 })).toEqual([0.333, 0.667]);
  });
});

describe("planRender", () => {
  const fill = (id: number): Stroke => ({ id, tool: "fill", color: 3, x: 0.5, y: 0.5 });
  const a = pen(1, [0, 0]);
  const b = fill(2);

  it("draws only new strokes when the list extends the committed prefix, keeping the live stroke as the tail", () => {
    const c = pen(3, [0.1, 0.1]);
    const d = pen(4, [0.2, 0.2]);
    expect(planRender([a], [a, b, c, d])).toEqual({ rebuild: false, commit: [b, c], tail: d });
  });

  it("redraws just the tail when the live stroke grows", () => {
    const live = pen(3, [0, 0]);
    const grown = { ...live, points: [0, 0, 0.5, 0.5] };
    expect(planRender([a, b], [a, b, grown])).toEqual({ rebuild: false, commit: [], tail: grown });
  });

  it("commits a trailing fill instead of treating it as a tail", () => {
    expect(planRender([a], [a, b])).toEqual({ rebuild: false, commit: [b], tail: null });
  });

  it("rebuilds after undo", () => {
    const c = pen(3, [0.1, 0.1]);
    expect(planRender([a, b], [a, c])).toEqual({ rebuild: true, commit: [a], tail: c });
    expect(planRender([a, b], [a])).toEqual({ rebuild: true, commit: [], tail: a });
  });

  it("rebuilds after clear", () => {
    expect(planRender([a, b], [])).toEqual({ rebuild: true, commit: [], tail: null });
  });

  it("rebuilds when an earlier stroke was replaced (resync or new turn)", () => {
    const a2 = { ...a };
    expect(planRender([a, b], [a2, b])).toEqual({ rebuild: true, commit: [a2, b], tail: null });
  });

  it("does nothing new for an identical list", () => {
    const list = [a, b];
    expect(planRender(list, list)).toEqual({ rebuild: false, commit: [], tail: null });
  });
});

describe("chunkPoints", () => {
  it("splits pending points into batches of at most MAX_POINTS_PER_BATCH, keeping x,y pairs", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => (i % 100) / 100);
    const batches = chunkPoints(pts);
    expect(batches.map((b) => b.length)).toEqual([MAX_POINTS_PER_BATCH, MAX_POINTS_PER_BATCH, 200]);
    expect(batches.flat()).toEqual(pts);
    for (const b of batches) expect(b.length % 2).toBe(0);
  });

  it("returns no batches for no points", () => {
    expect(chunkPoints([])).toEqual([]);
  });
});

describe("fillsRemaining", () => {
  it("defaults to the full cap before the server reports a count", () => {
    expect(fillsRemaining(undefined, 0)).toBe(MAX_FILLS);
  });

  it("counts the pad's own fills, since stroke actions bring no new view", () => {
    expect(fillsRemaining(MAX_FILLS, 3)).toBe(MAX_FILLS - 3);
    expect(fillsRemaining(MAX_FILLS - 3, 3)).toBe(MAX_FILLS - 3); // a later view already counts them
  });

  it("trusts the server's lower count, e.g. after the pad remounted mid-turn", () => {
    expect(fillsRemaining(10, 0)).toBe(10);
    expect(fillsRemaining(10, 4)).toBe(10);
  });

  it("never goes below zero", () => {
    expect(fillsRemaining(MAX_FILLS, MAX_FILLS + 2)).toBe(0);
    expect(fillsRemaining(-1, 0)).toBe(0);
    expect(fillsRemaining(0, 0)).toBe(0);
  });
});

describe("stroke keys", () => {
  it("start somewhere random in range, so a reloaded pad is unlikely to reuse its last key", () => {
    expect(firstStrokeKey(() => 0)).toBe(0);
    const k = firstStrokeKey(() => 0.999999);
    expect(Number.isInteger(k) && k >= 0 && k <= MAX_STROKE_KEY).toBe(true);
  });

  it("count up and wrap inside the range the server accepts", () => {
    expect(nextStrokeKey(5)).toBe(6);
    expect(nextStrokeKey(MAX_STROKE_KEY)).toBe(0);
    expect(MAX_STROKE_KEY).toBe(2 ** 31 - 1);
  });
});

describe("fillBadge", () => {
  it("shows the count only when few fills are left", () => {
    expect(fillBadge(MAX_FILLS)).toBeNull();
    expect(fillBadge(11)).toBeNull();
    expect(fillBadge(10)).toBe("10");
    expect(fillBadge(0)).toBe("0");
  });
});
