import type { HostCommand, RoomSnapshot } from "@party/shared";
import { PlayerChip, playSound } from "@party/ui";
import { QRCodeSVG } from "qrcode.react";
import { lazy, Suspense, useEffect, useRef } from "react";
import { publicOrigin } from "../lib/origin";
import { HostPanel } from "./HostPanel";
import { Results } from "./Results";

const LobbyBackground = lazy(() => import("./LobbyBackground"));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function ScreenLobby({ room, isHost, online, sendHost }: {
  room: RoomSnapshot;
  isHost: boolean;
  online: boolean;
  sendHost(cmd: HostCommand): void;
}) {
  const url = `${publicOrigin()}/room/${room.code}`;
  const count = room.players.length;
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current) playSound("join");
    prev.current = count;
  }, [count]);

  return (
    <div className="lobby-screen">
      {!reducedMotion() && (
        <Suspense fallback={null}>
          <LobbyBackground />
        </Suspense>
      )}
      <section className="code-panel card">
        <p className="eyebrow">Join at <strong>{new URL(url).host}</strong></p>
        <div className="room-code" data-testid="room-code">{room.code}</div>
        <div className="qr">
          <QRCodeSVG value={url} size={220} bgColor="#ffffff" fgColor="#0f0e17" marginSize={2} />
        </div>
        <p className="code-hint">Scan with your phone camera</p>
      </section>
      <section className="players-panel">
        <h2>{count ? `${count} player${count === 1 ? "" : "s"} in` : "Waiting for players…"}</h2>
        <div className="players-grid">
          {room.players.map((p) => (
            <PlayerChip
              key={p.id}
              data-testid="lobby-player"
              size="lg"
              name={p.name}
              avatar={p.avatar}
              dim={!p.connected}
              badge={p.isHost ? "host" : undefined}
            />
          ))}
        </div>
        {room.lastResults && <Results results={room.lastResults} />}
        {isHost ? (
          <HostPanel room={room} sendHost={sendHost} online={online} />
        ) : (
          <p className="waiting">Waiting for the host to start…</p>
        )}
      </section>
    </div>
  );
}
