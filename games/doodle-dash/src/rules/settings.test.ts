import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettings, wordPool } from "./settings";

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
  it("mixes custom words into the chosen difficulty", () => {
    const pool = wordPool({ ...defaultSettings, difficulty: "easy", customWords: ["Grandma's lasagna", "Apple"] });
    expect(pool).toContain("Grandma's lasagna");
    expect(pool).toContain("apple");
    expect(pool.filter((w) => w.toLowerCase() === "apple")).toHaveLength(1);
    expect(pool).not.toContain("astronaut");
  });
});
