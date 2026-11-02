import { hasLetter } from "./chars";
import type { Difficulty, DoodleSettings } from "./types";
import { EASY, HARD, MEDIUM } from "./words";

export const defaultSettings: DoodleSettings = { rounds: 3, drawTime: 80, difficulty: "mixed", customWords: [] };
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "mixed"];

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

export function parseSettings(input: unknown): DoodleSettings {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const difficulty = DIFFICULTIES.includes(o.difficulty as Difficulty)
    ? (o.difficulty as Difficulty)
    : defaultSettings.difficulty;
  const seen = new Set<string>();
  const customWords: string[] = [];
  for (const w of Array.isArray(o.customWords) ? o.customWords : []) {
    if (typeof w !== "string") continue;
    const t = w.trim().replace(/\s+/g, " ");
    const k = t.toLowerCase();
    if (t.length < 1 || t.length > 30 || !hasLetter(t) || seen.has(k)) continue;
    seen.add(k);
    customWords.push(t);
    if (customWords.length >= 200) break;
  }
  return {
    rounds: clampInt(o.rounds, 1, 6, defaultSettings.rounds),
    drawTime: clampInt(o.drawTime, 30, 180, defaultSettings.drawTime),
    difficulty,
    customWords,
  };
}

export function wordPool(settings: DoodleSettings): string[] {
  const base =
    settings.difficulty === "easy" ? EASY
    : settings.difficulty === "medium" ? MEDIUM
    : settings.difficulty === "hard" ? HARD
    : [...EASY, ...MEDIUM, ...HARD];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of [...base, ...settings.customWords]) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}
