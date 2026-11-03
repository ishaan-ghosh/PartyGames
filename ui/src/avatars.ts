import type { Avatar } from "@party/shared";

export const AVATAR_EMOJI = ["🦊", "🐙", "🐸", "🦄", "🐼", "🐯", "🐧", "🦖", "🐝", "🦉", "🐳", "🌵", "🍕", "👾", "🤖", "🎃"];
export const AVATAR_COLORS = ["#7f5af0", "#ff8906", "#e53170", "#2cb67d", "#3da9fc", "#ffd803", "#ef4565", "#94a1b2"];

export function randomAvatar(): Avatar {
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
  return { emoji: pick(AVATAR_EMOJI), color: pick(AVATAR_COLORS) };
}
