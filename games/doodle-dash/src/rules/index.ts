import type { ActionResult, GameModule } from "@party/shared";
import { parseAction } from "./actions";
import { handleGuess } from "./guess";
import { onPresence } from "./presence";
import { defaultSettings, parseSettings, publicSettings } from "./settings";
import { joinSave, splitSave } from "./save";
import { handleStroke, syncOp } from "./strokes";
import { nextTimerAt, onChoose, onSkip, onTimer, setup } from "./turns";
import type { DoodleAction, DoodleSettings, DoodleState } from "./types";
import { view } from "./view";

function route(s: DoodleState, playerId: string, action: DoodleAction, now: number): ActionResult<DoodleState> {
  switch (action.t) {
    case "choose":
      return onChoose(s, playerId, action.index, now);
    case "guess":
      return handleGuess(s, playerId, action.text, now);
    default:
      return handleStroke(s, playerId, action);
  }
}

export const doodleDash: GameModule<DoodleState, DoodleAction, DoodleSettings> = {
  id: "doodle-dash",
  meta: { name: "Doodle Dash", tagline: "Draw fast. Guess faster.", minPlayers: 2, maxPlayers: 12, accent: "#7f5af0" },
  defaultSettings,
  parseSettings,
  publicSettings,
  parseAction,
  setup,
  onAction(state, playerId, action, now) {
    // The room calls onAction without running due timers first, so catch up here. Otherwise
    // a guess after phaseEndsAt (but before the alarm fires) would still score.
    const due = nextTimerAt(state);
    const caughtUp = due !== null && due <= now;
    if (caughtUp) state = onTimer(state, now);
    const r = route(state, playerId, action, now);
    // If time moved the game on, the room must rebroadcast views even for an ignored action.
    return caughtUp ? { ...r, quiet: false } : r;
  },
  onTimer,
  nextTimerAt,
  onPresence,
  onSkip,
  view,
  sync: (s) => syncOp(s),
  splitSave,
  joinSave,
  isOver: (s) => s.phase === "over",
  results: (s) =>
    s.players
      .map((p) => ({ playerId: p.id, name: p.name, score: s.scores[p.id] ?? 0 }))
      .sort((a, b) => b.score - a.score),
};

export type { DoodleAction, DoodleSettings, DoodleState, Stroke, StrokeOp } from "./types";
export type { DoodleView, ViewFeedItem } from "./view";
export type { PublicDoodleSettings } from "./settings";
export { EMPTY_SIG, strokeSignature } from "./strokes";
export { BRUSH_SIZES, CANVAS_H, CANVAS_W, CHOOSE_MS, MAX_FILLS, MAX_POINTS_PER_BATCH, PALETTE, REVEAL_MS } from "./types";
