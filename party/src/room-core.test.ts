import { describe, expect, it } from "vitest";
import type { GameModule, ServerMsg } from "@party/shared";
import { RoomCore, type CoreDeps, type Outbox } from "./room-core";

interface CState { count: number; target: number; endsAt: number | null; players: string[]; names: Record<string, string>; presence: Record<string, boolean> }
type CAction = { t: "inc" } | { t: "ping" };

/** Tiny fake game so room behavior is tested independently of Doodle Dash. */
const counter: GameModule<CState, CAction, { target: number }> = {
  id: "counter",
  meta: { name: "Counter", tagline: "test game", minPlayers: 2, maxPlayers: 12, accent: "#ffffff" },
  defaultSettings: { target: 3 },
  parseSettings: (input) => {
    const t = (input as { target?: unknown } | null)?.target;
    return { target: typeof t === "number" ? t : 3 };
  },
  parseAction: (input) => {
    const t = (input as { t?: unknown } | null)?.t;
    return t === "inc" || t === "ping" ? { t } : null;
  },
  setup: (players, settings, _seed, now) => ({
    count: 0,
    target: settings.target,
    endsAt: now + 1000,
    players: players.map((p) => p.id),
    names: Object.fromEntries(players.map((p) => [p.id, p.name])),
    presence: {},
  }),
  onAction: (s, _id, a) =>
    a.t === "ping" ? { state: s, quiet: true, events: [{ to: "others", payload: "pong" }] } : { state: { ...s, count: s.count + 1 } },
  onTimer: (s, now) => (s.endsAt !== null && now >= s.endsAt ? { ...s, count: s.count + 1, endsAt: null } : s),
  nextTimerAt: (s) => s.endsAt,
  onPresence: (s, id, connected) => ({ ...s, presence: { ...s.presence, [id]: connected } }),
  onSkip: (s) => ({ ...s, count: s.target }),
  view: (s, v) => ({ count: s.count, viewer: v.kind === "screen" ? "screen" : v.playerId }),
  isOver: (s) => s.count >= s.target,
  results: (s) => s.players.map((id) => ({ playerId: id, name: s.names[id] ?? "?", score: s.count })),
};

function setup(opts: { created?: boolean } = {}) {
  const sent: { to: string; msg: ServerMsg }[] = [];
  const closed: string[] = [];
  /** Sends and closes in the order they happened, e.g. "send:c1:error" / "close:c1". */
  const log: string[] = [];
  let n = 0;
  const deps: CoreDeps = { newId: () => `id${++n}`, newSeed: () => 7, games: { counter }, defaultGameId: "counter" };
  const out: Outbox = {
    send: (to, msg) => {
      sent.push({ to, msg });
      log.push(`send:${to}:${msg.type}`);
    },
    close: (c) => {
      closed.push(c);
      log.push(`close:${c}`);
    },
  };
  const core = new RoomCore("ABCD", deps, out);
  if (opts.created !== false) core.create("HOSTKEY", 0);
  const msgs = (to: string, type?: ServerMsg["type"]) =>
    sent.filter((s) => s.to === to && (!type || s.msg.type === type)).map((s) => s.msg);
  const last = <T extends ServerMsg["type"]>(to: string, type: T) =>
    msgs(to, type).at(-1) as Extract<ServerMsg, { type: T }> | undefined;
  const id = (conn: string) => last(conn, "welcome")!.you.id;
  const player = (conn: string, name: string, extra: Record<string, unknown> = {}, now = 0) =>
    core.message(conn, { type: "hello", role: "player", name, ...extra }, now);
  const screen = (conn: string, extra: Record<string, unknown> = {}, now = 0) =>
    core.message(conn, { type: "hello", role: "screen", ...extra }, now);
  const host = (conn: string, cmd: object, now = 0) => core.message(conn, { type: "host", cmd }, now);
  return { core, sent, closed, log, msgs, last, id, player, screen, host, deps };
}

