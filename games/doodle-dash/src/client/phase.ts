import { CHOOSE_MS, REVEAL_MS, type DoodleView } from "../rules";

/** Full length of the current phase, for the timer ring's progress. */
export const phaseTotal = (v: DoodleView): number =>
  v.phase === "choosing" ? CHOOSE_MS : v.phase === "drawing" ? v.drawTime * 1000 : REVEAL_MS;

/**
 * What the countdown should show, or null when there is no running clock: while the game
 * waits for players (`phaseEndsAt` may be in the past and nothing is counting down) or
 * after the game is over.
 */
export function timerFor(v: DoodleView): { endsAt: number; totalMs: number } | null {
  if (v.waiting || v.phase === "over") return null;
  return { endsAt: v.phaseEndsAt, totalMs: phaseTotal(v) };
}
