import { describe, expect, it } from "vitest";
import { NEAR_BOTTOM_PX, anchoredScrollTop, hasNewItems, hasOwnNewItem, isNearBottom, pickAnchor } from "./feedScroll";

const box = (scrollTop: number, scrollHeight = 1000, clientHeight = 200) => ({ scrollTop, scrollHeight, clientHeight });

describe("isNearBottom", () => {
  it("is true at the very bottom, and when the content doesn't overflow", () => {
    expect(isNearBottom(box(800))).toBe(true);
    expect(isNearBottom(box(0, 150, 200))).toBe(true);
    expect(isNearBottom(box(0, 200, 200))).toBe(true);
  });

  it("is true whenever nothing overflows, even with a stale scroll position", () => {
    // e.g. the feed was replaced by a short one while the old scrollTop is still reported.
    expect(isNearBottom(box(500, 150, 200), 0)).toBe(true);
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

describe("hasOwnNewItem", () => {
  it("is true when any item newer than the last seen one is from you", () => {
    // A close guess arrives as your chat line plus a private "is close!" item.
    expect(hasOwnNewItem(4, [{ id: 4, playerId: "p2" }, { id: 5, playerId: "p1" }, { id: 6, playerId: "p1" }], "p1")).toBe(true);
    expect(hasOwnNewItem(4, [{ id: 5, playerId: "p1" }, { id: 6, playerId: null }], "p1")).toBe(true);
  });

  it("is false for others' items, already-seen items, or with no identity", () => {
    expect(hasOwnNewItem(4, [{ id: 5, playerId: "p2" }, { id: 6, playerId: null }], "p1")).toBe(false);
    expect(hasOwnNewItem(6, [{ id: 5, playerId: "p1" }, { id: 6, playerId: "p2" }], "p1")).toBe(false);
    expect(hasOwnNewItem(4, [{ id: 5, playerId: null }], null)).toBe(false);
  });

  it("treats everything as new on the first look", () => {
    expect(hasOwnNewItem(null, [{ id: 1, playerId: "p1" }], "p1")).toBe(true);
  });
});

describe("pickAnchor / anchoredScrollTop", () => {
  // Item tops/heights in content coordinates (relative to the top of the scrolled content).
  const rows = (ids: number[], h = 20, start = 0) => ids.map((id, i) => ({ id, top: start + i * h, height: h }));

  it("anchors to the first item still visible at the top of the viewport", () => {
    expect(pickAnchor(rows([1, 2, 3, 4]), 0)).toEqual({ id: 1, offset: 0 });
    expect(pickAnchor(rows([1, 2, 3, 4]), 25)).toEqual({ id: 2, offset: -5 });
    expect(pickAnchor(rows([1, 2, 3, 4]), 40)).toEqual({ id: 3, offset: 0 });
    expect(pickAnchor([], 0)).toBeNull();
  });

  it("keeps the anchored item in place when the top item is trimmed and one is appended", () => {
    const anchor = pickAnchor(rows([1, 2, 3, 4]), 25)!; // item 2, 5px scrolled past its top
    const after = rows([2, 3, 4, 5]); // item 1 trimmed: everything moved up 20px
    expect(anchoredScrollTop(anchor, after)).toBe(5);
  });

  it("keeps the position when items are appended below without trimming", () => {
    const anchor = pickAnchor(rows([1, 2, 3]), 30)!;
    expect(anchoredScrollTop(anchor, rows([1, 2, 3, 4]))).toBe(30);
  });

  it("follows the item when content above it grows (e.g. a taller row)", () => {
    const anchor = pickAnchor(rows([1, 2, 3]), 20)!; // item 2 at the top
    const after = [{ id: 1, top: 0, height: 50 }, { id: 2, top: 50, height: 20 }, { id: 3, top: 70, height: 20 }];
    expect(anchoredScrollTop(anchor, after)).toBe(50);
  });

  it("gives up (null) when the anchored item is gone, e.g. a new turn replaced the feed", () => {
    const anchor = pickAnchor(rows([1, 2, 3]), 0)!;
    expect(anchoredScrollTop(anchor, rows([7, 8, 9]))).toBeNull();
    expect(anchoredScrollTop(null, rows([7, 8, 9]))).toBeNull();
  });

  it("never asks for a negative scroll position", () => {
    expect(anchoredScrollTop({ id: 2, offset: 10 }, rows([2, 3]))).toBe(0);
  });
});
