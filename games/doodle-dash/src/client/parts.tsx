import { Button, TimerRing } from "@party/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DoodleView, ViewFeedItem } from "../rules";
import { hasNewItems, isNearBottom } from "./feedScroll";
import { timerFor } from "./phase";

export function Hint({ hint, big = false }: { hint: string | null; big?: boolean }) {
  if (!hint) return null;
  return (
    <div className={`dd-hint ${big ? "dd-hint-big" : ""}`}>
      <span className="dd-sr-only">Hint: {[...hint].map((ch) => (ch === "_" ? "blank" : ch === " " ? "space" : ch)).join(" ")}</span>
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

/**
 * The guess feed. It sticks to the bottom: new items and resizes keep the newest item in view only
 * while the reader is at the bottom; once they scroll up, their position is kept and a "New
 * messages" pill offers a jump back. `alwaysFollow` (the TV, which nobody scrolls) always follows.
 */
export function Feed({ items, players, compact = false, alwaysFollow = false }: {
  items: ViewFeedItem[];
  players: DoodleView["players"];
  compact?: boolean;
  alwaysFollow?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Whether the reader was at the bottom as of the last scroll; measured before content changes,
  // so it says where they were, not where the new content leaves them.
  const atBottom = useRef(true);
  const lastSeenId = useRef<number | null>(null);
  const [unseen, setUnseen] = useState(false);

  const toBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // The resulting scroll event lands at the bottom too, so it can't mark the reader as scrolled up.
    atBottom.current = true;
    setUnseen(false);
  }, []);

  useLayoutEffect(() => {
    const fresh = hasNewItems(lastSeenId.current, items);
    lastSeenId.current = items.length ? items[items.length - 1]!.id : null;
    if (alwaysFollow || atBottom.current) toBottom();
    else if (fresh) setUnseen(true);
  }, [items, alwaysFollow, toBottom]);

  // Keep the newest item in view when the feed is resized (e.g. the phone is rotated), if following.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (alwaysFollow || atBottom.current) toBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [alwaysFollow, toBottom]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    atBottom.current = isNearBottom(el);
    if (atBottom.current) setUnseen(false);
  };

  const nameOf = (id: string | null) => players.find((p) => p.id === id)?.name ?? "";
  return (
    <div ref={ref} className={`dd-feed ${compact ? "dd-feed-compact" : ""}`} aria-live="polite" onScroll={onScroll}>
      {items.map((f) => (
        <p key={f.id} className={`dd-feed-item dd-feed-${f.kind}`}>
          {f.kind === "chat" && <b>{nameOf(f.playerId)}: </b>}
          {f.text}
        </p>
      ))}
      {unseen && (
        <button type="button" className="dd-feed-jump" data-testid="feed-jump" onClick={toBottom}>
          New messages <span aria-hidden>↓</span>
        </button>
      )}
    </div>
  );
}

export function Scoreboard({ view }: { view: DoodleView }) {
  const sorted = [...view.players].sort((a, b) => b.score - a.score);
  return (
    <ol className={`dd-scores ${sorted.length > 8 ? "dd-scores-many" : ""}`}>
      {sorted.map((p) => (
        <li key={p.id} className={`dd-score-row ${p.solved ? "solved" : ""} ${p.id === view.drawerId ? "drawer" : ""} ${p.connected ? "" : "chip-dim"}`}>
          <span className="dd-score-name">
            <span aria-hidden>{p.avatar.emoji}</span> {p.name}{" "}
            {p.id === view.drawerId && (
              <>
                <span aria-hidden>✏️</span>
                <span className="dd-sr-only">(drawing)</span>
              </>
            )}
            {p.solved && (
              <>
                <span aria-hidden>✅</span>
                <span className="dd-sr-only">(guessed it)</span>
              </>
            )}
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
