import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@party/shared";
import { FATAL_ERRORS, forgetOnFatalError, initialRoomState, reduceServerMsg } from "./roomState";

const room = (phase: "lobby" | "playing"): RoomSnapshot => ({
  code: "ABCD", hostId: "a", mode: "phones", phase, gameId: "doodle-dash", settings: {},
  players: [], screens: [], lastResults: null, belowMin: false,
});

describe("reduceServerMsg", () => {
  it("records who we are", () => {
    const s = reduceServerMsg(initialRoomState, { type: "welcome", token: "t", you: { kind: "player", id: "a" } }, 0);
    expect(s.you).toEqual({ kind: "player", id: "a" });
  });

  it("is only open once the server has welcomed this connection", () => {
    const reconnecting = { ...initialRoomState, status: "reconnecting" as const };
    const s = reduceServerMsg(reconnecting, { type: "welcome", token: "t", you: { kind: "player", id: "a" } }, 0);
    expect(s.status).toBe("open");
  });

  it("stays closed if a welcome arrives after a fatal error", () => {
    const closed = { ...initialRoomState, status: "closed" as const };
    const s = reduceServerMsg(closed, { type: "welcome", token: "t", you: { kind: "player", id: "a" } }, 0);
    expect(s.status).toBe("closed");
  });

  it("tracks the server clock offset", () => {
    const s = reduceServerMsg(initialRoomState, { type: "room", room: room("lobby"), now: 10_500 }, 10_000);
    expect(s.clockOffset).toBe(500);
  });

  it("drops the game view when the room returns to the lobby", () => {
    let s = reduceServerMsg(initialRoomState, { type: "view", payload: { x: 1 }, now: 0 }, 0);
    expect(s.view).toEqual({ x: 1 });
    s = reduceServerMsg(s, { type: "room", room: room("lobby"), now: 0 }, 0);
    expect(s.view).toBeNull();
  });

  it("marks fatal errors as closed and keeps them", () => {
    let s = reduceServerMsg(initialRoomState, { type: "error", code: "ROOM_NOT_FOUND", message: "gone" }, 0);
    expect(s.status).toBe("closed");
    s = reduceServerMsg(s, { type: "room", room: room("lobby"), now: 0 }, 0);
    expect(s.error?.code).toBe("ROOM_NOT_FOUND");
  });

  it("treats REPLACED as fatal: closed, and kept across later room updates", () => {
    let s = reduceServerMsg(
      { ...initialRoomState, status: "open" },
      { type: "error", code: "REPLACED", message: "This seat was opened on another tab or device." },
      0,
    );
    expect(FATAL_ERRORS.has("REPLACED")).toBe(true);
    expect(s.status).toBe("closed");
    s = reduceServerMsg(s, { type: "room", room: room("lobby"), now: 0 }, 0);
    expect(s.error?.code).toBe("REPLACED");
    expect(s.status).toBe("closed");
  });

  it("treats a NAME_TAKEN or BAD_MESSAGE before welcome as a failed (re)join: forgets you and room", () => {
    for (const code of ["NAME_TAKEN", "BAD_MESSAGE"] as const) {
      const stale = {
        ...initialRoomState,
        status: "reconnecting" as const,
        you: { kind: "player" as const, id: "a" },
        room: room("lobby"),
        view: { x: 1 },
      };
      const s = reduceServerMsg(stale, { type: "error", code, message: "nope" }, 0);
      expect(s.you).toBeNull();
      expect(s.room).toBeNull();
      expect(s.view).toBeNull();
      expect(s.error).toEqual({ code, message: "nope" });
      expect(s.status).toBe("reconnecting");
    }
  });

  it("keeps you and room for those errors once welcomed", () => {
    const live = { ...initialRoomState, status: "open" as const, you: { kind: "player" as const, id: "a" }, room: room("lobby") };
    const s = reduceServerMsg(live, { type: "error", code: "BAD_MESSAGE", message: "bad" }, 0);
    expect(s.you).toEqual({ kind: "player", id: "a" });
    expect(s.room).not.toBeNull();
  });

  it("clears transient errors on the next room update", () => {
    let s = reduceServerMsg(initialRoomState, { type: "error", code: "NOT_HOST", message: "nope" }, 0);
    expect(s.status).toBe("connecting");
    s = reduceServerMsg(s, { type: "room", room: room("lobby"), now: 0 }, 0);
    expect(s.error).toBeNull();
  });
});

describe("forgetOnFatalError", () => {
  const spyStore = () => {
    const calls: string[] = [];
    return {
      calls,
      clearToken: (code: string, role: string) => void calls.push(`clearToken ${code} ${role}`),
      clearRoom: (code: string) => void calls.push(`clearRoom ${code}`),
    };
  };

  it("keeps the token on REPLACED: the other tab or device is using it", () => {
    const store = spyStore();
    forgetOnFatalError(store, "ABCD", "player", "REPLACED");
    expect(store.calls).toEqual([]);
  });

  it("forgets the seat when kicked", () => {
    const store = spyStore();
    forgetOnFatalError(store, "ABCD", "player", "KICKED");
    expect(store.calls).toEqual(["clearToken ABCD player"]);
  });

  it("forgets the whole room when it's gone", () => {
    const store = spyStore();
    forgetOnFatalError(store, "ABCD", "screen", "ROOM_NOT_FOUND");
    expect(store.calls).toEqual(["clearRoom ABCD"]);
  });
});
