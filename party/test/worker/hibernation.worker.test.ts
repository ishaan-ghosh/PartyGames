import { SELF, env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { SavedRoom } from "../../src/room-core";
import { MESSAGE_RATE } from "../../src/rate-limit";
import { QUIET_SAVE_MS } from "../../src/room";

// evictDurableObject() hibernates the room's WebSockets by default: the instance (and everything it
// held in memory) is torn down, the sockets stay open, and the next event wakes a fresh instance that
// runs onStart from storage. That is what production hibernation does to an idle room.

type Msg = { type: string; [k: string]: unknown };
type View = { phase: string; drawerId: string; you: { id: string }; strokeSig: string; players: { id: string; connected: boolean }[] };
type Room = { players: { id: string; name: string; connected: boolean }[]; hostId: string; phase: string };

async function createRoom() {
  const res = await SELF.fetch("https://party.test/api/rooms", { method: "POST" });
  expect(res.status).toBe(200);
  return res.json<{ code: string; hostKey: string }>();
}

async function open(code: string, pk?: string) {
  const q = pk ? `?_pk=${encodeURIComponent(pk)}` : "";
  const res = await SELF.fetch(`https://party.test/parties/room/${code}${q}`, { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`expected a websocket, got status ${res.status}`);
  ws.accept();
  const messages: Msg[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(String(e.data)));
  });
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  return { ws, messages, send };
}
type Client = Awaited<ReturnType<typeof open>>;

const stubFor = (code: string) => env.Room.get(env.Room.idFromName(code));
const lastOf = (c: Client, type: string) => c.messages.filter((m) => m.type === type).at(-1);
const lastView = (c: Client) => lastOf(c, "view")?.payload as View | undefined;
const lastRoom = (c: Client) => (lastOf(c, "room") as { room: Room } | undefined)?.room;
const savedRoom = (code: string) => runInDurableObject(stubFor(code), (_r, state) => state.storage.get<SavedRoom>("room"));

async function hello(c: Client, m: Record<string, unknown>) {
  c.send({ type: "hello", role: "player", ...m });
  await vi.waitFor(() => expect(lastOf(c, "welcome")).toBeDefined());
  return lastOf(c, "welcome") as unknown as { token: string; you: { id: string } };
}

/** Ana (host) and Ben in a lobby. */
async function lobby() {
  const { code, hostKey } = await createRoom();
  const a = await open(code);
  const b = await open(code);
  await hello(a, { name: "Ana", hostKey });
  await hello(b, { name: "Ben" });
  await vi.waitFor(() => expect(lastRoom(a)?.players).toHaveLength(2));
  return { code, a, b };
}

/** A game in its drawing phase: returns the drawer and the watcher. */
async function drawingTurn() {
  const { code, a, b } = await lobby();
  a.send({ type: "host", cmd: { cmd: "start" } });
  await vi.waitFor(() => expect(lastView(a)).toBeDefined());
  const v = lastView(a)!;
  const drawer = v.drawerId === v.you.id ? a : b;
  const watcher = drawer === a ? b : a;
  drawer.send({ type: "action", payload: { t: "choose", index: 0 } });
  await vi.waitFor(() => expect(lastView(watcher)?.phase).toBe("drawing"));
  return { code, a, b, drawer, watcher };
}

