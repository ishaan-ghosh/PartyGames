import { isRoomCode, normalizeRoomCode } from "@party/shared";
import { Banner, PlayerChip } from "@party/ui";
import { useEffect, useState } from "react";
import { storage } from "../lib/storage";
import { FATAL_ERRORS } from "../net/roomState";
import { useRoom, type HelloInfo } from "../net/useRoom";
import { Fatal } from "./Fatal";
import { JoinForm } from "./JoinForm";

function initialHello(code: string): HelloInfo | null {
  if (storage.getRole(code) === "screen") return { role: "screen" };
  const profile = storage.getProfile();
  return storage.getToken(code, "player") && profile ? { role: "player", ...profile } : null;
}

export function RoomPage({ code: raw }: { code: string }) {
  const code = normalizeRoomCode(raw);
  const [hello, setHello] = useState<HelloInfo | null>(() => initialHello(code));
  const [nameError, setNameError] = useState<string | null>(null);
  const r = useRoom(code, isRoomCode(code) ? hello : null);

  useEffect(() => {
    if (!r.error || r.you) return;
    if (r.error.code === "NAME_TAKEN" || r.error.code === "BAD_MESSAGE") {
      setNameError(r.error.message);
      setHello(null);
    }
  }, [r.error, r.you]);

  if (!isRoomCode(code)) return <Fatal message="That isn't a valid room code." />;
  if (!hello) {
    return (
      <JoinForm
        code={code}
        initial={storage.getProfile()}
        error={nameError}
        onJoin={(p) => {
          storage.setProfile(p);
          storage.setRole(code, "player");
          setNameError(null);
          setHello({ role: "player", ...p });
        }}
        onScreen={() => {
          storage.setRole(code, "screen");
          setHello({ role: "screen" });
        }}
      />
    );
  }
  if (r.error && FATAL_ERRORS.has(r.error.code)) return <Fatal message={r.error.message} />;
  if (!r.room || !r.you) return <div className="center"><p className="loading">Connecting…</p></div>;

  return (
    <main className="center">
      {r.status === "reconnecting" && <Banner tone="warn" floating>Reconnecting…</Banner>}
      <div className="card">
        <h1>Room {r.room.code}</h1>
        {r.room.players.map((p) => (
          <PlayerChip key={p.id} data-testid="lobby-player" name={p.name} avatar={p.avatar} dim={!p.connected} />
        ))}
      </div>
    </main>
  );
}
