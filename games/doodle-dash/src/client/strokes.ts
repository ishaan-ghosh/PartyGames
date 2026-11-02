import { BRUSH_SIZES, MAX_POINTS_PER_BATCH, PALETTE, type Stroke, type StrokeOp } from "../rules";

export const CANVAS_W = 800;
export const CANVAS_H = 600;

export function applyOp(strokes: Stroke[], op: StrokeOp): Stroke[] {
  switch (op.op) {
    case "begin":
      return [...strokes, op.stroke];
    case "append": {
      const last = strokes.at(-1);
      if (!last || last.id !== op.strokeId || last.tool === "fill") return strokes;
      return [...strokes.slice(0, -1), { ...last, points: [...last.points, ...op.points] }];
    }
    case "undo":
      return strokes.slice(0, -1);
    case "clear":
      return [];
  }
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Client (CSS pixel) coordinates → normalized 0–1 canvas coordinates, clamped to the canvas. */
export function normalizePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): [number, number] {
  return [clamp01((clientX - rect.left) / rect.width), clamp01((clientY - rect.top) / rect.height)];
}

/** Splits flat x,y points into batches the server accepts (≤ MAX_POINTS_PER_BATCH numbers, even length). */
export function chunkPoints(points: readonly number[]): number[][] {
  const size = MAX_POINTS_PER_BATCH - (MAX_POINTS_PER_BATCH % 2);
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += size) out.push(points.slice(i, i + size));
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function floodFillData(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  rgb: [number, number, number],
  tolerance = 48,
): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i0 = (y * w + x) * 4;
  const [tr, tg, tb] = [data[i0]!, data[i0 + 1]!, data[i0 + 2]!];
  if (tr === rgb[0] && tg === rgb[1] && tb === rgb[2]) return;
  const matches = (i: number) =>
    Math.abs(data[i]! - tr) + Math.abs(data[i + 1]! - tg) + Math.abs(data[i + 2]! - tb) <= tolerance;
  const seen = new Uint8Array(w * h);
  const stack = [y * w + x];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!matches(i)) continue;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
    const px = p % w;
    if (px > 0) stack.push(p - 1);
    if (px < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
}

export function renderStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[]): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  for (const s of strokes) {
    if (s.tool === "fill") {
      const img = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      const x = Math.min(CANVAS_W - 1, Math.floor(s.x * CANVAS_W));
      const y = Math.min(CANVAS_H - 1, Math.floor(s.y * CANVAS_H));
      floodFillData(img.data, CANVAS_W, CANVAS_H, x, y, hexToRgb(PALETTE[s.color] ?? "#000000"));
      ctx.putImageData(img, 0, 0);
      continue;
    }
    const p = s.points;
    if (p.length < 2) continue;
    ctx.strokeStyle = s.tool === "eraser" ? "#ffffff" : (PALETTE[s.color] ?? "#000000");
    ctx.lineWidth = BRUSH_SIZES[s.size] ?? 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p[0]! * CANVAS_W, p[1]! * CANVAS_H);
    if (p.length === 2) ctx.lineTo(p[0]! * CANVAS_W + 0.1, p[1]! * CANVAS_H); // a tap draws a dot
    for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i]! * CANVAS_W, p[i + 1]! * CANVAS_H);
    ctx.stroke();
  }
}
