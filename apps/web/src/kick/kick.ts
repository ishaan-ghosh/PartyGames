import type { PublicPlayer, RoomSnapshot } from "@party/shared";

/**
 * Players the viewer may kick: none unless the viewer is the host, and never the host themself.
 * Screens aren't in `room.players`, so they're never targets. Offline players are kickable.
 */
export function kickablePlayers(room: RoomSnapshot, youId: string): PublicPlayer[] {
  if (room.hostId === null || room.hostId !== youId) return [];
  return room.players.filter((p) => p.id !== youId && p.id !== room.hostId);
}

export function isKickable(room: RoomSnapshot, youId: string, playerId: string): boolean {
  return kickablePlayers(room, youId).some((p) => p.id === playerId);
}

/**
 * The player a pending kick confirm (`kickId`) is for. `stale` means a kick was asked for but its
 * target is no longer kickable (they left, or the viewer stopped being host): the caller must clear
 * `kickId`, or the confirm would reappear if that player became kickable again.
 */
export function pendingKick(kickable: PublicPlayer[], kickId: string | null): { target: PublicPlayer | undefined; stale: boolean } {
  const target = kickId === null ? undefined : kickable.find((p) => p.id === kickId);
  return { target, stale: kickId !== null && !target };
}
