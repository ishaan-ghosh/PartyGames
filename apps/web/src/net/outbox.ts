/**
 * Client-side send queue for one room connection. Messages are only handed to the transport after the
 * server has welcomed the current connection (it rejects anything before `hello` with BAD_MESSAGE).
 * Until then they wait here; beyond `limit` the oldest are dropped.
 */
export class Outbox {
  private queue: string[] = [];
  private ready = false;

  /** `transmit` returns false if it couldn't send (socket not open); the message then stays queued. */
  constructor(private readonly transmit: (msg: string) => boolean, private readonly limit = 50) {}

  send(msg: string): void {
    if (this.ready && this.queue.length === 0 && this.transmit(msg)) return;
    this.queue.push(msg);
    if (this.queue.length > this.limit) this.queue.splice(0, this.queue.length - this.limit);
  }

  /** The server welcomed this connection: flush the queue. */
  welcome(): void {
    this.ready = true;
    while (this.queue.length > 0) {
      if (!this.transmit(this.queue[0]!)) return;
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
