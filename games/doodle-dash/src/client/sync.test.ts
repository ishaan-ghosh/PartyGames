import { describe, expect, it } from "vitest";
import type { Stroke } from "../rules";
import { QUIET_MS, shouldAdoptView, type SyncInput } from "./sync";

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
  it("adopts a view that is as new as the live ops already applied", () => {
    expect(shouldAdoptView({ ...base, viewOpSeq: 5, localSeq: 5 })).toBe(true);
    expect(shouldAdoptView({ ...base, viewOpSeq: 9, localSeq: 5 })).toBe(true);
  });

  it("keeps the local list when live ops are already ahead of the view", () => {
    expect(shouldAdoptView({ ...base, viewOpSeq: 4, localSeq: 7 })).toBe(false);
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

  it("always adopts on a new turn", () => {
    expect(shouldAdoptView({ ...drawer, turnChanged: true, drawing: true })).toBe(true);
  });
});
