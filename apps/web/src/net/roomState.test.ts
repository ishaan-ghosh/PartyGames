import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@party/shared";
import { initialRoomState, reduceServerMsg } from "./roomState";

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

  it("clears transient errors on the next room update", () => {
    let s = reduceServerMsg(initialRoomState, { type: "error", code: "NOT_HOST", message: "nope" }, 0);
    expect(s.status).toBe("connecting");
    s = reduceServerMsg(s, { type: "room", room: room("lobby"), now: 0 }, 0);
    expect(s.error).toBeNull();
  });
});
