import { Banner, useWakeLock, type GameClientProps } from "@party/ui";
import type { CSSProperties } from "react";
import { getClientGame } from "../games";
import type { RoomConnection } from "../net/useRoom";
import { HostBar } from "./HostBar";

/**
 * Renders the registered game's Screen or Phone view. Only mounted once `r.room` and `r.you` are set.
 * Room-level notices (reconnecting, below minimum) live in RoomPage's banner stack.
 */
export function GameStage({ r, isHost }: { r: RoomConnection; isHost: boolean }) {
  useWakeLock(true);
  const room = r.room!;
  const you = r.you!;
  const online = r.status === "open";
  const game = getClientGame(room.gameId);
  // The host keeps Skip/End in every state, so a missing or loading game can't strand the room.
  const hostBar = isHost && (
    <HostBar
      disabled={!online}
      confirmSkip={you.kind === "player"}
      onSkip={() => r.sendHost({ cmd: "skip" })}
      onEnd={() => r.sendHost({ cmd: "endGame" })}
    />
  );
  const stageClass = `stage stage-${you.kind}`;

  if (!game || r.view === null) {
    return (
      <div className={stageClass}>
        <div className="center">
          {!game ? (
            <Banner tone="bad">This game isn't available on this device.</Banner>
          ) : (
            <p className="loading">Loading game…</p>
          )}
        </div>
        {hostBar}
      </div>
    );
  }

  const props: GameClientProps = {
    view: r.view,
    room,
    you,
    isHost,
    mode: room.mode,
    send: r.sendAction,
    onEvent: r.onEvent,
    serverNow: r.serverNow,
    soundOn: you.kind === "screen" || room.mode === "phones",
  };
  const View = you.kind === "screen" ? game.Screen : game.Phone;
  return (
    <div className={stageClass} style={{ "--game-accent": game.meta.accent } as CSSProperties}>
      <View {...props} />
      {hostBar}
    </div>
  );
}
