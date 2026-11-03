import { z } from "zod";

export const LIMITS = {
  maxPlayers: 12,
  maxScreens: 4,
  nameMax: 16,
  hostGraceMs: 15_000,
  emptyRoomTtlMs: 10 * 60_000,
} as const;

export const Avatar = z.object({
  emoji: z.string().min(1).max(8),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type Avatar = z.infer<typeof Avatar>;

const HostCmd = z.discriminatedUnion("cmd", [
  z.object({ cmd: z.literal("selectGame"), gameId: z.string().max(40) }),
  z.object({ cmd: z.literal("updateSettings"), settings: z.unknown() }),
  z.object({ cmd: z.literal("start") }),
  z.object({ cmd: z.literal("skip") }),
  z.object({ cmd: z.literal("endGame") }),
  z.object({ cmd: z.literal("kick"), playerId: z.string().max(64) }),
]);

export const ClientMsg = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    role: z.enum(["screen", "player"]),
    token: z.string().min(1).max(64).optional(),
    hostKey: z.string().min(1).max(64).optional(),
    name: z.string().max(40).optional(),
    avatar: Avatar.optional(),
  }),
  z.object({ type: z.literal("action"), payload: z.unknown() }),
  z.object({ type: z.literal("host"), cmd: HostCmd }),
  /** Asks for the game's full-picture event again (see GameModule.sync), e.g. after a missed event. */
  z.object({ type: z.literal("resync") }),
]);
export type ClientMessage = z.infer<typeof ClientMsg>;
export type HelloMessage = Extract<ClientMessage, { type: "hello" }>;
export type HostCommand = z.infer<typeof HostCmd>;

export type ErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "SCREENS_FULL"
  | "NAME_TAKEN"
  | "BAD_MESSAGE"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "KICKED"
  | "REPLACED";

export interface PublicPlayer { id: string; name: string; avatar: Avatar; connected: boolean; isHost: boolean }
export interface PublicScreen { id: string; connected: boolean; isHost: boolean }
export interface GameResult { playerId: string; name: string; score: number }

export interface RoomSnapshot {
  code: string;
  hostId: string | null;
  mode: "screen" | "phones";
  phase: "lobby" | "playing";
  gameId: string;
  settings: unknown;
  players: PublicPlayer[];
  screens: PublicScreen[];
  lastResults: GameResult[] | null;
  belowMin: boolean;
}

export interface You { kind: "screen" | "player"; id: string }

export type ServerMsg =
  | { type: "welcome"; token: string; you: You }
  | { type: "room"; room: RoomSnapshot; now: number }
  | { type: "view"; payload: unknown; now: number }
  | { type: "event"; payload: unknown }
  | { type: "error"; code: ErrorCode; message: string };
