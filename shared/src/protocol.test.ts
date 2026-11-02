import { describe, expect, it } from "vitest";
import { ClientMsg } from "./protocol";

const ok = (v: unknown) => ClientMsg.safeParse(v).success;

describe("ClientMsg", () => {
  it("accepts a player hello", () => {
    expect(ok({ type: "hello", role: "player", name: "Ana", avatar: { emoji: "🦊", color: "#ff8906" } })).toBe(true);
  });
  it("accepts a screen hello with token and host key", () => {
    expect(ok({ type: "hello", role: "screen", token: "t", hostKey: "k" })).toBe(true);
  });
  it("accepts actions with any payload", () => {
    expect(ok({ type: "action", payload: { t: "guess", text: "x" } })).toBe(true);
  });
  it("accepts host commands", () => {
    expect(ok({ type: "host", cmd: { cmd: "start" } })).toBe(true);
    expect(ok({ type: "host", cmd: { cmd: "kick", playerId: "p1" } })).toBe(true);
    expect(ok({ type: "host", cmd: { cmd: "selectGame", gameId: "doodle-dash" } })).toBe(true);
  });
  it("rejects garbage", () => {
    expect(ok(null)).toBe(false);
    expect(ok("hello")).toBe(false);
    expect(ok({ type: "nope" })).toBe(false);
    expect(ok({ type: "hello", role: "admin" })).toBe(false);
    expect(ok({ type: "hello", role: "player", avatar: { emoji: "🦊", color: "red" } })).toBe(false);
    expect(ok({ type: "host", cmd: { cmd: "explode" } })).toBe(false);
    expect(ok({ type: "hello", role: "player", token: "x".repeat(65) })).toBe(false);
  });
  it("rejects structurally wrong messages", () => {
    expect(ok([])).toBe(false);
    expect(ok([{ type: "hello", role: "player" }])).toBe(false);
    expect(ok({ type: ["hello"], role: "player" })).toBe(false);
    expect(ok({ type: "host", cmd: { cmd: "kick" } })).toBe(false);
    expect(ok({ type: "host" })).toBe(false);
  });
  it("rejects actions without a payload and settings updates without settings", () => {
    expect(ok({ type: "action" })).toBe(false);
    expect(ok({ type: "host", cmd: { cmd: "updateSettings" } })).toBe(false);
  });
  it("rejects empty tokens and host keys", () => {
    expect(ok({ type: "hello", role: "player", token: "" })).toBe(false);
    expect(ok({ type: "hello", role: "screen", hostKey: "" })).toBe(false);
  });
  it("rejects overlong fields", () => {
    expect(ok({ type: "hello", role: "player", name: "x".repeat(41) })).toBe(false);
    expect(ok({ type: "hello", role: "screen", hostKey: "x".repeat(65) })).toBe(false);
    expect(ok({ type: "host", cmd: { cmd: "selectGame", gameId: "x".repeat(41) } })).toBe(false);
    expect(ok({ type: "host", cmd: { cmd: "kick", playerId: "x".repeat(65) } })).toBe(false);
  });
});
