import { describe, expect, it } from "vitest";
import { doodleDash } from "./index";
import { handleGuess } from "./guess";
import { handleStroke } from "./strokes";
import { drawing, start } from "./testkit";
import { onChoose } from "./turns";
import { INK_LIMIT, MAX_FILLS } from "./types";

const begin = (id = 1) => ({ t: "strokeBegin" as const, id, tool: "pen" as const, color: 0, size: 0, points: [0.5, 0.5] });

/** Refused moves carry a reason code so the room can log them; accepted ones never do. */
describe("refusal reasons", () => {
  it("labels refused strokes", () => {
    expect(handleStroke(start(3), "p1", begin()).rejected).toBe("wrong_phase");
    const s = drawing("banana");
    expect(handleStroke(s, "p2", begin()).rejected).toBe("not_drawer");
    expect(handleStroke(s, "p1", { t: "strokeAppend", id: 9, points: [0, 0] }).rejected).toBe("no_open_stroke");
    expect(handleStroke(s, "p1", { t: "undo" }).rejected).toBe("nothing_to_undo");
    expect(handleStroke(s, "p1", { t: "clear" }).rejected).toBe("nothing_to_clear");
    s.fills = MAX_FILLS;
    expect(handleStroke(s, "p1", { t: "fill", color: 0, x: 0.1, y: 0.1 }).rejected).toBe("fill_limit");
    s.fills = 0;
    s.ink = INK_LIMIT;
    expect(handleStroke(s, "p1", begin()).rejected).toBe("ink_limit");
    expect(handleStroke(s, "p1", { t: "fill", color: 0, x: 0.1, y: 0.1 }).rejected).toBe("ink_limit");
  });

  it("does not label accepted strokes, even though they are quiet", () => {
    const s = drawing("banana");
    const r1 = handleStroke(s, "p1", begin());
    const r2 = handleStroke(s, "p1", { t: "strokeAppend", id: 1, points: [0.6, 0.6] });
    expect(r1.quiet && r2.quiet).toBe(true);
    expect(r1.rejected).toBeUndefined();
    expect(r2.rejected).toBeUndefined();
  });

  it("labels refused guesses and choices", () => {
    const s = drawing("banana");
    expect(handleGuess(s, "p2", "   ", 0).rejected).toBe("empty_guess");
    expect(handleGuess(s, "zz", "banana", 0).rejected).toBe("not_seated");
    expect(handleGuess(s, "p1", "banana", 0).rejected).toBe("drawer_guess");
    expect(handleGuess(s, "p2", "apple", 0).rejected).toBeUndefined();
    expect(onChoose(s, "p1", 0, 0).rejected).toBe("wrong_phase");
    const c = start(3);
    expect(onChoose(c, "p2", 0, 0).rejected).toBe("not_drawer");
    expect(onChoose(c, "p1", 2, 0).rejected).toBeUndefined();
  });

  it("keeps the reason when a refused action also caught up a timer", () => {
    const s = drawing("banana");
    const r = doodleDash.onAction(s, "p2", begin(), s.phaseEndsAt + 1);
    expect(r.quiet).toBe(false); // the turn moved on: the room must rebroadcast
    expect(r.rejected).toBe("wrong_phase");
  });
});
