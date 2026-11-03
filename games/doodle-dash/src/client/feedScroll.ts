/**
 * Stick-to-bottom for the guess feed: it follows the newest item only while the reader is at (or
 * within a line of) the bottom; once they scroll up to read, new items leave their position alone.
 */

/** How far from the bottom (px) still counts as "at the bottom": about one feed line. */
export const NEAR_BOTTOM_PX = 32;

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** True when the scroll box is at or near its bottom, and always when nothing overflows. */
export function isNearBottom(el: ScrollBox, threshold = NEAR_BOTTOM_PX): boolean {
  if (el.scrollHeight <= el.clientHeight) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** True when the feed's newest item differs from the one last seen (not just a re-render). */
export function hasNewItems(lastSeenId: number | null, items: readonly { id: number }[]): boolean {
  const newest = items.length ? items[items.length - 1]!.id : null;
  return newest !== null && newest !== lastSeenId;
}

/**
 * True when an item newer than the last seen one is the viewer's own (their guess, its private
 * "is close!" note, their "guessed it!"): they should see it even if they had scrolled up.
 * Feed ids only grow, so "newer" is id > lastSeenId.
 */
export function hasOwnNewItem(
  lastSeenId: number | null,
  items: readonly { id: number; playerId: string | null }[],
  youId: string | null,
): boolean {
  if (!youId) return false;
  return items.some((f) => (lastSeenId === null || f.id > lastSeenId) && f.playerId === youId);
}

/** An item's box in content coordinates (0 = top of the scrolled content). */
export interface ItemBox {
  id: number;
  top: number;
  height: number;
}

/** The first item visible at the top of the viewport, and where its top sits relative to it. */
export interface ScrollAnchor {
  id: number;
  offset: number;
}

/**
 * Picks the item that keeps a scrolled-up reader's place: the first one whose bottom is below the
 * viewport top. `offset` is its top minus scrollTop (negative when partly scrolled past).
 */
export function pickAnchor(items: readonly ItemBox[], scrollTop: number): ScrollAnchor | null {
  const first = items.find((b) => b.top + b.height > scrollTop) ?? items[items.length - 1];
  return first ? { id: first.id, offset: first.top - scrollTop } : null;
}

/**
 * The scrollTop that puts the anchored item back where it was after the content changed (e.g. the
 * oldest item was trimmed off the top). Null when the item is gone, so the caller leaves it be.
 * Done by hand because iOS Safari has no CSS scroll anchoring.
 */
export function anchoredScrollTop(anchor: ScrollAnchor | null, items: readonly ItemBox[]): number | null {
  if (!anchor) return null;
  const b = items.find((x) => x.id === anchor.id);
  return b ? Math.max(0, b.top - anchor.offset) : null;
}
