import { LIMITS } from "@party/shared";
import { SELF, env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GAME_ID, games } from "../../src/games";
import { RoomCore, type SavedRoom } from "../../src/room-core";

type Msg = { type: string; [k: string]: unknown };

async function createRoom() {
  const res = await SELF.fetch("https://party.test/api/rooms", { method: "POST" });
  expect(res.status).toBe(200);
  return res.json<{ code: string; hostKey: string }>();
}

async function open(code: string) {
  const res = await SELF.fetch(`https://party.test/parties/room/${code}`, { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`expected a websocket, got status ${res.status}`);
  ws.accept();
  const messages: Msg[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(String(e.data)));
  });
  return { ws, messages };
}

const stubFor = (code: string) => env.Room.get(env.Room.idFromName(code));
const storageOf = (code: string) =>
  runInDurableObject(stubFor(code), async (_room, state) => ({
    keys: [...(await state.storage.list()).keys()],
    alarm: await state.storage.getAlarm(),
  }));

/** Rewrites the persisted room, then drops the in-memory instance so the next wake restores from storage. */
async function editSaveAndEvict(code: string, edit: (s: SavedRoom) => void) {
  const stub = stubFor(code);
  await runInDurableObject(stub, async (_room, state) => {
    const saved = (await state.storage.get<SavedRoom>("room"))!;
    edit(saved);
    await state.storage.put("room", saved);
    await state.storage.deleteAlarm();
  });
  await evictDurableObject(stub, { webSockets: "close" });
}

