import { describe, expect, it } from "vitest";
import { handleGuess } from "./guess";
import { onPresence } from "./presence";
import { drawing } from "./testkit";
import { nextTimerAt, onTimer } from "./turns";

describe("presence", () => {
  it("ends the turn 10s after the drawer disconnects", () => {
    const s = drawing("banana");
    onPresence(s, "p1", false, 5000);
    expect(nextTimerAt(s)).toBe(15_000);
    onTimer(s, 15_000);
    expect(s.phase).toBe("reveal");
  });

  it("keeps the turn if the drawer is back within 10s", () => {
    const s = drawing("banana");
    onPresence(s, "p1", false, 5000);
    onPresence(s, "p1", true, 8000);
    expect(nextTimerAt(s)).toBe(40_000); // first hint
    onTimer(s, 15_000);
    expect(s.phase).toBe("drawing");
  });

  it("ends the turn when the last unsolved guesser leaves", () => {
    const s = drawing("banana");
    handleGuess(s, "p2", "banana", 1000);
    onPresence(s, "p3", false, 2000);
    expect(s.phase).toBe("reveal");
  });

  it("ignores unknown players", () => {
    const s = drawing("banana");
    onPresence(s, "nobody", false, 1000);
    expect(s.connected).not.toHaveProperty("nobody");
    expect(s.phase).toBe("drawing");
  });
});
