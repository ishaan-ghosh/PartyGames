import { afterEach, describe, expect, it, vi } from "vitest";

// No DOM renderer in this package: capture the effect and drive it by hand.
const effects: (() => void | (() => void))[] = [];
vi.mock("react", () => ({ useEffect: (fn: () => void | (() => void)) => void effects.push(fn) }));

const { useWakeLock } = await import("./useWakeLock");

function sentinel() {
  return { release: vi.fn(() => Promise.resolve()) };
}

function setup() {
  const listeners = new Map<string, () => void>();
  const doc = {
    visibilityState: "visible",
    addEventListener: (t: string, fn: () => void) => void listeners.set(t, fn),
    removeEventListener: (t: string) => void listeners.delete(t),
  };
  const pending: ((l: ReturnType<typeof sentinel>) => void)[] = [];
  const request = vi.fn(() => new Promise<ReturnType<typeof sentinel>>((res) => pending.push(res)));
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { wakeLock: { request } });
  effects.length = 0;
  useWakeLock(true);
  const cleanup = effects[0]!() as () => void;
  return { listeners, pending, request, cleanup };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("useWakeLock", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("releases a lock that resolves after cleanup (StrictMode)", async () => {
    const { pending, cleanup } = setup();
    cleanup();
    const l = sentinel();
    pending[0]!(l);
    await flush();
    expect(l.release).toHaveBeenCalledTimes(1);
  });

  it("releases the held lock on cleanup", async () => {
    const { pending, cleanup } = setup();
    const l = sentinel();
    pending[0]!(l);
    await flush();
    expect(l.release).not.toHaveBeenCalled();
    cleanup();
    expect(l.release).toHaveBeenCalledTimes(1);
  });

  it("releases the previous lock when re-acquiring on visibilitychange", async () => {
    const { listeners, pending, cleanup } = setup();
    const first = sentinel();
    pending[0]!(first);
    await flush();
    listeners.get("visibilitychange")!();
    const second = sentinel();
    pending[1]!(second);
    await flush();
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.release).not.toHaveBeenCalled();
    cleanup();
    expect(second.release).toHaveBeenCalledTimes(1);
  });
});
