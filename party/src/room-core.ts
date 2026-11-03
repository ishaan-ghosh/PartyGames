import {
  ClientMsg,
  LIMITS,
  type Avatar,
  type ErrorCode,
  type GameModule,
  type GameResult,
  type HelloMessage,
  type HostCommand,
  type PlayerInfo,
  type RoomSnapshot,
  type SavePart,
  type ServerMsg,
  type Viewer,
} from "@party/shared";
import { label, type Rejection } from "./rate-limit";

export interface Outbox {
  send(connId: string, msg: ServerMsg): void;
  close(connId: string): void;
  /** A client message was refused (spec §5: invalid actions are logged). Carries no message bodies. */
  reject?(r: Rejection): void;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameModule<any, any, any>;
export interface CoreDeps {
  newId(): string;
  newSeed(): number;
  games: Record<string, AnyGame>;
  defaultGameId: string;
}

export interface Member {
  id: string;
  token: string;
  kind: "screen" | "player";
  name: string;
  avatar: Avatar;
  connId: string | null;
  joinSeq: number;
  /** When this member last lost its connection; null while connected. */
  disconnectedAt: number | null;
}

export interface SavedRoom {
  v: 1;
  code: string;
  created: boolean;
  hostKey: string | null;
  hostId: string | null;
  hostGoneAt: number | null;
  members: Member[];
  joinSeq: number;
  gameId: string;
  settings: unknown;
  phase: "lobby" | "playing";
  gameState: unknown;
  /** Player ids seated when the current game started (late joiners are spectators). */
  seated: string[];
  lastResults: GameResult[] | null;
  emptySince: number | null;
  /** Names of game-state parts stored under their own keys (see GameModule.splitSave). */
  parts?: string[];
  /**
   * The rev each part had when this record was written (see SavePlanner), so a room woken from
   * hibernation doesn't rewrite every part on its next save. Written by the adapter, not RoomCore.
   */
  partRevs?: Record<string, string>;
}

/**
 * persist: save now. dirty: state changed by a quiet action (e.g. a stroke) that need not be saved
 * at once, but must be saved soon: the room may hibernate, which drops anything only in memory.
 */
export interface Handled { persist: boolean; dirty?: boolean }
const YES: Handled = { persist: true };
const NO: Handled = { persist: false };
const DIRTY: Handled = { persist: false, dirty: true };

/** Restoring a saved room, e.g. when the Durable Object starts or wakes from hibernation. */
export interface Restore {
  saved: SavedRoom;
  now: number;
  parts?: Record<string, unknown>;
  /**
   * Connection ids whose sockets are still open. After hibernation the sockets outlive the object:
   * members saved as connected on one of these stay connected. Everyone else is marked disconnected.
   */
  live?: ReadonlySet<string>;
}
/** At most one answered `resync` per member per this long. Clients retry less often than this. */
export const RESYNC_MIN_MS = 1000;
const DEFAULT_AVATAR: Avatar = { emoji: "🙂", color: "#7f5af0" };
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;
/** Control/format characters except ZWJ (U+200D) and VS16 (U+FE0F), which emoji sequences need. */
const CONTROL_OR_FORMAT_EXCEPT_EMOJI = /(?![‍️])[\p{Cc}\p{Cf}]/gu;
const AVATAR_EMOJI_MAX_CODE_POINTS = 16;

function cleanName(raw: string): string {
  const name = raw.replace(/\s+/gu, " ").replace(CONTROL_OR_FORMAT, "").trim().replace(/ {2,}/g, " ");
  return Array.from(name).slice(0, LIMITS.nameMax).join("").trim();
}

function cleanAvatar(avatar: Avatar | undefined): Avatar {
  if (!avatar) return DEFAULT_AVATAR;
  const emoji = avatar.emoji.replace(CONTROL_OR_FORMAT_EXCEPT_EMOJI, "").trim();
  const len = Array.from(emoji).length;
  const ok = len > 0 && len <= AVATAR_EMOJI_MAX_CODE_POINTS && /[^‍️]/u.test(emoji);
  return { emoji: ok ? emoji : DEFAULT_AVATAR.emoji, color: avatar.color };
}

function viewerOf(m: Member): Viewer {
  return m.kind === "screen" ? { kind: "screen" } : { kind: "player", playerId: m.id };
}

/** All room behavior, free of Cloudflare APIs. The Durable Object adapter feeds it messages and time. */
export class RoomCore {
  private s: SavedRoom;
  /** Last answered `resync` per member id (in memory only). */
  private readonly lastResync = new Map<string, number>();
  /**
   * True if restoring changed the saved state (someone's socket was gone, an old save was upgraded),
   * so the adapter must save. A wake from hibernation with every socket still open changes nothing.
   */
  readonly restoreChanged: boolean = false;

