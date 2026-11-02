export type SoundName = "join" | "correct" | "tick" | "turnEnd";

const KEY = "pg:muted";
const NOTES: Record<SoundName, [freq: number, at: number][]> = {
  join: [[523, 0], [784, 0.08]],
  correct: [[659, 0], [880, 0.09], [1319, 0.18]],
  tick: [[1200, 0]],
  turnEnd: [[784, 0], [587, 0.12], [392, 0.24]],
};
let ctx: AudioContext | null = null;

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable: mute just won't persist */
  }
}

/** Tiny synthesized sound effects — no audio files to load. */
export function playSound(name: SoundName): void {
  if (isMuted()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    const tick = name === "tick";
    const dur = tick ? 0.05 : 0.16;
    for (const [freq, at] of NOTES[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tick ? "square" : "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(tick ? 0.04 : 0.18, t0 + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.02);
    }
  } catch {
    /* audio unavailable */
  }
}
