import type { RoomSnapshot } from "@party/shared";
import type { ClientRoomState } from "./roomState";

/** Brief in-game notices a player phone shows when the room changes under it. */
export type RoomNoticeKind = "tv-lost" | "tv-back" | "host";

export const NOTICE_TEXT: Record<RoomNoticeKind, string> = {
  "tv-lost": "TV disconnected — playing on phones",
  "tv-back": "TV reconnected",
  host: "You're the host now",
};

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
 * was away. Mode changes only matter mid-game (both snapshots "playing"); host wins if both change.
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
  return { baseline, notice };
}
