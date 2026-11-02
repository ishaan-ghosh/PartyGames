import { isCloseGuess, normalizeGuess, type ActionResult } from "@party/shared";
import { allGuessed, endTurn, nameOf, pushFeed } from "./turns";
import type { DoodleState } from "./types";

export function handleGuess(s: DoodleState, playerId: string, text: string, now: number): ActionResult<DoodleState> {
  const clean = text.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean || !(playerId in s.scores)) return { state: s, quiet: true };

  if (s.phase !== "drawing" || !s.word) {
    pushFeed(s, { kind: "chat", playerId, text: clean, audience: "all" });
    return { state: s };
  }
  if (playerId === s.drawerId) return { state: s, quiet: true };
  if (s.solvers.includes(playerId)) {
    pushFeed(s, { kind: "chat", playerId, text: clean, audience: "solvers" });
    return { state: s };
  }
  if (normalizeGuess(clean) === normalizeGuess(s.word)) {
    const timeLeft = Math.max(0, s.phaseEndsAt - now);
    const points = Math.round(500 * (timeLeft / (s.settings.drawTime * 1000))) + 50;
    s.scores[playerId] = (s.scores[playerId] ?? 0) + points;
    s.turnPoints[playerId] = points;
    s.solvers.push(playerId);
    pushFeed(s, { kind: "correct", playerId, text: `${nameOf(s, playerId)} guessed it!`, audience: "all" });
    if (allGuessed(s)) endTurn(s, now);
    return { state: s };
  }
  pushFeed(s, { kind: "chat", playerId, text: clean, audience: "all" });
  if (isCloseGuess(clean, s.word)) {
    pushFeed(s, { kind: "close", playerId, text: `"${clean}" is close!`, audience: { only: playerId } });
  }
  return { state: s };
}
