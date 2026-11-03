import type { ActionResult } from "@party/shared";
import { INK_LIMIT, MAX_FILLS, STROKE_COST, type DoodleState, type Stroke, type StrokeAction, type StrokeOp } from "./types";

/** Cheap shape signature, "count:numbers" (a fill counts 2). Views carry it so clients can spot a wrong list. */
export function strokeSignature(strokes: readonly Stroke[]): string {
  let points = 0;
  for (const s of strokes) points += s.tool === "fill" ? 2 : s.points.length;
  return `${strokes.length}:${points}`;
}
export const EMPTY_SIG = "0:0";

/** The whole drawing as one "sync" op (copied: live strokes keep growing after it is queued). */
export function syncOp(s: DoodleState): StrokeOp {
  return { op: "sync", seq: s.opSeq, strokes: s.strokes.map((st) => (st.tool === "fill" ? { ...st } : { ...st, points: [...st.points] })) };
}

/**
 * Applies a drawer's stroke action. Always quiet; accepted actions carry one op event for the others,
 * refused ones a `rejected` reason code for the room's log.
 */
export function handleStroke(s: DoodleState, playerId: string, action: StrokeAction): ActionResult<DoodleState> {
  const ignore = (rejected: string): ActionResult<DoodleState> => ({ state: s, quiet: true, rejected });
  if (s.phase !== "drawing") return ignore("wrong_phase");
  if (playerId !== s.drawerId) return ignore("not_drawer");
  let op: StrokeOp;
  switch (action.t) {
    case "strokeBegin": {
      const cost = action.points.length + STROKE_COST;
      if (s.ink + cost > INK_LIMIT) return ignore("ink_limit");
      s.ink += cost;
      const stroke: Stroke = { id: s.nextStrokeId++, tool: action.tool, color: action.color, size: action.size, points: [...action.points] };
      s.strokes.push(stroke);
      s.openStroke = { key: action.id, strokeId: stroke.id };
      op = { op: "begin", seq: ++s.opSeq, stroke: { ...stroke, points: [...stroke.points] } };
      break;
    }
    case "strokeAppend": {
      // Only the stroke begun with this id, and only while it is still last: if its begin was lost,
      // appending would extend some earlier stroke (wrong color, a line joining the two).
      const last = s.strokes.at(-1);
      const open = s.openStroke;
      if (!last || last.tool === "fill" || !open || open.key !== action.id || open.strokeId !== last.id) return ignore("no_open_stroke");
      if (s.ink + action.points.length > INK_LIMIT) return ignore("ink_limit");
      s.ink += action.points.length;
      last.points.push(...action.points);
      op = { op: "append", seq: ++s.opSeq, strokeId: last.id, points: [...action.points] };
      break;
    }
    case "fill": {
      const fills = s.fills ?? 0;
      if (fills >= MAX_FILLS) return ignore("fill_limit");
      if (s.ink + 2 + STROKE_COST > INK_LIMIT) return ignore("ink_limit");
      s.fills = fills + 1;
      s.ink += 2 + STROKE_COST;
      const stroke: Stroke = { id: s.nextStrokeId++, tool: "fill", color: action.color, x: action.x, y: action.y };
      s.strokes.push(stroke);
      op = { op: "begin", seq: ++s.opSeq, stroke: { ...stroke } };
      break;
    }
    case "undo": {
      if (s.strokes.length === 0) return ignore("nothing_to_undo");
      s.strokes.pop();
      op = { op: "undo", seq: ++s.opSeq };
      break;
    }
    case "clear": {
      if (s.strokes.length === 0) return ignore("nothing_to_clear");
      s.strokes = [];
      op = { op: "clear", seq: ++s.opSeq };
      break;
    }
    default:
      return ignore("bad_action");
  }
  return { state: s, quiet: true, events: [{ to: "others", payload: op }] };
}
