import { z } from "zod";
import { BRUSH_SIZES, MAX_POINTS_PER_BATCH, PALETTE, type DoodleAction } from "./types";

// Rounded to 3 decimals (0.8 px on the 800 px canvas) after validation to keep view messages and saved state small.
const round3 = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
const coord = z.number().min(0).max(1).transform(round3);
const color = z.number().int().min(0).max(PALETTE.length - 1);
const points = (min: number) =>
  z.array(coord).min(min).max(MAX_POINTS_PER_BATCH).refine((a) => a.length % 2 === 0, "points must be x,y pairs");

const Action = z.discriminatedUnion("t", [
  z.object({ t: z.literal("choose"), index: z.number().int().min(0).max(2) }),
  z.object({ t: z.literal("guess"), text: z.string().max(200) }),
  z.object({
    t: z.literal("strokeBegin"),
    tool: z.enum(["pen", "eraser"]),
    color,
    size: z.number().int().min(0).max(BRUSH_SIZES.length - 1),
    points: points(2),
  }),
  z.object({ t: z.literal("strokeAppend"), points: points(2) }),
  z.object({ t: z.literal("fill"), color, x: coord, y: coord }),
  z.object({ t: z.literal("undo") }),
  z.object({ t: z.literal("clear") }),
]);

export function parseAction(input: unknown): DoodleAction | null {
  const r = Action.safeParse(input);
  return r.success ? (r.data as DoodleAction) : null;
}
