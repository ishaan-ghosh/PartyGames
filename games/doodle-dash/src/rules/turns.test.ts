import { describe, expect, it } from "vitest";
import { start } from "./testkit";
import { nextTimerAt, onChoose, onSkip, onTimer } from "./turns";

describe("turn flow", () => {
  it("starts with the first connected player choosing from 3 distinct words", () => {
    const s = start(3);
    expect(s.drawerId).toBe("p1");
    expect(s.phase).toBe("choosing");
    expect(new Set(s.choices).size).toBe(3);
    expect(s.phaseEndsAt).toBe(15_000);
  });

  it("skips a disconnected drawer at turn start", () => {
    expect(start(3, {}, { disconnected: [1] }).drawerId).toBe("p2");
  });

  it("lets only the drawer choose", () => {
    const s = start(3);
    expect(onChoose(s, "p2", 0, 1000).quiet).toBe(true);
    expect(s.phase).toBe("choosing");
    const picked = s.choices[1];
    onChoose(s, "p1", 1, 1000);
    expect(s.phase).toBe("drawing");
    expect(s.word).toBe(picked);
    expect(s.phaseEndsAt).toBe(81_000);
  });

  it("auto-picks a word when the drawer doesn't choose within 15s", () => {
    const s = start(3);
    const choices = [...s.choices];
    onTimer(s, 15_000);
    expect(s.phase).toBe("drawing");
    expect(choices).toContain(s.word);
  });

  it("rotates drawers and ends after the last round", () => {
    let s = start(2, { rounds: 1 });
    expect(s.drawerId).toBe("p1");
    s = onSkip(s, 1000);
    expect(s.phase).toBe("reveal");
    s = onTimer(s, 6000);
    expect(s.drawerId).toBe("p2");
    expect(s.phase).toBe("choosing");
    s = onSkip(s, 7000);
    s = onTimer(s, 12_000);
    expect(s.phase).toBe("over");
    expect(nextTimerAt(s)).toBeNull();
  });

  it("plays the configured number of rounds", () => {
    let s = start(2, { rounds: 2 });
    const drawers: string[] = [];
    let t = 0;
    while (s.phase !== "over") {
      drawers.push(s.drawerId);
      t += 1000;
      s = onSkip(s, t);
      t += 5000;
      s = onTimer(s, t);
    }
    expect(drawers).toEqual(["p1", "p2", "p1", "p2"]);
  });

  it("never plays the same word twice in a game", () => {
    let s = start(3, { rounds: 6 });
    const chosen: string[] = [];
    let t = 0;
    while (s.phase !== "over") {
      onChoose(s, s.drawerId, 0, t);
      chosen.push(s.word!);
      s = onSkip(s, (t += 1000));
      s = onTimer(s, (t += 5000));
    }
    expect(chosen).toHaveLength(18);
    expect(new Set(chosen).size).toBe(18);
  });

  it("schedules the next timer at the phase end", () => {
    const s = start(3);
    expect(nextTimerAt(s)).toBe(15_000);
  });
});
