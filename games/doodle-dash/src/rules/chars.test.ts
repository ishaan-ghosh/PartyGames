import { describe, expect, it } from "vitest";
import { canonical, matchGuess } from "./chars";

// The one guess matcher (shared/ used to carry an unused normalizeGuess/isCloseGuess pair).
describe("matchGuess", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(canonical("  Hot   AIR balloon! ")).toBe("hotairballoon");
    expect(matchGuess("Hot-air  BALLOON", "hot air balloon")).toBe("correct");
  });
  it("flags guesses one edit away from words of 4+ letters as close", () => {
    expect(matchGuess("banan", "banana")).toBe("close");
    expect(matchGuess("bananaa", "banana")).toBe("contains"); // contains the word: never shown to others
    expect(matchGuess("bandna", "banana")).toBe("close");
    expect(matchGuess("Banana", "banana")).toBe("correct"); // exact match is not "close"
    expect(matchGuess("car", "cat")).toBe("miss"); // word too short
    expect(matchGuess("apple", "orange")).toBe("miss");
  });
});
