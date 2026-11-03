import { isRoomCode } from "@party/shared";

/**
 * Only `/parties/room/<CODE>` may reach a Durable Object: anything else under `/parties/` would otherwise
 * spin up (and wipe) a Durable Object per junk name. Splits the path the same way partyserver's router does.
 */
export function isAllowedPartyPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "parties") return true; // not a party route; the router ignores it
  return parts[1] === "room" && isRoomCode(parts[2] ?? "");
}
