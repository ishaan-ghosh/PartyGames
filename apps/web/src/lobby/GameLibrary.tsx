import type { CSSProperties } from "react";
import { clientGames, comingSoon } from "../games";

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
      {comingSoon.map((g) => (
        <div
          key={g.id}
          role="radio"
          aria-checked={false}
          aria-disabled={true}
          className="game-card game-card-soon"
          style={{ "--card-accent": g.accent } as CSSProperties}
        >
          <span className="game-emoji" aria-hidden>{g.emoji}</span>
          <strong>{g.name}</strong>
          <span className="game-tagline">Coming soon</span>
        </div>
      ))}
    </div>
  );
}
