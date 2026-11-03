import { describe, expect, it } from "vitest";
import { BRUSH_SIZES, CANVAS_H, CANVAS_W } from "../rules";
import { canvasVars } from "./CanvasView";
import { fillPixel, normalizePoint } from "./strokes";

describe("canvas size", () => {
  it("is widescreen 16:9", () => {
    expect(CANVAS_W / CANVAS_H).toBeCloseTo(16 / 9, 10);
    expect(Number.isInteger(CANVAS_W) && Number.isInteger(CANVAS_H)).toBe(true);
  });

  it("hands doodle.css the same shape the bitmap has", () => {
    const vars = canvasVars as Record<string, string>;
    const aspect = /^(\d+) \/ (\d+)$/.exec(vars["--dd-aspect"] ?? "");
    expect(aspect).not.toBeNull();
    expect(Number(aspect![1]) / Number(aspect![2])).toBe(CANVAS_W / CANVAS_H);
    expect(Number(vars["--dd-ar"])).toBeCloseTo(16 / 9, 4);
  });

  it("keeps brush sizes the same relative to the picture height as the old 4/10/24 px at 600 px tall", () => {
    const old = [4, 10, 24];
    BRUSH_SIZES.forEach((b, i) => expect(b / CANVAS_H).toBeCloseTo(old[i]! / 600, 6));
  });
});

describe("fillPixel", () => {
  it("maps a normalised fill point onto the bitmap", () => {
    expect(fillPixel(0, 0)).toEqual([0, 0]);
    expect(fillPixel(0.5, 0.5)).toEqual([CANVAS_W / 2, CANVAS_H / 2]);
    expect(fillPixel(0.2, 0.68)).toEqual([192, 367]);
  });

  it("keeps the far edge inside the bitmap", () => {
    expect(fillPixel(1, 1)).toEqual([CANVAS_W - 1, CANVAS_H - 1]);
  });

  it("seeds a tap on a 16:9 canvas box at the pixel under the finger", () => {
    // A 640×360 CSS box; a tap 3/4 across and 1/3 down (stored as 0.333, so row 179).
    const [x, y] = normalizePoint(480, 120, { left: 0, top: 0, width: 640, height: 360 });
    expect(fillPixel(x, y)).toEqual([720, 179]);
  });
});
