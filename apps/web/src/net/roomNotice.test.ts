import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@party/shared";
import { NOTICE_TEXT, noticeText, observeRoom, type NoticeBaseline, type NoticeInput, type RoomNoticeKind } from "./roomNotice";

const snap = (over: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  code: "ABCD", hostId: "s1", mode: "screen", phase: "playing", gameId: "doodle-dash", settings: {},
  players: [], screens: [], lastResults: null, belowMin: false, ...over,
});

const input = (over: Partial<NoticeInput> = {}): NoticeInput => ({
  status: "open", session: 1, synced: true, youId: "p1", room: snap(), ...over,
});

/** Feeds a sequence of observations, returning the notice raised by each. */
function run(...inputs: NoticeInput[]): (RoomNoticeKind | null)[] {
  let baseline: NoticeBaseline | null = null;
  const notices: (RoomNoticeKind | null)[] = [];
  for (const i of inputs) {
    const r = observeRoom(baseline, i);
    baseline = r.baseline;
    notices.push(r.notice);
  }
  return notices;
}

describe("observeRoom", () => {
  it("raises nothing on the first synced snapshot (initial load / rejoin), even in phones mode", () => {
    expect(run(input({ room: snap({ mode: "phones" }) }))).toEqual([null]);
  });

  it("raises tv-lost when the screen leaves mid-game", () => {
    expect(run(input(), input({ room: snap({ mode: "phones" }) }))).toEqual([null, "tv-lost"]);
  });

  it("raises tv-back when a screen reconnects mid-game", () => {
    expect(run(input({ room: snap({ mode: "phones" }) }), input())).toEqual([null, "tv-back"]);
  });

  it("raises nothing for mode changes in the lobby", () => {
    const lobby = (mode: "screen" | "phones") => input({ room: snap({ phase: "lobby", mode }) });
    expect(run(lobby("screen"), lobby("phones"), lobby("screen"))).toEqual([null, null, null]);
  });

  it("raises nothing when the game starts or ends in a different mode", () => {
    expect(run(
      input({ room: snap({ phase: "lobby", mode: "screen" }) }),
      input({ room: snap({ phase: "playing", mode: "phones" }) }),
      input({ room: snap({ phase: "lobby", mode: "screen" }) }),
    )).toEqual([null, null, null]);
  });

  it("raises nothing for snapshots that don't change mode or host", () => {
    expect(run(input(), input({ room: snap({ belowMin: true }) }), input())).toEqual([null, null, null]);
  });

  it("raises host when host passes to you mid-game", () => {
    expect(run(
      input({ room: snap({ mode: "phones", hostId: "s1" }) }),
      input({ room: snap({ mode: "phones", hostId: "p1" }) }),
    )).toEqual([null, "host"]);
  });

  it("raises host only when it passes to you: not to someone else, nor again while you stay host", () => {
    expect(run(
      input({ room: snap({ hostId: "s1" }) }),
      input({ room: snap({ hostId: "p2" }) }),
      input({ room: snap({ hostId: "p1" }) }),
      input({ room: snap({ hostId: "p1" }) }),
    )).toEqual([null, null, "host", null]);
  });

  it("prefers host when mode and host change in the same snapshot", () => {
    expect(run(input(), input({ room: snap({ mode: "phones", hostId: "p1" }) }))).toEqual([null, "host"]);
  });

  it("raises nothing across a reconnect: the first fresh snapshot only re-baselines", () => {
    expect(run(
      input(), // screen mode, connected
      input({ status: "reconnecting" }), // phone's socket drops (e.g. it slept)
      input({ session: 2, synced: false }), // welcomed again; still holding the stale snapshot
      input({ session: 2, room: snap({ mode: "phones" }) }), // the TV left while we were away
    )).toEqual([null, null, null, null]);
  });

  it("re-baselines on a new session even if the drop itself was never observed", () => {
    // The reconnecting/welcome renders can be batched away; a new session alone must reset the baseline.
    expect(run(input(), input({ session: 2, room: snap({ mode: "phones" }) }))).toEqual([null, null]);
  });

  it("still notices live transitions after a reconnect", () => {
    expect(run(
      input(),
      input({ status: "reconnecting" }),
      input({ session: 2, room: snap({ mode: "phones" }) }),
      input({ session: 2, room: snap({ mode: "screen" }) }),
    )).toEqual([null, null, null, "tv-back"]);
  });

  it("raises host-tv when the TV reclaims host from you mid-game", () => {
    const screens = [{ id: "s1", connected: true, isHost: false }];
    expect(run(
      input({ room: snap({ mode: "phones", hostId: "p1", screens }) }),
      input({ room: snap({ mode: "phones", hostId: "s1", screens }) }),
    )).toEqual([null, "host-tv"]);
  });

  it("prefers host-tv over tv-back when the TV returns and reclaims host in one snapshot", () => {
    const screens = [{ id: "s1", connected: true, isHost: true }];
    expect(run(
      input({ room: snap({ mode: "phones", hostId: "p1", screens: [] }) }),
      input({ room: snap({ mode: "screen", hostId: "s1", screens }) }),
    )).toEqual([null, "host-tv"]);
    // Every other phone sees the plain reconnect.
    expect(run(
      input({ youId: "p2", room: snap({ mode: "phones", hostId: "p1", screens: [] }) }),
      input({ youId: "p2", room: snap({ mode: "screen", hostId: "s1", screens }) }),
    )).toEqual([null, "tv-back"]);
  });

  it("raises host-player when another player takes host from you mid-game", () => {
    expect(run(
      input({ room: snap({ mode: "phones", hostId: "p1" }) }),
      input({ room: snap({ mode: "phones", hostId: "p2" }) }),
    )).toEqual([null, "host-player"]);
  });

  it("raises nothing for losing host outside a game or across a reconnect", () => {
    const screens = [{ id: "s1", connected: true, isHost: true }];
    expect(run(
      input({ room: snap({ phase: "lobby", hostId: "p1" }) }),
      input({ room: snap({ phase: "lobby", hostId: "s1", screens }) }),
    )).toEqual([null, null]);
    expect(run(
      input({ room: snap({ mode: "phones", hostId: "p1" }) }),
      input({ session: 2, room: snap({ hostId: "s1", screens }) }),
    )).toEqual([null, null]);
  });

  it("names the new host in host-player text, and falls back when unknown", () => {
    const players = [{ id: "p2", name: "Bea", avatar: { emoji: "🐙", color: "#ff0000" }, connected: true, isHost: true }];
    expect(noticeText("host-player", snap({ hostId: "p2", players }))).toBe("Bea is the host now");
    expect(noticeText("host-player", snap({ hostId: "p9", players }))).toBe("You're no longer the host");
    expect(noticeText("host-tv", snap())).toBe(NOTICE_TEXT["host-tv"]);
  });

  it("raises nothing without a room or identity", () => {
    expect(run(input({ room: null }), input({ youId: null }))).toEqual([null, null]);
  });

  it("has short text for every notice", () => {
    for (const t of Object.values(NOTICE_TEXT)) expect(t.length).toBeLessThan(40);
  });
});
