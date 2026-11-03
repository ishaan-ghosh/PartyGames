import { describe, expect, it } from "vitest";
import { handleStroke } from "./strokes";
import { drawing, start } from "./testkit";
import { onChoose, onSkip, onTimer } from "./turns";
import { INK_LIMIT, MAX_FILLS } from "./types";
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

describe("fill cap", () => {
  const fill = { t: "fill", color: 4, x: 0.5, y: 0.5 } as const;

  it("is 60 fills per turn", () => {
    expect(MAX_FILLS).toBe(60);
  });

  it("rejects fills past the cap without an op or seq bump", () => {
    const s = drawing("banana");
    for (let i = 0; i < MAX_FILLS; i++) expect(handleStroke(s, "p1", fill).events).toBeDefined();
    const seq = s.opSeq;
    const ink = s.ink;
    const r = handleStroke(s, "p1", fill);
    expect(r.events).toBeUndefined();
    expect(s.opSeq).toBe(seq);
    expect(s.ink).toBe(ink);
    expect(s.strokes).toHaveLength(MAX_FILLS);
    // Pen strokes are still accepted.
    expect(handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] }).events).toBeDefined();
  });

  it("does not refund fills on undo or clear", () => {
    const s = drawing("banana");
    for (let i = 0; i < MAX_FILLS; i++) handleStroke(s, "p1", fill);
    handleStroke(s, "p1", { t: "undo" });
    expect(handleStroke(s, "p1", fill).events).toBeUndefined();
    handleStroke(s, "p1", { t: "clear" });
    expect(handleStroke(s, "p1", fill).events).toBeUndefined();
  });

  it("resets the count for the next turn", () => {
    let s = drawing("banana");
    for (let i = 0; i < MAX_FILLS; i++) handleStroke(s, "p1", fill);
    s = onSkip(s, 1000);
    s = onTimer(s, 6000);
    expect(s.drawerId).toBe("p2");
    onChoose(s, "p2", 0, 6000);
    expect(view(s, { kind: "player", playerId: "p2" }).fillsLeft).toBe(MAX_FILLS);
    expect(handleStroke(s, "p2", fill).events).toBeDefined();
  });

  it("shows the fills left only to the drawer while drawing", () => {
    const s = drawing("banana");
    handleStroke(s, "p1", fill);
    handleStroke(s, "p1", fill);
    expect(view(s, { kind: "player", playerId: "p1" }).fillsLeft).toBe(MAX_FILLS - 2);
    expect(view(s, { kind: "player", playerId: "p2" }).fillsLeft).toBeUndefined();
    expect(view(s, { kind: "screen" }).fillsLeft).toBeUndefined();
    expect(view(start(3), { kind: "player", playerId: "p1" }).fillsLeft).toBeUndefined(); // choosing
  });

  it("treats a saved state without a fill count as no fills yet", () => {
    const s = drawing("banana");
    delete (s as Partial<typeof s>).fills;
    expect(handleStroke(s, "p1", fill).events).toBeDefined();
    expect(view(s, { kind: "player", playerId: "p1" }).fillsLeft).toBe(MAX_FILLS - 1);
  });
});
