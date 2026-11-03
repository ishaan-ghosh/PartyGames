import { describe, expect, it } from "vitest";
import { doodleDash } from "./index";
import { defaultSettings, parseSettings, publicSettings, wordPool } from "./settings";

describe("settings", () => {
  it("clamps and cleans input", () => {
    expect(
      parseSettings({ rounds: 99, drawTime: 5, difficulty: "nope", customWords: [" Cat ", "cat", "", "x".repeat(31), 7] }),
    ).toEqual({ rounds: 6, drawTime: 30, difficulty: "mixed", customWords: ["Cat"] });
  });
  it("falls back to defaults for junk", () => {
    expect(parseSettings(null)).toEqual(defaultSettings);
    expect(parseSettings("x")).toEqual(defaultSettings);
  });
  it("keeps the current custom words when an update leaves them out (a form that can't see them)", () => {
    const prev = { ...defaultSettings, customWords: ["kite", "moon"] };
    expect(parseSettings({ rounds: 2, customWordCount: 2 }, prev)).toEqual({ ...defaultSettings, rounds: 2, customWords: ["kite", "moon"] });
    expect(parseSettings({ customWords: [] }, prev).customWords).toEqual([]);
    expect(parseSettings({ rounds: 2 }).customWords).toEqual([]);
  });
  it("adds words to the current list with addCustomWords, deduplicated and capped", () => {
    const prev = { ...defaultSettings, customWords: ["kite"] };
    expect(parseSettings({ addCustomWords: ["Kite", "sun", " "] }, prev).customWords).toEqual(["kite", "sun"]);
    const many = Array.from({ length: 300 }, (_, i) => `w${i}`);
    expect(parseSettings({ addCustomWords: many }, prev).customWords).toHaveLength(200);
  });
  it("shows custom words only to a host on a phone; others get the count", () => {
    const s = { ...defaultSettings, customWords: ["kite", "moon"] };
    expect(publicSettings(s, { isHost: true, kind: "player" })).toEqual(s);
    const hidden = { rounds: s.rounds, drawTime: s.drawTime, difficulty: s.difficulty, customWordCount: 2 };
    expect(publicSettings(s, { isHost: false, kind: "player" })).toEqual(hidden);
    expect(publicSettings(s, { isHost: true, kind: "screen" })).toEqual(hidden); // the TV is in view of everyone
    expect(publicSettings(s, { isHost: false, kind: "screen" })).toEqual(hidden);
    expect(doodleDash.publicSettings).toBe(publicSettings);
  });
  it("mixes custom words into the chosen difficulty", () => {
    const pool = wordPool({ ...defaultSettings, difficulty: "easy", customWords: ["Grandma's lasagna", "Apple"] });
    expect(pool).toContain("Grandma's lasagna");
    expect(pool).toContain("apple");
    expect(pool.filter((w) => w.toLowerCase() === "apple")).toHaveLength(1);
    expect(pool).not.toContain("astronaut");
  });
});
