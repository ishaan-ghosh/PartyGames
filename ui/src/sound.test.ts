import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("mute source of truth", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("keeps mute state in memory when localStorage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    const sound = await import("./sound");
    expect(sound.isMuted()).toBe(false);
    sound.setMuted(true);
    expect(sound.isMuted()).toBe(true);
    sound.setMuted(false);
    expect(sound.isMuted()).toBe(false);
  });

  it("initialises from and persists to localStorage", async () => {
    const store = new Map<string, string>([["pg:muted", "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const sound = await import("./sound");
    expect(sound.isMuted()).toBe(true);
    sound.setMuted(false);
    expect(store.get("pg:muted")).toBe("0");
  });

  it("does not create an AudioContext while muted", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "1", setItem: () => {} });
    const Ctor = vi.fn();
    vi.stubGlobal("AudioContext", Ctor);
    const sound = await import("./sound");
    sound.playSound("tick");
    expect(Ctor).not.toHaveBeenCalled();
  });
});
