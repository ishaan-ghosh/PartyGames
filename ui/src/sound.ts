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

function getContext(): { c: AudioContext; resumed: Promise<void> } {
  ctx ??= new AudioContext();
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

/**
 * Try to unlock audio on every activation event until the context is running, then detach.
 * Returns a function that detaches early.
 */
export function installAudioUnlock(target: Pick<Document, "addEventListener" | "removeEventListener">): () => void {
  let done = false;
  const detach = () => {
    done = true;
    for (const e of UNLOCK_EVENTS) target.removeEventListener(e, onEvent, true);
  };
  function onEvent() {
    void unlockAudio().then((running) => {
      if (running && !done) detach();
    });
  }
  for (const e of UNLOCK_EVENTS) target.addEventListener(e, onEvent, true);
  return detach;
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
