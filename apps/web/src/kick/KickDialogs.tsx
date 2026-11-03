import type { PublicPlayer, RoomSnapshot } from "@party/shared";
import { Button, PlayerChip } from "@party/ui";
import { useId, useState, type ReactNode, type Ref } from "react";
import { kickablePlayers } from "./kick";
import { Modal } from "./Modal";

/** The confirm step, shared by the lobby dialog and the in-game players dialog. Cancel has focus. */
function ConfirmBody({ player, titleId, online, onKick, onCancel }: {
  player: PublicPlayer;
  titleId: string;
  online: boolean;
  onKick(): void;
  onCancel(): void;
}) {
  return (
    <>
      <h2 id={titleId} className="modal-title">Kick {player.name}?</h2>
      <p className="modal-text">They'll be removed from the room.</p>
      {!online && <p className="modal-text">You're offline. Reconnect to kick players.</p>}
      <div className="modal-actions">
        <Button variant="secondary" size="lg" data-autofocus onClick={onCancel}>Cancel</Button>
        <Button variant="danger" size="lg" data-testid="kick-confirm" disabled={!online} onClick={onKick}>
          Kick
        </Button>
      </div>
    </>
  );
}

/** Lobby: wraps a kickable player's chip so the host can tap it; the chip keeps its own look. */
export function KickChipButton({ player, onClick, buttonRef, children }: {
  player: PublicPlayer;
  onClick(): void;
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="chip-button"
      data-testid={`kick-${player.name}`}
      aria-label={`Kick ${player.name}`}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Lobby: confirm kicking one player (opened by tapping their chip). */
export function KickConfirmDialog({ player, online, onKick, onClose, returnFocus }: {
  player: PublicPlayer;
  online: boolean;
  onKick(playerId: string): void;
  onClose(): void;
  /** The chip that opened it: focus goes back there on close (see Modal). */
  returnFocus?: HTMLElement | null;
}) {
  const titleId = useId();
  return (
    <Modal labelledBy={titleId} onClose={onClose} returnFocus={returnFocus} className="modal-confirm">
      <ConfirmBody
        player={player}
        titleId={titleId}
        online={online}
        onCancel={onClose}
        onKick={() => {
          onKick(player.id);
          onClose();
        }}
      />
    </Modal>
  );
}

/**
 * In game: every player with a Kick button for each one the host may kick, then a confirm step in
 * the same dialog. The list follows the room snapshot, so a kicked player drops out once the server
 * confirms.
 */
export function PlayersDialog({ room, youId, online, onKick, onClose, returnFocus }: {
  room: RoomSnapshot;
  youId: string;
  online: boolean;
  onKick(playerId: string): void;
  onClose(): void;
  /** The button that opened it: focus goes back there on close (see Modal). */
  returnFocus?: HTMLElement | null;
}) {
  const titleId = useId();
  const [targetId, setTargetId] = useState<string | null>(null);
  // Back from the confirm step, focus returns to the Kick button that opened it.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const kickable = kickablePlayers(room, youId);
  const target = kickable.find((p) => p.id === targetId);

  if (target) {
    const back = () => {
      setReturnTo(target.id);
      setTargetId(null);
    };
    // Escape/Back (and the backdrop) step back to the list, like Cancel; they don't close the dialog.
    return (
      <Modal labelledBy={titleId} onClose={back} focusKey={`confirm:${target.id}`} returnFocus={returnFocus} className="modal-confirm">
        <ConfirmBody
          player={target}
          titleId={titleId}
          online={online}
          onCancel={back}
          onKick={() => {
            onKick(target.id);
            setReturnTo(null);
            setTargetId(null);
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal labelledBy={titleId} onClose={onClose} focusKey={`list:${returnTo ?? ""}`} returnFocus={returnFocus} className="modal-players">
      <div className="modal-head">
        <h2 id={titleId} className="modal-title">Players</h2>
        <Button variant="ghost" aria-label="Close" data-autofocus={returnTo ? undefined : true} onClick={onClose}>
          ✕
        </Button>
      </div>
      <ul className="kick-list">
        {room.players.map((p) => {
          const canKick = kickable.some((k) => k.id === p.id);
          return (
            <li key={p.id}>
              <PlayerChip
                name={p.name}
                avatar={p.avatar}
                dim={!p.connected}
                badge={p.isHost ? "host" : p.connected ? undefined : "offline"}
              />
              {canKick && (
                <Button
                  variant="secondary"
                  data-testid={`kick-${p.name}`}
                  aria-label={`Kick ${p.name}`}
                  aria-haspopup="dialog"
                  data-autofocus={returnTo === p.id ? true : undefined}
                  onClick={() => setTargetId(p.id)}
                >
                  Kick
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {kickable.length === 0 && <p className="modal-text">No other players to kick.</p>}
    </Modal>
  );
}
