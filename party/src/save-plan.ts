import type { SavePart } from "@party/shared";
import type { SavedRoom } from "./room-core";

export const ROOM_KEY = "room";
export const partKey = (name: string) => `part:${name}`;

/**
 * Decides which storage keys a save writes. The room record is always written; game parts (see
 * GameModule.splitSave) only when their rev differs from the one last written, and parts that are
 * gone are deleted. It assumes each planned write happens, in order: callers issue a plan's writes
 * before planning the next save.
 */
export class SavePlanner {
  private written = new Map<string, string>();

  plan(split: { saved: SavedRoom; parts: Record<string, SavePart> }): { put: Record<string, unknown>; del: string[] } {
    const put: Record<string, unknown> = { [ROOM_KEY]: split.saved };
    const del: string[] = [];
    for (const [name, part] of Object.entries(split.parts)) {
      if (this.written.get(name) !== part.rev) put[partKey(name)] = part.value;
    }
    for (const name of this.written.keys()) if (!(name in split.parts)) del.push(partKey(name));
    this.written = new Map(Object.entries(split.parts).map(([name, p]) => [name, p.rev]));
    return { put, del };
  }

  /** Storage was wiped (or never read): the next save writes every part. */
  reset(): void {
    this.written.clear();
  }

  /** Parts found in storage on wake (revs unknown): rewritten if still present, deleted if not. */
  restored(names: readonly string[]): void {
    this.written = new Map(names.map((n) => [n, ""]));
  }
}
