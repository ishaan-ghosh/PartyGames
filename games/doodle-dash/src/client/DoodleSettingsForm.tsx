import type { SettingsFormProps } from "@party/ui";
import { useEffect, useRef, useState } from "react";
import type { DoodleSettings, PublicDoodleSettings } from "../rules";
import { editStateWhen, splitWords, syncWordsText, wordsHidden } from "./settings";

const DRAW_TIMES = [30, 45, 60, 80, 100, 120, 150, 180];
const DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;

type Settings = DoodleSettings | PublicDoodleSettings;

/**
 * The host's settings. On a phone host it edits the custom words directly; on a TV host the room
 * only sends their count (everyone can see the TV), so words can be added or cleared but not shown.
 * Updates that leave out `customWords` keep the room's current words (see parseSettings).
 */
export function DoodleSettingsForm({ settings, onChange, disabled }: SettingsFormProps<Settings>) {
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
      {wordsHidden(settings) ? (
        <HiddenWordsField settings={settings} onChange={onChange} disabled={disabled} />
      ) : (
        <CustomWordsField settings={settings} onChange={onChange} disabled={disabled} />
      )}
    </div>
  );
}

function CustomWordsField({ settings, onChange, disabled }: SettingsFormProps<DoodleSettings>) {
  const [words, setWords] = useState(settings.customWords.join(", "));
  const user = useRef({ focused: false, edited: false });
  // Room messages bring a new array every time; only react when the words themselves change.
  const incoming = settings.customWords.join("\n");
  useEffect(() => {
    // Disabling the textarea while focused fires no blur, so focus would otherwise stick.
    user.current = editStateWhen(disabled, user.current);
    setWords((w) => syncWordsText(w, incoming ? incoming.split("\n") : [], user.current));
  }, [incoming, disabled]);

  return (
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
  );
}

/** TV host: the words stay secret. New ones are sent as additions and the field empties again. */
function HiddenWordsField({ settings, onChange, disabled }: SettingsFormProps<PublicDoodleSettings>) {
  const [words, setWords] = useState("");
  const count = settings.customWordCount;
  const add = () => {
    const list = splitWords(words);
    if (list.length) onChange({ ...settings, addCustomWords: list } as PublicDoodleSettings);
    setWords("");
  };
  return (
    <div className="dd-field">
      <label>
        Custom words{" "}
        <span className="dd-hint-text" data-testid="custom-word-count">
          {count ? `${count} added, hidden on the TV` : "comma-separated, mixed into the pool"}
        </span>
        <textarea rows={2} value={words} disabled={disabled} placeholder="add words…" onChange={(e) => setWords(e.target.value)} onBlur={add} />
      </label>
      {count > 0 && (
        <button type="button" disabled={disabled} onClick={() => onChange({ ...settings, customWords: [] } as PublicDoodleSettings)}>
          Clear custom words
        </button>
      )}
    </div>
  );
}
