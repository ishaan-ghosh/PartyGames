import { useState } from "react";
import { isMuted, setMuted, unlockAudio } from "./sound";

export function MuteToggle({ floating = false }: { floating?: boolean }) {
  const [muted, setState] = useState(isMuted);
  return (
    <button
      type="button"
      className={`mute-toggle ${floating ? "mute-floating" : ""}`}
      aria-label="Mute sounds"
      aria-pressed={muted}
      onClick={() => {
        void unlockAudio();
        setMuted(!muted);
        setState(!muted);
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
