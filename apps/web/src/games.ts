import type { ClientGame } from "@party/ui";

/** Playable games, keyed by id. Games register here (Doodle Dash is added in Task 12). */
export const clientGames: Record<string, ClientGame> = {};

export const comingSoon: { id: string; name: string; tagline: string; emoji: string; accent: string }[] = [
  { id: "puff-up", name: "Puff Up", tagline: "Answer before it pops.", emoji: "🐡", accent: "#ff8906" },
  { id: "blank-slate", name: "Blank Slate", tagline: "Fill the blank. Win the room.", emoji: "🃏", accent: "#e53170" },
  { id: "head-to-head", name: "Head to Head", tagline: "Two answers enter. One leaves.", emoji: "⚔️", accent: "#3da9fc" },
  { id: "property-rush", name: "Property Rush", tagline: "Buy low. Gloat high.", emoji: "🏙️", accent: "#2cb67d" },
];
