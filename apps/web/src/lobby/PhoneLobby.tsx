import type { HostCommand, RoomSnapshot, You } from "@party/shared";
import { Button, PlayerChip } from "@party/ui";
import { QRCodeSVG } from "qrcode.react";
import { Fragment, useState } from "react";
import { getClientGame } from "../games";
import { publicOrigin } from "../lib/origin";
import { HostPanel } from "./HostPanel";
import { Results } from "./Results";

export function PhoneLobby({ room, you, isHost, online, sendHost }: {
  room: RoomSnapshot;
  you: You;
  isHost: boolean;
  online: boolean;
  sendHost(cmd: HostCommand): void;
}) {
  const me = room.players.find((p) => p.id === you.id);
  const game = getClientGame(room.gameId);
  const [showCode, setShowCode] = useState(false);
  return (
    <div className="phone phone-lobby" data-testid="phone-lobby">
      <header className="phone-header">
        <span className="eyebrow">Room</span>
        <strong className="room-code-sm">{room.code}</strong>
      </header>
      {me && <PlayerChip size="lg" name={me.name} avatar={me.avatar} badge={isHost ? "host" : undefined} />}
      {room.lastResults && <Results results={room.lastResults} />}
      {isHost ? (
        <>
          {room.mode === "phones" && (
            <Button variant="secondary" onClick={() => setShowCode((s) => !s)}>
              {showCode ? "Hide join code" : "Show join code"}
            </Button>
          )}
          {showCode && (
            <div className="qr qr-phone card">
              <QRCodeSVG value={`${publicOrigin()}/room/${room.code}`} size={180} bgColor="#ffffff" fgColor="#0f0e17" marginSize={2} />
              <strong className="room-code-sm">{room.code}</strong>
            </div>
          )}
          <HostPanel room={room} sendHost={sendHost} online={online} />
        </>
      ) : (
        <div className="card waiting-card">
          {game && <p className="waiting-game">{game.emoji} {game.meta.name}</p>}
          <p>Waiting for the host to start…</p>
        </div>
      )}
      <h3>Players</h3>
      <div className="players-list">
        {room.players.map((p) => (
          <Fragment key={p.id}>
            <PlayerChip
              data-testid="lobby-player"
              name={p.name}
              avatar={p.avatar}
              dim={!p.connected}
              badge={p.isHost ? "host" : undefined}
            />
            {!p.connected && <span className="sr-only">(offline)</span>}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
