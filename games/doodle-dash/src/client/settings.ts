export const splitWords = (text: string): string[] => text.split(",").map((w) => w.trim()).filter(Boolean);

const sameWords = (text: string, list: readonly string[]) =>
  splitWords(text).join("|").toLowerCase() === list.join("|").toLowerCase();

/**
 * The custom-words text to show after the room's settings change. Never overwrites what the user is
 * typing (focused) or has typed but not yet committed (edited); otherwise follows the room.
 */
export function syncWordsText(text: string, incoming: readonly string[], user: { focused: boolean; edited: boolean }): string {
  if (user.focused || user.edited) return text;
  return sameWords(text, incoming) ? text : incoming.join(", ");
}

/**
 * Edit flags after the field's `disabled` changes. A disabled textarea never fires blur, so focus is
 * cleared; unsaved edits are kept (disabled flips on every brief reconnect, and typed text must survive).
 */
export function editStateWhen(
  disabled: boolean | undefined,
  user: { focused: boolean; edited: boolean },
): { focused: boolean; edited: boolean } {
  return disabled ? { focused: false, edited: user.edited } : user;
}
