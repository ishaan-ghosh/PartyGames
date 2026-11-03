import { LIMITS } from "@party/shared";
import { SELF, env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { SavedRoom } from "../../src/room-core";

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
    await vi.waitFor(() => expect(messages.some((m) => m.type === "room")).toBe(true));
    const seen = messages.length;
    expect(await runDurableObjectAlarm(stubFor(code))).toBe(true);
    // A watchdog alarm that changes nothing a client can see sends nothing.
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.length).toBe(seen);
    const { keys, alarm } = await storageOf(code);
    expect(keys).toContain("room");
    expect(alarm).not.toBeNull();
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
