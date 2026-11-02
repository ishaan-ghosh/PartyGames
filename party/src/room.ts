import type { ServerMsg } from "@party/shared";
import { Server, type Connection, type WSMessage } from "partyserver";
import type { Env } from "./env";
import { DEFAULT_GAME_ID, games } from "./games";
import { RoomCore, type SavedRoom } from "./room-core";

const KEY = "room";
/** Largest client frame we will parse. A full 400-number stroke batch is about 8 KB of JSON. */
export const MAX_FRAME_BYTES = 16 * 1024;

function frameBytes(message: WSMessage): number {
  // UTF-16 length undercounts UTF-8 bytes by at most 3×, so only measure exactly near the cap.
  if (typeof message === "string") {
    return message.length * 3 <= MAX_FRAME_BYTES ? message.length : new TextEncoder().encode(message).byteLength;
  }
  return message.byteLength;
}

/** Thin Durable Object adapter: transport, persistence and alarms. All behavior lives in RoomCore. */
export class Room extends Server<Env> {
  private core!: RoomCore;
  private scheduled: number | null = null;

  async onStart() {
    const saved = await this.ctx.storage.get<SavedRoom>(KEY);
    this.core = this.makeCore(saved);
    this.scheduled = await this.ctx.storage.getAlarm();
  }

  private makeCore(saved?: SavedRoom): RoomCore {
    return new RoomCore(
      this.name,
      {
        newId: () => crypto.randomUUID(),
        newSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
        games,
        defaultGameId: DEFAULT_GAME_ID,
      },
      {
        send: (id, msg) => this.getConnection(id)?.send(JSON.stringify(msg)),
        close: (id) => this.getConnection(id)?.close(4000, "closed by room"),
      },
      saved ? { saved, now: Date.now() } : undefined,
    );
  }

  /**
   * RPC from the Worker's `POST /api/rooms`. Claims this room code with a fresh host key;
   * returns false if the code is already taken. Not reachable from outside the Worker.
   */
  async create(hostKey: string): Promise<boolean> {
    const ok = this.core.create(hostKey, Date.now());
    if (ok) await this.after(true);
    return ok;
  }

  onMessage(conn: Connection, message: WSMessage) {
    if (frameBytes(message) > MAX_FRAME_BYTES) {
      const err: ServerMsg = { type: "error", code: "BAD_MESSAGE", message: "Message too large." };
      conn.send(JSON.stringify(err));
      return;
    }
    let data: unknown = null;
    if (typeof message === "string") {
      try {
        data = JSON.parse(message);
      } catch {
        data = null;
      }
    }
    const r = this.core.message(conn.id, data, Date.now());
    void this.after(r.persist);
  }

  onClose(conn: Connection) {
    void this.after(this.core.disconnect(conn.id, Date.now()).persist);
  }

  onError(conn: Connection) {
    void this.after(this.core.disconnect(conn.id, Date.now()).persist);
  }

  /** Rooms speak WebSocket only; creation goes through the `create` RPC. */
  onRequest(): Response {
    return new Response("Not found", { status: 404 });
  }

  async onAlarm() {
    const now = Date.now();
    this.scheduled = null;
    if (this.core.shouldDiscard(now)) {
      await this.ctx.storage.delete(KEY);
      this.core = this.makeCore();
      return;
    }
    this.core.tick(now);
    await this.after(true);
  }

  private async after(persist: boolean) {
    if (persist) await this.ctx.storage.put(KEY, this.core.serialize());
    const at = this.core.nextAlarmAt();
    if (at === this.scheduled) return;
    this.scheduled = at;
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }
}