/** Screen s1 is host (has the host key); Ana (c1) and Ben (c2) are in the lobby. */
function lobby() {
  const h = setup();
  h.screen("s1", { hostKey: "HOSTKEY" });
  h.player("c1", "Ana");
  h.player("c2", "Ben");
  return h;
}

function started() {
  const h = lobby();
  h.host("s1", { cmd: "start" }, 0);
  return h;
}

describe("RoomCore: joining", () => {
  it("rejects hellos for a room that was never created", () => {
    const h = setup({ created: false });
    h.player("c1", "Ana");
    expect(h.last("c1", "error")?.code).toBe("ROOM_NOT_FOUND");
    expect(h.closed).toEqual(["c1"]);
  });

  it("welcomes a player and makes the creator host", () => {
    const h = setup();
    expect(h.player("c1", "Ana", { hostKey: "HOSTKEY" })).toEqual({ persist: true });
    const w = h.last("c1", "welcome")!;
    expect(w.you.kind).toBe("player");
    const room = h.last("c1", "room")!.room;
    expect(room.hostId).toBe(w.you.id);
    expect(room.mode).toBe("phones");
    expect(room.players.map((p) => p.name)).toEqual(["Ana"]);
  });

  it("makes the first device host when nobody presents the host key", () => {
    const h = setup();
    h.player("c1", "Ana");
    h.player("c2", "Ben");
    expect(h.last("c2", "room")!.room.hostId).toBe(h.id("c1"));
  });

  it("switches between screen and phones mode as screens come and go", () => {
    const h = setup();
    h.player("c1", "Ana");
    h.screen("s1");
    expect(h.last("s1", "welcome")!.you.kind).toBe("screen");
    expect(h.last("c1", "room")!.room.mode).toBe("screen");
    h.core.disconnect("s1", 10);
    expect(h.last("c1", "room")!.room.mode).toBe("phones");
  });

  it("rejects duplicate names regardless of case or spacing", () => {
    const h = setup();
    h.player("c1", "Ana");
    h.player("c2", "  ana ");
    expect(h.last("c2", "error")?.code).toBe("NAME_TAKEN");
    expect(h.closed).not.toContain("c2");
    expect(h.last("c1", "room")!.room.players).toHaveLength(1);
  });

  it("requires a name for new players", () => {
    const h = setup();
    h.player("c1", "   ");
    expect(h.last("c1", "error")?.code).toBe("BAD_MESSAGE");
  });

  it("caps players at 12 and screens at 4", () => {
    const h = setup();
    for (let i = 0; i < 12; i++) h.player(`c${i}`, `P${i}`);
    h.player("c12", "Late");
    expect(h.last("c12", "error")?.code).toBe("ROOM_FULL");
    expect(h.closed).toContain("c12");
    for (let i = 0; i < 4; i++) h.screen(`s${i}`);
    h.screen("s4");
    expect(h.last("s4", "error")?.code).toBe("SCREENS_FULL");
  });

  it("reclaims the same seat with a token and drops the old connection", () => {
    const h = setup();
    h.player("c1", "Ana");
    const { token, you } = h.last("c1", "welcome")!;
    h.core.message("c2", { type: "hello", role: "player", token }, 5);
    expect(h.last("c2", "welcome")!.you.id).toBe(you.id);
    expect(h.closed).toContain("c1");
    expect(h.last("c2", "room")!.room.players).toHaveLength(1);
    h.core.disconnect("c1", 6); // the stale socket closing later must not drop the seat
    expect(h.last("c2", "room")!.room.players[0]!.connected).toBe(true);
  });

  it("answers malformed messages with BAD_MESSAGE", () => {
    const h = setup();
    for (const junk of [null, "junk", { type: "hello" }, { type: "action", payload: 1 }]) h.core.message("c1", junk, 0);
    expect(h.msgs("c1", "error").map((m) => (m as { code: string }).code)).toEqual([
      "BAD_MESSAGE", "BAD_MESSAGE", "BAD_MESSAGE", "BAD_MESSAGE",
    ]);
  });
});

