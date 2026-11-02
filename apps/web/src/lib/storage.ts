import type { Avatar } from "@party/shared";

export interface Profile { name: string; avatar: Avatar }
export type Role = "screen" | "player";

const safe = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* private mode etc. */ }
  },
  del(k: string): void {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
};

export const storage = {
  // Tokens are scoped by role, so a device never reclaims its player seat while joining as a screen.
  getToken: (code: string, role: Role) => safe.get(`pg:token:${code}:${role}`),
  setToken: (code: string, role: Role, token: string) => safe.set(`pg:token:${code}:${role}`, token),
  clearToken: (code: string, role: Role) => safe.del(`pg:token:${code}:${role}`),
  /** Forget everything stored for a room code (e.g. the room is gone and the code may be reused). */
  clearRoom(code: string): void {
    for (const k of [`pg:token:${code}:player`, `pg:token:${code}:screen`, `pg:hostKey:${code}`, `pg:role:${code}`]) {
      safe.del(k);
    }
  },
  getHostKey: (code: string) => safe.get(`pg:hostKey:${code}`),
  setHostKey: (code: string, key: string) => safe.set(`pg:hostKey:${code}`, key),
  getRole(code: string): "screen" | "player" | null {
    const v = safe.get(`pg:role:${code}`);
    return v === "screen" || v === "player" ? v : null;
  },
  setRole: (code: string, role: "screen" | "player") => safe.set(`pg:role:${code}`, role),
  getProfile(): Profile | null {
    try {
      const p = JSON.parse(safe.get("pg:profile") ?? "null") as Profile | null;
      return p && typeof p.name === "string" && p.avatar ? p : null;
    } catch {
      return null;
    }
  },
  setProfile: (p: Profile) => safe.set("pg:profile", JSON.stringify(p)),
};
