import "@fontsource-variable/fredoka";
import "@fontsource-variable/inter";
import "@party/shared/tokens.css";
import "./base.css";
import "./ui.css";
import { unlockAudio } from "./sound";

// iOS Safari only lets audio start from a user gesture: unlock on the first one.
if (typeof document !== "undefined") {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = () => {
    unlockAudio();
    for (const e of events) document.removeEventListener(e, unlock, true);
  };
  for (const e of events) document.addEventListener(e, unlock, true);
}

export { Button, type ButtonProps } from "./Button";
export { PlayerChip, type PlayerChipProps } from "./PlayerChip";
export { Banner } from "./Banner";
export { TimerRing } from "./TimerRing";
export { MuteToggle } from "./MuteToggle";
export { AVATAR_COLORS, AVATAR_EMOJI, randomAvatar } from "./avatars";
export { isMuted, playSound, setMuted, unlockAudio, type SoundName } from "./sound";
export { useWakeLock } from "./useWakeLock";
export type { ClientGame, GameClientProps, SettingsFormProps } from "./game-client";
