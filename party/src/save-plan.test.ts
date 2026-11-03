import { describe, expect, it } from "vitest";
import type { SavedRoom } from "./room-core";
import { ROOM_KEY, SavePlanner, getBatched, partKey } from "./save-plan";

const saved = { v: 1 } as unknown as SavedRoom;
const parts = (revs: Record<string, string>) =>
  Object.fromEntries(Object.entries(revs).map(([k, rev]) => [k, { rev, value: `${k}@${rev}` }]));
/** The room record as written: the saved room plus the revs of the parts written beside it. */
const room = (partRevs?: Record<string, string>) => (partRevs ? { ...saved, partRevs } : saved);

describe("SavePlanner", () => {
  it("writes the room every time and a part only when its rev changes", () => {
    const p = new SavePlanner();
    expect(p.plan({ saved, parts: parts({ a: "1", b: "1" }) })).toEqual({
      put: { [ROOM_KEY]: room({ a: "1", b: "1" }), [partKey("a")]: "a@1", [partKey("b")]: "b@1" },
      del: [],
    });
    expect(p.plan({ saved, parts: parts({ a: "1", b: "1" }) })).toEqual({ put: { [ROOM_KEY]: room({ a: "1", b: "1" }) }, del: [] });
    expect(p.plan({ saved, parts: parts({ a: "1", b: "2" }) })).toEqual({
      put: { [ROOM_KEY]: room({ a: "1", b: "2" }), [partKey("b")]: "b@2" },
      del: [],
    });
  });

  it("deletes parts that are gone", () => {
    const p = new SavePlanner();
    p.plan({ saved, parts: parts({ a: "1", b: "1" }) });
    expect(p.plan({ saved, parts: parts({ a: "1" }) })).toEqual({ put: { [ROOM_KEY]: room({ a: "1" }) }, del: [partKey("b")] });
    expect(p.plan({ saved, parts: {} })).toEqual({ put: { [ROOM_KEY]: room() }, del: [partKey("a")] });
  });

  it("after a wake without known revs (older saves), rewrites restored parts once and deletes the ones no longer present", () => {
    const p = new SavePlanner();
    p.restored(["a", "b"]);
    expect(p.plan({ saved, parts: parts({ a: "1" }) })).toEqual({ put: { [ROOM_KEY]: room({ a: "1" }), [partKey("a")]: "a@1" }, del: [partKey("b")] });
  });

  it("after a wake with the revs from the room record, rewrites only parts that changed since", () => {
    const p = new SavePlanner();
    p.restored(["a", "b", "c"], { a: "1", b: "1", c: 7, constructor: "x" });
    expect(p.plan({ saved, parts: parts({ a: "1", b: "2", c: "7" }) })).toEqual({
      put: { [ROOM_KEY]: room({ a: "1", b: "2", c: "7" }), [partKey("b")]: "b@2", [partKey("c")]: "c@7" },
      del: [],
    });
  });

  it("round-trips: the revs it writes into the room record are the ones restored() takes", () => {
    const p = new SavePlanner();
    const first = p.plan({ saved, parts: parts({ a: "1", b: "1" }) });
    const woken = new SavePlanner();
    woken.restored(["a", "b"], (first.put[ROOM_KEY] as { partRevs: Record<string, string> }).partRevs);
    expect(woken.plan({ saved, parts: parts({ a: "1", b: "1" }) })).toEqual({ put: { [ROOM_KEY]: room({ a: "1", b: "1" }) }, del: [] });
  });

  it("writes everything again after a reset (storage wiped)", () => {
    const p = new SavePlanner();
    p.plan({ saved, parts: parts({ a: "1" }) });
    p.reset();
    expect(Object.keys(p.plan({ saved, parts: parts({ a: "1" }) }).put)).toEqual([ROOM_KEY, partKey("a")]);
  });
});

describe("getBatched", () => {
  it("reads at most `batch` keys per call and merges every result", async () => {
    const keys = Array.from({ length: 300 }, (_, i) => partKey(`strokes.${i}`));
    const calls: number[] = [];
    const get = async (ks: string[]) => {
      calls.push(ks.length);
      if (ks.length > 128) throw new Error("too many keys");
      return new Map(ks.map((k) => [k, `v:${k}`]));
    };
    const out = await getBatched(get, keys, 128);
    expect(calls).toEqual([128, 128, 44]);
    expect([...out.keys()]).toEqual(keys);
    expect(out.get(keys[299]!)).toBe(`v:${keys[299]}`);
  });

  it("makes no call for no keys", async () => {
    let called = false;
    const out = await getBatched(async () => ((called = true), new Map()), [], 128);
    expect(out.size).toBe(0);
    expect(called).toBe(false);
  });
});
