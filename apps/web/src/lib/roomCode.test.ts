import { describe, expect, it } from "vitest";
import { codeInputError, sanitizeCodeInput } from "./roomCode";

describe("sanitizeCodeInput", () => {
  it("uppercases, strips non-letters and caps at 4", () => {
    expect(sanitizeCodeInput(" abcd")).toBe("ABCD");
    expect(sanitizeCodeInput("ab-c d e")).toBe("ABCD");
    expect(sanitizeCodeInput("a1b2")).toBe("AB");
  });
});

describe("codeInputError", () => {
  it("accepts a valid code", () => {
    expect(codeInputError("ABCD")).toBeNull();
  });
  it("explains the letters codes never use", () => {
    expect(codeInputError("ABCI")).toBe("Room codes don't use I, L or O.");
    expect(codeInputError("LO")).toBe("Room codes don't use I, L or O.");
  });
  it("asks for 4 letters otherwise", () => {
    expect(codeInputError("ABC")).toBe("Room codes are 4 letters.");
  });
});
