import { Button } from "@party/ui";
import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { codeInputError, sanitizeCodeInput } from "../lib/roomCode";
import { storage } from "../lib/storage";

export function Home() {
  const [, navigate] = useLocation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function host(role: "screen" | "player") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const { code: newCode, hostKey } = (await res.json()) as { code: string; hostKey: string };
      storage.setHostKey(newCode, hostKey);
      storage.setRole(newCode, role);
      navigate(`/room/${newCode}`);
    } catch {
      setError("Couldn't create a room. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const c = sanitizeCodeInput(code);
    const invalid = codeInputError(c);
    if (invalid) {
      setError(invalid);
      return;
    }
    storage.setRole(c, "player");
    navigate(`/room/${c}`);
  }

  return (
    <main className="home">
      <h1 className="logo">Party<span>Games</span></h1>
      <p className="tagline">One screen. Everyone's phones. Zero chill.</p>
      <form className="card join-card" onSubmit={join}>
        <label>
          Got a room code?
          <input
            data-testid="join-code"
            className="code-input"
            value={code}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCD"
            onChange={(e) => {
              // Sanitize instead of maxLength, so pasting " abcd" still yields "ABCD".
              const next = sanitizeCodeInput(e.target.value);
              setCode(next);
              setError(/[ILO]/.test(next) ? codeInputError(next) : null);
            }}
          />
        </label>
        <Button type="submit" size="xl" data-testid="join-go">Join</Button>
      </form>
      <div className="host-row">
        <Button size="lg" variant="secondary" data-testid="host-screen" disabled={busy} onClick={() => host("screen")}>
          📺 Host on this screen
        </Button>
        <Button size="lg" variant="ghost" data-testid="host-phone" disabled={busy} onClick={() => host("player")}>
          📱 Start from my phone
        </Button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
