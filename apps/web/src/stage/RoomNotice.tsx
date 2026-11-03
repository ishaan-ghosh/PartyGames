import { useEffect, useRef, useState } from "react";
import type { RoomConnection } from "../net/useRoom";
import { NOTICE_TEXT, observeRoom, type NoticeBaseline, type RoomNoticeKind } from "../net/roomNotice";

const NOTICE_MS = 4500;

/**
 * Player phones: a brief, tap-to-dismiss notice when the TV drops or returns mid-game, or host
 * passes to you. Lives in RoomPage's banner stack (top of screen, clear of the host bar and mute
 * toggle). The live region stays mounted so screen readers announce the text when it appears.
 */
export function RoomNotice({ r }: { r: RoomConnection }) {
  const baseline = useRef<NoticeBaseline | null>(null);
  const [notice, setNotice] = useState<{ kind: RoomNoticeKind; id: number } | null>(null);
  const youId = r.you?.id ?? null;

  useEffect(() => {
    const next = observeRoom(baseline.current, { status: r.status, session: r.session, synced: r.synced, room: r.room, youId });
    baseline.current = next.baseline;
    if (next.notice) {
      const kind = next.notice;
      setNotice((n) => ({ kind, id: (n?.id ?? 0) + 1 }));
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

  return (
    <div className="room-notice-live" role="status" aria-live="polite">
      {notice && (
        <div key={notice.id} className="banner banner-info room-notice" data-testid="room-notice" onClick={() => setNotice(null)}>
          <span>{NOTICE_TEXT[notice.kind]}</span>
          <button type="button" className="room-notice-close" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
