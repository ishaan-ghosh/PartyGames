import { describe, expect, it } from "vitest";
import { handleStroke } from "./strokes";
import { drawing, start } from "./testkit";
import { onSkip, onTimer } from "./turns";
import { INK_LIMIT } from "./types";
import { view } from "./view";

describe("strokes", () => {
  it("relays drawer strokes to others as ordered ops", () => {
    const s = drawing("banana");
    const r1 = handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 3, size: 1, points: [0.1, 0.1] });
    const r2 = handleStroke(s, "p1", { t: "strokeAppend", points: [0.2, 0.2, 0.3, 0.3] });
    expect(r1.quiet).toBe(true);
    expect(r1.events).toEqual([
      { to: "others", payload: { op: "begin", seq: 1, stroke: { id: 1, tool: "pen", color: 3, size: 1, points: [0.1, 0.1] } } },
    ]);
    expect(r2.events?.[0]?.payload).toEqual({ op: "append", seq: 2, strokeId: 1, points: [0.2, 0.2, 0.3, 0.3] });
    expect(s.strokes[0]).toMatchObject({ points: [0.1, 0.1, 0.2, 0.2, 0.3, 0.3] });
  });

  it("ignores strokes from non-drawers and outside the drawing phase", () => {
    const s = drawing("banana");
    expect(handleStroke(s, "p2", { t: "clear" }).events).toBeUndefined();
    const c = start(3); // choosing
    expect(handleStroke(c, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] }).events).toBeUndefined();
    expect(c.strokes).toEqual([]);
  });

  it("supports fill, undo and clear", () => {
    const s = drawing("banana");
    handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0.5, 0.5] });
    handleStroke(s, "p1", { t: "fill", color: 4, x: 0.1, y: 0.1 });
    expect(s.strokes.map((x) => x.tool)).toEqual(["pen", "fill"]);
    expect(handleStroke(s, "p1", { t: "undo" }).events?.[0]?.payload).toEqual({ op: "undo", seq: 3 });
    expect(s.strokes).toHaveLength(1);
    handleStroke(s, "p1", { t: "clear" });
    expect(s.strokes).toEqual([]);
    expect(handleStroke(s, "p1", { t: "undo" }).events).toBeUndefined(); // nothing to undo
  });

  it("stops accepting ink after the per-turn limit", () => {
    const s = drawing("banana");
    s.ink = INK_LIMIT;
    const r = handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] });
    expect(r.events).toBeUndefined();
    expect(s.strokes).toEqual([]);
  });

  it("clears the canvas and ink for the next turn", () => {
    let s = drawing("banana");
    handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] });
    s = onSkip(s, 1000);
    s = onTimer(s, 6000);
    expect(s.drawerId).toBe("p2");
    expect(s.strokes).toEqual([]);
    expect(s.ink).toBe(0);
  });

  it("includes all strokes in every view so late joiners see the drawing", () => {
    const s = drawing("banana");
    handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] });
    const v = view(s, { kind: "player", playerId: "late" });
    expect(v.strokes).toHaveLength(1);
    expect(v.opSeq).toBe(1);
  });
});
