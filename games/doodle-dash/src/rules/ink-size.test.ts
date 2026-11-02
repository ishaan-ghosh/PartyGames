import { describe, expect, it } from "vitest";
import { parseAction } from "./actions";
import { handleStroke } from "./strokes";
import { drawing } from "./testkit";
import { INK_LIMIT, MAX_POINTS_PER_BATCH, type StrokeAction } from "./types";
import { view } from "./view";

const begin = (points: number[]) => ({ t: "strokeBegin", tool: "pen", color: 0, size: 0, points });

describe("stroke coordinate rounding", () => {
  it("rounds begin, append and fill coordinates to 3 decimals", () => {
    expect(parseAction(begin([0.123456, 0.9996]))).toMatchObject({ points: [0.123, 1] });
    expect(parseAction({ t: "strokeAppend", points: [0.0004, 0.5555555] })).toEqual({
      t: "strokeAppend",
      points: [0, 0.556],
    });
    expect(parseAction({ t: "fill", color: 0, x: 0.123456, y: 0.9996 })).toEqual({ t: "fill", color: 0, x: 0.123, y: 1 });
  });

  it("keeps rounded values inside 0..1", () => {
    const a = parseAction(begin([0, 1, 0.99999999, 0.00000001])) as { points: number[] };
    expect(a.points).toEqual([0, 1, 1, 0]);
  });
});

describe("ink limit", () => {
  it("is 120k numbers per turn", () => {
    expect(INK_LIMIT).toBe(120_000);
  });

  it("rejects a batch that would exceed the limit", () => {
    const s = drawing("banana");
    s.ink = INK_LIMIT - 2;
    const over = handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0.1, 0.1, 0.2, 0.2] });
    expect(over.events).toBeUndefined();
    expect(s.ink).toBe(INK_LIMIT - 2);
    const fits = handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0.1, 0.1] });
    expect(fits.events).toBeDefined();
    expect(s.ink).toBe(INK_LIMIT);
  });

  it("keeps the drawer's full view under 1 MB at the ink limit", () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    const s = drawing("banana");
    let first = true;
    while (s.ink < INK_LIMIT) {
      const n = Math.min(MAX_POINTS_PER_BATCH, INK_LIMIT - s.ink);
      const pts = Array.from({ length: n }, rand);
      const raw = first ? begin(pts) : { t: "strokeAppend", points: pts };
      const action = parseAction(raw) as StrokeAction;
      expect(handleStroke(s, "p1", action).events).toBeDefined();
      first = false;
    }
    expect(s.ink).toBe(INK_LIMIT);
    const bytes = new TextEncoder().encode(JSON.stringify(view(s, { kind: "player", playerId: "p1" }))).length;
    console.log(`max-ink drawer view JSON: ${bytes} bytes`);
    expect(bytes).toBeLessThan(1_000_000);
  });
});
