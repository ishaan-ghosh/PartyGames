import type { SendOptions } from "@party/ui";
import type { DoodleView } from "../rules";

/** How long a guess typed while offline may wait for the reconnect. */
export const GUESS_KEEP_MS = 20_000;

/**
 * Guesses don't depend on other actions, so they may outlive a reconnect longer than strokes do. Guesses
 * carry no turn id for the server to check, so the client does it instead: a queued guess is only sent if the
 * first view after the reconnect is still the same turn and phase it was typed in. Otherwise it could
 * land in a later turn (a reveal is only 5 s and the next drawer can pick a word at once).
 */
export function guessSendOptions(typedIn: Pick<DoodleView, "turnKey" | "phase">): SendOptions {
  const { turnKey, phase } = typedIn;
  return {
    keepMs: GUESS_KEEP_MS,
    stillValid: (view) => {
      if (typeof view !== "object" || view === null) return false;
      const v = view as Partial<DoodleView>;
      return v.turnKey === turnKey && v.phase === phase;
    },
  };
}
