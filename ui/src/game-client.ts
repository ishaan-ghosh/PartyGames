import type { GameMeta, RoomSnapshot, You } from "@party/shared";
import type { ComponentType } from "react";

/**
 * Marks an action as independent of the actions around it (e.g. a guess), so it can wait out a reconnect
 * on its own for up to `keepMs`. After the reconnect it's sent only if `stillValid` passes for the first
 * fresh view. Without options, actions are ordered and only survive a brief reconnect, all or nothing.
 */
export interface SendOptions {
  keepMs: number;
  stillValid?: (view: unknown) => boolean;
}

export interface GameClientProps<V = unknown> {
  view: V;
  room: RoomSnapshot;
  you: You;
  isHost: boolean;
  mode: "screen" | "phones";
  send(action: unknown, opts?: SendOptions): void;
  onEvent(cb: (payload: unknown) => void): () => void;
  /** Asks the room for the game's full-picture event again (GameModule.sync). Dropped while offline. */
  resync(): void;
  serverNow(): number;
  soundOn: boolean;
}

export interface SettingsFormProps<S = unknown> {
  settings: S;
  onChange(next: S): void;
  disabled: boolean;
}

export interface ClientGame {
  id: string;
  meta: GameMeta;
  emoji: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Screen: ComponentType<GameClientProps<any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Phone: ComponentType<GameClientProps<any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Settings: ComponentType<SettingsFormProps<any>>;
}
