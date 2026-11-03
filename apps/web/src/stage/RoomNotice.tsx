import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomConnection } from "../net/useRoom";
import { NO_NOTICES, noticeText, trackNotice, type NoticeInput, type NoticeTracker } from "../net/roomNotice";

const NOTICE_MS = 4500;

/**
 * Player phones: a brief notice when host passes to or from you mid-game (at once), or the TV drops or
 * returns mid-game (once that has held for NOTICE_HOLD_MS, so a quick TV reload is silent; see trackNotice).
 * Returns the current notice text (null when none) and a dismiss callback.
 */
export function useRoomNotice(r: RoomConnection): { text: string | null; dismiss(): void } {
  const tracker = useRef<NoticeTracker>(NO_NOTICES);
  const latest = useRef<NoticeInput | null>(null);
  const timer = useRef<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  // Players only: a screen never needs to be told the TV left.
  const youId = r.you?.kind === "player" ? r.you.id : null;

  // Feeds an observation to the tracker and (re)arms the timer for a held TV notice, which re-checks
  // the latest room once the hold ends: a quick TV reload is never told.
  const step = useCallback((input: NoticeInput) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    // Monotonic, so a wall-clock jump can't fire or stall a held notice.
    const now = performance.now();
    const next = trackNotice(tracker.current, input, now);
    tracker.current = next.tracker;
    if (next.notice) {
      // Resolve the text now, against the snapshot that settled it (e.g. the new host's name).
      const text = noticeText(next.notice, input.room);
      setNotice((n) => ({ text, id: (n?.id ?? 0) + 1 }));
    }
    const due = next.tracker.due;
    if (due !== null) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (latest.current) step(latest.current);
      }, Math.max(0, due - now));
    }
  }, []);

  useEffect(() => {
    const input: NoticeInput = { status: r.status, session: r.session, synced: r.synced, room: r.room, youId };
    latest.current = input;
    step(input);
  }, [step, r.status, r.session, r.synced, r.room, youId]);

  // Unmount (leaving or switching rooms): nothing pending may fire afterwards.
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    tracker.current = NO_NOTICES;
    latest.current = null;
  }, []);

  // Stale once we drop or leave the game: hide it rather than let it outlive its context.
  const inGame = r.status === "open" && r.room?.phase === "playing";
  useEffect(() => {
    if (!notice) return;
    if (!inGame) {
      setNotice(null);
      return;
    }
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice, inGame]);

  const dismiss = useCallback(() => setNotice(null), []);
  return { text: notice?.text ?? null, dismiss };
}

/**
 * Always-mounted, visually hidden live region, so screen readers announce the text when it appears.
 * Kept outside the banner stack so the stack still collapses when it has no visible banners.
 */
export function RoomNoticeAnnouncer({ text }: { text: string | null }) {
  return <p className="sr-only" role="status">{text}</p>;
}

/** The visible banner (top banner stack, clear of the host bar and mute toggle); tap to dismiss. */
export function RoomNoticeBanner({ text, onDismiss }: { text: string; onDismiss(): void }) {
  return (
    <div className="banner banner-info room-notice" data-testid="room-notice" onClick={onDismiss}>
      {/* Announced by RoomNoticeAnnouncer; hidden here so it isn't read twice. */}
      <span aria-hidden="true">{text}</span>
      <button type="button" className="room-notice-close" aria-label="Dismiss notice" onClick={onDismiss}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
