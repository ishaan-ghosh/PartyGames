import { Button, TimerRing } from "@party/ui";
import { useEffect, useRef, useState } from "react";
import type { DoodleView, ViewFeedItem } from "../rules";
import { timerFor } from "./phase";

export function Hint({ hint, big = false }: { hint: string | null; big?: boolean }) {
  if (!hint) return null;
  return (
    <div className={`dd-hint ${big ? "dd-hint-big" : ""}`} aria-label={`Hint: ${hint.replace(/_/g, "blank ")}`}>
      {[...hint].map((ch, i) => (
        <span key={i} aria-hidden className={ch === " " ? "dd-gap" : "dd-letter"}>{ch === "_" || ch === " " ? " " : ch}</span>
      ))}
    </div>
  );
}

/** The countdown, or a "waiting" pill when no clock is running (paused between turns). */
export function PhaseTimer({ view, serverNow, size }: { view: DoodleView; serverNow: () => number; size: number }) {
  const t = timerFor(view);
  if (t) return <TimerRing endsAt={t.endsAt} totalMs={t.totalMs} serverNow={serverNow} size={size} />;
  if (!view.waiting) return <span style={{ width: size, height: size }} aria-hidden />;
  return (
    <span className="dd-wait-pill" style={{ minHeight: size }}>
      <span className="dd-wait-dot" aria-hidden /> Paused
    </span>
  );
}

/** Shown while the game is paused between turns because too few players are connected. */
export function Waiting({ view, overlay = false }: { view: DoodleView; overlay?: boolean }) {
  const away = view.players.filter((p) => !p.connected);
  return (
    <div className={overlay ? "dd-overlay dd-waiting" : "dd-waiting dd-waiting-card"} role="status" data-testid="waiting">
      <p className="dd-waiting-title">Waiting for players…</p>
      <p className="dd-waiting-sub">The next turn starts when at least 2 players are connected.</p>
      {view.word && <p className="dd-waiting-sub">The last word was <strong>{view.word}</strong></p>}
      {away.length > 0 && (
        <p className="dd-waiting-away">
          Away: {away.map((p) => `${p.avatar.emoji} ${p.name}`).join(", ")}
        </p>
      )}
    </div>
  );
}

export function Feed({ items, players, compact = false }: { items: ViewFeedItem[]; players: DoodleView["players"]; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);
  const nameOf = (id: string | null) => players.find((p) => p.id === id)?.name ?? "";
  return (
    <div ref={ref} className={`dd-feed ${compact ? "dd-feed-compact" : ""}`} aria-live="polite">
      {items.map((f) => (
        <p key={f.id} className={`dd-feed-item dd-feed-${f.kind}`}>
          {f.kind === "chat" && <b>{nameOf(f.playerId)}: </b>}
          {f.text}
        </p>
      ))}
    </div>
  );
}

export function Scoreboard({ view }: { view: DoodleView }) {
  const sorted = [...view.players].sort((a, b) => b.score - a.score);
  return (
    <ol className="dd-scores">
      {sorted.map((p) => (
        <li key={p.id} className={`dd-score-row ${p.solved ? "solved" : ""} ${p.id === view.drawerId ? "drawer" : ""} ${p.connected ? "" : "chip-dim"}`}>
          <span className="dd-score-name">
            <span aria-hidden>{p.avatar.emoji}</span> {p.name} {p.id === view.drawerId && <span aria-label="drawing">✏️</span>}
            {p.solved && <span aria-label="guessed">✅</span>}
          </span>
          <span className="dd-score-num" data-testid={`score-${p.name}`}>{p.score}</span>
        </li>
      ))}
    </ol>
  );
}

export function Reveal({ view }: { view: DoodleView }) {
  const gains = view.players.filter((p) => p.turnPoints > 0).sort((a, b) => b.turnPoints - a.turnPoints);
  return (
    <div className="dd-overlay" data-testid="reveal">
      <p>The word was</p>
      <p className="dd-reveal-word">{view.word}</p>
      <ul className="dd-gains">
        {gains.length === 0 && <li>Nobody got it 😬</li>}
        {gains.map((p) => (
          <li key={p.id}>{p.avatar.emoji} {p.name} <strong>+{p.turnPoints}</strong></li>
        ))}
      </ul>
    </div>
  );
}

export function GuessForm({ placeholder, onSubmit }: { placeholder: string; onSubmit(text: string): void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="dd-guess"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        onSubmit(t);
        setText("");
        input.current?.focus();
      }}
    >
      <input
        ref={input}
        data-testid="guess-input"
        aria-label={placeholder}
        value={text}
        maxLength={60}
        placeholder={placeholder}
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit">Send</Button>
    </form>
  );
}
