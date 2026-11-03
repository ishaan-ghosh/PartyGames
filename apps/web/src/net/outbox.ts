/** Options for a game action that doesn't depend on the actions around it (e.g. a guess). */
export interface LooseSend {
  /** How long it may wait for a reconnect before it's dropped. */
  keepMs: number;
  /**
   * Checked against the first game view after a reconnect (null if the room has no game running).
   * If given and it returns false, or there is no view, the message is dropped — e.g. a guess typed
   * for a turn that has since ended.
   */
  stillValid?: (view: unknown) => boolean;
}

/** At most this many loose messages wait for a reconnect; older ones are dropped first. */
export const LOOSE_LIMIT = 10;

/**
 * Client-side send queue for one room connection. Messages are only handed to the transport after the
 * server has welcomed the current connection (it rejects anything before `hello` with BAD_MESSAGE).
 *
 * Three kinds of send:
 * - `send(msg)` (ordered game actions, e.g. strokes, fill, undo): waits here until welcomed, but only for
 *   `ttlMs`. They're all-or-nothing: if any would be dropped (older than `ttlMs` on flush, or the queue
 *   grows past `limit`), the whole ordered queue is dropped, and after an overflow every further ordered
 *   `send` is discarded until the next welcome. Dropping only part of an ordered sequence (a stroke's
 *   begin but not its appends, or the stroke an undo was meant for) would corrupt it on the server.
 * - `send(msg, { keepMs, stillValid })` (loose actions, e.g. guesses): each is kept or dropped on its own,
 *   for up to `keepMs`. After a reconnect they wait for the first game view (`synced`) and are only sent if
 *   `stillValid(view)` passes, so a guess typed during a long reconnect can't land on a later turn.
 * - `sendNow` (host commands): never queued. If the connection isn't welcomed and open it's dropped,
 *   so a stale `skip`/`kick`/`start` can never apply to the wrong turn.
 */
export class Outbox {
  private queue: { msg: string; at: number }[] = [];
  private loose: { msg: string; at: number; opts: LooseSend }[] = [];
  private ready = false;
  /** Welcomed and the room's state since then has arrived, so loose messages can be checked and sent. */
  private isSynced = false;
  /** Set when the ordered queue overflowed: discard ordered sends until the next welcome. */
  private overflowed = false;

  /** `transmit` returns false if it couldn't send (socket not open); a `send` message then stays queued. */
  constructor(
    private readonly transmit: (msg: string) => boolean,
    private readonly limit = 50,
    private readonly ttlMs = 2000,
    private readonly now: () => number = Date.now,
  ) {}

  send(msg: string, opts?: LooseSend): void {
    if (opts) return this.sendLoose(msg, opts);
    if (this.overflowed) return;
    if (this.ready && this.queue.length === 0 && this.transmit(msg)) return;
    this.queue.push({ msg, at: this.now() });
    if (this.queue.length > this.limit) {
      this.queue = [];
      this.overflowed = true;
    }
  }

  private sendLoose(msg: string, opts: LooseSend): void {
    if (this.isSynced && this.loose.length === 0 && this.transmit(msg)) return;
    this.loose.push({ msg, at: this.now(), opts });
    if (this.loose.length > LOOSE_LIMIT) this.loose.shift();
  }

  /** Send right away if welcomed; otherwise drop. Returns whether it was sent. */
  sendNow(msg: string): boolean {
    return this.ready && this.transmit(msg);
  }

  /** The server welcomed this connection: flush the ordered messages that are still fresh. */
  welcome(): void {
    this.ready = true;
    this.isSynced = false;
    this.overflowed = false;
    const cutoff = this.now() - this.ttlMs;
    if (this.queue.some((q) => q.at < cutoff)) this.queue = [];
    while (this.queue.length > 0) {
      if (!this.transmit(this.queue[0]!.msg)) return;
      this.queue.shift();
    }
  }

  /**
   * The room's state after the latest welcome has arrived: `view` is the game view, or null if no game is
   * running. Drops loose messages that are too old or no longer valid, and sends the rest. Later calls in
   * the same session only retry what the transport couldn't send.
   */
  synced(view: unknown): void {
    if (!this.ready) return;
    if (!this.isSynced) {
      const t = this.now();
      this.loose = this.loose.filter(
        ({ at, opts }) => t - at <= opts.keepMs && (!opts.stillValid || (view !== null && opts.stillValid(view))),
      );
      this.isSynced = true;
    }
    while (this.loose.length > 0) {
      if (!this.transmit(this.loose[0]!.msg)) return;
      this.loose.shift();
    }
  }

  /** The connection dropped: queue until the next welcome. */
  closed(): void {
    this.ready = false;
    this.isSynced = false;
  }

  clear(): void {
    this.queue = [];
    this.loose = [];
  }
}
