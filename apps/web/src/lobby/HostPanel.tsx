import type { HostCommand, RoomSnapshot } from "@party/shared";
import { Button } from "@party/ui";
import { getClientGame } from "../games";
import { GameLibrary } from "./GameLibrary";

/** `online` is false while the connection isn't welcomed: host commands would be dropped, so disable them. */
export function HostPanel({ room, sendHost, online }: {
  room: RoomSnapshot;
  sendHost(cmd: HostCommand): void;
  online: boolean;
}) {
  const game = getClientGame(room.gameId);
  const ready = room.players.filter((p) => p.connected).length;
  const min = game?.meta.minPlayers ?? 2;
  const missing = Math.max(0, min - ready);
  return (
    <section className="host-panel card">
      <h2>Pick a game</h2>
      {/* Scrolls on its own on the TV lobby so the Start button below stays on screen. */}
      <div className="host-panel-body">
        <GameLibrary
          selected={room.gameId}
          disabled={!online}
          onSelect={(gameId) => sendHost({ cmd: "selectGame", gameId })}
        />
        {game && (
          <>
            <h3>Settings</h3>
            <game.Settings
              settings={room.settings}
              onChange={(settings) => sendHost({ cmd: "updateSettings", settings })}
              disabled={!online}
            />
          </>
        )}
      </div>
      <Button
        size="xl"
        data-testid="start-game"
        disabled={!online || !game || missing > 0}
        onClick={() => sendHost({ cmd: "start" })}
      >
        {!game
          ? "Pick a game"
          : missing > 0
            ? `Need ${missing} more player${missing === 1 ? "" : "s"}`
            : !online
              ? "Reconnecting…"
              : `Start ${game.meta.name}`}
      </Button>
    </section>
  );
}