describe("room hibernation", () => {
  it("keeps members connected on their open sockets across a hibernate/wake, without a new hello", async () => {
    const { code, a, b } = await lobby();
    const before = (await savedRoom(code))!;
    await evictDurableObject(stubFor(code));
    // The host's socket still works as the host's: start needs a recognised host and two connected players.
    a.send({ type: "host", cmd: { cmd: "start" } });
    await vi.waitFor(() => expect(lastView(b)).toBeDefined());
    expect(lastRoom(a)!.players.every((p) => p.connected)).toBe(true);
    expect(a.messages.some((m) => m.type === "error")).toBe(false);
    // Waking with every socket still open changed nothing, so it saved nothing on its own: the record
    // was rewritten only by the start (members unchanged).
    expect((await savedRoom(code))!.members).toEqual(before.members);
    // A close after the wake still marks its member disconnected.
    b.ws.close();
    await vi.waitFor(() => expect(lastRoom(a)!.players.find((p) => p.name === "Ben")!.connected).toBe(false));
    a.ws.close();
  });

  it("handles a socket that closes while the room is hibernated as a disconnect (host)", async () => {
    const { code, a, b } = await lobby();
    await evictDurableObject(stubFor(code));
    const closedAt = Date.now();
    a.ws.close(1000); // the host's close is the event that wakes the room
    await vi.waitFor(() => expect(lastRoom(b)!.players.find((p) => p.name === "Ana")!.connected).toBe(false));
    await vi.waitFor(async () => expect((await savedRoom(code))!.hostGoneAt).toBeGreaterThanOrEqual(closedAt));
    const saved = (await savedRoom(code))!;
    expect(saved.members.find((m) => m.name === "Ana")).toMatchObject({ connId: null });
    expect(saved.members.find((m) => m.name === "Ben")!.connId).not.toBeNull();
    // Ben's socket is still bound: he can act without a new hello.
    b.messages.length = 0;
    b.send({ type: "host", cmd: { cmd: "start" } });
    await vi.waitFor(() => expect(b.messages.some((m) => m.type === "error" && m.code === "NOT_HOST")).toBe(true));
    b.ws.close();
  });

  it("handles a player's socket closing while a hibernated game is running", async () => {
    const { code, drawer, watcher } = await drawingTurn();
    await evictDurableObject(stubFor(code));
    const gone = lastView(drawer)!.you.id;
    drawer.ws.close(1000);
    await vi.waitFor(() => expect(lastView(watcher)!.players.find((p) => p.id === gone)!.connected).toBe(false));
    const state = (await savedRoom(code))!.gameState as { connected: Record<string, boolean>; drawerGoneAt: number | null };
    expect(state.connected[gone]).toBe(false);
    expect(state.drawerGoneAt).not.toBeNull();
    watcher.ws.close();
  });

  it("does not lose a mid-turn drawing: quiet strokes are saved within QUIET_SAVE_MS", async () => {
    const { code, a, b, drawer, watcher } = await drawingTurn();
    const events = () => watcher.messages.filter((m) => m.type === "event").length;
    const start = events();
    for (let i = 0; i < 40; i++) {
      drawer.send({ type: "action", payload: { t: "strokeBegin", id: i, tool: "pen", color: 0, size: 0, points: [0.1, 0.1, 0.2, 0.2] } });
    }
    drawer.send({ type: "action", payload: { t: "strokeAppend", id: 39, points: [0.3, 0.3] } });
    await vi.waitFor(() => expect(events()).toBe(start + 41));
    // Strokes are quiet (no immediate save); the debounced save lands on its own, before the room could idle out.
    await vi.waitFor(async () => expect((await savedRoom(code))!.parts).toEqual(["strokes.0", "strokes.1"]), {
      timeout: QUIET_SAVE_MS + 3_000,
      interval: 200,
    });
    const saved = (await savedRoom(code))!;
    expect(saved.partRevs).toEqual({ "strokes.0": expect.any(String), "strokes.1": expect.any(String) });
    await evictDurableObject(stubFor(code));
    // The open stroke survived too: the drawer keeps extending it after the wake.
    drawer.send({ type: "action", payload: { t: "strokeAppend", id: 39, points: [0.4, 0.4] } });
    await vi.waitFor(() => expect(events()).toBe(start + 42));
    watcher.messages.length = 0;
    watcher.send({ type: "resync" });
    await vi.waitFor(() => expect(watcher.messages.some((m) => m.type === "event")).toBe(true));
    const sync = watcher.messages.find((m) => m.type === "event")!.payload as { op: string; strokes: { points: number[] }[] };
    expect(sync.op).toBe("sync");
    expect(sync.strokes).toHaveLength(40);
    expect(sync.strokes[39]!.points).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4]);
    a.ws.close();
    b.ws.close();
  });

  it("resumes game timers after a wake: the alarm ticks the game and reaches the open sockets", async () => {
    const { code, a, b, watcher } = await drawingTurn();
    // Make the drawing phase already over in storage, then hibernate: the next alarm wakes a fresh instance.
    await runInDurableObject(stubFor(code), async (_r, state) => {
      const saved = (await state.storage.get<SavedRoom>("room"))!;
      (saved.gameState as { phaseEndsAt: number }).phaseEndsAt = Date.now() - 1;
      await state.storage.put("room", saved);
    });
    await evictDurableObject(stubFor(code));
    expect(await runDurableObjectAlarm(stubFor(code))).toBe(true);
    await vi.waitFor(() => expect(lastView(watcher)!.phase).not.toBe("drawing"));
    const alarm = await runInDurableObject(stubFor(code), (_r, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    a.ws.close();
    b.ws.close();
  });

  it("still rate-limits a socket after a wake", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { code, a, b } = await lobby();
      await evictDurableObject(stubFor(code));
      a.messages.length = 0;
      for (let i = 0; i < 400; i++) a.ws.send("not json {");
      await vi.waitFor(() => expect(a.messages.length).toBeGreaterThanOrEqual(MESSAGE_RATE.burst));
      await new Promise((r) => setTimeout(r, 100));
      expect(a.messages.length).toBeLessThan(300);
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(`"room":"${code}"`));
      expect(lines.length).toBeLessThan(40);
      a.ws.close();
      b.ws.close();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("reconnecting with the same _pk", () => {
  it("a late close from the old socket does not mark the new one disconnected", async () => {
    const { code, hostKey } = await createRoom();
    const old = await open(code, "same-pk");
    const { token } = await hello(old, { name: "Ana", hostKey });
    // PartySocket reuses its _pk on reconnect; the server may not have seen the old socket close yet.
    const fresh = await open(code, "same-pk");
    await hello(fresh, { token });
    await vi.waitFor(() => expect(old.messages.some((m) => m.type === "error" && m.code === "REPLACED")).toBe(true));
    old.ws.close();
    await new Promise((r) => setTimeout(r, 200)); // let the old close reach the room
    const ben = await open(code);
    await hello(ben, { name: "Ben" });
    await vi.waitFor(() => expect(lastRoom(fresh)?.players).toHaveLength(2));
    expect(lastRoom(fresh)!.players.find((p) => p.name === "Ana")!.connected).toBe(true);
    // And it is still the host's live socket.
    fresh.send({ type: "host", cmd: { cmd: "start" } });
    await vi.waitFor(() => expect(lastView(ben)).toBeDefined());
    fresh.ws.close();
    ben.ws.close();
  });
});
