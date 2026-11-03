import type { Avatar, GameResult } from "./protocol";

export interface PlayerInfo { id: string; name: string; avatar: Avatar; connected: boolean }
export type Viewer = { kind: "screen" } | { kind: "player"; playerId: string };
/** "others" = every connected device except the one that sent the action. */
export interface GameEvent { to: "all" | "others"; payload: unknown }
/** quiet: true → the room relays `events` but does NOT rebroadcast views or persist. */
export interface ActionResult<S> { state: S; events?: GameEvent[]; quiet?: boolean }
export interface GameMeta { name: string; tagline: string; minPlayers: number; maxPlayers: number; accent: string }

/**
 * A game's rules. Functions are deterministic and do no I/O: time arrives as `now`,
 * randomness comes from `seed`. They may mutate the state they are given and must return it.
 */
export interface GameModule<S, A, Settings> {
  id: string;
  meta: GameMeta;
  defaultSettings: Settings;
  parseSettings(input: unknown): Settings;
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
  isOver(state: S): boolean;
  results(state: S): GameResult[];
}
