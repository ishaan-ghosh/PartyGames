import { useEffect, useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from "react";
import { BRUSH_SIZES, PALETTE, type DoodleAction, type Stroke } from "../rules";
import { CanvasView } from "./CanvasView";
import { chunkPoints, normalizePoint } from "./strokes";

type Tool = "pen" | "eraser" | "fill";
const TOOLS: { tool: Tool; icon: string; label: string }[] = [
  { tool: "pen", icon: "✏️", label: "Pen" },
  { tool: "eraser", icon: "🧽", label: "Eraser" },
  { tool: "fill", icon: "🪣", label: "Fill" },
];
const BATCH_MS = 40;
const NO_OVERSCROLL = "dd-no-overscroll";

export function DrawPad({ strokes, setStrokes, send }: {
  strokes: Stroke[];
  setStrokes: Dispatch<SetStateAction<Stroke[]>>;
  send(action: DoodleAction): void;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(0);
  const [size, setSize] = useState(1);
  const pointer = useRef<number | null>(null); // the one pointer currently drawing
  const pending = useRef<number[]>([]);
  const last = useRef<[number, number]>([0, 0]);
  const localId = useRef(-1); // negative ids never collide with server ids
  // The parent passes a fresh `send` every render; keep the batching timer independent of that.
  const sendRef = useRef(send);
  sendRef.current = send;

  const flush = useRef(() => {
    if (!pending.current.length) return;
    const batches = chunkPoints(pending.current);
    pending.current = [];
    for (const points of batches) sendRef.current({ t: "strokeAppend", points });
  }).current;

  useEffect(() => {
    const id = setInterval(flush, BATCH_MS);
    return () => {
      clearInterval(id);
      flush();
    };
  }, [flush]);

  // No pull-to-refresh or rubber-band scrolling on the page while this pad is on screen.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(NO_OVERSCROLL);
    return () => root.classList.remove(NO_OVERSCROLL);
  }, []);

  const pos = (e: PointerEvent<HTMLCanvasElement>) => normalizePoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    flush();
    const [x, y] = pos(e);
    if (tool === "fill") {
      send({ t: "fill", color, x, y });
      setStrokes((s) => [...s, { id: localId.current--, tool: "fill", color, x, y }]);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointer.current = e.pointerId;
    last.current = [x, y];
    const id = localId.current--;
    send({ t: "strokeBegin", tool, color, size, points: [x, y] });
    setStrokes((s) => [...s, { id, tool, color, size, points: [x, y] }]);
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== e.pointerId) return;
    const [x, y] = pos(e);
    if (Math.hypot(x - last.current[0], y - last.current[1]) < 0.002) return;
    last.current = [x, y];
    pending.current.push(x, y);
    setStrokes((s) => {
      const tail = s.at(-1);
      if (!tail || tail.tool === "fill") return s;
      return [...s.slice(0, -1), { ...tail, points: [...tail.points, x, y] }];
    });
  };

  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    flush();
  };

  const edit = (action: DoodleAction, local: (s: Stroke[]) => Stroke[]) => {
    if (pointer.current !== null) return;
    flush();
    send(action);
    setStrokes(local);
  };

  return (
    <div className="dd-pad">
      <CanvasView
        strokes={strokes}
        testId="draw-canvas"
        className="dd-canvas-draw"
        label="Your drawing"
        blockTouch
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
      />
      <div className="dd-tools">
        <div className="dd-palette" role="radiogroup" aria-label="Color">
          {PALETTE.map((c, i) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === i}
              aria-label={`Color ${i + 1}`}
              className={`dd-swatch ${color === i ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => {
                setColor(i);
                if (tool === "eraser") setTool("pen");
              }}
            />
          ))}
        </div>
        <div className="dd-toolrow">
          {TOOLS.map(({ tool: t, icon, label }) => (
            <button key={t} type="button" aria-label={label} aria-pressed={tool === t} className={`dd-tool ${tool === t ? "on" : ""}`} onClick={() => setTool(t)}>
              <span aria-hidden>{icon}</span>
            </button>
          ))}
          {BRUSH_SIZES.map((px, i) => (
            <button key={px} type="button" aria-label={`Brush size ${i + 1}`} aria-pressed={size === i} className={`dd-size ${size === i ? "on" : ""}`} onClick={() => setSize(i)}>
              <span aria-hidden style={{ width: 6 + i * 7, height: 6 + i * 7 }} />
            </button>
          ))}
          <button type="button" className="dd-tool" aria-label="Undo" onClick={() => edit({ t: "undo" }, (s) => s.slice(0, -1))}>
            <span aria-hidden>↩️</span>
          </button>
          <button type="button" className="dd-tool" aria-label="Clear" onClick={() => edit({ t: "clear" }, () => [])}>
            <span aria-hidden>🗑️</span>
          </button>
        </div>
      </div>
    </div>
  );
}
