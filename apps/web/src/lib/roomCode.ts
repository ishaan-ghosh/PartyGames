import { isRoomCode } from "@party/shared";

/** Normalizes what the user typed or pasted into the code box: letters only, uppercase, at most 4. */
export function sanitizeCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

/** Why `code` isn't a valid room code, or null if it is. */
export function codeInputError(code: string): string | null {
  if (/[ILO]/.test(code)) return "Room codes don't use I, L or O.";
  return isRoomCode(code) ? null : "Room codes are 4 letters.";
}
