import { hasLetter } from "./chars";
import type { Difficulty, DoodleSettings } from "./types";
import { EASY, HARD, MEDIUM } from "./words";

export const defaultSettings: DoodleSettings = { rounds: 3, drawTime: 80, difficulty: "mixed", customWords: [] };
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "mixed"];

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

/**
 * What a connection sees of the settings. Custom words are the host's secret: only a host on a phone
 * gets them (to edit); everyone else, the TV included even when it is the host, gets their count.
 */
export type PublicDoodleSettings = Omit<DoodleSettings, "customWords"> & { customWordCount: number };

export function publicSettings(s: DoodleSettings, to: { isHost: boolean; kind: "screen" | "player" }): DoodleSettings | PublicDoodleSettings {
  if (to.isHost && to.kind === "player") return s;
  return { rounds: s.rounds, drawTime: s.drawTime, difficulty: s.difficulty, customWordCount: s.customWords.length };
}

/**
 * Cleans a settings update. Without a `customWords` array the current words (`prev`) are kept, so a
 * form that only sees the count can change everything else; `addCustomWords` appends to them.
 */
export function parseSettings(input: unknown, prev?: DoodleSettings): DoodleSettings {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const difficulty = DIFFICULTIES.includes(o.difficulty as Difficulty)
    ? (o.difficulty as Difficulty)
    : defaultSettings.difficulty;
  const base: unknown[] = Array.isArray(o.customWords) ? o.customWords : (prev?.customWords ?? []);
  const added: unknown[] = Array.isArray(o.addCustomWords) ? o.addCustomWords : [];
  const seen = new Set<string>();
  const customWords: string[] = [];
  for (const w of [...base, ...added]) {
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
