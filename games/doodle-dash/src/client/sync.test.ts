import { describe, expect, it } from "vitest";
import type { Stroke } from "../rules";
import { QUIET_MS, RACE_MS, acceptOp, resetLive, shouldAdoptView, type LiveSeq, type SyncInput } from "./sync";

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
  recentOps: [],
  now: 100_000,
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

  it("keeps the local list when live ops that arrived just now explain why the view is behind", () => {
    // The view was queued for render, then ops 5..7 arrived before the effect ran.
    const recentOps = [5, 6, 7].map((seq) => ({ seq, at: base.now - 20 }));
    expect(shouldAdoptView({ ...base, viewOpSeq: 4, localSeq: 7, recentOps })).toBe(false);
  });

  it("adopts a view behind the local seq when recent ops don't explain it (server restarted)", () => {
    expect(shouldAdoptView({ ...base, viewOpSeq: 10, localSeq: 50 })).toBe(true);
    const old = [11, 12].map((seq) => ({ seq, at: base.now - RACE_MS - 1 }));
    expect(shouldAdoptView({ ...base, viewOpSeq: 10, localSeq: 12, recentOps: old })).toBe(true);
    // Only part of the gap arrived recently.
    expect(shouldAdoptView({ ...base, viewOpSeq: 10, localSeq: 12, recentOps: [{ seq: 12, at: base.now }] })).toBe(true);
  });

  it("accepts live ops again after adopting a reset server's view", () => {
    const live: LiveSeq = { seq: 50, recent: [] };
    expect(acceptOp(live, 11, base.now)).toBe(false);
    expect(shouldAdoptView({ ...base, viewOpSeq: 10, localSeq: live.seq, recentOps: live.recent })).toBe(true);
    resetLive(live, 10);
    expect(acceptOp(live, 11, base.now)).toBe(true);
    expect(live.seq).toBe(11);
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

describe("acceptOp", () => {
  it("drops stale or duplicate ops and remembers only the last RACE_MS of accepted ones", () => {
    const live: LiveSeq = { seq: 3, recent: [] };
    expect(acceptOp(live, 3, 0)).toBe(false);
    expect(acceptOp(live, 4, 0)).toBe(true);
    expect(acceptOp(live, 5, RACE_MS + 1)).toBe(true);
    expect(live.recent).toEqual([{ seq: 5, at: RACE_MS + 1 }]);
  });
});