describe("RoomCore: host commands and games", () => {
  it("only lets the host run host commands", () => {
    const h = lobby();
    h.host("c2", { cmd: "start" });
    expect(h.last("c2", "error")?.code).toBe("NOT_HOST");
  });

  it("requires enough connected players to start", () => {
    const h = setup();
    h.screen("s1", { hostKey: "HOSTKEY" });
    h.player("c1", "Ana");
    h.host("s1", { cmd: "start" });
    expect(h.last("s1", "error")?.code).toBe("NOT_ENOUGH_PLAYERS");
    h.player("c2", "Ben");
    h.host("s1", { cmd: "start" });
    expect(h.last("s1", "room")!.room.phase).toBe("playing");
    expect(h.last("s1", "view")!.payload).toEqual({ count: 0, viewer: "screen" });
    expect(h.last("c1", "view")!.payload).toEqual({ count: 0, viewer: h.id("c1") });
  });

  it("applies settings through the game's parser", () => {
    const h = lobby();
    h.host("s1", { cmd: "updateSettings", settings: { target: 5 } });
    expect(h.last("c1", "room")!.room.settings).toEqual({ target: 5 });
  });

  it("routes actions and rebroadcasts views", () => {
    const h = started();
    expect(h.core.message("c1", { type: "action", payload: { t: "inc" } }, 1)).toEqual({ persist: true });
    expect(h.last("c2", "view")!.payload).toMatchObject({ count: 1 });
  });

  it("relays quiet events to everyone but the sender without persisting", () => {
    const h = started();
    const viewsBefore = h.msgs("c2", "view").length;
    expect(h.core.message("c1", { type: "action", payload: { t: "ping" } }, 1)).toEqual({ persist: false });
    expect(h.last("c2", "event")?.payload).toBe("pong");
    expect(h.last("s1", "event")?.payload).toBe("pong");
    expect(h.last("c1", "event")).toBeUndefined();
    expect(h.msgs("c2", "view")).toHaveLength(viewsBefore);
  });

  it("ignores actions from screens and invalid payloads", () => {
    const h = started();
    expect(h.core.message("s1", { type: "action", payload: { t: "inc" } }, 1)).toEqual({ persist: false });
    expect(h.core.message("c1", { type: "action", payload: { t: "boom" } }, 1)).toEqual({ persist: false });
    expect(h.last("c1", "view")!.payload).toMatchObject({ count: 0 });
  });

  it("returns to the lobby with results when the game ends", () => {
    const h = started();
    for (let i = 0; i < 3; i++) h.core.message("c1", { type: "action", payload: { t: "inc" } }, 1);
    const room = h.last("c1", "room")!.room;
    expect(room.phase).toBe("lobby");
    expect(room.lastResults).toEqual([
      { playerId: h.id("c1"), name: "Ana", score: 3 },
      { playerId: h.id("c2"), name: "Ben", score: 3 },
    ]);
  });

  it("lets the host skip and end the game", () => {
    const a = started();
    a.host("s1", { cmd: "skip" });
    expect(a.last("c1", "room")!.room.phase).toBe("lobby");
    const b = started();
    b.host("s1", { cmd: "endGame" });
    expect(b.last("c1", "room")!.room).toMatchObject({ phase: "lobby", lastResults: expect.any(Array) });
  });

  it("runs game timers through tick and reports the next alarm", () => {
    const h = started();
    expect(h.core.nextAlarmAt()).toBe(1000);
    h.core.tick(1000);
    expect(h.last("c1", "view")!.payload).toMatchObject({ count: 1 });
    expect(h.core.nextAlarmAt()).toBeNull();
  });

  it("lets late joiners watch the game as non-players", () => {
    const h = started();
    h.player("c3", "Cy", {}, 2);
    expect(h.last("c3", "view")!.payload).toEqual({ count: 0, viewer: h.id("c3") });
    expect((h.core.serialize().gameState as CState).players).not.toContain(h.id("c3"));
  });

  it("flags when too few players remain mid-game", () => {
    const h = started();
    h.core.disconnect("c2", 5);
    expect(h.last("c1", "room")!.room.belowMin).toBe(true);
  });

  it("kicks a player but never the host", () => {
    const h = lobby();
    h.host("s1", { cmd: "kick", playerId: h.id("c2") });
    expect(h.last("c2", "error")?.code).toBe("KICKED");
    expect(h.closed).toContain("c2");
    expect(h.last("c1", "room")!.room.players.map((p) => p.name)).toEqual(["Ana"]);
    h.host("s1", { cmd: "kick", playerId: h.id("s1") });
    expect(h.closed).not.toContain("s1");
  });
});

