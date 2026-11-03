import "@fontsource-variable/fredoka";
import "@fontsource-variable/inter";
import "@party/shared/tokens.css";
import "./base.css";
import "./ui.css";
import { installAudioUnlock } from "./sound";

// iOS Safari only lets audio start from a user activation: keep trying until it runs, and again
// whenever it gets suspended (sleep, background tab, call/Siri).
if (typeof document !== "undefined") installAudioUnlock(document, window);

export { Button, type ButtonProps } from "./Button";
export { PlayerChip, type PlayerChipProps } from "./PlayerChip";
export { Banner } from "./Banner";
export { TimerRing } from "./TimerRing";
export { MuteToggle } from "./MuteToggle";
export { AVATAR_COLORS, AVATAR_EMOJI, randomAvatar } from "./avatars";
export { isMuted, playSound, setMuted, unlockAudio, type SoundName } from "./sound";
export { useWakeLock } from "./useWakeLock";
export type { ClientGame, GameClientProps, SendOptions, SettingsFormProps } from "./game-client";
