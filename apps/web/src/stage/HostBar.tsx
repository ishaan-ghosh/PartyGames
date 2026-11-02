/** Host-only skip/end controls over the game. Disabled while offline: host commands are never queued. */
export function HostBar({ onSkip, onEnd, disabled = false }: { onSkip(): void; onEnd(): void; disabled?: boolean }) {
  return (
    <div className="host-bar" role="group" aria-label="Host controls">
      <button type="button" data-testid="host-skip" disabled={disabled} onClick={onSkip}>⏭ Skip</button>
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
    </div>
  );
}