describe("RoomCore: host handoff and lifetime", () => {
  it("passes host to the earliest connected member after 15s", () => {
    const h = lobby();
    h.core.disconnect("s1", 1000);
    expect(h.core.nextAlarmAt()).toBe(16_000);
    h.core.tick(15_999);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("s1"));
    h.core.tick(16_000);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("c1"));
  });

  it("keeps host if they come back within the grace period", () => {
    const h = lobby();
    const { token } = h.last("s1", "welcome")!;
    h.core.disconnect("s1", 1000);
    h.core.message("s1b", { type: "hello", role: "screen", token, hostKey: "HOSTKEY" }, 5000);
    h.core.tick(16_000);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("s1"));
  });

  it("gives host back to the creator when they return later", () => {
    const h = lobby();
    const { token } = h.last("s1", "welcome")!;
    h.core.disconnect("s1", 1000);
    h.core.tick(16_000);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("c1"));
    h.core.message("s1b", { type: "hello", role: "screen", token, hostKey: "HOSTKEY" }, 20_000);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("s1"));
  });

  it("discards the room 10 minutes after everyone leaves", () => {
    const h = setup();
    h.player("c1", "Ana", {}, 0);
    h.core.disconnect("c1", 1000);
    h.core.tick(16_000); // host grace expires with nobody to hand to
    expect(h.core.nextAlarmAt()).toBe(601_000);
    expect(h.core.shouldDiscard(600_999)).toBe(false);
    expect(h.core.shouldDiscard(601_000)).toBe(true);
  });

  it("discards a created room nobody ever joined", () => {
    const h = setup();
    expect(h.core.nextAlarmAt()).toBe(600_000);
    expect(h.core.shouldDiscard(600_000)).toBe(true);
  });

  it("stops the empty-room countdown when someone joins", () => {
    const h = setup();
    h.player("c1", "Ana", {}, 5);
    expect(h.core.shouldDiscard(10 * 60_000 + 5)).toBe(false);
  });

  it("survives a save and restore", () => {
    const h = started();
    h.core.message("c1", { type: "action", payload: { t: "inc" } }, 1);
    const { token } = h.last("c1", "welcome")!;
    const saved = h.core.serialize();
    const sent2: { to: string; msg: ServerMsg }[] = [];
    const out2: Outbox = { send: (to, msg) => sent2.push({ to, msg }), close: () => {} };
    const restored = new RoomCore("ABCD", h.deps, out2, { saved, now: 5000 });
    expect((restored.serialize().gameState as CState).presence).toMatchObject({
      [h.id("c1")]: false,
      [h.id("c2")]: false,
    });
    restored.message("n1", { type: "hello", role: "player", token }, 6000);
    expect(sent2.find((s) => s.to === "n1" && s.msg.type === "welcome")).toMatchObject({ msg: { you: { id: h.id("c1") } } });
    expect(sent2.filter((s) => s.to === "n1" && s.msg.type === "view").at(-1)?.msg).toMatchObject({ payload: { count: 1 } });
  });
});

