import { Banner, Button, useWakeLock, type GameClientProps } from "@party/ui";
import type { CSSProperties } from "react";
import { clientGames } from "../games";
import type { RoomConnection } from "../net/useRoom";
import { HostBar } from "./HostBar";

/** Renders the registered game's Screen or Phone view. Only mounted once `r.room` and `r.you` are set. */
export function GameStage({ r, isHost }: { r: RoomConnection; isHost: boolean }) {
  useWakeLock(true);
  const room = r.room!;
  const you = r.you!;
  const online = r.status === "open";
  const game = clientGames[room.gameId];
  if (!game) return <div className="center"><Banner tone="bad">This game isn't available on this device.</Banner></div>;
  if (r.view === null) return <div className="center"><p className="loading">Loading game…</p></div>;

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
    <div className={`stage stage-${you.kind}`} style={{ "--game-accent": game.meta.accent } as CSSProperties}>
      {room.belowMin && (
        <Banner
          tone="warn"
          floating
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
      <View {...props} />
      {isHost && (
        <HostBar
          disabled={!online}
          onSkip={() => r.sendHost({ cmd: "skip" })}
          onEnd={() => r.sendHost({ cmd: "endGame" })}
        />
      )}
    </div>
  );
}
