import { describe, expect, it } from "vitest";
import { splitWords, syncWordsText } from "./settings";

describe("splitWords", () => {
  it("splits on commas and drops blanks", () => {
    expect(splitWords(" cat, , big dog ,")).toEqual(["cat", "big dog"]);
  });
});

describe("syncWordsText", () => {
  const idle = { focused: false, edited: false };

  it("shows the room's words when the user isn't editing", () => {
    expect(syncWordsText("old", ["cat", "dog"], idle)).toBe("cat, dog");
  });

  it("keeps the user's own formatting when it already means the same words", () => {
    expect(syncWordsText("Cat,dog", ["cat", "dog"], idle)).toBe("Cat,dog");
  });

  it("never replaces text while the textarea is focused", () => {
    expect(syncWordsText("half typ", ["cat"], { focused: true, edited: false })).toBe("half typ");
  });

  it("never replaces unsaved edits", () => {
    expect(syncWordsText("unsaved", ["cat"], { focused: false, edited: true })).toBe("unsaved");
  });
});
