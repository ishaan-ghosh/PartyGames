import { describe, expect, it } from "vitest";
import type { SavedRoom } from "./room-core";
import { ROOM_KEY, SavePlanner, partKey } from "./save-plan";

const saved = { v: 1 } as unknown as SavedRoom;
const parts = (revs: Record<string, string>) =>
  Object.fromEntries(Object.entries(revs).map(([k, rev]) => [k, { rev, value: `${k}@${rev}` }]));

describe("SavePlanner", () => {
  it("writes the room every time and a part only when its rev changes", () => {
    const p = new SavePlanner();
    expect(p.plan({ saved, parts: parts({ a: "1", b: "1" }) })).toEqual({
      put: { [ROOM_KEY]: saved, [partKey("a")]: "a@1", [partKey("b")]: "b@1" },
      del: [],
    });
    expect(p.plan({ saved, parts: parts({ a: "1", b: "1" }) })).toEqual({ put: { [ROOM_KEY]: saved }, del: [] });
    expect(p.plan({ saved, parts: parts({ a: "1", b: "2" }) })).toEqual({ put: { [ROOM_KEY]: saved, [partKey("b")]: "b@2" }, del: [] });
  });

  it("deletes parts that are gone", () => {
    const p = new SavePlanner();
    p.plan({ saved, parts: parts({ a: "1", b: "1" }) });
    expect(p.plan({ saved, parts: parts({ a: "1" }) })).toEqual({ put: { [ROOM_KEY]: saved }, del: [partKey("b")] });
    expect(p.plan({ saved, parts: {} }).del).toEqual([partKey("a")]);
  });

  it("after a wake, rewrites restored parts once and deletes the ones no longer present", () => {
    const p = new SavePlanner();
    p.restored(["a", "b"]);
    expect(p.plan({ saved, parts: parts({ a: "1" }) })).toEqual({ put: { [ROOM_KEY]: saved, [partKey("a")]: "a@1" }, del: [partKey("b")] });
  });

  it("writes everything again after a reset (storage wiped)", () => {
    const p = new SavePlanner();
    p.plan({ saved, parts: parts({ a: "1" }) });
    p.reset();
    expect(Object.keys(p.plan({ saved, parts: parts({ a: "1" }) }).put)).toEqual([ROOM_KEY, partKey("a")]);
  });
});
