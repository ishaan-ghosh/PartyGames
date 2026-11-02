import type { Avatar } from "@party/shared";

export interface Profile { name: string; avatar: Avatar }

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
  getToken: (code: string) => safe.get(`pg:token:${code}`),
  setToken: (code: string, token: string) => safe.set(`pg:token:${code}`, token),
  clearToken: (code: string) => safe.del(`pg:token:${code}`),
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
