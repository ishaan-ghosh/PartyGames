import type { SavePart } from "@party/shared";
import type { SavedRoom } from "./room-core";

export const ROOM_KEY = "room";
export const partKey = (name: string) => `part:${name}`;

/**
 * Reads `keys` with `get`, at most `batch` keys per call (Durable Object storage caps a multi-key get
 * at 128), and merges the results.
 */
export async function getBatched(
  get: (keys: string[]) => Promise<Map<string, unknown>>,
  keys: readonly string[],
  batch: number,
): Promise<Map<string, unknown>> {
  const reads: Promise<Map<string, unknown>>[] = [];
  for (let i = 0; i < keys.length; i += batch) reads.push(get(keys.slice(i, i + batch)));
  const out = new Map<string, unknown>();
  for (const m of await Promise.all(reads)) for (const [k, v] of m) out.set(k, v);
  return out;
}

/**
 * Decides which storage keys a save writes. The room record is always written; game parts (see
 * GameModule.splitSave) only when their rev differs from the one last written, and parts that are
 * gone are deleted. It assumes each planned write happens, in order: callers issue a plan's writes
 * before planning the next save. The room record carries the parts' revs (`partRevs`), written in the
 * same atomic batch, so a room woken from hibernation knows what storage holds without rewriting it.
 */
export class SavePlanner {
  private written = new Map<string, string>();

  plan(split: { saved: SavedRoom; parts: Record<string, SavePart> }): { put: Record<string, unknown>; del: string[] } {
    const names = Object.keys(split.parts);
    const room = names.length ? { ...split.saved, partRevs: Object.fromEntries(names.map((n) => [n, split.parts[n]!.rev])) } : split.saved;
    const put: Record<string, unknown> = { [ROOM_KEY]: room };
    const del: string[] = [];
    for (const [name, part] of Object.entries(split.parts)) {
      if (this.written.get(name) !== part.rev) put[partKey(name)] = part.value;
    }
    for (const name of this.written.keys()) if (!(name in split.parts)) del.push(partKey(name));
    // Records the new revs before the writes complete. Safe: if a Durable Object storage write fails,
    // the object is reset and restarts, and onStart rebuilds this planner from what storage holds.
    this.written = new Map(Object.entries(split.parts).map(([name, p]) => [name, p.rev]));
    return { put, del };
  }

  /** Storage was wiped (or never read): the next save writes every part. */
  reset(): void {
    this.written.clear();
  }

  /**
   * Parts found in storage on wake, with the revs the room record says they were written at. A part
   * without a known rev (older saves) is rewritten if still present; parts no longer present are deleted.
   */
  restored(names: readonly string[], revs?: Record<string, unknown>): void {
    this.written = new Map(names.map((n) => {
      const rev = revs && Object.prototype.hasOwnProperty.call(revs, n) ? revs[n] : undefined;
      return [n, typeof rev === "string" ? rev : ""];
    }));
  }
}