  constructor(
    code: string,
    private readonly deps: CoreDeps,
    private readonly out: Outbox,
    restore?: Restore,
  ) {
    if (restore) {
      this.s = structuredClone(restore.saved);
      const partNames = this.s.parts;
      delete this.s.parts;
      delete this.s.partRevs;
      let changed = false;
      const offline = new Set<string>();
      for (const m of this.s.members) {
        if (m.connId !== null && restore.live?.has(m.connId) && m.disconnectedAt === null) continue;
        // Older saves lack disconnectedAt; anyone connected at save time dropped "now".
        if (m.connId !== null || typeof m.disconnectedAt !== "number") {
          m.disconnectedAt = restore.now;
          changed = true;
        }
        m.connId = null;
        offline.add(m.id);
      }
      // The saved game may no longer be registered (removed in a later deploy, or a pre-fix prototype key
      // like "constructor"): reopen in the lobby with the default game rather than crash on wake.
      if (!Object.prototype.hasOwnProperty.call(deps.games, this.s.gameId)) {
        const fallback = deps.games[deps.defaultGameId];
        if (!fallback) throw new Error(`Unknown default game ${deps.defaultGameId}`);
        this.s.gameId = deps.defaultGameId;
        this.s.settings = fallback.defaultSettings;
        this.s.phase = "lobby";
        this.s.gameState = null;
        this.s.seated = [];
        changed = true;
      }
      // Older saves lack seated; best effort is every player seat that existed.
      if (!Array.isArray(this.s.seated)) {
        this.s.seated = this.s.phase === "playing" ? this.s.members.filter((m) => m.kind === "player").map((m) => m.id) : [];
        changed = true;
      }
      if (this.s.emptySince === null && this.connected().length === 0) {
        this.s.emptySince = restore.now;
        changed = true;
      }
      if (this.s.phase === "playing" && partNames?.length && this.game.joinSave) {
        const parts = Object.fromEntries(partNames.map((n) => [n, restore.parts?.[n]]));
        this.s.gameState = this.game.joinSave(this.s.gameState, parts);
      }
      if (this.s.phase === "playing") {
        for (const m of this.s.members) {
          if (m.kind === "player" && offline.has(m.id)) this.s.gameState = this.game.onPresence(this.s.gameState, m.id, false, restore.now);
        }
      }
      this.restoreChanged = changed;
    } else {
      const game = deps.games[deps.defaultGameId];
      if (!game) throw new Error(`Unknown default game ${deps.defaultGameId}`);
      this.s = {
        v: 1, code, created: false, hostKey: null, hostId: null, hostGoneAt: null,
        members: [], joinSeq: 0, gameId: deps.defaultGameId, settings: game.defaultSettings,
        phase: "lobby", gameState: null, seated: [], lastResults: null, emptySince: null,
      };
    }
  }

  get created(): boolean {
    return this.s.created;
  }

  create(hostKey: string, now: number): boolean {
    if (this.s.created) return false;
    this.s.created = true;
    this.s.hostKey = hostKey;
    this.s.emptySince = now;
    return true;
  }

  serialize(): SavedRoom {
    return structuredClone(this.s);
  }

  /** Like serialize, with the game's bulky parts split out to be stored under their own keys. */
  serializeSplit(): { saved: SavedRoom; parts: Record<string, SavePart> } {
    if (this.s.phase !== "playing" || !this.game.splitSave) return { saved: this.serialize(), parts: {} };
    const { state, parts } = this.game.splitSave(this.s.gameState);
    const saved = structuredClone({ ...this.s, gameState: state, parts: Object.keys(parts) });
    return { saved, parts };
  }

