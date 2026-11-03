import { describe, expect, it } from "vitest";
import { isRoomCode, makeRoomCode, normalizeRoomCode } from "./codes";
import { Rng } from "./rng";

describe("room codes", () => {
  it("makes 4-letter codes without ambiguous characters", () => {
    const r = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const c = makeRoomCode(() => r.next());
      expect(isRoomCode(c)).toBe(true);
      expect(c).not.toMatch(/[ILO0-9]/);
    }
  });
  it("normalizes user input", () => {
    expect(normalizeRoomCode("  abcd ")).toBe("ABCD");
  });
  it("rejects ambiguous or wrong-length codes", () => {
    for (const bad of ["ABCO", "ABCI", "ABC", "ABCDE", "AB1D", "abcd"]) expect(isRoomCode(bad)).toBe(false);
  });
});
