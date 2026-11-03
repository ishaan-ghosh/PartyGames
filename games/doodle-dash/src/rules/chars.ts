import { levenshtein } from "@party/shared";

const LETTER = /^[\p{L}\p{N}]$/u;
const MARK = /^\p{M}$/u;
const NOT_WORD = /[^\p{L}\p{N}\p{M}]/gu;

/** A letter or digit in any script. These are hidden in hints and can be revealed. */
export function isLetter(ch: string): boolean {
  return LETTER.test(ch);
}

/** A combining mark (e.g. U+0301). Hidden in hints unless the letter it attaches to is revealed. */
export function isMark(ch: string): boolean {
  return MARK.test(ch);
}

export function hasLetter(word: string): boolean {
  return [...word].some(isLetter);
}

/**
 * Canonical form for comparing guesses with the word: NFKC, lowercase, and only
 * letters, digits and combining marks (no spaces or punctuation). Marks are kept so
 * that words differing only by a vowel sign (e.g. Devanagari) don't collapse together.
 */
export function canonical(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(NOT_WORD, "");
}

export type GuessMatch = "correct" | "contains" | "close" | "miss";

export function matchGuess(guess: string, word: string): GuessMatch {
  const g = canonical(guess);
  const w = canonical(word);
  if (!g || !w) return "miss";
  if (g === w) return "correct";
  if (g.includes(w)) return "contains";
  if ([...w].length >= 4 && levenshtein(g, w) === 1) return "close";
  return "miss";
}
