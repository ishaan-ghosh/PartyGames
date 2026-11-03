import { describe, expect, it } from "vitest";
import { MESSAGE_RATE, MessageLimiter, RejectLog, TokenBucket } from "./rate-limit";

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

describe("MessageLimiter", () => {
  const opts = { burst: 4, perSec: 2, abuseMs: 5000, quietMs: 2000 };

  it("accepts a burst and then drops", () => {
    const l = new MessageLimiter(0, opts);
    expect([0, 0, 0, 0, 0].map((t) => l.check(t))).toEqual(["ok", "ok", "ok", "ok", "drop"]);
    expect(l.check(500)).toBe("ok");
  });

  it("closes a connection that stays over the limit for abuseMs", () => {
    const l = new MessageLimiter(0, opts);
    let last = "ok";
    let t = 0;
    // 10 messages a second against a 2/s refill.
    for (; t < 10_000 && last !== "close"; t += 100) last = l.check(t);
    expect(last).toBe("close");
    expect(t - 100).toBeGreaterThanOrEqual(5000);
    expect(t - 100).toBeLessThan(6000);
  });

  it("forgives short bursts separated by quiet stretches", () => {
    const l = new MessageLimiter(0, opts);
    for (let round = 0; round < 10; round++) {
      const start = round * 4000;
      // 1 s of flooding, then 3 s of silence.
      for (let t = start; t < start + 1000; t += 50) expect(l.check(t)).not.toBe("close");
    }
  });

  it("never drops a fast drawer: 40 ms stroke batches plus a new stroke every 100 ms, after a full reconnect flush", () => {
    const l = new MessageLimiter(0);
    // Outbox replays up to 50 queued actions plus the hello right after a reconnect.
    for (let i = 0; i < 51; i++) expect(l.check(0)).toBe("ok");
    for (let t = 0; t < 120_000; t += 20) {
      if (t % 40 === 0) expect(l.check(t)).toBe("ok"); // strokeAppend
      if (t % 100 === 0) expect(l.check(t)).toBe("ok"); // strokeBegin
    }
  });

  it("uses a burst that covers the client outbox replay", () => {
    expect(MESSAGE_RATE.burst).toBeGreaterThanOrEqual(51);
  });
});
