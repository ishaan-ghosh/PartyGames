import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomConnection } from "../net/useRoom";
import { noticeText, observeRoom, type NoticeBaseline } from "../net/roomNotice";

const NOTICE_MS = 4500;

/**
 * Player phones: a brief notice when the TV drops or returns mid-game, or host passes to or from you.
 * Returns the current notice text (null when none) and a dismiss callback.
 */
export function useRoomNotice(r: RoomConnection): { text: string | null; dismiss(): void } {
  const baseline = useRef<NoticeBaseline | null>(null);
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  // Players only: a screen never needs to be told the TV left.
  const youId = r.you?.kind === "player" ? r.you.id : null;

  useEffect(() => {
    const next = observeRoom(baseline.current, { status: r.status, session: r.session, synced: r.synced, room: r.room, youId });
    baseline.current = next.baseline;
    if (next.notice) {
      // Resolve the text now, against the snapshot that raised it (e.g. the new host's name).
      const text = noticeText(next.notice, r.room);
      setNotice((n) => ({ text, id: (n?.id ?? 0) + 1 }));
    }
  }, [r.status, r.session, r.synced, r.room, youId]);

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
