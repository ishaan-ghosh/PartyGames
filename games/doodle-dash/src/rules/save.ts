import type { SavePart } from "@party/shared";
import type { DoodleState, Stroke } from "./types";

/** Strokes per stored chunk. Only the last chunk changes while drawing; undo/clear touch the tail. */
export const SAVE_CHUNK = 32;
const PREFIX = "strokes.";

function chunkRev(s: DoodleState, chunk: Stroke[]): string {
  let points = 0;
  for (const st of chunk) points += st.tool === "fill" ? 2 : st.points.length;
  // Stroke ids are unique within a game and a stroke only ever grows, so ids + size pin the content.
  return `${s.round}:${s.turnIndex}:${chunk[0]!.id}-${chunk.at(-1)!.id}:${chunk.length}:${points}`;
}

/** Saves the drawing in chunks beside the rest of the state, so a guess doesn't rewrite all the ink. */
export function splitSave(s: DoodleState): { state: DoodleState; parts: Record<string, SavePart> } {
  const parts: Record<string, SavePart> = {};
  for (let i = 0; i * SAVE_CHUNK < s.strokes.length; i++) {
    const chunk = s.strokes.slice(i * SAVE_CHUNK, (i + 1) * SAVE_CHUNK);
    parts[`${PREFIX}${i}`] = { rev: chunkRev(s, chunk), value: chunk };
  }
  return { state: { ...s, strokes: [] }, parts };
}

export function joinSave(s: DoodleState, parts: Record<string, unknown>): DoodleState {
  const chunks = Object.keys(parts)
    .filter((k) => k.startsWith(PREFIX))
    .map((k) => ({ i: Number(k.slice(PREFIX.length)), v: parts[k] }))
    .filter((c) => Number.isInteger(c.i))
    .sort((a, b) => a.i - b.i);
  s.strokes = chunks.flatMap((c) => (Array.isArray(c.v) ? (c.v as Stroke[]) : []));
  return s;
}
