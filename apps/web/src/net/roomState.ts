import type { ErrorCode, RoomSnapshot, ServerMsg, You } from "@party/shared";

/**
 * Errors after which the client stops reconnecting. REPLACED is here so two tabs holding the same
 * token don't keep taking the seat back from each other forever.
 */
export const FATAL_ERRORS = new Set<ErrorCode>(["ROOM_NOT_FOUND", "ROOM_FULL", "SCREENS_FULL", "KICKED", "REPLACED"]);

/** Non-fatal errors that, before a welcome, mean our hello was rejected. */
export const JOIN_FAILURES = new Set<ErrorCode>(["NAME_TAKEN", "BAD_MESSAGE"]);

/** What to forget from local storage after a fatal error. REPLACED keeps the token: the other tab is using it. */
export function forgetOnFatalError(
  store: { clearToken(code: string, role: "screen" | "player"): void; clearRoom(code: string): void },
  code: string,
  role: "screen" | "player",
  err: ErrorCode,
): void {
  if (err === "KICKED") store.clearToken(code, role);
  // The room is gone and its code may be reused: forget our seat, role and host key for it.
  if (err === "ROOM_NOT_FOUND") store.clearRoom(code);
}

export interface ClientRoomState {
  status: "connecting" | "open" | "reconnecting" | "closed";
  you: You | null;
  room: RoomSnapshot | null;
  view: unknown | null;
  clockOffset: number;
  error: { code: ErrorCode; message: string } | null;
  /** Counts welcomes: each (re)connect the server accepts starts a new session. */
  session: number;
  /** A room snapshot has arrived since the latest welcome, so `room` is fresh for this session. */
  synced: boolean;
}

export const initialRoomState: ClientRoomState = {
  status: "connecting", you: null, room: null, view: null, clockOffset: 0, error: null, session: 0, synced: false,
};

export function reduceServerMsg(s: ClientRoomState, msg: ServerMsg, localNow: number): ClientRoomState {
  switch (msg.type) {
    case "welcome":
      // "open" means welcomed: only then can host commands be sent (see Outbox.sendNow).
      return {
        ...s,
        you: msg.you,
        error: null,
        status: s.status === "closed" ? "closed" : "open",
        session: s.session + 1,
        synced: false,
      };
    case "room":
      return {
        ...s,
        room: msg.room,
        synced: s.status === "open",
        view: msg.room.phase === "lobby" ? null : s.view,
        clockOffset: msg.now - localNow,
        error: s.error && FATAL_ERRORS.has(s.error.code) ? s.error : null,
      };
    case "view":
      return { ...s, view: msg.payload, clockOffset: msg.now - localNow };
    case "error":
      // Before the welcome, these mean the server rejected our hello (e.g. our token went stale after
      // lobby eviction and our name is now taken). Forget the old seat so the join form comes back.
      if (s.status !== "open" && JOIN_FAILURES.has(msg.code)) {
        return { ...s, you: null, room: null, view: null, error: { code: msg.code, message: msg.message } };
      }
      return {
        ...s,
        error: { code: msg.code, message: msg.message },
        status: FATAL_ERRORS.has(msg.code) ? "closed" : s.status,
      };
    case "event":
      return s;
  }
}
