import { beforeEach, describe, expect, it } from "vitest";
import { storage } from "./storage";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe("storage", () => {
  it("scopes tokens by room code and role", () => {
    storage.setToken("ABCD", "player", "p-token");
    expect(storage.getToken("ABCD", "player")).toBe("p-token");
    expect(storage.getToken("ABCD", "screen")).toBeNull();
    expect(storage.getToken("EFGH", "player")).toBeNull();
    storage.clearToken("ABCD", "player");
    expect(storage.getToken("ABCD", "player")).toBeNull();
  });

  it("forgets everything about a room code", () => {
    storage.setToken("ABCD", "player", "p");
    storage.setToken("ABCD", "screen", "s");
    storage.setHostKey("ABCD", "k");
    storage.setRole("ABCD", "screen");
    storage.setToken("EFGH", "player", "other");
    storage.clearRoom("ABCD");
    expect(storage.getToken("ABCD", "player")).toBeNull();
    expect(storage.getToken("ABCD", "screen")).toBeNull();
    expect(storage.getHostKey("ABCD")).toBeNull();
    expect(storage.getRole("ABCD")).toBeNull();
    expect(storage.getToken("EFGH", "player")).toBe("other");
  });
});