describe("RoomCore: seat replacement and role-aware reclaim", () => {
  it("tells the old connection it was REPLACED before closing it", () => {
    const h = setup();
    h.player("c1", "Ana");
    const { token, you } = h.last("c1", "welcome")!;
    h.core.message("c2", { type: "hello", role: "player", token }, 5);
    expect(h.last("c1", "error")?.code).toBe("REPLACED");
    const errAt = h.log.indexOf("send:c1:error");
    const closeAt = h.log.indexOf("close:c1");
    expect(errAt).toBeGreaterThanOrEqual(0);
    expect(closeAt).toBeGreaterThan(errAt);
    expect(h.last("c2", "welcome")!.you.id).toBe(you.id);
    expect(h.last("c2", "room")!.room.players).toHaveLength(1);
  });

  it("does not let a player hello reclaim a screen's seat", () => {
    const h = setup();
    h.screen("s1");
    const screenWelcome = h.last("s1", "welcome")!;
    h.player("c1", "Ana", { token: screenWelcome.token });
    const w = h.last("c1", "welcome")!;
    expect(w.you.kind).toBe("player");
    expect(w.you.id).not.toBe(screenWelcome.you.id);
    expect(w.token).not.toBe(screenWelcome.token);
    expect(h.closed).not.toContain("s1");
    const room = h.last("c1", "room")!.room;
    expect(room.screens).toHaveLength(1);
    expect(room.screens[0]!.connected).toBe(true);
    expect(room.players.map((p) => p.name)).toEqual(["Ana"]);
  });

  it("does not let a screen hello reclaim a player's seat", () => {
    const h = setup();
    h.player("c1", "Ana");
    const playerWelcome = h.last("c1", "welcome")!;
    h.screen("s1", { token: playerWelcome.token });
    const w = h.last("s1", "welcome")!;
    expect(w.you.kind).toBe("screen");
    expect(w.you.id).not.toBe(playerWelcome.you.id);
    expect(h.closed).not.toContain("c1");
    const room = h.last("s1", "room")!.room;
    expect(room.players).toHaveLength(1);
    expect(room.players[0]!.connected).toBe(true);
    expect(room.screens).toHaveLength(1);
  });
});

describe("RoomCore: lobby eviction for caps", () => {
  it("makes room for a new player by removing the longest-disconnected player, never the host", () => {
    const h = setup();
    for (let i = 0; i < 12; i++) h.player(`c${i}`, `P${i}`);
    // c0 is host (first device). It drops first but must never be evicted.
    h.core.disconnect("c0", 1);
    h.core.disconnect("c3", 10);
    h.core.disconnect("c5", 5);
    h.player("n1", "New1", {}, 20);
    expect(h.last("n1", "welcome")).toBeDefined();
    let names = h.last("n1", "room")!.room.players.map((p) => p.name);
    expect(names).not.toContain("P5");
    expect(names).toContain("P3");
    expect(names).toContain("P0");
    expect(names).toHaveLength(12);
    h.player("n2", "New2", {}, 21);
    names = h.last("n2", "room")!.room.players.map((p) => p.name);
    expect(names).not.toContain("P3");
    expect(names).toContain("P0");
    h.player("n3", "New3", {}, 22);
    expect(h.last("n3", "error")?.code).toBe("ROOM_FULL");
    expect(h.closed).toContain("n3");
  });

  it("makes room for a new screen by removing a disconnected screen", () => {
    const h = setup();
    h.player("c1", "Ana"); // host
    for (let i = 0; i < 4; i++) h.screen(`s${i}`);
    h.core.disconnect("s2", 5);
    h.screen("s4", {}, 10);
    expect(h.last("s4", "welcome")?.you.kind).toBe("screen");
    const room = h.last("s4", "room")!.room;
    expect(room.screens).toHaveLength(4);
    expect(room.screens.every((s) => s.connected)).toBe(true);
    h.screen("s5", {}, 11);
    expect(h.last("s5", "error")?.code).toBe("SCREENS_FULL");
  });

  it("never evicts connected members", () => {
    const h = setup();
    for (let i = 0; i < 12; i++) h.player(`c${i}`, `P${i}`);
    h.player("n1", "New1");
    expect(h.last("n1", "error")?.code).toBe("ROOM_FULL");
    expect(h.last("c1", "room")!.room.players).toHaveLength(12);
  });

  it("keeps the hard cap mid-game", () => {
    const h = setup();
    h.screen("s1", { hostKey: "HOSTKEY" });
    for (let i = 0; i < 12; i++) h.player(`c${i}`, `P${i}`);
    h.host("s1", { cmd: "start" });
    h.core.disconnect("c4", 5);
    h.player("n1", "New1", {}, 10);
    expect(h.last("n1", "error")?.code).toBe("ROOM_FULL");
    expect(h.last("s1", "room")!.room.players.map((p) => p.name)).toContain("P4");
  });
});

