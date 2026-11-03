import type { RoomSnapshot } from "@party/shared";
import { useState } from "react";
import { PlayersDialog } from "../kick/KickDialogs";

/**
 * Host-only skip/end/players controls over the game. Skip/End are disabled while offline: host
 * commands are never queued. The players list stays viewable offline; its Kick buttons don't.
 * `confirmSkip` asks before skipping (on phones, where the bar sits next to game controls).
 */
export function HostBar({ room, youId, onSkip, onEnd, onKick, disabled = false, confirmSkip = false }: {
  room: RoomSnapshot;
  youId: string;
  onSkip(): void;
  onEnd(): void;
  onKick(playerId: string): void;
  disabled?: boolean;
  confirmSkip?: boolean;
}) {
  const [showPlayers, setShowPlayers] = useState(false);
  return (
    <>
      <div className="host-bar" role="group" aria-label="Host controls">
        <button
          type="button"
          data-testid="host-skip"
          disabled={disabled}
          onClick={() => {
            if (!confirmSkip || window.confirm("Skip this turn for everyone?")) onSkip();
          }}
        >
          ⏭ Skip
        </button>
        <button
          type="button"
          data-testid="host-end"
          disabled={disabled}
          onClick={() => {
            if (window.confirm("End the game for everyone?")) onEnd();
          }}
        >
          ⏹ End
        </button>
        <button
          type="button"
          data-testid="host-players"
          aria-haspopup="dialog"
          aria-label="Players"
          onClick={() => setShowPlayers(true)}
        >
          {/* Icon-only on narrow phones, so the bar stays clear of the mute toggle. */}
          <span aria-hidden="true">👥</span> <span className="host-bar-label">Players</span>
        </button>
      </div>
      {/* Outside the bar, so its dimming and `.host-bar button` styles don't reach the dialog. */}
      {showPlayers && (
        <PlayersDialog
          room={room}
          youId={youId}
          online={!disabled}
          onKick={onKick}
          onClose={() => setShowPlayers(false)}
        />
      )}
    </>
  );
}
