import type { ErrorCode, RoomSnapshot, ServerMsg, You } from "@party/shared";

export const FATAL_ERRORS = new Set<ErrorCode>(["ROOM_NOT_FOUND", "ROOM_FULL", "SCREENS_FULL", "KICKED"]);

export interface ClientRoomState {
  status: "connecting" | "open" | "reconnecting" | "closed";
  you: You | null;
  room: RoomSnapshot | null;
  view: unknown | null;
  clockOffset: number;
  error: { code: ErrorCode; message: string } | null;
}

export const initialRoomState: ClientRoomState = {
  status: "connecting", you: null, room: null, view: null, clockOffset: 0, error: null,
};

export function reduceServerMsg(s: ClientRoomState, msg: ServerMsg, localNow: number): ClientRoomState {
  switch (msg.type) {
    case "welcome":
      // "open" means welcomed: only then can host commands be sent (see Outbox.sendNow).
      return { ...s, you: msg.you, error: null, status: s.status === "closed" ? "closed" : "open" };
    case "room":
      return {
        ...s,
        room: msg.room,
        view: msg.room.phase === "lobby" ? null : s.view,
        clockOffset: msg.now - localNow,
        error: s.error && FATAL_ERRORS.has(s.error.code) ? s.error : null,
      };
    case "view":
      return { ...s, view: msg.payload, clockOffset: msg.now - localNow };
    case "error":
      return {
        ...s,
        error: { code: msg.code, message: msg.message },
        status: FATAL_ERRORS.has(msg.code) ? "closed" : s.status,
      };
    case "event":
      return s;
  }
}
