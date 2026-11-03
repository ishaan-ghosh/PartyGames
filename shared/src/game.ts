import type { Avatar, GameResult } from "./protocol";

export interface PlayerInfo { id: string; name: string; avatar: Avatar; connected: boolean }
export type Viewer = { kind: "screen" } | { kind: "player"; playerId: string };
/** "others" = every connected device except the one that sent the action. */
export interface GameEvent { to: "all" | "others"; payload: unknown }
/**
 * quiet: true → the room relays `events` but does NOT rebroadcast views or persist.
 * rejected: the game refused the action; a short reason code (e.g. "not_drawer", "wrong_phase") the
 * room logs with the action type. Never put player text in it. Independent of `quiet`: a refused
 * action can still return changed state (e.g. timers caught up), and the room handles that as usual.
 */
export interface ActionResult<S> { state: S; events?: GameEvent[]; quiet?: boolean; rejected?: string }
/** A separately stored piece of game state. Equal `rev` means equal `value`. */
export interface SavePart { rev: string; value: unknown }
export interface GameMeta { name: string; tagline: string; minPlayers: number; maxPlayers: number; accent: string }

/**
 * A game's rules. Functions are deterministic and do no I/O: time arrives as `now`,
 * randomness comes from `seed`. They may mutate the state they are given and must return it.
 */
export interface GameModule<S, A, Settings> {
  id: string;
  meta: GameMeta;
  defaultSettings: Settings;
  /** `prev` is the room's current settings, so an update may leave out fields it can't see. */
  parseSettings(input: unknown, prev?: Settings): Settings;
  /**
   * Optional: what one connection may see of the settings (default: all of them). The host's
   * settings form receives this, so it must still work from it. `phase` is the room's phase: the host
   * can change mid-game, so a game may hide more while one is being played.
   */
  publicSettings?(settings: Settings, to: { isHost: boolean; kind: "screen" | "player"; phase: "lobby" | "playing" }): unknown;
  parseAction(input: unknown): A | null;
  setup(players: PlayerInfo[], settings: Settings, seed: number, now: number): S;
  onAction(state: S, playerId: string, action: A, now: number): ActionResult<S>;
  onTimer(state: S, now: number): S;
  nextTimerAt(state: S): number | null;
  onPresence(state: S, playerId: string, connected: boolean, now: number): S;
  onSkip(state: S, now: number): S;
  view(state: S, viewer: Viewer): unknown;
  /**
   * Optional full-picture event for one viewer, for data too bulky to resend in every view (e.g. a
   * drawing that otherwise streams as incremental events). The room sends it as an `event` to a
   * connection when it (re)joins a game in progress and when that connection sends `resync`
   * (throttled). Return null to send nothing.
   */
  sync?(state: S, viewer: Viewer): unknown;
  /**
   * Optional: moves bulky, append-mostly data out of the saved state. Each part is stored under its
   * own key and rewritten only when its `rev` changes, so a save after e.g. a guess skips it. Must
   * not mutate `state`; `joinSave` reverses it on restore (a part may be missing: tolerate it).
   */
  splitSave?(state: S): { state: S; parts: Record<string, SavePart> };
  joinSave?(state: S, parts: Record<string, unknown>): S;
  isOver(state: S): boolean;
  results(state: S): GameResult[];
}
