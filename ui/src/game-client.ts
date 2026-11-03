import type { GameMeta, RoomSnapshot, You } from "@party/shared";
import type { ComponentType } from "react";

export interface GameClientProps<V = unknown> {
  view: V;
  room: RoomSnapshot;
  you: You;
  isHost: boolean;
  mode: "screen" | "phones";
  send(action: unknown): void;
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
