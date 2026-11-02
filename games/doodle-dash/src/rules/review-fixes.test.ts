import { describe, expect, it } from "vitest";
import { handleGuess } from "./guess";
import { defaultSettings, parseSettings } from "./settings";
import { drawing, players, start } from "./testkit";
import { hintSchedule, letterIndices, onChoose, onSkip, revealHint, setup } from "./turns";
import { VIEW_FEED_LIMIT, type DoodleSettings } from "./types";
import { makeHint, view } from "./view";

const screen = { kind: "screen" } as const;
const as = (playerId: string) => ({ kind: "player", playerId }) as const;

describe("unicode hints", () => {
  it("masks non-Latin letters", () => {
    expect(view(drawing("кошка"), screen).hint).toBe("_____");
    expect(view(drawing("寿司"), screen).hint).toBe("__");
    expect(letterIndices("ёлка")).toHaveLength(4);
  });

  it("masks accented letters, precomposed or with combining marks", () => {
    expect(view(drawing("café"), screen).hint).toBe("____");
    expect(makeHint("café", [])).toBe("_____");
    expect(makeHint("café", [3])).toBe("___é");
    expect(letterIndices("café")).toEqual([0, 1, 2, 3]);
  });

  it("schedules hints for non-Latin words", () => {
    expect(hintSchedule("кошка", 0, 80_000)).toEqual([40_000, 60_000]);
  });

  it("drops custom words with no letter or digit", () => {
    expect(parseSettings({ customWords: ["!!!", "--", "кошка", "寿司", "a1"] }).customWords).toEqual(["кошка", "寿司", "a1"]);
  });
});

describe("guess normalization", () => {
  it("accepts punctuation and case differences as correct", () => {
    const s = drawing("banana");
    handleGuess(s, "p2", "Banana!", 0);
    expect(s.solvers).toEqual(["p2"]);
    expect(s.scores.p2).toBe(550);
  });

  it("matches across hyphens and spaces", () => {
    for (const g of ["yoyo", "yo yo", "YO-YO"]) {
      const s = drawing("yo-yo");
      handleGuess(s, "p2", g, 0);
      expect(s.solvers).toEqual(["p2"]);
    }
  });

  it("keeps a wrong guess that contains the word private to the guesser", () => {
    const s = drawing("banana", 4);
    handleGuess(s, "p2", "a banana", 1000);
    handleGuess(s, "p2", "bananas", 1000);
    expect(s.solvers).toEqual([]);
    for (const v of [screen, as("p1"), as("p3"), as("p4")]) {
      expect(JSON.stringify(view(s, v).feed)).not.toMatch(/banana/i);
    }
    const own = view(s, as("p2")).feed;
    expect(own.some((f) => f.text === "a banana")).toBe(true);
    expect(own.some((f) => f.kind === "close")).toBe(false);
  });

  it("keeps ordinary near misses public and close", () => {
    const s = drawing("banana");
    handleGuess(s, "p2", "Banan!", 1000);
    expect(view(s, as("p3")).feed.at(-1)).toMatchObject({ kind: "chat", text: "Banan!" });
    expect(view(s, as("p2")).feed.at(-1)).toMatchObject({ kind: "close" });
  });

  it("does not treat a punctuation-only guess as correct", () => {
    const s = drawing("banana");
    handleGuess(s, "p2", "???", 1000);
    expect(s.solvers).toEqual([]);
  });
});

describe("word pool reset", () => {
  it("does not re-offer recently played words after the pool runs out", () => {
    let s = start(2, { difficulty: "easy", rounds: 100 });
    const played: string[] = [];
    let t = 0;
    for (let i = 0; i < 120; i++) {
      onChoose(s, s.drawerId, 0, t);
      played.push(s.word!);
      s = onSkip(s, (t += 1000));
      s = onSkip(s, (t += 1000));
      for (const w of played.slice(-10)) expect(s.choices).not.toContain(w);
    }
  });
});

describe("setup", () => {
  it("does not keep a reference to the caller's settings", () => {
    const settings: DoodleSettings = { ...defaultSettings, customWords: ["kite"] };
    const s = setup(players(2), settings, 1, 0);
    settings.rounds = 6;
    settings.customWords.push("x");
    expect(s.settings.rounds).toBe(defaultSettings.rounds);
    expect(s.settings.customWords).toEqual(["kite"]);
  });
});

describe("hint helpers", () => {
  it("gives 0, 1 or 2 hints by letter count", () => {
    expect(hintSchedule("a", 0, 80_000)).toEqual([]);
    expect(hintSchedule("ox", 0, 80_000)).toEqual([40_000]);
    expect(hintSchedule("cat", 0, 80_000)).toEqual([40_000]);
    expect(hintSchedule("frog", 0, 80_000)).toEqual([40_000, 60_000]);
    expect(hintSchedule("a-b", 0, 80_000)).toEqual([40_000]);
  });

  it("always leaves at least one letter hidden", () => {
    const s = drawing("cat");
    for (let i = 0; i < 5; i++) revealHint(s);
    expect(s.revealed).toHaveLength(2);
    expect(makeHint("cat", s.revealed)).toMatch(/_/);
  });
});

describe("settings limits", () => {
  it("caps custom words at 200", () => {
    const words = Array.from({ length: 250 }, (_, i) => `word${i}`);
    expect(parseSettings({ customWords: words }).customWords).toHaveLength(200);
  });

  it("rounds non-integer draw times", () => {
    expect(parseSettings({ drawTime: 45.6 }).drawTime).toBe(46);
  });
});

describe("view feed", () => {
  it("shows at most 30 visible items, newest last", () => {
    expect(VIEW_FEED_LIMIT).toBe(30);
    const s = start(3);
    for (let i = 1; i <= 40; i++) handleGuess(s, "p2", `msg ${i}`, 0);
    const feed = view(s, screen).feed;
    expect(feed).toHaveLength(VIEW_FEED_LIMIT);
    expect(feed.at(-1)?.text).toBe("msg 40");
    expect(feed[0]?.text).toBe("msg 11");
  });
});
