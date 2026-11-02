import { doodleDash } from "@party/doodle-dash/rules";
import type { AnyGame } from "./room-core";

export const games: Record<string, AnyGame> = { [doodleDash.id]: doodleDash };
export const DEFAULT_GAME_ID = doodleDash.id;
