import type { CSSProperties } from "react";
import { clientGames } from "../games";

export function GameLibrary({ selected, onSelect, disabled = false }: {
  selected: string;
  onSelect(id: string): void;
  disabled?: boolean;
}) {
  return (
    <div className="game-library" role="radiogroup" aria-label="Game">
      {Object.values(clientGames).map((g) => (
        <button
          key={g.id}
          type="button"
          role="radio"
          aria-checked={selected === g.id}
          disabled={disabled}
          className={`game-card ${selected === g.id ? "on" : ""}`}
          style={{ "--card-accent": g.meta.accent } as CSSProperties}
          onClick={() => onSelect(g.id)}
        >
          <span className="game-emoji" aria-hidden>{g.emoji}</span>
          <strong>{g.meta.name}</strong>
          <span className="game-tagline">{g.meta.tagline}</span>
        </button>
      ))}
    </div>
  );
}