  message(connId: string, raw: unknown, now: number): Handled {
    const parsed = ClientMsg.safeParse(raw);
    if (!parsed.success) {
      this.out.reject?.({ conn: connId, type: label((raw as { type?: unknown } | null)?.type), reason: "bad_message" });
      this.error(connId, "BAD_MESSAGE", "Unrecognized message.");
      return NO;
    }
    const msg = parsed.data;
    if (msg.type === "hello") return this.hello(connId, msg, now);
    const m = this.memberByConn(connId);
    if (!m) {
      this.out.reject?.({ conn: connId, type: msg.type, reason: "no_hello" });
      this.error(connId, "BAD_MESSAGE", "Say hello first.");
      return NO;
    }
    if (msg.type === "resync") return this.resync(m, now);
    return msg.type === "action" ? this.action(m, msg.payload, now) : this.hostCmd(m, msg.cmd, now);
  }

  disconnect(connId: string, now: number): Handled {
    const m = this.memberByConn(connId);
    if (!m) return NO;
    m.connId = null;
    m.disconnectedAt = now;
    if (m.id === this.s.hostId) this.s.hostGoneAt = now;
    if (this.s.phase === "playing" && m.kind === "player") {
      this.s.gameState = this.game.onPresence(this.s.gameState, m.id, false, now);
      this.checkOver();
    }
    if (this.connected().length === 0) this.s.emptySince = now;
    this.broadcast(now);
    return YES;
  }

  /**
   * Alarm handler. Broadcasts only if something a client can see changed: clients run countdowns from
   * deadlines and `now`, so a watchdog or early alarm that moves nothing sends nothing. Asks for a
   * save only if state may have changed, so an idle lobby's watchdog writes nothing.
   */
  tick(now: number): Handled {
    const before = this.visible();
    let changed = false;
    if (this.s.hostGoneAt !== null && now >= this.s.hostGoneAt + LIMITS.hostGraceMs) {
      this.transferHost();
      changed = true;
    }
    if (this.s.phase === "playing") {
      this.s.gameState = this.game.onTimer(this.s.gameState, now);
      this.checkOver();
      changed = true; // game timers may change hidden state too
    }
    if (this.visible() !== before) {
      this.broadcast(now);
      changed = true;
    }
    return changed ? YES : NO;
  }

  nextAlarmAt(): number | null {
    const times: number[] = [];
    if (this.s.hostGoneAt !== null) times.push(this.s.hostGoneAt + LIMITS.hostGraceMs);
    if (this.s.emptySince !== null) times.push(this.s.emptySince + LIMITS.emptyRoomTtlMs);
    if (this.s.phase === "playing") {
      const t = this.game.nextTimerAt(this.s.gameState);
      if (t !== null) times.push(t);
    }
    return times.length ? Math.min(...times) : null;
  }

  shouldDiscard(now: number): boolean {
    return this.s.emptySince !== null && now >= this.s.emptySince + LIMITS.emptyRoomTtlMs;
  }

  snapshot(): RoomSnapshot {
    const hostId = this.s.hostId;
    const sorted = [...this.s.members].sort((a, b) => a.joinSeq - b.joinSeq);
    return {
      code: this.s.code,
      hostId,
      mode: this.connected("screen").length > 0 ? "screen" : "phones",
      phase: this.s.phase,
      gameId: this.s.gameId,
      settings: this.s.settings,
      players: sorted
        .filter((m) => m.kind === "player")
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connId !== null, isHost: m.id === hostId })),
      screens: sorted
        .filter((m) => m.kind === "screen")
        .map((m) => ({ id: m.id, connected: m.connId !== null, isHost: m.id === hostId })),
      lastResults: this.s.lastResults,
      belowMin: this.s.phase === "playing" && this.connectedSeated() < this.game.meta.minPlayers,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private get game(): AnyGame {
    return this.deps.games[this.s.gameId]!;
  }

