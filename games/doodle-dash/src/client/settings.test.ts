import { describe, expect, it } from "vitest";
import { editStateWhen, splitWords, syncWordsText } from "./settings";

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

describe("editStateWhen", () => {
  it("keeps the user's edit flags while the field is enabled", () => {
    const user = { focused: true, edited: true };
    expect(editStateWhen(false, user)).toBe(user);
  });

  it("clears the edit flags once the field is disabled (no blur fires then)", () => {
    expect(editStateWhen(true, { focused: true, edited: true })).toEqual({ focused: false, edited: false });
  });

  it("lets the room's words through after the field is disabled mid-edit", () => {
    const user = editStateWhen(true, { focused: true, edited: true });
    expect(syncWordsText("half typ", ["cat"], user)).toBe("cat");
  });
});
