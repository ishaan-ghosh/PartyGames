import { beforeAll, describe, expect, it } from "vitest";
import { parseAction } from "./actions";
import { handleStroke } from "./strokes";
import { drawing } from "./testkit";
import { INK_LIMIT, MAX_POINTS_PER_BATCH, STROKE_COST, type DoodleState, type StrokeAction } from "./types";
import { view } from "./view";

// node:v8 is loaded dynamically because this package's tsconfig has no Node types.
let serialize: (v: unknown) => Uint8Array;
beforeAll(async () => {
  const v8Module = "node:v8";
  ({ serialize } = (await import(/* @vite-ignore */ v8Module)) as { serialize: (v: unknown) => Uint8Array });
});

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

  it("charges a per-stroke cost on strokeBegin and fill but not on append", () => {
    const s = drawing("banana");
    handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0.1, 0.1] });
    expect(s.ink).toBe(2 + STROKE_COST);
    handleStroke(s, "p1", { t: "strokeAppend", points: [0.2, 0.2, 0.3, 0.3] });
    expect(s.ink).toBe(6 + STROKE_COST);
    handleStroke(s, "p1", { t: "fill", color: 0, x: 0.5, y: 0.5 });
    expect(s.ink).toBe(8 + 2 * STROKE_COST);
    handleStroke(s, "p1", { t: "undo" });
    handleStroke(s, "p1", { t: "clear" });
    expect(s.ink).toBe(8 + 2 * STROKE_COST); // no refunds
  });

  it("rejects a batch that would exceed the limit", () => {
    const s = drawing("banana");
    s.ink = INK_LIMIT - STROKE_COST - 2;
    const over = handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0.1, 0.1, 0.2, 0.2] });
    expect(over.events).toBeUndefined();
    expect(s.ink).toBe(INK_LIMIT - STROKE_COST - 2);
    const fits = handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0.1, 0.1] });
    expect(fits.events).toBeDefined();
    expect(s.ink).toBe(INK_LIMIT);
  });

  it("rejects a fill that would exceed the limit", () => {
    const s = drawing("banana");
    s.ink = INK_LIMIT - STROKE_COST - 1;
    expect(handleStroke(s, "p1", { t: "fill", color: 0, x: 0.5, y: 0.5 }).events).toBeUndefined();
    expect(s.strokes).toEqual([]);
  });
});

describe("max-ink message and save size", () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;

  /** Feeds raw actions through parseAction + handleStroke until the drawer is refused. */
  function flood(next: (first: boolean) => unknown): DoodleState {
    const s = drawing("banana");
    for (let first = true; ; first = false) {
      const action = parseAction(next(first)) as StrokeAction;
      expect(action).not.toBeNull();
      if (!handleStroke(s, "p1", action).events) break;
    }
    return s;
  }

  function expectSmall(s: DoodleState) {
    const viewBytes = new TextEncoder().encode(JSON.stringify(view(s, { kind: "player", playerId: "p1" }))).length;
    expect(viewBytes).toBeLessThan(1_000_000);
    // RoomCore.serialize() saves structuredClone(state); the clone's arrays come back holey,
    // which V8 serializes larger than the live packed arrays, so measure the clone like the real save path.
    expect(serialize(structuredClone(s)).length).toBeLessThan(1_800_000);
  }

  it("one long random stroke", () => {
    const s = flood((first) => {
      const pts = Array.from({ length: MAX_POINTS_PER_BATCH }, rand);
      return first ? begin(pts) : { t: "strokeAppend", points: pts };
    });
    expect(s.ink).toBeGreaterThan(INK_LIMIT - MAX_POINTS_PER_BATCH);
    expectSmall(s);
  });

  it("many 2-point dots", () => {
    const s = flood(() => begin([rand(), rand()]));
    expect(s.ink).toBeGreaterThan(INK_LIMIT - STROKE_COST - 2);
    expectSmall(s);
  });

  it("many fills", () => {
    const s = flood(() => ({ t: "fill", color: 3, x: rand(), y: rand() }));
    expect(s.ink).toBeGreaterThan(INK_LIMIT - STROKE_COST - 2);
    expectSmall(s);
  });
});
