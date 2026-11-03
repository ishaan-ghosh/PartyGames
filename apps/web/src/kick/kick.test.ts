import type { PublicPlayer, RoomSnapshot } from "@party/shared";
import { describe, expect, it } from "vitest";
import { isKickable, kickablePlayers, pendingKick } from "./kick";

const p = (id: string, name: string, isHost = false): PublicPlayer => ({
  id, name, isHost, connected: true, avatar: { emoji: "🐙", color: "#ff0000" },
});

function room(hostId: string | null, players: PublicPlayer[]): RoomSnapshot {
  return {
    code: "ABCD", hostId, mode: "screen", phase: "lobby", gameId: "doodle-dash", settings: {},
    players, screens: [{ id: "s1", connected: true, isHost: hostId === "s1" }], lastResults: null, belowMin: false,
  };
}

describe("kickablePlayers", () => {
  it("lets a host screen kick every player", () => {
    const r = room("s1", [p("a", "Ana"), p("b", "Ben")]);
    expect(kickablePlayers(r, "s1").map((x) => x.name)).toEqual(["Ana", "Ben"]);
  });

  it("never lists the host player themself", () => {
    const r = room("a", [p("a", "Ana", true), p("b", "Ben"), p("c", "Cy")]);
    expect(kickablePlayers(r, "a").map((x) => x.name)).toEqual(["Ben", "Cy"]);
  });

  it("gives non-hosts nobody to kick", () => {
    const r = room("a", [p("a", "Ana", true), p("b", "Ben")]);
    expect(kickablePlayers(r, "b")).toEqual([]);
    expect(kickablePlayers(room(null, [p("b", "Ben")]), "b")).toEqual([]);
  });

  it("includes offline players", () => {
    const r = room("s1", [{ ...p("a", "Ana"), connected: false }]);
    expect(kickablePlayers(r, "s1")).toHaveLength(1);
  });
});

describe("isKickable", () => {
  const r = room("a", [p("a", "Ana", true), p("b", "Ben")]);
  it("matches kickablePlayers", () => {
    expect(isKickable(r, "a", "b")).toBe(true);
    expect(isKickable(r, "a", "a")).toBe(false);
    expect(isKickable(r, "b", "a")).toBe(false);
    expect(isKickable(r, "a", "s1")).toBe(false); // screens are never kick targets
    expect(isKickable(r, "a", "gone")).toBe(false);
  });
});

describe("pendingKick", () => {
  const r = room("a", [p("a", "Ana", true), p("b", "Ben")]);
  it("finds a pending kick's target while they're still kickable", () => {
    expect(pendingKick(kickablePlayers(r, "a"), "b")).toEqual({ target: r.players[1], stale: false });
  });
  it("has nothing pending when no kick was asked for", () => {
    expect(pendingKick(kickablePlayers(r, "a"), null)).toEqual({ target: undefined, stale: false });
  });
  it("marks a pending kick stale once the target can't be kicked, so it can't resurrect", () => {
    // The target left, or the viewer stopped being host.
    expect(pendingKick(kickablePlayers(room("a", [p("a", "Ana", true)]), "a"), "b")).toEqual({ target: undefined, stale: true });
    expect(pendingKick(kickablePlayers(r, "b"), "b")).toEqual({ target: undefined, stale: true });
  });
});
