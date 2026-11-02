import { useEffect, useState } from "react";

export function TimerRing({ endsAt, totalMs, serverNow, size = 64 }: {
  endsAt: number;
  totalMs: number;
  serverNow: () => number;
  size?: number;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, endsAt - serverNow());
  const frac = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <div className={`timer ${left > 0 && left <= 10_000 ? "timer-low" : ""}`} style={{ width: size, height: size }} data-testid="timer">
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
        <circle cx="32" cy="32" r={r} className="timer-track" />
        <circle cx="32" cy="32" r={r} className="timer-fill" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span aria-label="seconds left">{Math.ceil(left / 1000)}</span>
    </div>
  );
}
