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

describe("installAudioUnlock", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("keeps listening on activation events until the context is running", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    let allowRun = false;
    class FakeContext {
      state: string = "suspended";
      destination = {};
      resume = vi.fn(async () => {
        if (allowRun) this.state = "running";
      });
      createBuffer = () => ({});
      createBufferSource = () => ({ buffer: null, connect: () => {}, start: () => {} });
    }
    vi.stubGlobal("AudioContext", FakeContext);
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: vi.fn((t: string, fn: () => void) => void listeners.set(t, fn)),
      removeEventListener: vi.fn((t: string) => void listeners.delete(t)),
    };
    const { installAudioUnlock } = await import("./sound");
    installAudioUnlock(target as unknown as Document);
    expect([...listeners.keys()].sort()).toEqual(["click", "keydown", "pointerup", "touchend"]);

    // Activation that doesn't manage to start audio: stay attached.
    listeners.get("touchend")!();
    await new Promise((r) => setTimeout(r, 0));
    expect(listeners.size).toBe(4);

    // Next activation succeeds: detach everything.
    allowRun = true;
    listeners.get("click")!();
    await new Promise((r) => setTimeout(r, 0));
    expect(listeners.size).toBe(0);
  });
});
