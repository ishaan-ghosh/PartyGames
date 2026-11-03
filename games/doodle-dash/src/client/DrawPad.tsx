import { useEffect, useId, useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from "react";
import { BRUSH_SIZES, PALETTE, type DoodleAction, type Stroke } from "../rules";
import { CanvasView } from "./CanvasView";
import { DebugOverlay, useDebugDraw } from "./debugDraw";
import { SIDEWAYS_QUERY, escapeClosesPanel, focusInPanel } from "./sideways";
import { chunkPoints, fillBadge, fillsRemaining, firstStrokeKey, nextStrokeKey, normalizePoint } from "./strokes";
import type { ActivityRef } from "./useStrokes";

type Tool = "pen" | "eraser" | "fill";
const TOOLS: { tool: Tool; icon: string; label: string }[] = [
  { tool: "pen", icon: "✏️", label: "Pen" },
  { tool: "eraser", icon: "🧽", label: "Eraser" },
  { tool: "fill", icon: "🪣", label: "Fill" },
];
/** Spoken names for PALETTE, in the same order. */
const COLOR_NAMES = ["Black", "White", "Gray", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Brown"];
const SIZE_NAMES = ["small", "medium", "large"];
const TOOL_ICON: Record<Tool, string> = { pen: "✏️", eraser: "🧽", fill: "🪣" };
const BATCH_MS = 40;
const NO_OVERSCROLL = "dd-no-overscroll";

const isSideways = () => typeof matchMedia !== "undefined" && matchMedia(SIDEWAYS_QUERY).matches;

/** Stable send/flush/end helpers; they only touch refs, so timers and listeners can hold them. */
interface PadIO {
  send(action: DoodleAction): void;
  flush(): void;
  end(): void;
}

export function DrawPad({ strokes, setStrokes, send, activity, fillsLeft: serverFillsLeft }: {
  strokes: Stroke[];
  setStrokes: Dispatch<SetStateAction<Stroke[]>>;
  send(action: DoodleAction): void;
  /** Shared with useStrokes so it only resyncs from the server while the pad is idle. */
  activity: ActivityRef;
  /** The view's `fillsLeft` (stale while drawing; see fillsRemaining). */
  fillsLeft?: number;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(0);
  const [size, setSize] = useState(1);
  // The pull-out colours/tools panel of the sideways layout. Upright, CSS always shows the tools
  // inline and ignores this, so closing it after a pick there is harmless.
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Set when the toggle opens the panel from the keyboard: focus then moves to its first control.
  const focusPanel = useRef(false);
  const debug = useDebugDraw();
  const [fillsSent, setFillsSent] = useState(0); // this pad is mounted for one drawing turn
  const fillsLeft = fillsRemaining(serverFillsLeft, fillsSent);
  const fillsBadge = fillBadge(fillsLeft);
  const pointer = useRef<number | null>(null); // the one pointer currently drawing
  const pending = useRef<number[]>([]);
  const last = useRef<[number, number]>([0, 0]);
  const localId = useRef(-1); // negative ids never collide with server ids
  // The id sent with strokeBegin and every strokeAppend of the current stroke, so the server
  // can refuse appends whose begin was lost. Not the local (negative) or server stroke id.
  const strokeKey = useRef<number | null>(null);
  // The parent passes a fresh `send` every render; keep the batching timer independent of that.
  const sendRef = useRef(send);
  sendRef.current = send;

  const io: PadIO = useRef<PadIO>({
    send(action: DoodleAction) {
      activity.current.lastSendAt = Date.now();
      sendRef.current(action);
    },
    flush() {
      if (pending.current.length) {
        const batches = chunkPoints(pending.current);
        pending.current = [];
        const id = strokeKey.current;
        if (id !== null) for (const points of batches) io.send({ t: "strokeAppend", id, points });
      }
      activity.current.pendingPoints = 0;
    },
    /** End the current stroke, if any. Also used when pointer-up never arrives (blur, tab hidden). */
    end() {
      pointer.current = null;
      activity.current.drawing = false;
      io.flush();
    },
  }).current;

  useEffect(() => {
    const id = setInterval(io.flush, BATCH_MS);
    const hidden = () => {
      if (document.visibilityState === "hidden") io.end();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", io.end);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", io.end);
      io.end();
    };
  }, [io]);

  // Out of fills: drop back to the pen so the next tap draws instead of doing nothing.
  useEffect(() => {
    if (tool === "fill" && fillsLeft <= 0) setTool("pen");
  }, [tool, fillsLeft]);

  // No pull-to-refresh or rubber-band scrolling on the page while this pad is on screen.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(NO_OVERSCROLL);
    return () => root.classList.remove(NO_OVERSCROLL);
  }, []);

  /**
   * Close the pull-out panel. Sideways, the closed panel and the host bar it carries are
   * display: none, so focus inside them would drop to <body>: hand it back to the toggle.
   */
  const closePanel = () => {
    setPanelOpen(false);
    if (isSideways() && focusInPanel(document.activeElement, panelRef.current)) toggleRef.current?.focus();
  };
  const closeRef = useRef(closePanel);
  closeRef.current = closePanel;

  // Opened from the keyboard: focus its first control. (A tap leaves focus alone.)
  useEffect(() => {
    if (!panelOpen || !focusPanel.current) return;
    focusPanel.current = false;
    if (isSideways()) panelRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [panelOpen]);

  // Escape closes the pull-out panel, but not when it closes a dialog opened over it.
  useEffect(() => {
    if (!panelOpen) return;
    const key = (e: KeyboardEvent) => {
      if (escapeClosesPanel(e)) closeRef.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [panelOpen]);

  const pos = (e: PointerEvent<HTMLCanvasElement>) => normalizePoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    debug?.record(e);
    if (panelOpen && pointer.current === null) {
      closePanel();
      // A tap on the drawing while the panel is out just closes it, like tapping outside a menu.
      // (Upright the panel is the inline tool rows and always shown: draw as usual.)
      if (isSideways()) {
        e.preventDefault();
        return;
      }
    }
    if (pointer.current !== null) {
      // A second finger is ignored. A new primary pointer means every earlier pointer is up,
      // so a stroke still marked active lost its pointer-up: end it and carry on.
      if (!e.isPrimary) return;
      io.end();
    }
    e.preventDefault();
    io.flush();
    const [x, y] = pos(e);
    if (tool === "fill") {
      if (fillsLeft <= 0) return; // the server would refuse it
      setFillsSent((n) => n + 1);
      io.send({ t: "fill", color, x, y });
      setStrokes((s) => [...s, { id: localId.current--, tool: "fill", color, x, y }]);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointer.current = e.pointerId;
    activity.current.drawing = true;
    last.current = [x, y];
    const id = localId.current--;
    const key = strokeKey.current === null ? firstStrokeKey() : nextStrokeKey(strokeKey.current);
    strokeKey.current = key;
    io.send({ t: "strokeBegin", id: key, tool, color, size, points: [x, y] });
    setStrokes((s) => [...s, { id, tool, color, size, points: [x, y] }]);
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== e.pointerId) return;
    const [x, y] = pos(e);
    if (Math.hypot(x - last.current[0], y - last.current[1]) < 0.002) return;
    last.current = [x, y];
    pending.current.push(x, y);
    activity.current.pendingPoints = pending.current.length;
    setStrokes((s) => {
      const tail = s.at(-1);
      if (!tail || tail.tool === "fill") return s;
      return [...s.slice(0, -1), { ...tail, points: [...tail.points, x, y] }];
    });
  };

  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current === e.pointerId) io.end();
  };

  const edit = (action: DoodleAction, local: (s: Stroke[]) => Stroke[]) => {
    io.end();
    io.send(action);
    setStrokes(local);
  };

  const pickColor = (i: number) => {
    setColor(i);
    if (tool === "eraser") setTool("pen");
    closePanel();
  };
  const pickTool = (t: Tool) => {
    setTool(t);
    closePanel();
  };
  const undo = () => edit({ t: "undo" }, (s) => s.slice(0, -1));

  return (
    <div className="dd-pad">
      <div className="dd-canvas-cell">
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
        {debug && <DebugOverlay info={debug.info} />}
      </div>
      {/* Sideways only (doodle.css): the rail's quick controls. Not shown upright. */}
      <div className="dd-rail-btns">
        <button
          type="button"
          className={`dd-tool dd-tools-toggle${panelOpen ? " on" : ""}`}
          data-testid="tools-toggle"
          aria-label="Colours and tools"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          ref={toggleRef}
          onClick={(e) => {
            // detail 0: activated by Enter/Space (or assistive tech), not a pointer.
            if (!panelOpen) focusPanel.current = e.detail === 0;
            setPanelOpen(!panelOpen);
          }}
        >
          {panelOpen ? (
            <span aria-hidden>✕</span>
          ) : (
            <span aria-hidden className="dd-toggle-swatch" style={{ background: tool === "eraser" ? "#ffffff" : PALETTE[color] }}>
              {TOOL_ICON[tool]}
            </span>
          )}
        </button>
        <button type="button" className="dd-tool" aria-label="Undo" onClick={undo}>
          <span aria-hidden>↩️</span>
        </button>
      </div>
      {/* Upright: the palette and tool rows under the canvas. Sideways: the pull-out panel. */}
      <div className="dd-tools" id={panelId} ref={panelRef} data-open={panelOpen || undefined} data-testid="tools-panel">
        <div className="dd-palette" role="radiogroup" aria-label="Color">
          {PALETTE.map((c, i) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === i}
              aria-label={COLOR_NAMES[i] ?? `Color ${i + 1}`}
              className={`dd-swatch ${color === i ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => pickColor(i)}
            />
          ))}
        </div>
        <div className="dd-toolrow">
          {TOOLS.map(({ tool: t, icon, label }) => {
            const isFill = t === "fill";
            const usedUp = isFill && fillsLeft <= 0;
            const badge = isFill ? fillsBadge : null;
            return (
              <button
                key={t}
                type="button"
                aria-label={badge === null ? label : `${label}, ${fillsLeft} left`}
                title={isFill ? (usedUp ? "No fills left this turn" : badge !== null ? `${fillsLeft} fills left` : undefined) : undefined}
                aria-pressed={tool === t}
                aria-disabled={usedUp || undefined}
                disabled={usedUp}
                className={`dd-tool ${tool === t ? "on" : ""}${badge !== null ? " dd-tool-counted" : ""}`}
                onClick={() => {
                  if (!usedUp) pickTool(t);
                }}
              >
                <span aria-hidden>{icon}</span>
                {badge !== null && <span className="dd-tool-badge" aria-hidden data-testid="fill-count">{badge}</span>}
              </button>
            );
          })}
          <button
            type="button"
            className="dd-size"
            aria-label={`Brush size: ${SIZE_NAMES[size] ?? size + 1}. Tap to change.`}
            onClick={() => setSize((s) => (s + 1) % BRUSH_SIZES.length)}
          >
            <span aria-hidden style={{ width: 6 + size * 7, height: 6 + size * 7 }} />
          </button>
          <button type="button" className="dd-tool" aria-label="Undo" onClick={undo}>
            <span aria-hidden>↩️</span>
          </button>
          <button
            type="button"
            className="dd-tool"
            aria-label="Clear"
            onClick={() => {
              edit({ t: "clear" }, () => []);
              closePanel();
            }}
          >
            <span aria-hidden>🗑️</span>
          </button>
        </div>
      </div>
    </div>
  );
}
