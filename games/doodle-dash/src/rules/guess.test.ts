import { describe, expect, it } from "vitest";
import { handleGuess } from "./guess";
import { drawing, start } from "./testkit";
import { onTimer } from "./turns";
import { view } from "./view";

const screen = { kind: "screen" } as const;
const as = (playerId: string) => ({ kind: "player", playerId }) as const;
const guess = (s: ReturnType<typeof drawing>, id: string, text: string, now = 0) => handleGuess(s, id, text, now);

describe("guessing and scoring", () => {
  it("scores a correct guess by speed", () => {
    const s = drawing("banana");
    guess(s, "p2", "banana", 40_000);
    expect(s.scores.p2).toBe(300);
    expect(s.solvers).toEqual(["p2"]);
  });

  it("ignores case and extra spaces", () => {
    const s = drawing("hot air balloon");
    guess(s, "p2", "  Hot  AIR balloon ", 0);
    expect(s.scores.p2).toBe(550);
  });

  it("never shows the correct guess text to anyone", () => {
    const s = drawing("banana", 4);
    guess(s, "p2", "BANANA", 1000);
    for (const v of [screen, as("p1"), as("p2"), as("p3")]) {
      expect(JSON.stringify(view(s, v).feed)).not.toMatch(/banana/i);
    }
    expect(view(s, screen).feed.at(-1)).toMatchObject({ kind: "correct", text: "P2 guessed it!" });
  });

  it("tells only the guesser when they are close", () => {
    const s = drawing("banana");
    guess(s, "p2", "banan", 1000);
    expect(view(s, as("p2")).feed.some((f) => f.kind === "close")).toBe(true);
    expect(view(s, as("p3")).feed.some((f) => f.kind === "close")).toBe(false);
    expect(view(s, screen).feed.some((f) => f.kind === "close")).toBe(false);
    expect(view(s, as("p3")).feed.at(-1)).toMatchObject({ kind: "chat", text: "banan", playerId: "p2" });
  });

  it("hides solver chat from people still guessing", () => {
    const s = drawing("banana", 4);
    guess(s, "p2", "banana", 1000);
    guess(s, "p2", "so easy", 2000);
    expect(view(s, as("p3")).feed.some((f) => f.text === "so easy")).toBe(false);
    expect(view(s, screen).feed.some((f) => f.text === "so easy")).toBe(false);
    expect(view(s, as("p1")).feed.some((f) => f.text === "so easy")).toBe(true);
  });

  it("does not let the drawer guess or chat while drawing", () => {
    const s = drawing("banana");
    expect(guess(s, "p1", "banana", 1000).quiet).toBe(true);
    expect(s.scores.p1).toBe(0);
  });

  it("ignores empty guesses", () => {
    const s = drawing("banana");
    const before = s.feed.length;
    expect(guess(s, "p2", "   ").quiet).toBe(true);
    expect(s.feed.length).toBe(before);
  });

  it("allows chat while the drawer is choosing", () => {
    const s = start(3);
    guess(s, "p2", "good luck", 1000);
    expect(view(s, screen).feed.at(-1)).toMatchObject({ kind: "chat", text: "good luck" });
  });

  it("ends the turn when everyone has guessed and pays the drawer", () => {
    const s = drawing("banana");
    guess(s, "p2", "banana");
    guess(s, "p3", "banana");
    expect(s.phase).toBe("reveal");
    expect(s.scores.p1).toBe(200);
    expect(view(s, screen).word).toBe("banana");
  });

  it("caps drawer points at 600", () => {
    const s = drawing("banana", 8);
    for (let i = 2; i <= 8; i++) guess(s, `p${i}`, "banana");
    expect(s.scores.p1).toBe(600);
  });

  it("ends the turn when time runs out, revealing the word", () => {
    const s = drawing("banana");
    onTimer(s, 80_000);
    expect(s.phase).toBe("reveal");
    expect(s.scores.p1).toBe(0);
    expect(view(s, screen).word).toBe("banana");
  });
});

describe("hints", () => {
  const shown = (h: string | null) => [...(h ?? "")].filter((c) => c !== "_").length;

  it("reveals one letter at 50% and another at 75% of the draw time", () => {
    const s = drawing("banana");
    expect(view(s, screen).hint).toBe("______");
    onTimer(s, 40_000);
    expect(shown(view(s, screen).hint)).toBe(1);
    onTimer(s, 60_000);
    expect(shown(view(s, screen).hint)).toBe(2);
  });

  it("keeps spaces and punctuation visible", () => {
    expect(view(drawing("yo-yo"), screen).hint).toBe("__-__");
    expect(view(drawing("hot air balloon"), screen).hint).toBe("___ ___ _______");
  });

  it("shows the full word to the drawer and to solvers", () => {
    const s = drawing("banana");
    expect(view(s, as("p1")).hint).toBe("banana");
    guess(s, "p2", "banana");
    expect(view(s, as("p2")).word).toBe("banana");
    expect(view(s, as("p3")).word).toBeNull();
  });
});
