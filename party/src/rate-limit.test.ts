import { describe, expect, it } from "vitest";
import { RejectLog, TokenBucket } from "./rate-limit";

describe("TokenBucket", () => {
  it("allows a full burst, then refuses until tokens refill", () => {
    const b = new TokenBucket(3, 1, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(999)).toBe(false);
    expect(b.take(1000)).toBe(true);
    expect(b.take(1000)).toBe(false);
  });

  it("refills continuously but never above capacity", () => {
    const b = new TokenBucket(2, 10, 0);
    b.take(0);
    b.take(0);
    expect(b.take(50)).toBe(false); // half a token
    expect(b.take(100)).toBe(true);
    // A long idle stretch only restores the burst, not more.
    for (let i = 0; i < 2; i++) expect(b.take(60_000)).toBe(true);
    expect(b.take(60_000)).toBe(false);
  });

  it("ignores clocks that go backwards", () => {
    const b = new TokenBucket(1, 1, 1000);
    expect(b.take(1000)).toBe(true);
    expect(b.take(500)).toBe(false);
    expect(b.take(1999)).toBe(false);
    expect(b.take(2000)).toBe(true);
  });
});

describe("RejectLog", () => {
  it("writes one compact JSON line per rejection with only the given fields", () => {
    const lines: string[] = [];
    const log = new RejectLog("ABCD", (l) => lines.push(l));
    log.log({ conn: "c1", player: "p1", type: "host:kick", reason: "not_host" }, 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ ev: "reject", room: "ABCD", conn: "c1", player: "p1", type: "host:kick", reason: "not_host" });
  });

  it("rate-limits itself and reports how many lines it suppressed", () => {
    const lines: string[] = [];
    const log = new RejectLog("ABCD", (l) => lines.push(l), { burst: 2, perSec: 1 });
    for (let i = 0; i < 10; i++) log.log({ conn: "c1", type: "action", reason: "rate_limited" }, 0);
    expect(lines).toHaveLength(2);
    log.log({ conn: "c1", type: "action", reason: "rate_limited" }, 1000);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]!)).toMatchObject({ suppressed: 8 });
    log.log({ conn: "c1", type: "action", reason: "rate_limited" }, 2000);
    expect(JSON.parse(lines[3]!).suppressed).toBeUndefined();
  });
});
