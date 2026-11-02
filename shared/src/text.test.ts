import { describe, expect, it } from "vitest";
import { isCloseGuess, levenshtein, normalizeGuess } from "./text";

describe("text helpers", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeGuess("  Hot   AIR balloon ")).toBe("hot air balloon");
  });
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });
  it("flags guesses one edit away from words of 4+ letters", () => {
    expect(isCloseGuess("banan", "banana")).toBe(true);
    expect(isCloseGuess("bananas", "banana")).toBe(true);
    expect(isCloseGuess("Banana", "banana")).toBe(false); // exact match is not "close"
    expect(isCloseGuess("car", "cat")).toBe(false); // word too short
    expect(isCloseGuess("apple", "orange")).toBe(false);
  });
});
