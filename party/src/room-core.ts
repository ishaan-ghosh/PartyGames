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
  type ServerMsg,
  type Viewer,
} from "@party/shared";

export interface Outbox {
  send(connId: string, msg: ServerMsg): void;
  close(connId: string): void;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameModule<any, any, any>;
export interface CoreDeps {
  newId(): string;
  newSeed(): number;
  games: Record<string, AnyGame>;
  defaultGameId: string;
}

interface Member {
  id: string;
  token: string;
  kind: "screen" | "player";
  name: string;
  avatar: Avatar;
  connId: string | null;
  joinSeq: number;
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
  lastResults: GameResult[] | null;
  emptySince: number | null;
}

export interface Handled { persist: boolean }
const YES: Handled = { persist: true };
const NO: Handled = { persist: false };
const DEFAULT_AVATAR: Avatar = { emoji: "🙂", color: "#7f5af0" };

/** All room behavior, free of Cloudflare APIs. The Durable Object adapter feeds it messages and time. */
export class RoomCore {
  private s: SavedRoom;

  constructor(
    code: string,
    private readonly deps: CoreDeps,
    private readonly out: Outbox,
    restore?: { saved: SavedRoom; now: number },
  ) {
    if (restore) {
      this.s = structuredClone(restore.saved);
      for (const m of this.s.members) m.connId = null;
      this.s.emptySince ??= restore.now;
      if (this.s.phase === "playing") {
        for (const m of this.s.members) {
          if (m.kind === "player") this.s.gameState = this.game.onPresence(this.s.gameState, m.id, false, restore.now);
        }
      }
    } else {
      const game = deps.games[deps.defaultGameId];
      if (!game) throw new Error(`Unknown default game ${deps.defaultGameId}`);
      this.s = {
        v: 1, code, created: false, hostKey: null, hostId: null, hostGoneAt: null,
        members: [], joinSeq: 0, gameId: deps.defaultGameId, settings: game.defaultSettings,
        phase: "lobby", gameState: null, lastResults: null, emptySince: null,
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

  message(connId: string, raw: unknown, now: number): Handled {
    const parsed = ClientMsg.safeParse(raw);
    if (!parsed.success) {
      this.error(connId, "BAD_MESSAGE", "Unrecognized message.");
      return NO;
    }
    const msg = parsed.data;
    if (msg.type === "hello") return this.hello(connId, msg, now);
    const m = this.memberByConn(connId);
    if (!m) {
      this.error(connId, "BAD_MESSAGE", "Say hello first.");
      return NO;
    }
    return msg.type === "action" ? this.action(m, msg.payload, now) : this.hostCmd(m, msg.cmd, now);
  }

  disconnect(connId: string, now: number): Handled {
    const m = this.memberByConn(connId);
    if (!m) return NO;
    m.connId = null;
    if (m.id === this.s.hostId) this.s.hostGoneAt = now;
    if (this.s.phase === "playing" && m.kind === "player") {
      this.s.gameState = this.game.onPresence(this.s.gameState, m.id, false, now);
      this.checkOver();
    }
    if (this.connected().length === 0) this.s.emptySince = now;
    this.broadcast(now);
    return YES;
  }

  tick(now: number): void {
    if (this.s.hostGoneAt !== null && now >= this.s.hostGoneAt + LIMITS.hostGraceMs) this.transferHost();
    if (this.s.phase === "playing") {
      this.s.gameState = this.game.onTimer(this.s.gameState, now);
      this.checkOver();
    }
    this.broadcast(now);
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
      belowMin: this.s.phase === "playing" && this.connected("player").length < this.game.meta.minPlayers,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private get game(): AnyGame {
    return this.deps.games[this.s.gameId]!;
  }

  private connected(kind?: Member["kind"]): Member[] {
    return this.s.members.filter((m) => m.connId !== null && (!kind || m.kind === kind));
  }

  private memberByConn(connId: string): Member | undefined {
    return this.s.members.find((m) => m.connId === connId);
  }

  private error(connId: string, code: ErrorCode, message: string): void {
    this.out.send(connId, { type: "error", code, message });
  }

  private hello(connId: string, msg: HelloMessage, now: number): Handled {
    if (!this.s.created) {
      this.error(connId, "ROOM_NOT_FOUND", "That room doesn't exist or has closed.");
      this.out.close(connId);
      return NO;
    }
    if (this.memberByConn(connId)) return NO; // duplicate hello on one socket

    let m: Member | null | undefined = msg.token ? this.s.members.find((x) => x.token === msg.token) : undefined;
    if (m) {
      if (m.connId && m.connId !== connId) this.out.close(m.connId);
      m.connId = connId;
    } else {
      m = this.addMember(connId, msg);
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
    }
    this.broadcast(now);
    return YES;
  }

  private addMember(connId: string, msg: HelloMessage): Member | null {
    let name = "Screen";
    if (msg.role === "player") {
      name = (msg.name ?? "").trim().replace(/\s+/g, " ").slice(0, LIMITS.nameMax);
      if (!name) {
        this.error(connId, "BAD_MESSAGE", "Pick a name first.");
        return null;
      }
      const players = this.s.members.filter((x) => x.kind === "player");
      if (players.length >= LIMITS.maxPlayers) {
        this.error(connId, "ROOM_FULL", `This room is full (${LIMITS.maxPlayers} players).`);
        this.out.close(connId);
        return null;
      }
      if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        this.error(connId, "NAME_TAKEN", `Someone here is already called ${name}.`);
        return null;
      }
    } else if (this.s.members.filter((x) => x.kind === "screen").length >= LIMITS.maxScreens) {
      this.error(connId, "SCREENS_FULL", `This room already has ${LIMITS.maxScreens} screens.`);
      this.out.close(connId);
      return null;
    }
    const m: Member = {
      id: this.deps.newId(),
      token: this.deps.newId(),
      kind: msg.role,
      name,
      avatar: msg.avatar ?? DEFAULT_AVATAR,
      connId,
      joinSeq: ++this.s.joinSeq,
    };
    this.s.members.push(m);
    return m;
  }

  private action(m: Member, payload: unknown, now: number): Handled {
    if (this.s.phase !== "playing" || m.kind !== "player") return NO;
    const action = this.game.parseAction(payload);
    if (action === null) return NO;
    const res = this.game.onAction(this.s.gameState, m.id, action, now);
    this.s.gameState = res.state;
    for (const ev of res.events ?? []) {
      for (const c of this.connected()) {
        if (ev.to === "all" || c.id !== m.id) this.out.send(c.connId!, { type: "event", payload: ev.payload });
      }
    }
    if (res.quiet) return NO;
    this.checkOver();
    this.broadcast(now);
    return YES;
  }

  private hostCmd(m: Member, cmd: HostCommand, now: number): Handled {
    if (m.id !== this.s.hostId) {
      this.error(m.connId!, "NOT_HOST", "Only the host can do that.");
      return NO;
    }
    const s = this.s;
    switch (cmd.cmd) {
      case "selectGame": {
        const game = this.deps.games[cmd.gameId];
        if (s.phase !== "lobby" || !game) return NO;
        s.gameId = cmd.gameId;
        s.settings = game.defaultSettings;
        break;
      }
      case "updateSettings":
        if (s.phase !== "lobby") return NO;
        s.settings = this.game.parseSettings(cmd.settings);
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
  }

  private checkOver(): void {
    if (this.s.phase === "playing" && this.game.isOver(this.s.gameState)) this.finish();
  }

  private broadcast(now: number): void {
    const room = this.snapshot();
    for (const c of this.connected()) {
      this.out.send(c.connId!, { type: "room", room, now });
      if (this.s.phase === "playing") {
        const viewer: Viewer = c.kind === "screen" ? { kind: "screen" } : { kind: "player", playerId: c.id };
        this.out.send(c.connId!, { type: "view", payload: this.game.view(this.s.gameState, viewer), now });
      }
    }
  }
}