describe("RoomCore: belowMin counts only seated players", () => {
  it("ignores late spectators", () => {
    const h = started();
    h.core.disconnect("c2", 5);
    h.player("c3", "Cy", {}, 6);
    expect(h.last("c1", "room")!.room.belowMin).toBe(true);
  });

  it("remembers who was seated across save and restore", () => {
    const h = started();
    h.player("c3", "Cy", {}, 2);
    const t1 = h.last("c1", "welcome")!.token;
    const t3 = h.last("c3", "welcome")!.token;
    const saved = h.core.serialize();
    const out2: Outbox = { send: () => {}, close: () => {} };
    const restored = new RoomCore("ABCD", h.deps, out2, { saved, now: 5000 });
    restored.message("n1", { type: "hello", role: "player", token: t1 }, 6000);
    restored.message("n3", { type: "hello", role: "player", token: t3 }, 6000);
    expect(restored.snapshot().belowMin).toBe(true);
  });

  it("restores older saves without the new fields", () => {
    const h = started();
    const t1 = h.last("c1", "welcome")!.token;
    const saved = h.core.serialize() as unknown as Record<string, unknown>;
    delete saved.seated;
    for (const m of saved.members as Record<string, unknown>[]) delete m.disconnectedAt;
    const out2: Outbox = { send: () => {}, close: () => {} };
    const restored = new RoomCore("ABCD", h.deps, out2, { saved: saved as never, now: 5000 });
    restored.message("n1", { type: "hello", role: "player", token: t1 }, 6000);
    expect(restored.snapshot().belowMin).toBe(true);
    const ser = restored.serialize();
    expect(Array.isArray(ser.seated)).toBe(true);
    for (const m of ser.members) expect(m.disconnectedAt === null || typeof m.disconnectedAt === "number").toBe(true);
  });
});

describe("RoomCore: name and avatar hygiene", () => {
  it("rejects names made only of zero-width characters", () => {
    const h = setup();
    h.player("c1", "​‌‍﻿");
    expect(h.last("c1", "error")?.code).toBe("BAD_MESSAGE");
    expect(h.last("c1", "welcome")).toBeUndefined();
  });

  it("strips control and format characters from names", () => {
    const h = setup();
    h.player("c1", "A​n\u0007a");
    expect(h.last("c1", "room")!.room.players[0]!.name).toBe("Ana");
  });

  it("truncates names by code point so emoji are not split", () => {
    const h = setup();
    h.player("c1", "😀".repeat(17));
    expect(h.last("c1", "room")!.room.players[0]!.name).toBe("😀".repeat(16));
  });

  it("keeps ZWJ emoji avatars and falls back when the emoji is invisible", () => {
    const h = setup();
    const family = "👨‍👩‍👧";
    h.player("c1", "Ana", { avatar: { emoji: family, color: "#112233" } });
    h.player("c2", "Ben", { avatar: { emoji: "​\u0007", color: "#445566" } });
    const players = h.last("c2", "room")!.room.players;
    expect(players[0]!.avatar).toEqual({ emoji: family, color: "#112233" });
    expect(players[1]!.avatar.emoji).toBe("🙂");
    expect(players[1]!.avatar.color).toBe("#445566");
  });
});
