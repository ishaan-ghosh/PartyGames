import type { RoomSnapshot } from "@party/shared";
import type { ClientRoomState } from "./roomState";

/**
 * Brief in-game notices a player phone shows when the room changes under it. "host-tv" / "host-player"
 * are for the phone that loses host: the TV reclaimed it, or another player took it.
 */
export type RoomNoticeKind = "tv-lost" | "tv-back" | "host" | "host-tv" | "host-player";

/** Fixed text; "host-player" names the new host (see noticeText) and falls back to this. */
export const NOTICE_TEXT: Record<RoomNoticeKind, string> = {
  "tv-lost": "TV disconnected — playing on phones",
  "tv-back": "TV reconnected",
  host: "You're the host now",
  "host-tv": "The TV is the host again",
  "host-player": "You're no longer the host",
};

/** The text for a notice, resolved against the room it was raised in (names are at most 16 chars). */
export function noticeText(kind: RoomNoticeKind, room: RoomSnapshot | null): string {
  if (kind === "host-player") {
    const name = room?.players.find((p) => p.id === room.hostId)?.name;
    if (name) return `${name} is the host now`;
  }
  return NOTICE_TEXT[kind];
}

/** The last room state seen in the current session; null until a fresh snapshot arrives. */
export interface NoticeBaseline {
  session: number;
  mode: RoomSnapshot["mode"];
  phase: RoomSnapshot["phase"];
  hostId: string | null;
}

export interface NoticeInput extends Pick<ClientRoomState, "status" | "session" | "synced" | "room"> {
  youId: string | null;
}

/**
 * Detects live transitions worth a notice. Only changes observed within one welcomed session count:
 * the first fresh snapshot of every session (initial load, rejoin, reconnect after a drop) just sets
 * the baseline, so a phone never gets a stale "TV disconnected" for something that happened while it
 * was away. Mode changes only matter mid-game (both snapshots "playing"); a host change involving you
 * wins over a mode change in the same snapshot (so the phone the TV reclaims host from hears
 * "The TV is the host again" rather than "TV reconnected"; every other phone gets "TV reconnected").
 */
export function observeRoom(
  prev: NoticeBaseline | null,
  s: NoticeInput,
): { baseline: NoticeBaseline | null; notice: RoomNoticeKind | null } {
  if (s.status !== "open" || !s.synced || !s.room || !s.youId) return { baseline: null, notice: null };
  const { mode, phase, hostId } = s.room;
  const baseline: NoticeBaseline = { session: s.session, mode, phase, hostId };
  if (!prev || prev.session !== s.session) return { baseline, notice: null };

  const midGame = prev.phase === "playing" && phase === "playing";
  let notice: RoomNoticeKind | null = null;
  if (midGame && prev.mode !== mode) notice = mode === "phones" ? "tv-lost" : "tv-back";
  if (midGame && hostId === s.youId && prev.hostId !== s.youId) notice = "host";
  if (midGame && prev.hostId === s.youId && hostId !== null && hostId !== s.youId) {
    notice = s.room.screens.some((x) => x.id === hostId) ? "host-tv" : "host-player";
  }
  return { baseline, notice };
}
