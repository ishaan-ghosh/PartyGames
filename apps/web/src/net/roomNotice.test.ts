import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@party/shared";
import {
  NOTICE_HOLD_MS, NOTICE_TEXT, NO_NOTICES, noticeText, observeRoom, trackNotice,
  type NoticeBaseline, type NoticeInput, type NoticeTracker, type RoomNoticeKind,
} from "./roomNotice";

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

/**
 * Plays a timeline through trackNotice the way the hook does: each entry is a room update at time `at`,
 * and whenever a notice is due before the next update, the timer re-checks the latest input at `due`.
 * Returns every notice told, with when.
 */
function timeline(...steps: [at: number, input: NoticeInput][]): [number, RoomNoticeKind][] {
  let t: NoticeTracker = NO_NOTICES;
  let last: NoticeInput | null = null;
  const told: [number, RoomNoticeKind][] = [];
  const feed = (i: NoticeInput, now: number) => {
    const r = trackNotice(t, i, now);
    t = r.tracker;
    if (r.notice) told.push([now, r.notice]);
  };
  const all: [number, NoticeInput | null][] = [...steps, [Infinity, null]];
  for (const [at, i] of all) {
    while (last && t.due !== null && t.due <= at) feed(last, t.due);
    if (!i) break;
    feed(i, at);
    last = i;
  }
  return told;
}

describe("trackNotice (held TV notices, immediate host notices)", () => {
  const screen = (over: Partial<RoomSnapshot> = {}) => input({ room: snap(over) });
  const phones = (over: Partial<RoomSnapshot> = {}) => input({ room: snap({ mode: "phones", ...over }) });
  const tvHost = [{ id: "s1", connected: true, isHost: true }];

  it("says nothing when the TV reloads within the hold", () => {
    expect(timeline([0, screen()], [1000, phones()], [2500, screen()])).toEqual([]);
  });

  it("says TV disconnected once the TV has been gone for the hold, then TV reconnected when it returns", () => {
    expect(timeline([0, screen()], [1000, phones()], [10_000, screen()])).toEqual([
      [1000 + NOTICE_HOLD_MS, "tv-lost"],
      [10_000 + NOTICE_HOLD_MS, "tv-back"],
    ]);
  });

  it("says nothing if the TV is back just before the hold ends", () => {
    expect(timeline([0, screen()], [1000, phones()], [1000 + NOTICE_HOLD_MS - 1, screen()])).toEqual([]);
  });

  it("says nothing more when the TV drops again right after reconnecting", () => {
    expect(timeline([0, screen()], [1000, phones()], [10_000, screen()], [11_000, phones()])).toEqual([
      [1000 + NOTICE_HOLD_MS, "tv-lost"],
    ]);
  });

  it("doesn't extend the hold for further changes while one is pending", () => {
    // The host change at 2000 raises its own notice (told at once) and doesn't push the TV notice back.
    expect(timeline([0, screen()], [1000, phones()], [2000, phones({ hostId: "p1" })])).toEqual([
      [2000, "host"],
      [1000 + NOTICE_HOLD_MS, "tv-lost"],
    ]);
  });

  it("starts a fresh hold after a change is undone, so a later quick drop isn't told early", () => {
    expect(timeline([0, screen()], [1000, phones()], [2000, screen()], [3900, phones()], [4100, screen()])).toEqual([]);
  });

  it("tells you're the host at once", () => {
    expect(timeline([0, phones()], [1000, phones({ hostId: "p1" })])).toEqual([[1000, "host"]]);
  });

  it("tells someone else took host from you at once", () => {
    expect(timeline([0, phones({ hostId: "p1" })], [1000, phones({ hostId: "p2" })])).toEqual([[1000, "host-player"]]);
  });

  it("tells every host change at once, even a quick bounce", () => {
    expect(timeline([0, phones()], [500, phones({ hostId: "p1" })], [2000, phones({ hostId: "p2" })])).toEqual([
      [500, "host"],
      [2000, "host-player"],
    ]);
  });

  it("tells you're the host at once and TV disconnected after the hold when both change together", () => {
    expect(timeline([0, screen()], [1000, phones({ hostId: "p1" })])).toEqual([
      [1000, "host"],
      [1000 + NOTICE_HOLD_MS, "tv-lost"],
    ]);
  });

  it("on a quick TV reload tells only the host changes: you're the host, then the TV is the host again", () => {
    expect(timeline(
      [0, screen({ hostId: "s1", screens: tvHost })],
      [1000, phones({ hostId: "p1" })],
      [2500, screen({ hostId: "s1", screens: tvHost })],
    )).toEqual([[1000, "host"], [2500, "host-tv"]]);
  });

  it("lets the TV is the host again stand for TV reconnected, so it isn't told twice", () => {
    expect(timeline(
      [0, phones({ hostId: "p1" })],
      [1000, screen({ hostId: "s1", screens: tvHost })],
    )).toEqual([[1000, "host-tv"]]);
    // Also when the TV came back (TV reconnected pending) before reclaiming host.
    expect(timeline(
      [0, phones({ hostId: "p1" })],
      [1000, screen({ hostId: "p1" })],
      [2000, screen({ hostId: "s1", screens: tvHost })],
    )).toEqual([[2000, "host-tv"]]);
  });

  it("still tells TV reconnected to the other phones when the TV returns and reclaims host", () => {
    expect(timeline([0, phones({ hostId: "p2" })], [1000, screen({ hostId: "s1", screens: tvHost })]))
      .toEqual([[1000 + NOTICE_HOLD_MS, "tv-back"]]);
  });

  it("prefers a host notice over a TV notice that falls due on the same update, absorbing the TV change", () => {
    let t: NoticeTracker = NO_NOTICES;
    t = trackNotice(t, screen(), 0).tracker;
    t = trackNotice(t, phones(), 1000).tracker;
    // The timer slipped: the next thing seen is a host change after the TV notice was due.
    const r = trackNotice(t, phones({ hostId: "p1" }), 1000 + NOTICE_HOLD_MS + 50);
    expect(r.notice).toBe("host");
    expect(r.tracker.due).toBeNull();
    expect(trackNotice(r.tracker, phones({ hostId: "p1" }), 10_000).notice).toBeNull();
  });

  it("drops a pending notice when the game ends, the socket drops or the session changes", () => {
    expect(timeline([0, screen()], [1000, phones()], [2000, phones({ phase: "lobby" })])).toEqual([]);
    expect(timeline([0, screen()], [1000, phones()], [2000, input({ status: "reconnecting", room: snap({ mode: "phones" }) })]))
      .toEqual([]);
    expect(timeline([0, screen()], [1000, phones()], [2000, input({ session: 2, room: snap({ mode: "phones" }) })]))
      .toEqual([]);
  });

  it("says nothing for host changes outside a game", () => {
    expect(timeline([0, phones({ phase: "lobby" })], [1000, phones({ phase: "lobby", hostId: "p1" })])).toEqual([]);
  });

  it("says nothing on the first snapshot of a session", () => {
    expect(timeline([0, phones({ hostId: "p1" })], [10_000, phones({ hostId: "p1" })])).toEqual([]);
  });
});
