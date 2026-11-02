import { describe, expect, it } from "vitest";
import { doodleDash, type DoodleView } from "./index";
import { drawing, start } from "./testkit";

const { parseAction, view, onAction, onPresence, onSkip, onTimer, nextTimerAt, isOver, results } = doodleDash;

describe("doodleDash module", () => {
  it("parses valid actions", () => {
    expect(parseAction({ t: "guess", text: "hi" })).toEqual({ t: "guess", text: "hi" });
    expect(parseAction({ t: "strokeBegin", tool: "pen", color: 0, size: 2, points: [0, 1] })).not.toBeNull();
    expect(parseAction({ t: "fill", color: 11, x: 0.5, y: 0.5 })).not.toBeNull();
  });

  it("rejects malformed actions", () => {
    const bad = [
      null,
      "garbage",
      { t: "nope" },
      { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [1.5, 0] },
      { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0.1] },
      { t: "strokeBegin", tool: "pen", color: 12, size: 0, points: [0, 0] },
      { t: "strokeBegin", tool: "spray", color: 0, size: 0, points: [0, 0] },
      { t: "strokeAppend", points: Array(402).fill(0.5) },
      { t: "choose", index: 3 },
      { t: "guess", text: "x".repeat(201) },
    ];
    for (const b of bad) expect(parseAction(b)).toBeNull();
  });

  it("shows word choices only to the drawer", () => {
    const s = start(3);
    expect(view(s, { kind: "player", playerId: "p1" })).toMatchObject({ choices: s.choices, you: { role: "drawer" } });
    expect(view(s, { kind: "player", playerId: "p2" })).toMatchObject({ choices: null, word: null, hint: null });
    expect(view(s, { kind: "screen" })).toMatchObject({ choices: null, you: null });
  });

  it("hides the word from the screen and guessers while drawing", () => {
    const s = drawing("banana");
    expect(view(s, { kind: "screen" })).toMatchObject({ word: null, hint: "______" });
    expect(view(s, { kind: "player", playerId: "p2" })).toMatchObject({ word: null, you: { role: "guesser" } });
    expect(view(s, { kind: "player", playerId: "p1" })).toMatchObject({ word: "banana" });
  });

  it("treats unknown players as spectators who cannot guess", () => {
    const s = drawing("banana");
    expect((view(s, { kind: "player", playerId: "zz" }) as DoodleView).you).toEqual({ id: "zz", role: "spectator" });
    expect(onAction(s, "zz", { t: "guess", text: "banana" }, 0).quiet).toBe(true);
    expect(s.solvers).toEqual([]);
  });

  it("routes actions by type", () => {
    const s = start(3);
    onAction(s, "p1", { t: "choose", index: 0 }, 0);
    expect(s.phase).toBe("drawing");
    const r = onAction(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] }, 0);
    expect(r.events).toHaveLength(1);
  });

  it("returns results sorted by score with names", () => {
    const s = drawing("banana");
    onAction(s, "p3", { t: "guess", text: "banana" }, 0);
    expect(results(s)[0]).toEqual({ playerId: "p3", name: "P3", score: 550 });
  });
});

describe("doodleDash module: late actions", () => {
  it("does not score a guess that arrives after the turn ended but before the timer fired", () => {
    const s = drawing("banana"); // drawing ends at 80_000
    const r = onAction(s, "p2", { t: "guess", text: "banana" }, 80_001);
    expect(s.scores.p2).toBe(0);
    expect(s.solvers).toEqual([]);
    expect(s.phase).toBe("reveal");
    expect(r.quiet).toBeFalsy(); // the room must rebroadcast the moved-on turn
  });

  it("drops strokes that arrive after the turn ended", () => {
    const s = drawing("banana");
    const r = onAction(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] }, 80_001);
    expect(r.events).toBeUndefined();
    expect(s.strokes).toEqual([]);
    expect(s.phase).toBe("reveal");
  });

  it("still scores a guess just before the turn ends", () => {
    const s = drawing("banana");
    onAction(s, "p2", { t: "guess", text: "banana" }, 80_000 - 1);
    expect(s.solvers).toEqual(["p2"]);
  });
});

describe("doodleDash module: pause and resume", () => {
  it("starts the next turn when two players reconnect after everyone left during the reveal", () => {
    let s = drawing("banana", 3, { rounds: 3 });
    s = onSkip(s, 1000); // reveal until 6000
    for (const id of ["p1", "p2", "p3"]) s = onPresence(s, id, false, 2000);
    s = onTimer(s, 6000);
    expect(s.paused).toBe(true);
    expect(nextTimerAt(s)).toBeNull();

    s = onPresence(s, "p2", true, 7000);
    expect(s.paused).toBe(true);
    expect(s.phase).toBe("reveal");

    s = onPresence(s, "p3", true, 8000);
    expect(s.paused).toBe(false);
    expect(s.phase).toBe("choosing");
    expect(s.drawerId).toBe("p2");
    expect(nextTimerAt(s)).toBe(23_000);
  });

  it("ends the game on resume when no remaining drawer of the final round is connected", () => {
    // 4 players, 1 round. After p3's turn only p4 is left to draw.
    let s = drawing("banana", 4, { rounds: 1 });
    s = onSkip(s, 1000);
    s = onTimer(s, 6000); // p2 draws
    s = onSkip(s, 7000);
    s = onTimer(s, 12_000); // p3 draws
    expect(s.drawerId).toBe("p3");
    for (const id of ["p1", "p2", "p3"]) s = onPresence(s, id, false, 13_000);
    s = onSkip(s, 14_000);
    s = onTimer(s, 19_000); // only p4 online: wait for players
    expect(s.paused).toBe(true);

    s = onPresence(s, "p4", false, 20_000);
    s = onPresence(s, "p1", true, 21_000);
    s = onPresence(s, "p2", true, 22_000);
    expect(isOver(s)).toBe(true);
    expect(nextTimerAt(s)).toBeNull();
  });
});
