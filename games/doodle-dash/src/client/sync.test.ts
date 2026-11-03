import { describe, expect, it } from "vitest";
import type { Stroke, StrokeOp } from "../rules";
import { BUFFER_MAX, BUFFER_MS, QUIET_MS, adoptView, receiveOp, shouldAdoptView, type LiveSeq, type SyncInput } from "./sync";

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
    const live: LiveSeq = { seq: 3, buffer: [] };
    expect(receiveOp(live, begin(4), NOW)).toBe(true);
    expect(live.seq).toBe(4);
  });

  it("ignores duplicates and stale ops", () => {
    const live: LiveSeq = { seq: 4, buffer: [] };
    expect(receiveOp(live, begin(4), NOW)).toBe(false);
    expect(receiveOp(live, begin(2), NOW)).toBe(false);
    expect(live.seq).toBe(4);
  });

  it("does not apply an op after a gap (the next view resyncs)", () => {
    const live: LiveSeq = { seq: 4, buffer: [] };
    expect(receiveOp(live, begin(6), NOW)).toBe(false);
    expect(live.seq).toBe(4);
  });

  it("keeps the buffer within the time window and count cap", () => {
    const live: LiveSeq = { seq: 0, buffer: [] };
    receiveOp(live, begin(1), NOW - BUFFER_MS - 1);
    receiveOp(live, begin(2), NOW);
    expect(live.buffer.map((b) => b.op.seq)).toEqual([2]);
    for (let q = 3; q < BUFFER_MAX + 10; q++) receiveOp(live, begin(q), NOW);
    expect(live.buffer).toHaveLength(BUFFER_MAX);
  });
});

describe("adoptView", () => {
  it("replays buffered ops past a reconnect view even when the local seq was further behind (F1)", () => {
    const live: LiveSeq = { seq: 10, buffer: [] };
    // Ops 16, 17 arrive before the reconnect view (opSeq 15) reaches the effect: not applicable yet.
    expect(receiveOp(live, begin(16), NOW)).toBe(false);
    expect(receiveOp(live, begin(17), NOW)).toBe(false);
    const strokes = adoptView(live, [pen(1, [0, 0])], 15);
    expect(ids(strokes)).toEqual([1, 16, 17]);
    expect(live.seq).toBe(17);
  });

  it("rebuilds the same list when a view was merely overtaken by contiguous live ops", () => {
    const live: LiveSeq = { seq: 4, buffer: [] };
    let local: Stroke[] = [pen(1, [0, 0])];
    for (const op of [begin(5), begin(6)]) if (receiveOp(live, op, NOW)) local = [...local, ...(op.op === "begin" ? [op.stroke] : [])];
    const strokes = adoptView(live, [pen(1, [0, 0])], 4);
    expect(ids(strokes)).toEqual(ids(local));
    expect(live.seq).toBe(6);
  });

  it("recovers from a server restart: ops the new server sent before its view are replayed (F3)", () => {
    const live: LiveSeq = { seq: 50, buffer: [] };
    expect(receiveOp(live, begin(11), NOW)).toBe(false); // stale by the old seq, but buffered
    const strokes = adoptView(live, [pen(1, [0, 0])], 10);
    expect(ids(strokes)).toEqual([1, 11]);
    expect(live.seq).toBe(11);
    expect(receiveOp(live, begin(12), NOW)).toBe(true);
  });

  it("stops replaying at the first gap", () => {
    const live: LiveSeq = { seq: 10, buffer: [] };
    receiveOp(live, begin(12), NOW);
    receiveOp(live, begin(14), NOW);
    const strokes = adoptView(live, [], 11);
    expect(ids(strokes)).toEqual([12]);
    expect(live.seq).toBe(12);
  });

  it("prefers the most recently received op when a seq repeats (old server vs restarted one)", () => {
    const live: LiveSeq = { seq: 10, buffer: [] };
    receiveOp(live, begin(11, 111), NOW - 10);
    live.seq = 50; // old server moved on, then restarted
    receiveOp(live, begin(11, 211), NOW);
    expect(ids(adoptView(live, [], 10))).toEqual([211]);
  });
});