describe("room lifecycle", () => {
  it("schedules a discard alarm for a created room nobody has joined", async () => {
    const before = Date.now();
    const { code } = await createRoom();
    const { alarm } = await storageOf(code);
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeLessThanOrEqual(Date.now() + LIMITS.emptyRoomTtlMs);
    expect(alarm!).toBeGreaterThanOrEqual(before);
  });

  it("discards an expired empty room on its alarm and leaves no storage behind", async () => {
    const { code } = await createRoom();
    await editSaveAndEvict(code, (s) => {
      s.emptySince = Date.now() - LIMITS.emptyRoomTtlMs - 1_000;
    });
    expect((await storageOf(code)).alarm).toBeNull();
    // A cold wake from storage must re-arm an alarm on its own. It is already due, so it fires by
    // itself and discards the room, leaving nothing in storage.
    await SELF.fetch(`https://party.test/parties/room/${code}`);
    await vi.waitFor(async () => expect(await storageOf(code)).toEqual({ keys: [], alarm: null }));
    expect(await runDurableObjectAlarm(stubFor(code))).toBe(false);
    // The code is free again: it reads as never created.
    const { ws, messages } = await open(code);
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana" }));
    await vi.waitFor(() => expect(messages[0]).toMatchObject({ type: "error", code: "ROOM_NOT_FOUND" }));
  });

  it("re-arms an alarm when a lobby room whose sockets vanished without onClose is restored", async () => {
    const { code } = await createRoom();
    // evictDurableObject hangs once the instance has held a non-hibernatable socket, so build the save a
    // deploy leaves behind directly: a host still marked connected (onClose never ran), room not empty,
    // no alarm stored.
    await editSaveAndEvict(code, (s) => {
      s.members.push({
        id: "p1", token: "t1", kind: "player", name: "Ana", avatar: { emoji: "🙂", color: "#7f5af0" },
        connId: "dropped-without-onclose", joinSeq: 1, disconnectedAt: null,
      });
      s.joinSeq = 1;
      s.hostId = "p1";
      s.emptySince = null;
      s.hostGoneAt = null;
    });
    const wokeAt = Date.now();
    await SELF.fetch(`https://party.test/parties/room/${code}`);
    const { alarm, keys } = await storageOf(code);
    expect(keys).toContain("room");
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeLessThanOrEqual(wokeAt + LIMITS.emptyRoomTtlMs + 5_000);
  });

  it("keeps a room that is still in use when its alarm fires, and re-arms it", async () => {
    const { code, hostKey } = await createRoom();
    const { ws, messages } = await open(code);
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana", hostKey }));
    await vi.waitFor(() => expect(messages.some((m) => m.type === "welcome")).toBe(true));
    expect((await storageOf(code)).alarm).not.toBeNull();
    expect(await runDurableObjectAlarm(stubFor(code))).toBe(true);
    const { keys, alarm } = await storageOf(code);
    expect(keys).toContain("room");
    expect(alarm).not.toBeNull();
    ws.close();
  });

  it("stores the drawing in parts beside the room record", async () => {
    const { code, hostKey } = await createRoom();
    const a = await open(code);
    const b = await open(code);
    a.ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana", hostKey }));
    await vi.waitFor(() => expect(a.messages.some((m) => m.type === "welcome")).toBe(true));
    b.ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ben" }));
    await vi.waitFor(() => expect(b.messages.some((m) => m.type === "welcome")).toBe(true));
    a.ws.send(JSON.stringify({ type: "host", cmd: { cmd: "start" } }));
    const lastView = (m: Msg[]) => m.filter((x) => x.type === "view").at(-1)?.payload as { drawerId: string; you: { id: string } } | undefined;
    await vi.waitFor(() => expect(lastView(a.messages)).toBeDefined());
    const drawer = lastView(a.messages)!.drawerId === lastView(a.messages)!.you.id ? a : b;
    const watcher = drawer === a ? b : a;
    drawer.ws.send(JSON.stringify({ type: "action", payload: { t: "choose", index: 0 } }));
    for (let i = 0; i < 40; i++) {
      drawer.ws.send(JSON.stringify({ type: "action", payload: { t: "strokeBegin", id: i, tool: "pen", color: 0, size: 0, points: [0.1, 0.1, 0.2, 0.2] } }));
    }
    await vi.waitFor(() => expect(watcher.messages.filter((m) => m.type === "event")).toHaveLength(40));
    watcher.ws.send(JSON.stringify({ type: "action", payload: { t: "guess", text: "nope" } })); // persists
    await vi.waitFor(async () => expect((await storageOf(code)).keys).toEqual(expect.arrayContaining(["room", "part:strokes.0", "part:strokes.1"])));
    const saved = await runInDurableObject(stubFor(code), (_r, state) => state.storage.get<SavedRoom>("room"));
    expect((saved!.gameState as { strokes: unknown[] }).strokes).toEqual([]);
    expect(saved!.parts).toEqual(["strokes.0", "strokes.1"]);
    a.ws.close();
    b.ws.close();
  });

  it("restores a drawing saved in parts when the room wakes", async () => {
    const { code } = await createRoom();
    // Build a mid-drawing save with the real room logic, then plant it as this room's storage.
    const core = new RoomCore(code, { newId: () => crypto.randomUUID(), newSeed: () => 1, games, defaultGameId: DEFAULT_GAME_ID }, { send: () => {}, close: () => {} });
    core.create("k", Date.now());
    core.message("x1", { type: "hello", role: "player", name: "Ana", hostKey: "k" }, Date.now());
    core.message("x2", { type: "hello", role: "player", name: "Ben" }, Date.now());
    core.message("x1", { type: "host", cmd: { cmd: "start" } }, Date.now());
    for (const c of ["x1", "x2"]) core.message(c, { type: "action", payload: { t: "choose", index: 0 } }, Date.now());
    for (let i = 0; i < 40; i++) {
      for (const c of ["x1", "x2"]) {
        core.message(c, { type: "action", payload: { t: "strokeBegin", id: i, tool: "pen", color: 0, size: 0, points: [0.1, 0.1, 0.2, 0.2] } }, Date.now());
      }
    }
    const { saved, parts } = core.serializeSplit();
    expect(saved.parts).toEqual(["strokes.0", "strokes.1"]);
    const token = saved.members[0]!.token;
    await runInDurableObject(stubFor(code), async (_room, state) => {
      await state.storage.put({ room: saved, ...Object.fromEntries(Object.entries(parts).map(([k, p]) => [`part:${k}`, p.value])) });
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(stubFor(code), { webSockets: "close" });
    const { ws, messages } = await open(code);
    ws.send(JSON.stringify({ type: "hello", role: "player", token }));
    await vi.waitFor(() => expect(messages.some((m) => m.type === "event")).toBe(true));
    const sync = messages.find((m) => m.type === "event")!.payload as { op: string; strokes: unknown[] };
    expect(sync.op).toBe("sync");
    expect(sync.strokes).toHaveLength(40);
    ws.close();
  });

  it("leaves no storage behind when someone touches a code that was never created", async () => {
    const { ws, messages } = await open("WXYZ");
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana" }));
    await vi.waitFor(() => expect(messages[0]).toMatchObject({ type: "error", code: "ROOM_NOT_FOUND" }));
    await SELF.fetch("https://party.test/parties/room/WXYZ");
    expect(await storageOf("WXYZ")).toEqual({ keys: [], alarm: null });
  });
});
