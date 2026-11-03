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

/** True when the scroll box is at or near its bottom (always true when nothing overflows). */
export function isNearBottom(el: ScrollBox, threshold = NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** True when the feed's newest item differs from the one last seen (not just a re-render). */
export function hasNewItems(lastSeenId: number | null, items: readonly { id: number }[]): boolean {
  const newest = items.length ? items[items.length - 1]!.id : null;
  return newest !== null && newest !== lastSeenId;
}
