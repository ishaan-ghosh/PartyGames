import { describe, expect, it } from "vitest";
import type { ServerMsg } from "@party/shared";
import { games } from "./games";
import { RoomCore, type CoreDeps, type Outbox } from "./room-core";

/**
 * Wire and storage cost of Doodle Dash with a realistic drawing on the canvas: ~100 strokes of
 * ~40 points each. Regression guard for "a guess re-sends / re-saves every stroke".
 */
function room() {
  const sent: { to: string; bytes: number; msg: ServerMsg }[] = [];
  let n = 0;
  const deps: CoreDeps = { newId: () => `id${++n}`, newSeed: () => 7, games, defaultGameId: "doodle-dash" };
  const out: Outbox = {
    send: (to, msg) => sent.push({ to, bytes: JSON.stringify(msg).length, msg }),
    close: () => {},
  };
  const core = new RoomCore("ABCD", deps, out);
  core.create("HOSTKEY", 0);
  core.message("s1", { type: "hello", role: "screen", hostKey: "HOSTKEY" }, 0);
  const conns = ["c1", "c2", "c3", "c4", "c5"];
  conns.forEach((c, i) => core.message(c, { type: "hello", role: "player", name: `P${i}` }, 0));
  core.message("s1", { type: "host", cmd: { cmd: "start" } }, 0);
  const welcome = (c: string) => sent.find((s) => s.to === c && s.msg.type === "welcome")!.msg as Extract<ServerMsg, { type: "welcome" }>;
  const view = (c: string) =>
    (sent.filter((s) => s.to === c && s.msg.type === "view").at(-1)!.msg as Extract<ServerMsg, { type: "view" }>).payload as {
      drawerId: string;
      phase: string;
    };
  const drawerConn = conns.find((c) => welcome(c).you.id === view(c).drawerId)!;
  core.message(drawerConn, { type: "action", payload: { t: "choose", index: 0 } }, 1);
  expect(view(drawerConn).phase).toBe("drawing");
  // 100 strokes × 40 points, each begun and then extended in two appends, as DrawPad batches them.
  let r = 0.123456;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 100; i++) {
    const pts = () => Array.from({ length: 26 }, rnd);
    core.message(drawerConn, { type: "action", payload: { t: "strokeBegin", id: i, tool: "pen", color: i % 12, size: i % 3, points: pts() } }, 2);
    core.message(drawerConn, { type: "action", payload: { t: "strokeAppend", id: i, points: pts() } }, 2);
    core.message(drawerConn, { type: "action", payload: { t: "strokeAppend", id: i, points: pts() } }, 2);
  }
  const guesser = conns.find((c) => c !== drawerConn)!;
  return { core, sent, guesser, conns };
}

describe("doodle dash bytes per guess", () => {
  it("a wrong guess with ~100 strokes on the canvas stays small on the wire", () => {
    const { core, sent, guesser } = room();
    const before = sent.length;
    core.message(guesser, { type: "action", payload: { t: "guess", text: "definitely not it" } }, 3);
    const wire = sent.slice(before).reduce((a, s) => a + s.bytes, 0);
    // Before strokes left the view this was ~319 KB (every view carried the ~53 KB drawing).
    expect(sent.slice(before).some((s) => JSON.stringify(s.msg).includes("points"))).toBe(false);
    expect(wire).toBeLessThan(20_000);
  });

  it("a screen joining mid-drawing gets the whole drawing once, as a sync event after its view", () => {
    const { core, sent } = room();
    const before = sent.length;
    core.message("s2", { type: "hello", role: "screen" }, 4);
    const mine = sent.slice(before).filter((s) => s.to === "s2");
    expect(mine.map((s) => s.msg.type)).toEqual(["welcome", "room", "view", "event"]);
    const ev = mine[3]!.msg as Extract<ServerMsg, { type: "event" }>;
    expect(ev.payload).toMatchObject({ op: "sync" });
    expect((ev.payload as { strokes: unknown[] }).strokes).toHaveLength(100);
  });
});
