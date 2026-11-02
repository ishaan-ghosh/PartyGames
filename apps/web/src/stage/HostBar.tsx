/**
 * Host-only skip/end controls over the game. Disabled while offline: host commands are never queued.
 * `confirmSkip` asks before skipping (on phones, where the bar sits next to game controls).
 */
export function HostBar({ onSkip, onEnd, disabled = false, confirmSkip = false }: {
  onSkip(): void;
  onEnd(): void;
  disabled?: boolean;
  confirmSkip?: boolean;
}) {
  return (
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
    </div>
  );
}
