/**
 * Client-side send queue for one room connection. Messages are only handed to the transport after the
 * server has welcomed the current connection (it rejects anything before `hello` with BAD_MESSAGE).
 *
 * Two kinds of send:
 * - `send` (game actions): waits here until welcomed, but only for `ttlMs`. Older messages are dropped
 *   on flush, so a guess typed during a long reconnect can't land on a later turn. Beyond `limit` the
 *   oldest are dropped.
 * - `sendNow` (host commands): never queued. If the connection isn't welcomed and open it's dropped,
 *   so a stale `skip`/`kick`/`start` can never apply to the wrong turn.
 */
export class Outbox {
  private queue: { msg: string; at: number }[] = [];
  private ready = false;

  /** `transmit` returns false if it couldn't send (socket not open); a `send` message then stays queued. */
  constructor(
    private readonly transmit: (msg: string) => boolean,
    private readonly limit = 50,
    private readonly ttlMs = 2000,
    private readonly now: () => number = Date.now,
  ) {}

  send(msg: string): void {
    if (this.ready && this.queue.length === 0 && this.transmit(msg)) return;
    this.queue.push({ msg, at: this.now() });
    if (this.queue.length > this.limit) this.queue.splice(0, this.queue.length - this.limit);
  }

  /** Send right away if welcomed; otherwise drop. Returns whether it was sent. */
  sendNow(msg: string): boolean {
    return this.ready && this.transmit(msg);
  }

  /** The server welcomed this connection: flush what's still fresh. */
  welcome(): void {
    this.ready = true;
    const cutoff = this.now() - this.ttlMs;
    this.queue = this.queue.filter((q) => q.at >= cutoff);
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
