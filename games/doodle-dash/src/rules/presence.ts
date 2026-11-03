import { allGuessed, endTurn, resumeIfReady } from "./turns";
import type { DoodleState } from "./types";

export function onPresence(s: DoodleState, playerId: string, connected: boolean, now: number): DoodleState {
  if (!(playerId in s.connected)) return s;
  s.connected[playerId] = connected;
  const active = s.phase === "choosing" || s.phase === "drawing";
  if (playerId === s.drawerId && active) {
    s.drawerGoneAt = connected ? null : now;
  } else if (!connected && s.phase === "drawing" && allGuessed(s)) {
    endTurn(s, now);
  }
  // A game paused between turns starts the next turn once enough players are back.
  if (connected) resumeIfReady(s, now);
  return s;
}
