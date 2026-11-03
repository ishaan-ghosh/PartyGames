import { describe, expect, it } from "vitest";
import { isAllowedPartyPath } from "./routes";

describe("isAllowedPartyPath", () => {
  it("allows room routes named with a room code", () => {
    expect(isAllowedPartyPath("/parties/room/ABCD")).toBe(true);
    expect(isAllowedPartyPath("/parties/room/WXYZ/")).toBe(true);
  });

  it("rejects room routes whose name isn't a room code", () => {
    for (const name of ["abcd", "ABCO", "ABCDE", "ABC", "constructor", "AB%20D", ""]) {
      expect(isAllowedPartyPath(`/parties/room/${name}`), name).toBe(false);
    }
  });

  it("rejects other party namespaces", () => {
    expect(isAllowedPartyPath("/parties/other/ABCD")).toBe(false);
    expect(isAllowedPartyPath("/parties")).toBe(false);
  });

  it("leaves non-party paths alone", () => {
    expect(isAllowedPartyPath("/api/rooms")).toBe(true);
    expect(isAllowedPartyPath("/")).toBe(true);
  });
});
