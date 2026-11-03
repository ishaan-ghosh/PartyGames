import type { Avatar, Viewer } from "@party/shared";
import { isLetter, isMark } from "./chars";
import { strokeSignature } from "./strokes";
import { MAX_FILLS, VIEW_FEED_LIMIT, type Audience, type DoodleState, type FeedItem, type Phase } from "./types";

export type ViewFeedItem = Omit<FeedItem, "audience">;
export interface DoodleView {
  turnKey: string;
  phase: Phase;
  round: number;
  rounds: number;
  drawTime: number;
  phaseEndsAt: number;
  drawerId: string;
  players: { id: string; name: string; avatar: Avatar; score: number; connected: boolean; solved: boolean; turnPoints: number }[];
  word: string | null;
  hint: string | null;
  choices: string[] | null;
  you: { id: string; role: "drawer" | "guesser" | "solver" | "spectator" } | null;
  feed: ViewFeedItem[];
  /** Stroke version and shape; the strokes themselves come on the stroke channel (StrokeOp). */
  strokeSig: string;
  opSeq: number;
  /** True while the game is paused between turns waiting for players to (re)connect. */
  waiting?: boolean;
  /** Drawer only, while drawing: flood fills still allowed this turn (see MAX_FILLS). */
  fillsLeft?: number;
}

export function makeHint(word: string, revealed: number[]): string {
  let baseShown = true;
  return [...word]
    .map((ch, i) => {
      if (isLetter(ch)) {
        baseShown = revealed.includes(i);
        return baseShown ? ch : "_";
      }
      if (isMark(ch)) return baseShown ? ch : "_";
      baseShown = true;
      return ch;
    })
    .join("");
}

export function view(s: DoodleState, viewer: Viewer): DoodleView {
  const playerId = viewer.kind === "player" ? viewer.playerId : null;
  const inGame = playerId !== null && playerId in s.scores;
  const isDrawer = inGame && playerId === s.drawerId;
  const solved = playerId !== null && inGame && s.solvers.includes(playerId);
  const turnOver = s.phase === "reveal" || s.phase === "over";
  const knowsWord = turnOver || isDrawer || solved;
  const canSee = (a: Audience) =>
    a === "all" || (a === "solvers" && (isDrawer || solved)) || (typeof a === "object" && a.only === playerId);

  return {
    turnKey: `${s.round}:${s.turnIndex}`,
    phase: s.phase,
    round: s.round,
    rounds: s.settings.rounds,
    drawTime: s.settings.drawTime,
    phaseEndsAt: s.phaseEndsAt,
    drawerId: s.drawerId,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: s.scores[p.id] ?? 0,
      connected: s.connected[p.id] ?? false,
      solved: s.solvers.includes(p.id),
      turnPoints: s.turnPoints[p.id] ?? 0,
    })),
    word: s.word && knowsWord ? s.word : null,
    hint: s.word ? (knowsWord ? s.word : makeHint(s.word, s.revealed)) : null,
    choices: isDrawer && s.phase === "choosing" ? [...s.choices] : null,
    you:
      playerId === null
        ? null
        : { id: playerId, role: !inGame ? "spectator" : isDrawer ? "drawer" : solved ? "solver" : "guesser" },
    feed: s.feed.filter((f) => canSee(f.audience)).slice(-VIEW_FEED_LIMIT).map(({ audience: _hidden, ...rest }) => rest),
    strokeSig: strokeSignature(s.strokes),
    opSeq: s.opSeq,
    waiting: s.paused,
    ...(isDrawer && s.phase === "drawing" ? { fillsLeft: Math.max(0, MAX_FILLS - (s.fills ?? 0)) } : {}),
  };
}
