import { isRoomCode, normalizeRoomCode } from "@party/shared";
import { Banner, Button } from "@party/ui";
import { useEffect, useState } from "react";
import { storage } from "../lib/storage";
import "../lobby/lobby.css";
import { PhoneLobby } from "../lobby/PhoneLobby";
import { ScreenLobby } from "../lobby/ScreenLobby";
import { GameStage } from "../stage/GameStage";
import { RoomNoticeAnnouncer, RoomNoticeBanner, useRoomNotice } from "../stage/RoomNotice";
import { FATAL_ERRORS, JOIN_FAILURES } from "../net/roomState";
import { useRoom, type HelloInfo } from "../net/useRoom";
import { Fatal } from "./Fatal";
import { JoinForm } from "./JoinForm";

function initialHello(code: string): HelloInfo | null {
  if (storage.getRole(code) === "screen") return { role: "screen" };
  const profile = storage.getProfile();
  return storage.getToken(code, "player") && profile ? { role: "player", ...profile } : null;
}

/**
 * Each attempt is a fresh mount of RoomSession, so "Rejoin here" after REPLACED resets the room state
 * (the fatal error would otherwise stick) and opens a new socket and Outbox.
 */
export function RoomPage({ code }: { code: string }) {
  const [attempt, setAttempt] = useState(0);
  return <RoomSession key={attempt} code={code} onRejoin={() => setAttempt((n) => n + 1)} />;
}

function RoomSession({ code: raw, onRejoin }: { code: string; onRejoin(): void }) {
  const code = normalizeRoomCode(raw);
  const [hello, setHello] = useState<HelloInfo | null>(() => initialHello(code));
  const [nameError, setNameError] = useState<string | null>(null);
  const r = useRoom(code, isRoomCode(code) ? hello : null);
  const notice = useRoomNotice(r);

  useEffect(() => {
    if (!r.error || r.you) return;
    // Our hello was rejected (also after a stale-token reconnect; the reducer then drops `you`).
    if (JOIN_FAILURES.has(r.error.code)) {
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
  if (r.error?.code === "REPLACED") {
    // Our token is still valid (the other tab uses it), so rejoining here takes the seat back.
    return (
      <Fatal
        message="This seat was opened on another tab or device."
        action={
          <Button size="lg" data-testid="rejoin" onClick={onRejoin}>
            Use this device instead
          </Button>
        }
      />
    );
  }
  if (r.error && FATAL_ERRORS.has(r.error.code)) return <Fatal message={r.error.message} />;
  if (!r.room || !r.you) return <div className="center"><p className="loading">Connecting…</p></div>;

  // Nothing below renders until `you` is set, so every send has a welcomed (or welcoming) outbox.
  const isHost = r.room.hostId === r.you.id;
  const online = r.status === "open";
  const belowMin = r.room.phase === "playing" && r.room.belowMin;
  return (
    <main className={`room-view ${r.you.kind === "screen" ? "screen-view" : "phone-view"}`}>
      {/* One fixed stack, so notices never hide each other. */}
      <div className="banner-stack">
        {r.status === "reconnecting" && <Banner tone="warn">Reconnecting…</Banner>}
        {r.error && <Banner tone="bad">{r.error.message}</Banner>}
        {belowMin && (
          <Banner
            tone="warn"
            action={
              isHost ? (
                <Button variant="secondary" disabled={!online} onClick={() => r.sendHost({ cmd: "endGame" })}>
                  End game
                </Button>
              ) : undefined
            }
          >
            Not enough players connected.
          </Banner>
        )}
        {notice.text && <RoomNoticeBanner text={notice.text} onDismiss={notice.dismiss} />}
      </div>
      {r.you.kind === "player" && <RoomNoticeAnnouncer text={notice.text} />}
      {r.room.phase === "lobby" ? (
        r.you.kind === "screen" ? (
          <ScreenLobby room={r.room} youId={r.you.id} isHost={isHost} online={online} sendHost={r.sendHost} />
        ) : (
          <PhoneLobby room={r.room} you={r.you} isHost={isHost} online={online} sendHost={r.sendHost} />
        )
      ) : (
        <GameStage r={r} isHost={isHost} />
      )}
    </main>
  );
}