  private connected(kind?: Member["kind"]): Member[] {
    return this.s.members.filter((m) => m.connId !== null && (!kind || m.kind === kind));
  }

  private connectedSeated(): number {
    const seated = new Set(this.s.seated);
    return this.connected("player").filter((m) => seated.has(m.id)).length;
  }

  /**
   * Lobby only: if `kind` is at `cap`, remove its longest-disconnected member (never a connected one,
   * never the host, never one gone for less than LIMITS.evictGraceMs). Returns true if there is room afterwards.
   */
  private makeRoom(kind: Member["kind"], cap: number, now: number): boolean {
    const same = this.s.members.filter((x) => x.kind === kind);
    if (same.length < cap) return true;
    if (this.s.phase !== "lobby") return false;
    const victim = same
      .filter((x) => x.connId === null && x.id !== this.s.hostId && now - (x.disconnectedAt ?? 0) >= LIMITS.evictGraceMs)
      .sort((a, b) => (a.disconnectedAt ?? 0) - (b.disconnectedAt ?? 0) || a.joinSeq - b.joinSeq)[0];
    if (!victim) return false;
    this.s.members = this.s.members.filter((x) => x !== victim);
    this.lastResync.delete(victim.id);
    return true;
  }

  /** Lobby only: a disconnected non-host `kind` member is still inside its eviction grace, so a seat will free up. */
  private seatFreeingSoon(kind: Member["kind"]): boolean {
    return this.s.phase === "lobby" && this.s.members.some((x) => x.kind === kind && x.connId === null && x.id !== this.s.hostId);
  }

  /** Refusal text for a full room, with a hint to retry when a seat is only held by someone's grace period. */
  private fullMessage(kind: Member["kind"]): string {
    const base = kind === "player" ? `This room is full (${LIMITS.maxPlayers} players).` : `This room already has ${LIMITS.maxScreens} screens.`;
    return this.seatFreeingSoon(kind) ? `${base} Someone just dropped out, so try again in a minute.` : base;
  }

  /** A hello was refused. Hellos carry names and keys, so only the reason is logged. */
  private rejectHello(connId: string, reason: string): void {
    this.out.reject?.({ conn: connId, type: "hello", reason });
  }

  private memberByConn(connId: string): Member | undefined {
    return this.s.members.find((m) => m.connId === connId);
  }

  private error(connId: string, code: ErrorCode, message: string): void {
    this.out.send(connId, { type: "error", code, message });
  }

  private hello(connId: string, msg: HelloMessage, now: number): Handled {
    if (!this.s.created) {
      this.rejectHello(connId, "room_not_found");
      this.error(connId, "ROOM_NOT_FOUND", "That room doesn't exist or has closed.");
      this.out.close(connId);
      return NO;
    }
    if (this.memberByConn(connId)) {
      this.rejectHello(connId, "duplicate_hello"); // one socket, one seat
      return NO;
    }

    let m: Member | null | undefined = msg.token
      ? this.s.members.find((x) => x.token === msg.token && x.kind === msg.role)
      : undefined;
    if (m) {
      if (m.connId && m.connId !== connId) {
        this.error(m.connId, "REPLACED", "This seat was opened on another tab or device.");
        this.out.close(m.connId);
      }
      m.connId = connId;
      m.disconnectedAt = null;
    } else {
      m = this.addMember(connId, msg, now);
      if (!m) return NO;
    }

    if (msg.hostKey && msg.hostKey === this.s.hostKey) this.s.hostId = m.id;
    else if (this.s.hostId === null) this.s.hostId = m.id;
    if (this.s.hostId === m.id) {
      this.s.hostGoneAt = null;
    } else {
      const host = this.s.members.find((x) => x.id === this.s.hostId);
      if (host && host.connId === null && this.s.hostGoneAt === null) this.s.hostGoneAt = now;
    }
    this.s.emptySince = null;

    this.out.send(connId, { type: "welcome", token: m.token, you: { kind: m.kind, id: m.id } });
    if (this.s.phase === "playing" && m.kind === "player") {
      this.s.gameState = this.game.onPresence(this.s.gameState, m.id, true, now);
      this.checkOver(); // a reconnect can resume a paused game straight into its end
    }
    this.broadcast(now);
    this.sendSync(m);
    return YES;
  }

