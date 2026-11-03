import { describe, expect, it } from "vitest";
import type { Stroke, StrokeOp } from "../rules";
import { BUFFER_MAX, BUFFER_MS, QUIET_MS, REPLAY_MS, adoptView, receiveOp, shouldAdoptView, syncView, type LiveSeq, type SyncInput } from "./sync";

const pen = (id: number, points: number[]): Stroke => ({ id, tool: "pen", color: 0, size: 0, points });

const base: SyncInput = {
  ownsCanvas: false,
  turnChanged: false,
  viewOpSeq: 5,
  localSeq: 5,
  viewStrokes: [pen(1, [0, 0])],
  localStrokes: [pen(-1, [0, 0])],
  drawing: false,
  pendingPoints: 0,
  msSinceLastSend: 60_000,
};

describe("shouldAdoptView: viewers", () => {
  it("adopts a view that is newer than the live ops already applied", () => {
    expect(shouldAdoptView({ ...base, viewOpSeq: 9, localSeq: 5 })).toBe(true);
  });

  it("skips a view at the same op seq with the same shape (avoids a full redraw)", () => {
    expect(shouldAdoptView({ ...base, viewOpSeq: 5, localSeq: 5 })).toBe(false);
  });

  it("adopts a view at the same op seq whose shape differs from the local list", () => {
    expect(shouldAdoptView({ ...base, viewOpSeq: 5, localSeq: 5, viewStrokes: [pen(1, [0, 0, 1, 1])] })).toBe(true);
    expect(shouldAdoptView({ ...base, viewOpSeq: 5, localSeq: 5, viewStrokes: [pen(1, [0, 0]), pen(2, [1, 1])] })).toBe(true);
  });

  it("adopts a view behind the local seq (overtaken by live ops, or a restarted server)", () => {
    expect(shouldAdoptView({ ...base, viewOpSeq: 4, localSeq: 7 })).toBe(true);
    expect(shouldAdoptView({ ...base, viewOpSeq: 10, localSeq: 50 })).toBe(true);
  });

  it("always adopts on a new turn", () => {
    expect(shouldAdoptView({ ...base, viewOpSeq: 0, localSeq: 99, turnChanged: true })).toBe(true);
  });
});

describe("shouldAdoptView: drawer", () => {
  const drawer: SyncInput = { ...base, ownsCanvas: true };

  it("keeps its optimistic list when it matches the server", () => {
    expect(shouldAdoptView({ ...drawer, viewStrokes: [pen(1, [0, 0, 1, 1])], localStrokes: [pen(-1, [0, 0, 1, 1])] })).toBe(false);
  });

  it("resyncs when the server has a different number of strokes and the drawer is idle", () => {
    expect(shouldAdoptView({ ...drawer, viewStrokes: [], localStrokes: [pen(-1, [0, 0]), pen(-2, [1, 1])] })).toBe(true);
  });

  it("resyncs when the server dropped an append batch (same count, fewer points)", () => {
    expect(shouldAdoptView({ ...drawer, viewStrokes: [pen(1, [0, 0])], localStrokes: [pen(-1, [0, 0, 0.5, 0.5])] })).toBe(true);
  });

  it("does not resync while a pointer is down", () => {
    expect(shouldAdoptView({ ...drawer, viewStrokes: [], drawing: true })).toBe(false);
  });

  it("does not resync while points are waiting to be sent", () => {
    expect(shouldAdoptView({ ...drawer, viewStrokes: [], pendingPoints: 4 })).toBe(false);
  });

  it("does not resync from a view that may predate actions still in flight", () => {
    expect(shouldAdoptView({ ...drawer, viewStrokes: [], msSinceLastSend: QUIET_MS - 1 })).toBe(false);
    expect(shouldAdoptView({ ...drawer, viewStrokes: [], msSinceLastSend: QUIET_MS })).toBe(true);
  });

  it("waits longer than the outbox's 2 s action TTL before trusting a view", () => {
    expect(QUIET_MS).toBeGreaterThan(2000);
  });

  it("always adopts on a new turn", () => {
    expect(shouldAdoptView({ ...drawer, turnChanged: true, drawing: true })).toBe(true);
  });
});

const begin = (seq: number, id = seq): StrokeOp => ({ op: "begin", seq, stroke: pen(id, [0, 0]) });
const ids = (strokes: readonly Stroke[]) => strokes.map((x) => x.id);
const NOW = 100_000;

describe("receiveOp", () => {
  it("applies only the next op in sequence", () => {
    const live: LiveSeq = { seq: 3, buffer: [], dirty: false };
    expect(receiveOp(live, begin(4), NOW)).toBe(true);
    expect(live.seq).toBe(4);
  });

  it("ignores duplicates and stale ops", () => {
    const live: LiveSeq = { seq: 4, buffer: [], dirty: false };
    expect(receiveOp(live, begin(4), NOW)).toBe(false);
    expect(receiveOp(live, begin(2), NOW)).toBe(false);
    expect(live.seq).toBe(4);
  });

  it("applies an op after a gap best-effort and marks the list dirty until the next view", () => {
    const live: LiveSeq = { seq: 4, buffer: [], dirty: false };
    expect(receiveOp(live, begin(6), NOW)).toBe(true);
    expect(live.seq).toBe(6);
    expect(live.dirty).toBe(true);
    expect(receiveOp(live, begin(7), NOW)).toBe(true);
  });

  it("keeps the buffer within the time window and count cap", () => {
    const live: LiveSeq = { seq: 0, buffer: [], dirty: false };
    receiveOp(live, begin(1), NOW - BUFFER_MS - 1);
    receiveOp(live, begin(2), NOW);
    expect(live.buffer.map((b) => b.op.seq)).toEqual([2]);
    for (let q = 3; q < BUFFER_MAX + 10; q++) receiveOp(live, begin(q), NOW);
    expect(live.buffer).toHaveLength(BUFFER_MAX);
  });
});

