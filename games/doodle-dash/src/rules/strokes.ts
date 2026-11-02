import type { ActionResult } from "@party/shared";
import { INK_LIMIT, type DoodleState, type Stroke, type StrokeAction, type StrokeOp } from "./types";

/** Applies a drawer's stroke action. Always quiet; accepted actions carry one op event for the others. */
export function handleStroke(s: DoodleState, playerId: string, action: StrokeAction): ActionResult<DoodleState> {
  const ignore: ActionResult<DoodleState> = { state: s, quiet: true };
  if (s.phase !== "drawing" || playerId !== s.drawerId) return ignore;
  let op: StrokeOp;
  switch (action.t) {
    case "strokeBegin": {
      if (s.ink + action.points.length > INK_LIMIT) return ignore;
      s.ink += action.points.length;
      const stroke: Stroke = { id: s.nextStrokeId++, tool: action.tool, color: action.color, size: action.size, points: [...action.points] };
      s.strokes.push(stroke);
      op = { op: "begin", seq: ++s.opSeq, stroke: { ...stroke, points: [...stroke.points] } };
      break;
    }
    case "strokeAppend": {
      const last = s.strokes.at(-1);
      if (!last || last.tool === "fill" || s.ink + action.points.length > INK_LIMIT) return ignore;
      s.ink += action.points.length;
      last.points.push(...action.points);
      op = { op: "append", seq: ++s.opSeq, strokeId: last.id, points: [...action.points] };
      break;
    }
    case "fill": {
      if (s.ink + 2 > INK_LIMIT) return ignore;
      s.ink += 2;
      const stroke: Stroke = { id: s.nextStrokeId++, tool: "fill", color: action.color, x: action.x, y: action.y };
      s.strokes.push(stroke);
      op = { op: "begin", seq: ++s.opSeq, stroke: { ...stroke } };
      break;
    }
    case "undo": {
      if (s.strokes.length === 0) return ignore;
      s.strokes.pop();
      op = { op: "undo", seq: ++s.opSeq };
      break;
    }
    case "clear": {
      if (s.strokes.length === 0) return ignore;
      s.strokes = [];
      op = { op: "clear", seq: ++s.opSeq };
      break;
    }
    default:
      return ignore;
  }
  return { state: s, quiet: true, events: [{ to: "others", payload: op }] };
}
