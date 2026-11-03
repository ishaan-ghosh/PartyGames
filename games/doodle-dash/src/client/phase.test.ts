import { describe, expect, it } from "vitest";
import { CHOOSE_MS, REVEAL_MS, type DoodleView } from "../rules";
import { drawerSeesFeed, phaseTotal, timerFor } from "./phase";

const base: DoodleView = {
  turnKey: "1:0",
  phase: "drawing",
  round: 1,
  rounds: 3,
  drawTime: 80,
  phaseEndsAt: 10_000,
  drawerId: "p1",
  players: [],
  word: null,
  hint: null,
  choices: null,
  you: null,
  feed: [],
  strokeSig: "0:0",
  opSeq: 0,
};

describe("phaseTotal", () => {
  it("uses the length of the current phase", () => {
    expect(phaseTotal({ ...base, phase: "choosing" })).toBe(CHOOSE_MS);
    expect(phaseTotal({ ...base, phase: "drawing", drawTime: 45 })).toBe(45_000);
    expect(phaseTotal({ ...base, phase: "reveal" })).toBe(REVEAL_MS);
  });
});

describe("timerFor", () => {
  it("shows a countdown during active phases", () => {
    expect(timerFor(base)).toEqual({ endsAt: 10_000, totalMs: 80_000 });
  });

  it("hides the countdown while waiting for players, even though phaseEndsAt is in the past", () => {
    expect(timerFor({ ...base, phase: "reveal", waiting: true })).toBeNull();
  });

  it("hides the countdown once the game is over", () => {
    expect(timerFor({ ...base, phase: "over" })).toBeNull();
  });
});

describe("drawerSeesFeed", () => {
  it("shows the drawer the guess feed when there is no TV to watch it on", () => {
    expect(drawerSeesFeed("phones")).toBe(true);
  });

  it("leaves the feed to the TV in screen mode, so the drawer's canvas keeps its room", () => {
    expect(drawerSeesFeed("screen")).toBe(false);
  });
});
