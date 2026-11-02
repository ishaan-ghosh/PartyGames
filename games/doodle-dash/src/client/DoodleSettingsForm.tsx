import type { SettingsFormProps } from "@party/ui";
import { useEffect, useState } from "react";
import type { DoodleSettings } from "../rules";

const DRAW_TIMES = [30, 45, 60, 80, 100, 120, 150, 180];
const DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;
const splitWords = (text: string) => text.split(",").map((w) => w.trim()).filter(Boolean);
const sameWords = (text: string, list: string[]) => splitWords(text).join("|").toLowerCase() === list.join("|").toLowerCase();

export function DoodleSettingsForm({ settings, onChange, disabled }: SettingsFormProps<DoodleSettings>) {
  const [words, setWords] = useState(settings.customWords.join(", "));
  useEffect(() => {
    setWords((w) => (sameWords(w, settings.customWords) ? w : settings.customWords.join(", ")));
  }, [settings.customWords]);

  return (
    <div className="dd-settings">
      <div className="dd-field">
        <span className="dd-field-label" id="dd-rounds-label">Rounds</span>
        <div className="stepper" role="group" aria-labelledby="dd-rounds-label">
          <button type="button" aria-label="Fewer rounds" disabled={disabled || settings.rounds <= 1} onClick={() => onChange({ ...settings, rounds: settings.rounds - 1 })}>−</button>
          <span aria-live="polite">{settings.rounds}</span>
          <button type="button" aria-label="More rounds" disabled={disabled || settings.rounds >= 6} onClick={() => onChange({ ...settings, rounds: settings.rounds + 1 })}>+</button>
        </div>
      </div>
      <label>
        Draw time
        <select value={settings.drawTime} disabled={disabled} onChange={(e) => onChange({ ...settings, drawTime: Number(e.target.value) })}>
          {DRAW_TIMES.map((s) => <option key={s} value={s}>{s} seconds</option>)}
        </select>
      </label>
      <div className="dd-field">
        <span className="dd-field-label">Words</span>
        <div className="segmented" role="radiogroup" aria-label="Word difficulty">
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={settings.difficulty === d} className={settings.difficulty === d ? "on" : ""} disabled={disabled} onClick={() => onChange({ ...settings, difficulty: d })}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <label>
        Custom words <span className="dd-hint-text">comma-separated, mixed into the pool</span>
        <textarea
          rows={2}
          value={words}
          disabled={disabled}
          placeholder="grandma's lasagna, the group chat"
          onChange={(e) => setWords(e.target.value)}
          onBlur={() => onChange({ ...settings, customWords: splitWords(words) })}
        />
      </label>
    </div>
  );
}
