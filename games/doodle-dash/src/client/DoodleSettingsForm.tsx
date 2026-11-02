import type { SettingsFormProps } from "@party/ui";
import { useEffect, useRef, useState } from "react";
import type { DoodleSettings } from "../rules";
import { editStateWhen, splitWords, syncWordsText } from "./settings";

const DRAW_TIMES = [30, 45, 60, 80, 100, 120, 150, 180];
const DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;

export function DoodleSettingsForm({ settings, onChange, disabled }: SettingsFormProps<DoodleSettings>) {
  const [words, setWords] = useState(settings.customWords.join(", "));
  const user = useRef({ focused: false, edited: false });
  // Room messages bring a new array every time; only react when the words themselves change.
  const incoming = settings.customWords.join("\n");
  useEffect(() => {
    // Disabling the textarea while focused fires no blur, so focus would otherwise stick.
    user.current = editStateWhen(disabled, user.current);
    setWords((w) => syncWordsText(w, incoming ? incoming.split("\n") : [], user.current));
  }, [incoming, disabled]);
  // Re-enabled (e.g. reconnected) with edits that never got a blur: send them now.
  const wasDisabled = useRef(disabled);
  useEffect(() => {
    const reenabled = wasDisabled.current && !disabled;
    wasDisabled.current = disabled;
    if (reenabled && user.current.edited && !user.current.focused) {
      user.current = { focused: false, edited: false };
      onChange({ ...settings, customWords: splitWords(words) });
    }
    // Only a disabled -> enabled transition should send; settings/words are read at that moment.
  }, [disabled]);

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
          onFocus={() => {
            user.current.focused = true;
          }}
          onChange={(e) => {
            user.current.edited = true;
            setWords(e.target.value);
          }}
          onBlur={() => {
            user.current = { focused: false, edited: false };
            onChange({ ...settings, customWords: splitWords(words) });
          }}
        />
      </label>
    </div>
  );
}
