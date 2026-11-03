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
    const line: Record<string, unknown> = { ev: "reject", room: this.room, ...r };
    if (this.suppressed) line.suppressed = this.suppressed;
    this.suppressed = 0;
    this.sink(JSON.stringify(line));
  }
}

/** A short identifier-like label from untrusted input, or "?" — so logs never echo arbitrary client text. */
export function label(v: unknown): string {
  return typeof v === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(v) ? v : "?";
}
