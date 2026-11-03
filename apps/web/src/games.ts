import { doodleClient } from "@party/doodle-dash/client";
import type { ClientGame } from "@party/ui";

/** Playable games, keyed by id. */
export const clientGames: Record<string, ClientGame> = { [doodleClient.id]: doodleClient };

/** Own-property lookup, so ids like "constructor" or "__proto__" never resolve via Object.prototype. */
export function getClientGame(id: string): ClientGame | undefined {
  return Object.prototype.hasOwnProperty.call(clientGames, id) ? clientGames[id] : undefined;
}