  /** The game's full-picture event (GameModule.sync) to one member, if a game is running and has one. */
  private sendSync(m: Member): void {
    if (this.s.phase !== "playing" || !this.game.sync || !m.connId) return;
    const viewer: Viewer = m.kind === "screen" ? { kind: "screen" } : { kind: "player", playerId: m.id };
    const payload = this.game.sync(this.s.gameState, viewer);
    if (payload != null) this.out.send(m.connId, { type: "event", payload });
  }

  /** A client asks for the sync event again. Throttled per member: the payload can be large. */
  private resync(m: Member, now: number): Handled {
    const last = this.lastResync.get(m.id);
    if (last !== undefined && now - last < RESYNC_MIN_MS) return NO;
    if (this.s.phase !== "playing" || !this.game.sync) return NO;
    this.lastResync.set(m.id, now);
    this.sendSync(m);
    return NO;
  }

  private addMember(connId: string, msg: HelloMessage, now: number): Member | null {
    let name = "Screen";
    if (msg.role === "player") {
      name = cleanName(msg.name ?? "");
      if (!name) {
        this.rejectHello(connId, "no_name");
        this.error(connId, "BAD_MESSAGE", "Pick a name first.");
        return null;
      }
      // Name check runs before any eviction so a rejected newcomer never costs anyone their seat.
      const lower = name.toLowerCase();
      if (this.s.members.some((p) => p.kind === "player" && p.name.toLowerCase() === lower)) {
        this.rejectHello(connId, "name_taken");
        this.error(connId, "NAME_TAKEN", `Someone here is already called ${name}.`);
        return null;
      }
      if (!this.makeRoom("player", LIMITS.maxPlayers, now)) {
        this.rejectHello(connId, "room_full");
        this.error(connId, "ROOM_FULL", this.fullMessage("player"));
        this.out.close(connId);
        return null;
      }
    } else if (!this.makeRoom("screen", LIMITS.maxScreens, now)) {
      this.rejectHello(connId, "screens_full");
      this.error(connId, "SCREENS_FULL", this.fullMessage("screen"));
      this.out.close(connId);
      return null;
    }
    const m: Member = {
      id: this.deps.newId(),
      token: this.deps.newId(),
      kind: msg.role,
      name,
      avatar: cleanAvatar(msg.avatar),
      connId,
      joinSeq: ++this.s.joinSeq,
      disconnectedAt: null,
    };
    this.s.members.push(m);
    return m;
  }

  private action(m: Member, payload: unknown, now: number): Handled {
    const reject = (reason: string) =>
      this.out.reject?.({ conn: m.connId!, player: m.id, type: `action:${label((payload as { t?: unknown } | null)?.t)}`, reason });
    if (this.s.phase !== "playing") {
      reject("not_playing");
      return NO;
    }
    if (m.kind !== "player") {
      reject("not_a_player");
      return NO;
    }
    const action = this.game.parseAction(payload);
    if (action === null) {
      reject("bad_action");
      return NO;
    }
    const res = this.game.onAction(this.s.gameState, m.id, action, now);
    this.s.gameState = res.state;
    // Reason code only, squeezed through label(): it is game-chosen, but must stay a short identifier.
    if (res.rejected !== undefined) reject(label(res.rejected));
    for (const ev of res.events ?? []) {
      for (const c of this.connected()) {
        if (ev.to === "all" || c.id !== m.id) this.out.send(c.connId!, { type: "event", payload: ev.payload });
      }
    }
    // A refused quiet action changed nothing; an accepted one (a stroke) did, but is saved lazily.
    if (res.quiet) return res.rejected !== undefined ? NO : DIRTY;
    this.checkOver();
    this.broadcast(now);
    return YES;
  }

