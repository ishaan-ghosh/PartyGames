import { useEffect } from "react";

/** Keep the screen awake while `active`; re-acquire after the tab becomes visible again. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (cancelled) {
          // Cleanup ran while the request was pending (always under StrictMode): don't leak it.
          void l.release().catch(() => {});
          return;
        }
        const prev = lock;
        lock = l;
        if (prev && prev !== l) void prev.release().catch(() => {});
      } catch {
        /* denied or unsupported: ignore */
      }
    };
    const onVisible = () => {
      if (!cancelled && document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [active]);
}
