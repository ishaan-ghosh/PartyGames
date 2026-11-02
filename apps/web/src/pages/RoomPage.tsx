import { isRoomCode, normalizeRoomCode } from "@party/shared";
import { Banner } from "@party/ui";
import { useEffect, useState } from "react";
import { storage } from "../lib/storage";
import "../lobby/lobby.css";
import { PhoneLobby } from "../lobby/PhoneLobby";
import { ScreenLobby } from "../lobby/ScreenLobby";
import { GameStage } from "../stage/GameStage";
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

  // Nothing below renders until `you` is set, so every send has a welcomed (or welcoming) outbox.
  const isHost = r.room.hostId === r.you.id;
  const online = r.status === "open";
  return (
    <div className={`room-view ${r.you.kind === "screen" ? "screen-view" : "phone-view"}`}>
      {r.status === "reconnecting" && <Banner tone="warn" floating>Reconnecting…</Banner>}
      {r.error && <Banner tone="bad" floating>{r.error.message}</Banner>}
      {r.room.phase === "lobby" ? (
        r.you.kind === "screen" ? (
          <ScreenLobby room={r.room} isHost={isHost} online={online} sendHost={r.sendHost} />
        ) : (
          <PhoneLobby room={r.room} you={r.you} isHost={isHost} online={online} sendHost={r.sendHost} />
        )
      ) : (
        <GameStage r={r} isHost={isHost} />
      )}
    </div>
  );
}
