import { describe, expect, it } from "vitest";
import { strokeSignature, type Stroke, type StrokeOp } from "../rules";
import { applyOp } from "./strokes";
import { QUIET_MS, RESYNC_RETRY_MS, drawerIdle, receiveOp, receiveSync, receiveView, type LiveSeq, type ViewInput } from "./sync";

const pen = (id: number, points: number[]): Stroke => ({ id, tool: "pen", color: 0, size: 0, points });
const begin = (seq: number, id = seq): StrokeOp => ({ op: "begin", seq, stroke: pen(id, [0, 0]) });
const sync = (seq: number, strokes: Stroke[]): Extract<StrokeOp, { op: "sync" }> => ({ op: "sync", seq, strokes });
const ids = (strokes: readonly Stroke[]) => strokes.map((x) => x.id);
const live = (seq: number, dirty = false): LiveSeq => ({ seq, dirty });

const one = [pen(1, [0, 0])];
const base: ViewInput = { ownsCanvas: false, turnChanged: false, viewOpSeq: 5, viewSig: strokeSignature(one), localStrokes: one, idle: true };

describe("receiveOp", () => {
  it("applies only the next op in sequence", () => {
    const l = live(3);
    expect(receiveOp(l, begin(4))).toEqual({ apply: true, resync: false });
    expect(l.seq).toBe(4);
  });

  it("ignores duplicates and stale ops", () => {
    const l = live(4);
    expect(receiveOp(l, begin(4)).apply).toBe(false);
    expect(receiveOp(l, begin(2)).apply).toBe(false);
    expect(l.seq).toBe(4);
  });

  it("applies an op after a gap best-effort, marks the list dirty and asks for a sync", () => {
    const l = live(4);
    expect(receiveOp(l, begin(6))).toEqual({ apply: true, resync: true });
    expect(l).toEqual({ seq: 6, dirty: true });
    expect(receiveOp(l, begin(7))).toEqual({ apply: true, resync: false });
  });
});

describe("receiveSync", () => {
  it("adopts the server's list and version, even one behind the local seq (restarted server)", () => {
    const l = live(50);
    const got = receiveSync(l, sync(10, [pen(1, [0, 0]), pen(2, [0, 0])]), { ownsCanvas: false, idle: true, localStrokes: [] });
    expect(got && ids(got)).toEqual([1, 2]);
    expect(l).toEqual({ seq: 10, dirty: false });
    expect(receiveOp(l, begin(11)).apply).toBe(true);
  });

  it("keeps the local objects for a same-shape sync when clean (no full redraw)", () => {
    const l = live(5);
    expect(receiveSync(l, sync(5, [pen(9, [0, 0])]), { ownsCanvas: false, idle: true, localStrokes: one })).toBeNull();
  });

  it("replaces a dirty list even when the shape matches", () => {
    const l = live(5, true);
    const got = receiveSync(l, sync(6, [pen(9, [0, 0])]), { ownsCanvas: false, idle: true, localStrokes: one });
    expect(got && ids(got)).toEqual([9]);
    expect(l.dirty).toBe(false);
  });

  it("never overwrites a busy drawer's optimistic list", () => {
    const l = live(5, true);
    expect(receiveSync(l, sync(6, []), { ownsCanvas: true, idle: false, localStrokes: one })).toBeNull();
    expect(l).toEqual({ seq: 5, dirty: true });
    expect(receiveSync(l, sync(6, []), { ownsCanvas: true, idle: true, localStrokes: one })).toEqual([]);
  });

  it("applyOp treats a sync op as the whole list", () => {
    expect(applyOp(one, sync(3, []))).toEqual([]);
  });
});

describe("receiveView: viewers", () => {
  it("does nothing for a view at the local seq with the same shape", () => {
    const l = live(5);
    expect(receiveView(l, base)).toEqual({ strokes: null, resync: false });
    expect(l).toEqual({ seq: 5, dirty: false });
  });

  it("asks for a sync when the shape differs at the same seq", () => {
    const l = live(5);
    expect(receiveView(l, { ...base, viewSig: "1:4" })).toEqual({ strokes: null, resync: true });
    expect(l.dirty).toBe(true);
  });

  it("asks for a sync when the view is ahead with a different shape (missed ops)", () => {
    expect(receiveView(live(5), { ...base, viewOpSeq: 9, viewSig: "3:6" }).resync).toBe(true);
  });

  it("fast-forwards the version when the view is ahead but the shape matches (e.g. a former drawer)", () => {
    const l = live(2);
    expect(receiveView(l, { ...base, viewOpSeq: 9 })).toEqual({ strokes: null, resync: false });
    expect(l.seq).toBe(9);
  });

  it("ignores a view overtaken by live ops", () => {
    const l = live(7);
    expect(receiveView(l, { ...base, viewOpSeq: 5, viewSig: "0:0" })).toEqual({ strokes: null, resync: false });
    expect(l.seq).toBe(7);
  });

  it("keeps asking while dirty, until a sync lands", () => {
    const l = live(5, true);
    expect(receiveView(l, base).resync).toBe(true);
    expect(receiveView(l, { ...base, viewOpSeq: 3 }).resync).toBe(true);
  });

  it("starts a new turn empty at the view's version", () => {
    const l = live(40, true);
    expect(receiveView(l, { ...base, turnChanged: true, viewOpSeq: 41, viewSig: "0:0" })).toEqual({ strokes: [], resync: false });
    expect(l).toEqual({ seq: 41, dirty: false });
    expect(receiveOp(l, begin(42)).resync).toBe(false);
  });

  it("asks for a sync when the first view of a new turn already has ink (an earlier view was skipped)", () => {
    const l = live(40);
    expect(receiveView(l, { ...base, turnChanged: true, viewOpSeq: 45, viewSig: "2:4" })).toEqual({ strokes: [], resync: true });
  });
});

describe("receiveView: drawer", () => {
  const drawer: ViewInput = { ...base, ownsCanvas: true };

  it("keeps its list and settles when it matches the server", () => {
    const l = live(1, true);
    expect(receiveView(l, { ...drawer, viewOpSeq: 30 })).toEqual({ strokes: null, resync: false });
    expect(l).toEqual({ seq: 30, dirty: false });
  });

  it("asks for a sync when idle and the server's shape differs (dropped begin or append batch)", () => {
    expect(receiveView(live(1), { ...drawer, viewSig: "0:0" }).resync).toBe(true);
    expect(receiveView(live(1), { ...drawer, viewSig: "1:4" }).resync).toBe(true);
  });

  it("does not compare while busy", () => {
    expect(receiveView(live(1), { ...drawer, viewSig: "0:0", idle: false })).toEqual({ strokes: null, resync: false });
  });
});

describe("drawerIdle", () => {
  it("needs no pointer, no pending points and a quiet period longer than the outbox TTL", () => {
    expect(drawerIdle({ drawing: false, pendingPoints: 0, msSinceLastSend: QUIET_MS })).toBe(true);
    expect(drawerIdle({ drawing: true, pendingPoints: 0, msSinceLastSend: QUIET_MS })).toBe(false);
    expect(drawerIdle({ drawing: false, pendingPoints: 4, msSinceLastSend: QUIET_MS })).toBe(false);
    expect(drawerIdle({ drawing: false, pendingPoints: 0, msSinceLastSend: QUIET_MS - 1 })).toBe(false);
    expect(QUIET_MS).toBeGreaterThan(2000);
  });

  it("retries resync less often than the room answers it", () => {
    expect(RESYNC_RETRY_MS).toBeGreaterThan(1000);
  });
});
