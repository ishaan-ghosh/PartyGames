import { Rng, type ActionResult, type PlayerInfo } from "@party/shared";
import { wordPool } from "./settings";
import {
  CHOOSE_MS, DRAWER_GRACE_MS, FEED_KEEP, REVEAL_MS,
  type DoodleSettings, type DoodleState, type FeedItem,
} from "./types";

export function nameOf(s: DoodleState, id: string): string {
  return s.players.find((p) => p.id === id)?.name ?? "Someone";
}

export function pushFeed(s: DoodleState, item: Omit<FeedItem, "id">): void {
  s.feed.push({ id: s.nextFeedId++, ...item });
  if (s.feed.length > FEED_KEEP) s.feed.splice(0, s.feed.length - FEED_KEEP);
}

export function letterIndices(word: string): number[] {
  return [...word].flatMap((ch, i) => (/[a-z0-9]/i.test(ch) ? [i] : []));
}

export function hintSchedule(word: string, start: number, durationMs: number): number[] {
  const n = letterIndices(word).length;
  const count = n >= 4 ? 2 : n >= 2 ? 1 : 0;
  return [0.5, 0.75].slice(0, count).map((f) => start + Math.round(durationMs * f));
}

export function setup(players: PlayerInfo[], settings: DoodleSettings, seed: number, now: number): DoodleState {
  const s: DoodleState = {
    seed,
    settings,
    players: players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })),
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    connected: Object.fromEntries(players.map((p) => [p.id, p.connected])),
    round: 1,
    turnOrder: players.map((p) => p.id),
    turnIndex: 0,
    drawerId: "",
    phase: "choosing",
    phaseStartedAt: now,
    phaseEndsAt: now,
    choices: [],
    word: null,
    revealed: [],
    hintTimes: [],
    solvers: [],
    turnPoints: {},
    strokes: [],
    opSeq: 0,
    nextStrokeId: 1,
    ink: 0,
    feed: [],
    nextFeedId: 1,
    usedWords: [],
    drawerGoneAt: null,
  };
  return startTurn(s, now);
}

function availableWords(s: DoodleState): string[] {
  const used = new Set(s.usedWords.map((w) => w.toLowerCase()));
  const pool = wordPool(s.settings);
  const fresh = pool.filter((w) => !used.has(w.toLowerCase()));
  if (fresh.length >= 3) return fresh;
  s.usedWords = [];
  return pool;
}

export function startTurn(s: DoodleState, now: number): DoodleState {
  for (;;) {
    if (s.turnIndex >= s.turnOrder.length) {
      if (s.round >= s.settings.rounds) {
        s.phase = "over";
        s.choices = [];
        return s;
      }
      s.round += 1;
      s.turnIndex = 0;
      s.turnOrder = s.players.map((p) => p.id);
      continue;
    }
    if (s.connected[s.turnOrder[s.turnIndex]!]) break;
    s.turnIndex += 1;
  }
  const drawerId = s.turnOrder[s.turnIndex]!;
  const rng = new Rng(s.seed);
  s.choices = rng.sample(availableWords(s), 3);
  s.seed = rng.seed;
  s.drawerId = drawerId;
  s.phase = "choosing";
  s.phaseStartedAt = now;
  s.phaseEndsAt = now + CHOOSE_MS;
  s.word = null;
  s.revealed = [];
  s.hintTimes = [];
  s.solvers = [];
  s.turnPoints = {};
  s.strokes = [];
  s.ink = 0;
  s.drawerGoneAt = null;
  pushFeed(s, { kind: "system", playerId: null, text: `${nameOf(s, drawerId)} is choosing a word`, audience: "all" });
  return s;
}

export function chooseWord(s: DoodleState, index: number, now: number): DoodleState {
  const word = s.choices[index];
  if (!word) return s;
  const durationMs = s.settings.drawTime * 1000;
  s.word = word;
  s.usedWords.push(word);
  s.choices = [];
  s.phase = "drawing";
  s.phaseStartedAt = now;
  s.phaseEndsAt = now + durationMs;
  s.hintTimes = hintSchedule(word, now, durationMs);
  pushFeed(s, { kind: "system", playerId: null, text: `${nameOf(s, s.drawerId)} is drawing!`, audience: "all" });
  return s;
}

