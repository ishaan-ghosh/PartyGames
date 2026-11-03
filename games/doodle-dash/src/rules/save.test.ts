import { describe, expect, it } from "vitest";
import { handleGuess } from "./guess";
import { doodleDash } from "./index";
import { SAVE_CHUNK, joinSave, splitSave } from "./save";
import { handleStroke } from "./strokes";
import { drawing } from "./testkit";
import { onSkip, onTimer } from "./turns";

function drawn(n: number) {
  const s = drawing("banana", 3, { drawTime: 30 });
  for (let i = 0; i < n; i++) handleStroke(s, "p1", { t: "strokeBegin", id: i, tool: "pen", color: 0, size: 0, points: [0.1, 0.2] });
  return s;
}
const revs = (parts: Record<string, { rev: string }>) => Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, p.rev]));

describe("split saves", () => {
  it("moves strokes into fixed-size chunks and leaves the rest of the state alone", () => {
    const s = drawn(SAVE_CHUNK * 2 + 5);
    const { state, parts } = splitSave(s);
    expect(state.strokes).toEqual([]);
    expect(s.strokes).toHaveLength(SAVE_CHUNK * 2 + 5); // input untouched
    expect(Object.keys(parts)).toEqual(["strokes.0", "strokes.1", "strokes.2"]);
    expect((parts["strokes.2"]!.value as unknown[]).length).toBe(5);
    expect({ ...state, strokes: s.strokes }).toEqual(s);
  });

  it("round-trips through storage-like cloning", () => {
    const s = drawn(70);
    const { state, parts } = structuredClone(splitSave(s));
    const restored = joinSave(state, Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, p.value])));
    expect(restored).toEqual(s);
  });

  it("keeps every rev when a guess changes the state but not the drawing", () => {
    const s = drawn(70);
    const before = revs(splitSave(s).parts);
    handleGuess(s, "p2", "nope", 1);
    expect(revs(splitSave(s).parts)).toEqual(before);
  });

  it("changes only the last chunk's rev while drawing, and drops chunks on undo and clear", () => {
    const s = drawn(70);
    const before = revs(splitSave(s).parts);
    handleStroke(s, "p1", { t: "strokeAppend", id: 69, points: [0.3, 0.3] });
    const after = revs(splitSave(s).parts);
    expect(after["strokes.0"]).toBe(before["strokes.0"]);
    expect(after["strokes.1"]).toBe(before["strokes.1"]);
    expect(after["strokes.2"]).not.toBe(before["strokes.2"]);
    for (let i = 0; i < 6; i++) handleStroke(s, "p1", { t: "undo" });
    expect(Object.keys(splitSave(s).parts)).toEqual(["strokes.0", "strokes.1"]);
    handleStroke(s, "p1", { t: "clear" });
    expect(splitSave(s).parts).toEqual({});
  });

  it("gives a new turn's drawing new revs even where chunk shapes repeat", () => {
    const s = drawn(1);
    const rev = splitSave(s).parts["strokes.0"]!.rev;
    onSkip(s, 1);
    onTimer(s, s.phaseEndsAt);
    s.strokes = [{ id: 1, tool: "pen", color: 0, size: 0, points: [0.1, 0.2] }];
    expect(splitSave(s).parts["strokes.0"]!.rev).not.toBe(rev);
  });

  it("tolerates missing or malformed chunks on restore", () => {
    const s = drawn(40);
    const { state, parts } = structuredClone(splitSave(s));
    const restored = joinSave(state, { "strokes.1": parts["strokes.1"]!.value, "strokes.0": undefined, junk: 5 });
    expect(restored.strokes).toHaveLength(40 - SAVE_CHUNK);
  });

  it("is wired into the game module", () => {
    expect(doodleDash.splitSave).toBe(splitSave);
    expect(doodleDash.joinSave).toBe(joinSave);
  });
});
