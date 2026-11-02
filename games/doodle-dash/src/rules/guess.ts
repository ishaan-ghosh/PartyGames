import type { ActionResult } from "@party/shared";
import { matchGuess } from "./chars";
import { allGuessed, endTurn, nameOf, pushFeed } from "./turns";
import type { DoodleState } from "./types";

export function handleGuess(s: DoodleState, playerId: string, text: string, now: number): ActionResult<DoodleState> {
  const clean = text.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean || !(playerId in s.scores)) return { state: s, quiet: true };

  if (s.phase !== "drawing" || !s.word) {
    // A late guess that is (or contains) the word stays private, so a correct guess is never shown.
    const match = s.word ? matchGuess(clean, s.word) : "miss";
    const hidden = match === "correct" || match === "contains";
    pushFeed(s, { kind: "chat", playerId, text: clean, audience: hidden ? { only: playerId } : "all" });
    return { state: s };
  }
  if (playerId === s.drawerId) return { state: s, quiet: true };
  if (s.solvers.includes(playerId)) {
    pushFeed(s, { kind: "chat", playerId, text: clean, audience: "solvers" });
    return { state: s };
  }
  const match = matchGuess(clean, s.word);
  if (match === "correct") {
    const timeLeft = Math.max(0, s.phaseEndsAt - now);
    const points = Math.round(500 * (timeLeft / (s.settings.drawTime * 1000))) + 50;
    s.scores[playerId] = (s.scores[playerId] ?? 0) + points;
    s.turnPoints[playerId] = points;
    s.solvers.push(playerId);
    pushFeed(s, { kind: "correct", playerId, text: `${nameOf(s, playerId)} guessed it!`, audience: "all" });
    if (allGuessed(s)) endTurn(s, now);
    return { state: s };
  }
  if (match === "contains") {
    // Wrong, but it would give the word away, so only the guesser sees it.
    pushFeed(s, { kind: "chat", playerId, text: clean, audience: { only: playerId } });
    return { state: s };
  }
  pushFeed(s, { kind: "chat", playerId, text: clean, audience: "all" });
  if (match === "close") {
    pushFeed(s, { kind: "close", playerId, text: `"${clean}" is close!`, audience: { only: playerId } });
  }
  return { state: s };
}