export function onChoose(s: DoodleState, playerId: string, index: number, now: number): ActionResult<DoodleState> {
  if (s.phase !== "choosing" || playerId !== s.drawerId || !s.choices[index]) return { state: s, quiet: true };
  return { state: chooseWord(s, index, now) };
}

export function endTurn(s: DoodleState, now: number): DoodleState {
  const drawerPoints = Math.min(100 * s.solvers.length, 600);
  if (drawerPoints > 0) {
    s.scores[s.drawerId] = (s.scores[s.drawerId] ?? 0) + drawerPoints;
    s.turnPoints[s.drawerId] = drawerPoints;
  }
  pushFeed(s, {
    kind: "system",
    playerId: null,
    text: s.word ? `The word was "${s.word}"` : `${nameOf(s, s.drawerId)}'s turn was skipped`,
    audience: "all",
  });
  s.phase = "reveal";
  s.phaseStartedAt = now;
  s.phaseEndsAt = now + REVEAL_MS;
  s.hintTimes = [];
  s.choices = [];
  s.drawerGoneAt = null;
  return s;
}

export function nextTurn(s: DoodleState, now: number): DoodleState {
  s.turnIndex += 1;
  return startTurn(s, now);
}

export function allGuessed(s: DoodleState): boolean {
  const guessers = s.players.filter((p) => p.id !== s.drawerId && s.connected[p.id]);
  return guessers.length > 0 && guessers.every((p) => s.solvers.includes(p.id));
}

/** Reveal one random hidden letter, always leaving at least one hidden. */
export function revealHint(s: DoodleState): void {
  const hidden = letterIndices(s.word ?? "").filter((i) => !s.revealed.includes(i));
  if (hidden.length <= 1) return;
  const rng = new Rng(s.seed);
  s.revealed.push(rng.pick(hidden));
  s.seed = rng.seed;
}

export function nextTimerAt(s: DoodleState): number | null {
  if (s.phase === "over") return null;
  const times = [s.phaseEndsAt];
  if (s.phase === "drawing" && s.hintTimes.length) times.push(s.hintTimes[0]!);
  if (s.drawerGoneAt !== null && (s.phase === "choosing" || s.phase === "drawing")) {
    times.push(s.drawerGoneAt + DRAWER_GRACE_MS);
  }
  return Math.min(...times);
}

function step(s: DoodleState, now: number): DoodleState {
  const active = s.phase === "choosing" || s.phase === "drawing";
  if (active && s.drawerGoneAt !== null && now >= s.drawerGoneAt + DRAWER_GRACE_MS) return endTurn(s, now);
  if (s.phase === "choosing" && now >= s.phaseEndsAt) {
    const rng = new Rng(s.seed);
    const i = rng.int(s.choices.length);
    s.seed = rng.seed;
    return chooseWord(s, i, now);
  }
  if (s.phase === "drawing") {
    if (now >= s.phaseEndsAt) return endTurn(s, now);
    if (s.hintTimes.length && s.hintTimes[0]! <= now) {
      s.hintTimes.shift();
      revealHint(s);
      return s;
    }
  }
  if (s.phase === "reveal" && now >= s.phaseEndsAt) return nextTurn(s, now);
  return s;
}

export function onTimer(s: DoodleState, now: number): DoodleState {
  for (let guard = 0; guard < 20; guard++) {
    const at = nextTimerAt(s);
    if (at === null || at > now) break;
    s = step(s, now);
  }
  return s;
}

export function onSkip(s: DoodleState, now: number): DoodleState {
  if (s.phase === "choosing" || s.phase === "drawing") return endTurn(s, now);
  if (s.phase === "reveal") return nextTurn(s, now);
  return s;
}