  private hostCmd(m: Member, cmd: HostCommand, now: number): Handled {
    const reject = (reason: string) => this.out.reject?.({ conn: m.connId!, player: m.id, type: `host:${cmd.cmd}`, reason });
    if (m.id !== this.s.hostId) {
      reject("not_host");
      this.error(m.connId!, "NOT_HOST", "Only the host can do that.");
      return NO;
    }
    const s = this.s;
    switch (cmd.cmd) {
      case "selectGame": {
        if (s.phase !== "lobby") return NO;
        // Own-property lookup: ids like "constructor" or "__proto__" must not resolve via Object.prototype.
        const game = Object.prototype.hasOwnProperty.call(this.deps.games, cmd.gameId) ? this.deps.games[cmd.gameId] : undefined;
        if (!game) {
          reject("unknown_game");
          this.error(m.connId!, "BAD_MESSAGE", "Unknown game.");
          return NO;
        }
        if (cmd.gameId === s.gameId) return NO; // re-selecting keeps the host's custom settings
        s.gameId = cmd.gameId;
        s.settings = game.defaultSettings;
        break;
      }
      case "updateSettings":
        if (s.phase !== "lobby") return NO;
        s.settings = this.game.parseSettings(cmd.settings, s.settings);
        break;
      case "start": {
        if (s.phase !== "lobby") return NO;
        const players = this.connected("player").sort((a, b) => a.joinSeq - b.joinSeq);
        const min = this.game.meta.minPlayers;
        if (players.length < min) {
          this.error(m.connId!, "NOT_ENOUGH_PLAYERS", `${this.game.meta.name} needs at least ${min} players.`);
          return NO;
        }
        const infos: PlayerInfo[] = players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, connected: true }));
        s.gameState = this.game.setup(infos, s.settings, this.deps.newSeed(), now);
        s.phase = "playing";
        s.seated = players.map((p) => p.id);
        s.lastResults = null;
        this.checkOver();
        break;
      }
      case "skip":
        if (s.phase !== "playing") return NO;
        s.gameState = this.game.onSkip(s.gameState, now);
        this.checkOver();
        break;
      case "endGame":
        if (s.phase !== "playing") return NO;
        this.finish();
        break;
      case "kick": {
        const target = s.members.find((x) => x.id === cmd.playerId);
        if (!target || target.id === s.hostId) return NO;
        s.members = s.members.filter((x) => x !== target);
        this.lastResync.delete(target.id);
        if (target.connId) {
          this.error(target.connId, "KICKED", "You were removed from the room.");
          this.out.close(target.connId);
        }
        if (s.phase === "playing" && target.kind === "player") {
          s.gameState = this.game.onPresence(s.gameState, target.id, false, now);
          this.checkOver();
        }
        break;
      }
    }
    this.broadcast(now);
    return YES;
  }

  private transferHost(): void {
    const next = this.connected().sort((a, b) => a.joinSeq - b.joinSeq)[0];
    if (next) this.s.hostId = next.id;
    this.s.hostGoneAt = null;
  }

  private finish(): void {
    this.s.lastResults = this.game.results(this.s.gameState);
    this.s.phase = "lobby";
    this.s.gameState = null;
    this.s.seated = [];
  }

  private checkOver(): void {
    if (this.s.phase === "playing" && this.game.isOver(this.s.gameState)) this.finish();
  }

  private broadcast(now: number): void {
    const room = this.snapshot();
    for (const c of this.connected()) {
      // Per connection: a game may hide settings (e.g. Doodle Dash's custom words) from all but the host.
      const settings = this.game.publicSettings
        ? this.game.publicSettings(this.s.settings, { isHost: c.id === this.s.hostId, kind: c.kind, phase: this.s.phase })
        : room.settings;
      this.out.send(c.connId!, { type: "room", room: { ...room, settings }, now });
      if (this.s.phase === "playing") {
        this.out.send(c.connId!, { type: "view", payload: this.game.view(this.s.gameState, viewerOf(c)), now });
      }
    }
  }

  /**
   * What broadcast() would send, minus `now`, as one string. Serialized eagerly because game rules may
   * mutate their state in place. Views go over the wire as JSON, so comparing JSON is exact.
   */
  private visible(): string {
    const views = this.s.phase === "playing" ? this.connected().map((c) => this.game.view(this.s.gameState, viewerOf(c))) : null;
    return JSON.stringify([this.snapshot(), views]);
  }
}