describe("adoptView", () => {
  it("replays buffered ops past a reconnect view even when the local seq was further behind (F1)", () => {
    const live: LiveSeq = { seq: 10, buffer: [], dirty: false };
    // Ops 16, 17 arrive before the reconnect view (opSeq 15) reaches the effect: applied best-effort.
    expect(receiveOp(live, begin(16), NOW)).toBe(true);
    expect(receiveOp(live, begin(17), NOW)).toBe(true);
    expect(live.dirty).toBe(true);
    const strokes = syncView(live, { ...base, viewOpSeq: 15, localSeq: live.seq, viewStrokes: [pen(1, [0, 0])], localStrokes: [pen(16, [0, 0]), pen(17, [0, 0])] }, NOW);
    expect(strokes && ids(strokes)).toEqual([1, 16, 17]);
    expect(live.dirty).toBe(false);
    expect(live.seq).toBe(17);
  });

  it("rebuilds the same list when a view was merely overtaken by contiguous live ops", () => {
    const live: LiveSeq = { seq: 4, buffer: [], dirty: false };
    let local: Stroke[] = [pen(1, [0, 0])];
    for (const op of [begin(5), begin(6)]) if (receiveOp(live, op, NOW)) local = [...local, ...(op.op === "begin" ? [op.stroke] : [])];
    const strokes = adoptView(live, [pen(1, [0, 0])], 4, NOW);
    expect(ids(strokes)).toEqual(ids(local));
    expect(live.seq).toBe(6);
  });

  it("recovers from a server restart: ops the new server sent before its view are replayed (F3)", () => {
    const live: LiveSeq = { seq: 50, buffer: [], dirty: false };
    expect(receiveOp(live, begin(11), NOW)).toBe(false); // stale by the old seq, but buffered
    const strokes = adoptView(live, [pen(1, [0, 0])], 10, NOW);
    expect(ids(strokes)).toEqual([1, 11]);
    expect(live.seq).toBe(11);
    expect(receiveOp(live, begin(12), NOW)).toBe(true);
  });

  it("stops replaying at the first gap", () => {
    const live: LiveSeq = { seq: 10, buffer: [], dirty: false };
    receiveOp(live, begin(12), NOW);
    receiveOp(live, begin(14), NOW);
    const strokes = adoptView(live, [], 11, NOW);
    expect(ids(strokes)).toEqual([12]);
    expect(live.seq).toBe(12);
  });

  it("prefers the most recently received op when a seq repeats (old server vs restarted one)", () => {
    const live: LiveSeq = { seq: 10, buffer: [], dirty: false };
    receiveOp(live, begin(11, 111), NOW - 10);
    live.seq = 50; // old server moved on, then restarted
    receiveOp(live, begin(11, 211), NOW);
    expect(ids(adoptView(live, [], 10, NOW))).toEqual([211]);
  });

  it("does not replay ops older than REPLAY_MS (pre-restart ops would be ghosts)", () => {
    const live: LiveSeq = { seq: 10, buffer: [], dirty: false };
    receiveOp(live, begin(11), 0);
    receiveOp(live, begin(12), 0);
    const strokes = adoptView(live, [pen(1, [0, 0])], 10, 3000);
    expect(ids(strokes)).toEqual([1]);
    expect(live.seq).toBe(10);
    expect(REPLAY_MS).toBeLessThan(3000);
  });
});

describe("syncView", () => {
  it("keeps the local list when a viewer's view was only overtaken by live ops (no full redraw)", () => {
    const live: LiveSeq = { seq: 4, buffer: [], dirty: false };
    receiveOp(live, begin(5), NOW);
    receiveOp(live, begin(6), NOW);
    const local = [pen(1, [0, 0]), pen(5, [0, 0]), pen(6, [0, 0])];
    expect(syncView(live, { ...base, viewOpSeq: 4, localSeq: live.seq, viewStrokes: [pen(1, [0, 0])], localStrokes: local }, NOW)).toBeNull();
    expect(live.seq).toBe(6);
  });

  it("adopts when the replayed result differs from the local list", () => {
    const live: LiveSeq = { seq: 4, buffer: [], dirty: false };
    receiveOp(live, begin(5), NOW);
    // Local list lost a point the server has: view [1 with 2 points] + op 5 differs from local.
    const strokes = syncView(live, { ...base, viewOpSeq: 4, localSeq: live.seq, viewStrokes: [pen(1, [0, 0, 1, 1])], localStrokes: [pen(1, [0, 0]), pen(5, [0, 0])] }, NOW);
    expect(strokes && ids(strokes)).toEqual([1, 5]);
    expect(live.seq).toBe(5);
  });

  it("a dirty list forces adoption of an equal-seq, same-shape view", () => {
    const live: LiveSeq = { seq: 6, buffer: [], dirty: true };
    const input = { ...base, viewOpSeq: 6, localSeq: 6, viewStrokes: [pen(1, [0, 0])], localStrokes: [pen(9, [0, 0])] };
    expect(shouldAdoptView(input)).toBe(false);
    const strokes = syncView(live, input, NOW);
    expect(strokes && ids(strokes)).toEqual([1]);
    expect(live.dirty).toBe(false);
  });

  it("skips an equal-seq, same-shape view when clean", () => {
    const live: LiveSeq = { seq: 5, buffer: [], dirty: false };
    expect(syncView(live, base, NOW)).toBeNull();
  });
});
