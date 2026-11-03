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
    // visibilitychange stays attached to re-arm later (see the next describe).
    const gestures = () => [...listeners.keys()].filter((k) => k !== "visibilitychange").sort();
    expect(gestures()).toEqual(["click", "keydown", "pointerup", "touchend"]);

    // Activation that doesn't manage to start audio: stay attached.
    listeners.get("touchend")!();
    await new Promise((r) => setTimeout(r, 0));
    expect(gestures()).toHaveLength(4);

    // Next activation succeeds: detach the activation listeners.
    allowRun = true;
    listeners.get("click")!();
    await new Promise((r) => setTimeout(r, 0));
    expect(gestures()).toEqual([]);
  });
});

describe("installAudioUnlock re-arms after iOS suspends the context", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const GESTURES = ["click", "keydown", "pointerup", "touchend"];

  function fakeTarget() {
    const listeners = new Map<string, () => void>();
    return {
      listeners,
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (t: string, fn: () => void) => void listeners.set(t, fn),
      removeEventListener: (t: string) => void listeners.delete(t),
      fire: (t: string) => listeners.get(t)?.(),
    };
  }

  async function setup() {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const contexts: FakeContext[] = [];
    let canResume = true;
    class FakeContext {
      state: string = "suspended";
      destination = {};
      currentTime = 0;
      private onState: (() => void)[] = [];
      constructor() {
        contexts.push(this);
      }
      addEventListener(t: string, fn: () => void) {
        if (t === "statechange") this.onState.push(fn);
      }
      setState(next: string) {
        this.state = next;
        for (const fn of this.onState) fn();
      }
      resume = vi.fn(async () => {
        if (canResume && this.state !== "running") this.setState("running");
      });
      createBuffer = () => ({});
      createBufferSource = () => ({ buffer: null, connect: () => {}, start: () => {} });
      createOscillator = vi.fn();
    }
    vi.stubGlobal("AudioContext", FakeContext);
    const doc = fakeTarget();
    const win = fakeTarget();
    const sound = await import("./sound");
    const detach = sound.installAudioUnlock(doc as unknown as Document, win as unknown as Window);
    const gestures = () => [...doc.listeners.keys()].filter((k) => GESTURES.includes(k)).sort();
    const flush = () => new Promise((r) => setTimeout(r, 0));
    // First gesture unlocks.
    doc.fire("touchend");
    await flush();
    expect(contexts[0]!.state).toBe("running");
    expect(gestures()).toEqual([]);
    return { doc, win, ctx: contexts[0]!, gestures, flush, detach, setResume: (v: boolean) => (canResume = v), sound };
  }

  it("re-attaches the gesture listeners when the context is interrupted, and detaches once running again", async () => {
    const { doc, ctx, gestures, flush, setResume } = await setup();
    setResume(false); // iOS: resume() without a user gesture doesn't start it
    ctx.setState("interrupted");
    await flush();
    expect(gestures()).toEqual(GESTURES);
    setResume(true);
    doc.fire("pointerup");
    await flush();
    expect(ctx.state).toBe("running");
    expect(gestures()).toEqual([]);
  });

  it("re-arms and tries resume() when the page becomes visible with the context suspended", async () => {
    const { doc, ctx, gestures, flush, setResume } = await setup();
    setResume(false);
    doc.visibilityState = "hidden";
    ctx.setState("suspended"); // phone slept
    ctx.resume.mockClear();
    doc.visibilityState = "visible";
    doc.fire("visibilitychange");
    await flush();
    expect(ctx.resume).toHaveBeenCalled();
    expect(gestures()).toEqual(GESTURES);
  });

  it("re-arms on pageshow (back/forward cache restore)", async () => {
    const { win, ctx, gestures, flush, setResume } = await setup();
    setResume(false);
    ctx.state = "suspended"; // no statechange event fired
    win.fire("pageshow");
    await flush();
    expect(gestures()).toEqual(GESTURES);
  });

  it("detaches without a gesture if resume() on becoming visible succeeds", async () => {
    const { doc, ctx, gestures, flush } = await setup();
    ctx.state = "suspended";
    doc.fire("visibilitychange");
    await flush();
    expect(ctx.state).toBe("running");
    expect(gestures()).toEqual([]);
  });

  it("does nothing on becoming visible while the context is running", async () => {
    const { doc, ctx, gestures, flush } = await setup();
    ctx.resume.mockClear();
    doc.fire("visibilitychange");
    await flush();
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(gestures()).toEqual([]);
  });

  it("never plays a sound when unlocking", async () => {
    const { doc, ctx, flush, setResume } = await setup();
    setResume(false);
    ctx.setState("interrupted");
    setResume(true);
    doc.fire("keydown");
    await flush();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });

  it("removes every listener when detached", async () => {
    const { doc, win, ctx, gestures, flush, detach, setResume } = await setup();
    detach();
    expect(doc.listeners.size).toBe(0);
    expect(win.listeners.size).toBe(0);
    setResume(false);
    ctx.setState("interrupted");
    await flush();
    expect(gestures()).toEqual([]);
  });

  it("keeps the mute toggle working across a re-arm", async () => {
    const { ctx, flush, setResume, sound } = await setup();
    setResume(false);
    ctx.setState("interrupted");
    await flush();
    sound.setMuted(true);
    sound.playSound("tick");
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    sound.setMuted(false);
    sound.playSound("tick");
    expect(ctx.createOscillator).toHaveBeenCalled();
  });
});
