import type { PlayerInfo } from "@party/shared";
import { defaultSettings } from "./settings";
import { hintSchedule, onChoose, setup } from "./turns";
import type { DoodleSettings, DoodleState } from "./types";

export function players(n: number, disconnected: number[] = []): PlayerInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `P${i + 1}`,
    avatar: { emoji: "🦊", color: "#ff8906" },
    connected: !disconnected.includes(i + 1),
  }));
}

export function start(
  n = 3,
  settings: Partial<DoodleSettings> = {},
  opts: { disconnected?: number[]; now?: number } = {},
): DoodleState {
  return setup(players(n, opts.disconnected), { ...defaultSettings, ...settings }, 42, opts.now ?? 0);
}

/** A game where p1 chose a word at t=0 and is drawing; the word is forced to `word`. */
export function drawing(word: string, n = 3, settings: Partial<DoodleSettings> = {}): DoodleState {
  const s = start(n, settings);
  onChoose(s, "p1", 0, 0);
  s.word = word;
  s.usedWords = [word];
  s.revealed = [];
  s.hintTimes = hintSchedule(word, 0, s.settings.drawTime * 1000);
  return s;
}
