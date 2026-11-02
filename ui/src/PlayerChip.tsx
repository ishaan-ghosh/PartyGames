import type { Avatar } from "@party/shared";
import type { HTMLAttributes, ReactNode } from "react";

export interface PlayerChipProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  avatar: Avatar;
  dim?: boolean;
  badge?: ReactNode;
  size?: "md" | "lg";
}

export function PlayerChip({ name, avatar, dim = false, badge, size = "md", className = "", ...rest }: PlayerChipProps) {
  return (
    <div className={`chip chip-${size} ${dim ? "chip-dim" : ""} ${className}`} {...rest}>
      <span className="chip-avatar" style={{ background: avatar.color }} aria-hidden>{avatar.emoji}</span>
      <span className="chip-name">{name}</span>
      {badge && <span className="chip-badge">{badge}</span>}
    </div>
  );
}
