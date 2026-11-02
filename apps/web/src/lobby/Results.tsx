import type { GameResult } from "@party/shared";

const MEDALS = ["🥇", "🥈", "🥉"];

export function Results({ results }: { results: GameResult[] }) {
  return (
    <section className="results card" aria-label="Last game results">
      <h2>Last game</h2>
      <ol>
        {results.map((r, i) => (
          <li key={r.playerId} style={{ animationDelay: `${i * 80}ms` }}>
            <span className="medal" aria-hidden>{MEDALS[i] ?? `${i + 1}.`}</span>
            <span className="results-name">{r.name}</span>
            <span className="results-score">{r.score}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
