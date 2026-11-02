import { useState } from "react";
import { isMuted, setMuted } from "./sound";

export function MuteToggle({ floating = false }: { floating?: boolean }) {
  const [muted, setState] = useState(isMuted);
  return (
    <button
      type="button"
      className={`mute-toggle ${floating ? "mute-floating" : ""}`}
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      aria-pressed={muted}
      onClick={() => {
        setMuted(!muted);
        setState(!muted);
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
