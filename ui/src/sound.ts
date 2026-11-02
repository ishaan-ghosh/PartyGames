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

function getContext(): AudioContext {
  ctx ??= new AudioContext();
  // Safari also has an "interrupted" state, so resume on anything that isn't running.
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  return ctx;
}

/**
 * Create/resume the AudioContext and play a 1-sample silent buffer. Call from a user
 * gesture — iOS Safari keeps the context suspended otherwise.
 */
export function unlockAudio(): void {
  try {
    const c = getContext();
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* audio unavailable */
  }
}

/** Tiny synthesized sound effects — no audio files to load. */
export function playSound(name: SoundName): void {
  if (muted) return;
  try {
    const c = getContext();
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
