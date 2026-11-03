/**
 * Client-side send queue for one room connection. Messages are only handed to the transport after the
 * server has welcomed the current connection (it rejects anything before `hello` with BAD_MESSAGE).
 *
 * Two kinds of send:
 * - `send` (game actions): waits here until welcomed, but only for `ttlMs`, so a guess typed during a
 *   long reconnect can't land on a later turn. Queued actions are all-or-nothing: if any would be dropped
 *   (older than `ttlMs` on flush, or the queue grows past `limit`), the whole queue is dropped, and after an
 *   overflow every further `send` is discarded until the next welcome. Dropping only part of an ordered
 *   sequence (e.g. a stroke's begin but not its appends) would corrupt it on the server.
 * - `sendNow` (host commands): never queued. If the connection isn't welcomed and open it's dropped,
 *   so a stale `skip`/`kick`/`start` can never apply to the wrong turn.
 */
export class Outbox {
  private queue: { msg: string; at: number }[] = [];
  private ready = false;
  /** Set when the queue overflowed: discard sends until the next welcome so no partial sequence survives. */
  private overflowed = false;

  /** `transmit` returns false if it couldn't send (socket not open); a `send` message then stays queued. */
  constructor(
    private readonly transmit: (msg: string) => boolean,
    private readonly limit = 50,
    private readonly ttlMs = 2000,
    private readonly now: () => number = Date.now,
  ) {}

  send(msg: string): void {
    if (this.overflowed) return;
    if (this.ready && this.queue.length === 0 && this.transmit(msg)) return;
    this.queue.push({ msg, at: this.now() });
    if (this.queue.length > this.limit) {
      this.queue = [];
      this.overflowed = true;
    }
  }

  /** Send right away if welcomed; otherwise drop. Returns whether it was sent. */
  sendNow(msg: string): boolean {
    return this.ready && this.transmit(msg);
  }

  /** The server welcomed this connection: flush what's still fresh. */
  welcome(): void {
    this.ready = true;
    this.overflowed = false;
    const cutoff = this.now() - this.ttlMs;
    if (this.queue.some((q) => q.at < cutoff)) this.queue = [];
    while (this.queue.length > 0) {
      if (!this.transmit(this.queue[0]!.msg)) return;
      this.queue.shift();
    }
  }

  /** The connection dropped: queue until the next welcome. */
  closed(): void {
    this.ready = false;
  }

  clear(): void {
    this.queue = [];
  }
}
