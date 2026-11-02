import { describe, expect, it } from "vitest";
import { hasWebGL } from "./webgl";

const canvasWith = (supported: string[]) => () => ({
  getContext: (kind: string) => (supported.includes(kind) ? {} : null),
});

describe("hasWebGL", () => {
  it("is true with webgl2", () => {
    expect(hasWebGL(canvasWith(["webgl2"]))).toBe(true);
  });

  it("falls back to webgl", () => {
    expect(hasWebGL(canvasWith(["webgl"]))).toBe(true);
  });

  it("is false when neither context is available", () => {
    expect(hasWebGL(canvasWith([]))).toBe(false);
  });

  it("is false when probing throws", () => {
    expect(hasWebGL(() => { throw new Error("no canvas"); })).toBe(false);
  });
});
