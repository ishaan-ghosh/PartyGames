import { describe, expect, it } from "vitest";
import { drawing } from "./testkit";
import { nextTimerAt, onSkip, onTimer, resumeIfReady } from "./turns";
import type { DoodleState } from "./types";
import { view } from "./view";

const screen = { kind: "screen" } as const;

function setConnected(s: DoodleState, ids: string[]): void {
  for (const id of Object.keys(s.connected)) s.connected[id] = ids.includes(id);
}

/** p1 is drawing; `connected` are online when the turn ends and the reveal runs out. */
function pastReveal(connected: string[]): DoodleState {
  let s = drawing("banana", 3, { rounds: 3 });
  setConnected(s, connected);
  s = onSkip(s, 1000); // reveal until 6000
  return onTimer(s, 6000);
}

describe("pause between turns", () => {
  it("pauses instead of ending the game when nobody is connected", () => {
    const s = pastReveal([]);
    expect(s.phase).toBe("reveal");
    expect(s.paused).toBe(true);
    expect(s.round).toBe(1);
    expect(nextTimerAt(s)).toBeNull();
    expect(view(s, screen).waiting).toBe(true);
  });

  it("does not start a turn with only one connected player", () => {
    const s = pastReveal(["p3"]);
    expect(s.phase).toBe("reveal");
    expect(s.paused).toBe(true);
    expect(nextTimerAt(s)).toBeNull();
    expect(onTimer(s, 60_000).phase).toBe("reveal");
  });

  it("stays paused until at least two players are connected", () => {
    const s = pastReveal([]);
    s.connected.p3 = true;
    expect(resumeIfReady(s, 10_000)).toBe(false);
    expect(s.paused).toBe(true);
    s.connected.p1 = true;
    expect(resumeIfReady(s, 11_000)).toBe(true);
    expect(s.paused).toBe(false);
    expect(s.phase).toBe("choosing");
    expect(s.drawerId).toBe("p3"); // p2 is still away, so the next connected player draws
    expect(s.phaseEndsAt).toBe(26_000);
    expect(nextTimerAt(s)).toBe(26_000);
    expect(view(s, screen).waiting).toBe(false);
  });

  it("resumes with the reconnected next drawer", () => {
    const s = pastReveal(["p3"]);
    s.connected.p2 = true;
    expect(resumeIfReady(s, 9000)).toBe(true);
    expect(s.drawerId).toBe("p2");
  });

  it("does nothing when not paused", () => {
    const s = drawing("banana");
    expect(resumeIfReady(s, 1000)).toBe(false);
    expect(s.phase).toBe("drawing");
    expect(view(s, screen).waiting).toBe(false);
  });

  it("still ends the game after the last turn even with fewer than two connected", () => {
    let s = drawing("banana", 2, { rounds: 1 });
    s = onSkip(s, 1000);
    s = onTimer(s, 6000); // p2's turn
    expect(s.drawerId).toBe("p2");
    setConnected(s, ["p2"]);
    s = onSkip(s, 7000);
    s = onTimer(s, 12_000);
    expect(s.phase).toBe("over");
    expect(s.paused).toBe(false);
  });

  it("ends the game instead of pausing when no remaining drawer of the final round is connected", () => {
    let s = drawing("banana", 3, { rounds: 1 });
    setConnected(s, ["p1"]); // p2 and p3, the only drawers left, are away
    s = onSkip(s, 1000);
    s = onTimer(s, 6000);
    expect(s.phase).toBe("over");
    expect(s.paused).toBe(false);
    expect(nextTimerAt(s)).toBeNull();
  });

  it("still pauses in the final round while a remaining drawer is connected", () => {
    let s = drawing("banana", 3, { rounds: 1 });
    setConnected(s, ["p3"]);
    s = onSkip(s, 1000);
    s = onTimer(s, 6000);
    expect(s.phase).toBe("reveal");
    expect(s.paused).toBe(true);
  });

  it("keeps a running turn going when players drop below two", () => {
    const s = drawing("banana");
    setConnected(s, ["p1"]);
    onTimer(s, 40_000); // first hint, no turn boundary
    expect(s.phase).toBe("drawing");
    expect(s.paused).toBe(false);
  });
});
