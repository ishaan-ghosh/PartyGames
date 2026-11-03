/** Classic token bucket: holds up to `capacity` tokens, refills at `perSec`, one token per take. Pure; time comes in. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly perSec: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  take(now: number): boolean {
    if (now > this.last) {
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) * this.perSec) / 1000);
      this.last = now;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** One rejected client message. Never carries message bodies: `type` is the message kind only. */
export interface Rejection {
  conn: string;
  player?: string;
  type: string;
  reason: string;
}

/**
 * Structured warn lines for rejected client messages (spec §5), rate-limited per room so a flood
 * can't spam logs. Lines dropped by the limiter are counted and reported on the next line written.
 */
export class RejectLog {
  private bucket: TokenBucket | null = null;
  private suppressed = 0;

  constructor(
    private readonly room: string,
    private readonly sink: (line: string) => void = (l) => console.warn(l),
    private readonly rate = { burst: 20, perSec: 1 },
  ) {}

  log(r: Rejection, now: number): void {
    this.bucket ??= new TokenBucket(this.rate.burst, this.rate.perSec, now);
    if (!this.bucket.take(now)) {
      this.suppressed++;
      return;
    }
    const line: Record<string, unknown> = { ev: "reject", room: this.room, ...r, conn: printable(r.conn) };
    if (this.suppressed) line.suppressed = this.suppressed;
    this.suppressed = 0;
    this.sink(JSON.stringify(line));
  }
}

/** Longest connection id written to logs. Real ids are UUIDs (36 chars); clients can pick their own via `_pk`. */
export const CONN_LOG_MAX = 64;

/**
 * A client-chosen string made safe for a log line: control, format, separator and other non-printable
 * characters removed, then cut to `max` code points.
 */
export function printable(v: string, max = CONN_LOG_MAX): string {
  return Array.from(v.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "")).slice(0, max).join("");
}

/** A short identifier-like label from untrusted input, or "?" — so logs never echo arbitrary client text. */
export function label(v: unknown): string {
  return typeof v === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(v) ? v : "?";
}

/**
 * Per-connection message budget. Sized from what a fast Doodle Dash drawer sends: DrawPad flushes a
 * strokeAppend every 40 ms (25/s) plus a strokeBegin per new stroke, about 25 + 2·strokes/s, so up to
 * ~45/s when dabbing; on top of that a client `resync` roughly every 1.5 s and the odd guess. Right
 * after a reconnect the client Outbox replays up to 50 queued actions plus hello at once. Refill 60/s
 * and burst 120 leave a third more than the fastest real drawer, so honest clients never see a drop.
 */
export const MESSAGE_RATE = {
  burst: 120,
  perSec: 60,
  /** A connection that keeps dropping messages for this long is closed. */
  abuseMs: 5_000,
  /** A gap this long without a drop ends an over-limit streak. */
  quietMs: 2_000,
} as const;

/** WebSocket close code for policy violations (RFC 6455). */
export const POLICY_CLOSE = 1008;

export type LimitVerdict = "ok" | "drop" | "close";

/**
 * Token bucket plus abuse detection: messages over budget are dropped; a streak of drops (no gap
 * longer than `quietMs`) lasting `abuseMs` means the client is flooding, so the caller should close it.
 */
export class MessageLimiter {
  private readonly bucket: TokenBucket;
  private streakStart: number | null = null;
  private lastDrop = 0;

  constructor(
    now: number,
    private readonly opts: { burst: number; perSec: number; abuseMs: number; quietMs: number } = MESSAGE_RATE,
  ) {
    this.bucket = new TokenBucket(opts.burst, opts.perSec, now);
  }

  check(now: number): LimitVerdict {
    if (this.bucket.take(now)) return "ok";
    if (this.streakStart === null || now - this.lastDrop > this.opts.quietMs) this.streakStart = now;
    this.lastDrop = now;
    return now - this.streakStart >= this.opts.abuseMs ? "close" : "drop";
  }
}
