import { describe, expect, it } from "vitest";
import { GUESS_KEEP_MS, guessSendOptions } from "./guessSend";

describe("guessSendOptions", () => {
  const opts = guessSendOptions({ turnKey: "1:2", phase: "drawing" });

  it("keeps a guess for a reconnect well past the 2 s stroke window", () => {
    expect(opts.keepMs).toBe(GUESS_KEEP_MS);
    expect(GUESS_KEEP_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("is still valid in the same turn and phase", () => {
    expect(opts.stillValid!({ turnKey: "1:2", phase: "drawing" })).toBe(true);
  });

  it("is not valid once the turn or phase moved on", () => {
    expect(opts.stillValid!({ turnKey: "1:3", phase: "drawing" })).toBe(false);
    expect(opts.stillValid!({ turnKey: "2:2", phase: "drawing" })).toBe(false);
    expect(opts.stillValid!({ turnKey: "1:2", phase: "reveal" })).toBe(false);
  });

  it("is not valid for a missing or malformed view", () => {
    expect(opts.stillValid!(null)).toBe(false);
    expect(opts.stillValid!("x")).toBe(false);
    expect(opts.stillValid!({})).toBe(false);
  });
});
