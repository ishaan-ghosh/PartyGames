import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { MESSAGE_RATE } from "../../src/rate-limit";

type Msg = { type: string; [k: string]: unknown };

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

async function createRoom() {
  const res = await SELF.fetch("https://party.test/api/rooms", { method: "POST" });
  expect(res.status).toBe(200);
  return res.json<{ code: string; hostKey: string }>();
}

describe("worker", () => {
  it("creates a room and welcomes its host over a websocket", async () => {
    const { code, hostKey } = await createRoom();
    expect(code).toMatch(/^[A-HJKMNP-Z]{4}$/);
    expect(hostKey).toEqual(expect.any(String));
    const { ws, messages } = await open(code);
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana", hostKey }));
    await vi.waitFor(() => expect(messages.some((m) => m.type === "room")).toBe(true));
    const welcome = messages.find((m) => m.type === "welcome") as unknown as { you: { id: string } };
    const room = messages.filter((m) => m.type === "room").at(-1) as unknown as { room: { hostId: string; gameId: string } };
    expect(room.room.hostId).toBe(welcome.you.id);
    expect(room.room.gameId).toBe("doodle-dash");
    ws.close();
  });

  it("refuses rooms that were never created", async () => {
    const { ws, messages } = await open("QQQQ");
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana" }));
    await vi.waitFor(() => expect(messages[0]).toMatchObject({ type: "error", code: "ROOM_NOT_FOUND" }));
  });

  it("answers non-JSON with BAD_MESSAGE and keeps the room usable", async () => {
    const { code } = await createRoom();
    const { ws, messages } = await open(code);
    ws.send("not json {");
    await vi.waitFor(() => expect(messages[0]).toMatchObject({ type: "error", code: "BAD_MESSAGE" }));
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana" }));
    await vi.waitFor(() => expect(messages.some((m) => m.type === "welcome")).toBe(true));
    ws.close();
  });

  it("logs rejected messages as one structured warn line without the message body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { code } = await createRoom();
      const { ws, messages } = await open(code);
      ws.send(JSON.stringify({ type: "action", payload: { t: "guess", text: "secret words" } }));
      await vi.waitFor(() => expect(messages[0]).toMatchObject({ type: "error", code: "BAD_MESSAGE" }));
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(`"room":"${code}"`));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ ev: "reject", room: code, type: "action", reason: "no_hello" });
      expect(lines[0]).not.toContain("secret");
      ws.close();
    } finally {
      warn.mockRestore();
    }
  });

  it("drops messages past the per-connection rate limit and keeps the socket open for a short burst", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { code } = await createRoom();
      const { ws, messages } = await open(code);
      for (let i = 0; i < 400; i++) ws.send("not json {");
      await vi.waitFor(() => expect(messages.length).toBeGreaterThanOrEqual(MESSAGE_RATE.burst));
      // Let any straggling replies land, then check the excess got no reply at all.
      await new Promise((r) => setTimeout(r, 100));
      expect(messages.length).toBeLessThan(300);
      // The log limited itself too: 400 rejections, far fewer lines.
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(`"room":"${code}"`));
      expect(lines.length).toBeLessThan(40);
      // Still open: a short burst is dropped, not punished.
      ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana" }));
      await vi.waitFor(() => expect(messages.some((m) => m.type === "welcome")).toBe(true), { timeout: 3000 });
      ws.close();
    } finally {
      warn.mockRestore();
    }
  });

  it("answers oversized frames with BAD_MESSAGE without parsing them and keeps the room usable", async () => {
    const { code } = await createRoom();
    const { ws, messages } = await open(code);
    // A valid hello padded past the 16 KB cap: if it were parsed, it would be welcomed.
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana", pad: "x".repeat(20_000) }));
    await vi.waitFor(() => expect(messages[0]).toMatchObject({ type: "error", code: "BAD_MESSAGE" }));
    expect(messages.some((m) => m.type === "welcome")).toBe(false);
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana" }));
    await vi.waitFor(() => expect(messages.some((m) => m.type === "welcome")).toBe(true));
    ws.close();
  });

  it("does not let outside HTTP requests create a room", async () => {
    const res = await SELF.fetch("https://party.test/parties/room/ZZZZ", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostKey: "mine" }),
    });
    expect(res.status).toBe(404);
    const { ws, messages } = await open("ZZZZ");
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana", hostKey: "mine" }));
    await vi.waitFor(() => expect(messages[0]).toMatchObject({ type: "error", code: "ROOM_NOT_FOUND" }));
  });

  it("404s room routes whose name isn't a room code, without reaching a Durable Object", async () => {
    for (const name of ["abcd", "ABCO", "ABCDE", "ABC", "constructor", "AB%20D", "anything-at-all"]) {
      const res = await SELF.fetch(`https://party.test/parties/room/${name}`, { headers: { Upgrade: "websocket" } });
      expect(res.status, name).toBe(404);
      expect(res.webSocket, name).toBeNull();
    }
    const other = await SELF.fetch("https://party.test/parties/other/ABCD", { headers: { Upgrade: "websocket" } });
    expect(other.status).toBe(404);
  });
});
