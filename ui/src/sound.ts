export type SoundName = "join" | "correct" | "tick" | "turnEnd";

const KEY = "pg:muted";
const NOTES: Record<SoundName, [freq: number, at: number][]> = {
  join: [[523, 0], [784, 0.08]],
  correct: [[659, 0], [880, 0.09], [1319, 0.18]],
  tick: [[1200, 0]],
  turnEnd: [[784, 0], [587, 0.12], [392, 0.24]],
};
let ctx: AudioContext | null = null;

/** In-memory source of truth for mute; localStorage only persists it (it may be unavailable). */
let muted: boolean = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* storage unavailable: mute just won't persist */
  }
}

/** Called whenever the AudioContext's state changes (see installAudioUnlock). */
const stateWatchers = new Set<() => void>();

function getContext(): { c: AudioContext; resumed: Promise<void> } {
  if (!ctx) {
    ctx = new AudioContext();
    ctx.addEventListener?.("statechange", () => {
      for (const w of stateWatchers) w();
    });
  }
  // Safari also has an "interrupted" state, so resume on anything that isn't running.
  const resumed = ctx.state !== "running" ? ctx.resume().catch(() => {}) : Promise.resolve();
  return { c: ctx, resumed };
}

/**
 * Create/resume the AudioContext and play a 1-sample silent buffer. Call from a user
 * activation event — iOS Safari keeps the context suspended otherwise. Resolves to
 * whether the context ended up running (false if still suspended or audio is unavailable).
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    const { c, resumed } = getContext();
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
    await resumed;
    return c.state === "running";
  } catch {
    return false;
  }
}

/** Events that count as user activation on touch and desktop (touch `pointerdown` does not). */
const UNLOCK_EVENTS = ["pointerup", "touchend", "click", "keydown"] as const;

type EventTarget_ = Pick<Document, "addEventListener" | "removeEventListener">;

/**
 * Try to unlock audio on every activation event until the context is running, then stop listening for
 * activation. iOS Safari suspends or interrupts the context again when the phone sleeps, the tab is
 * backgrounded, or a call/Siri takes over, so the activation listeners re-arm (and resume() is tried at
 * once) when the context leaves "running", the page becomes visible, or it's restored from the
 * back/forward cache (`pageshow` on `win`). Nothing audible is played on unlock.
 * Returns a function that removes every listener.
 */
export function installAudioUnlock(
  target: EventTarget_ & { visibilityState?: DocumentVisibilityState },
  win?: Pick<Window, "addEventListener" | "removeEventListener">,
): () => void {
  let disposed = false;
  let armed = false;
  const arm = () => {
    if (armed || disposed) return;
    armed = true;
    for (const e of UNLOCK_EVENTS) target.addEventListener(e, onGesture, true);
  };
  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const e of UNLOCK_EVENTS) target.removeEventListener(e, onGesture, true);
  };
  function onGesture() {
    void unlockAudio().then((running) => {
      if (running) disarm();
    });
  }
  /** The context (if any) isn't running: listen for activation again and try resuming without one. */
  const recheck = () => {
    if (disposed || !ctx || ctx.state === "running") return;
    arm();
    void ctx.resume().catch(() => {});
  };
  const onState = () => {
    if (ctx?.state === "running") disarm();
    else recheck();
  };
  const onVisibility = () => {
    if (target.visibilityState !== "hidden") recheck();
  };
  stateWatchers.add(onState);
  target.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("pageshow", recheck);
  arm();
  return () => {
    disarm();
    disposed = true;
    stateWatchers.delete(onState);
    target.removeEventListener("visibilitychange", onVisibility);
    win?.removeEventListener("pageshow", recheck);
  };
}

/** Tiny synthesized sound effects — no audio files to load. */
export function playSound(name: SoundName): void {
  if (muted) return;
  try {
    const { c } = getContext();
    const t0 = c.currentTime;
    const tick = name === "tick";
    const dur = tick ? 0.05 : 0.16;
    for (const [freq, at] of NOTES[name]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = tick ? "square" : "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(tick ? 0.04 : 0.18, t0 + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.02);
    }
  } catch {
    /* audio unavailable */
  }
}
