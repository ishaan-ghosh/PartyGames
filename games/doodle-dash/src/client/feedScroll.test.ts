import { describe, expect, it } from "vitest";
import { NEAR_BOTTOM_PX, hasNewItems, isNearBottom } from "./feedScroll";

const box = (scrollTop: number, scrollHeight = 1000, clientHeight = 200) => ({ scrollTop, scrollHeight, clientHeight });

describe("isNearBottom", () => {
  it("is true at the very bottom, and when the content doesn't overflow", () => {
    expect(isNearBottom(box(800))).toBe(true);
    expect(isNearBottom(box(0, 150, 200))).toBe(true);
  });

  it("tolerates fractional scroll positions and a little slack", () => {
    expect(isNearBottom(box(799.5))).toBe(true);
    expect(isNearBottom(box(800 - NEAR_BOTTOM_PX))).toBe(true);
  });

  it("is false once the user has scrolled up past the threshold", () => {
    expect(isNearBottom(box(800 - NEAR_BOTTOM_PX - 1))).toBe(false);
    expect(isNearBottom(box(0))).toBe(false);
  });

  it("keeps the threshold small: a line or so, not a page", () => {
    expect(NEAR_BOTTOM_PX).toBeGreaterThanOrEqual(24);
    expect(NEAR_BOTTOM_PX).toBeLessThanOrEqual(40);
  });
});

describe("hasNewItems", () => {
  it("is true when the newest item changed", () => {
    expect(hasNewItems(3, [{ id: 2 }, { id: 3 }, { id: 4 }])).toBe(true);
    expect(hasNewItems(null, [{ id: 1 }])).toBe(true);
  });

  it("is false for a re-render with the same items, or an empty feed", () => {
    expect(hasNewItems(4, [{ id: 3 }, { id: 4 }])).toBe(false);
    expect(hasNewItems(null, [])).toBe(false);
    expect(hasNewItems(4, [])).toBe(false);
  });
});
