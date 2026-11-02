import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it("returns values in [0, 1)", () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("advances its seed so it can be saved and resumed", () => {
    const a = new Rng(9);
    a.next();
    const resumed = new Rng(a.seed);
    expect(resumed.next()).toBe(a.next());
  });
  it("samples distinct items", () => {
    const s = new Rng(3).sample(["a", "b", "c", "d", "e"], 3);
    expect(s).toHaveLength(3);
    expect(new Set(s).size).toBe(3);
  });
  it("returns every item when asked for more than exist", () => {
    expect(new Rng(3).sample([1, 2], 5).sort()).toEqual([1, 2]);
  });
});
