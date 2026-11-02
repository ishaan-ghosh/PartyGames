import { playSound } from "@party/ui";
import { useEffect, useRef } from "react";
import type { DoodleView } from "../rules";

const lastCorrectId = (v: DoodleView) => v.feed.reduce((m, f) => (f.kind === "correct" ? Math.max(m, f.id) : m), 0);

export function useDoodleSounds(view: DoodleView, enabled: boolean, serverNow: () => number): void {
  const prev = useRef({ phase: view.phase, correct: lastCorrectId(view) });

  useEffect(() => {
    const p = prev.current;
    const correct = lastCorrectId(view);
    if (enabled) {
      if (correct > p.correct) playSound("correct");
      if (view.phase === "reveal" && p.phase !== "reveal") playSound("turnEnd");
    }
    prev.current = { phase: view.phase, correct };
  }, [view, enabled]);

  useEffect(() => {
    if (!enabled || view.phase !== "drawing" || view.waiting) return;
    let lastSecond = -1;
    const id = setInterval(() => {
      const left = Math.ceil((view.phaseEndsAt - serverNow()) / 1000);
      if (left > 0 && left <= 5 && left !== lastSecond) {
        lastSecond = left;
        playSound("tick");
      }
    }, 200);
    return () => clearInterval(id);
  }, [enabled, view.phase, view.phaseEndsAt, view.waiting, serverNow]);
}
