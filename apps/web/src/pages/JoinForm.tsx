import type { Avatar } from "@party/shared";
import { AVATAR_COLORS, AVATAR_EMOJI, Button, randomAvatar } from "@party/ui";
import { useState } from "react";
import type { Profile } from "../lib/storage";

export function JoinForm({ code, initial, error, onJoin, onScreen }: {
  code: string;
  initial: Profile | null;
  error: string | null;
  onJoin(p: Profile): void;
  onScreen(): void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [avatar, setAvatar] = useState<Avatar>(initial?.avatar ?? randomAvatar);
  const trimmed = name.trim();
  return (
    <main className="join">
      <p className="eyebrow">Joining room</p>
      <h1 className="room-code-md">{code}</h1>
      <form
        className="card join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onJoin({ name: trimmed.slice(0, 16), avatar });
        }}
      >
        <label>
          Your name
          <input
            data-testid="name-input"
            value={name}
            maxLength={16}
            autoFocus
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="emoji-grid" role="radiogroup" aria-label="Avatar">
          {AVATAR_EMOJI.map((em) => (
            <button
              type="button"
              key={em}
              role="radio"
              aria-checked={avatar.emoji === em}
              className={`emoji-btn ${avatar.emoji === em ? "on" : ""}`}
              style={avatar.emoji === em ? { background: avatar.color } : undefined}
              onClick={() => setAvatar((a) => ({ ...a, emoji: em }))}
            >
              {em}
            </button>
          ))}
        </div>
        <div className="color-row" role="radiogroup" aria-label="Color">
          {AVATAR_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              role="radio"
              aria-checked={avatar.color === c}
              aria-label={`Color ${c}`}
              className={`color-dot ${avatar.color === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => setAvatar((a) => ({ ...a, color: c }))}
            />
          ))}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <Button type="submit" size="xl" data-testid="join-submit" disabled={!trimmed}>Join</Button>
      </form>
      <button type="button" className="link" onClick={onScreen}>Use this device as a shared screen instead</button>
    </main>
  );
}
