import { describe, expect, it } from "vitest";
import { RAIL_MAX, RAIL_MIN, RAIL_SLIM, SIDE_GAP, WORD_ROW, escapeClosesPanel, focusInPanel, sidewaysLayout } from "./sideways";

/** The drawer's content box for a viewport: doodle.css pads it 6px left/right, 4px top/bottom. */
const at = (vw: number, vh: number) => sidewaysLayout(vw - 12, vh - 8);

describe("sidewaysLayout", () => {
  it("fills the full height with the word in the rail on long phones", () => {
    for (const [vw, vh] of [[852, 340], [844, 390], [844, 340], [667, 320], [568, 260]] as const) {
      const l = at(vw, vh);
      expect(l.side, `${vw}×${vh}`).toBe("rail");
      expect(l.canvasH, `${vw}×${vh}`).toBeGreaterThanOrEqual(0.85 * vh);
      expect(l.rail).toBeGreaterThanOrEqual(RAIL_MIN);
      expect(l.canvasW + SIDE_GAP + l.rail).toBeLessThanOrEqual(vw - 12);
    }
    expect(at(852, 340)).toMatchObject({ side: "rail", canvasH: 331, rail: 244 });
  });

  it("puts the word above the canvas and slims the rail on 16:9 phones", () => {
    for (const [vw, vh] of [[667, 375], [568, 320]] as const) {
      const l = at(vw, vh);
      expect(l.side, `${vw}×${vh}`).toBe("top");
      expect(l.rail).toBe(RAIL_SLIM);
      expect(l.canvasH + WORD_ROW).toBeLessThanOrEqual(vh - 8);
      expect(l.canvasW + SIDE_GAP + RAIL_SLIM).toBeLessThanOrEqual(vw - 12);
    }
    // 667×375 (iPhone SE): the canvas still takes 88% of the height.
    expect(at(667, 375).canvasH).toBeGreaterThanOrEqual(0.85 * 375);
  });

  it("always picks the arrangement with the bigger canvas", () => {
    for (let vw = 480; vw <= 1000; vw += 7)
      for (let vh = 240; vh <= 500; vh += 11) {
        const l = at(vw, vh);
        // The other arrangement's canvas, worked out independently: never bigger than the chosen one.
        const w = vw - 12, h = vh - 8;
        const otherW = l.side === "rail"
          ? Math.min(w - SIDE_GAP - RAIL_SLIM, (h - WORD_ROW) * 16 / 9)
          : Math.min(w - SIDE_GAP - Math.min(RAIL_MAX, Math.max(RAIL_MIN, w - SIDE_GAP - h * 16 / 9)), h * 16 / 9);
        expect(l.canvasW, `${vw}×${vh}`).toBeGreaterThanOrEqual(Math.floor(otherW) - 1);
        // Neither arrangement may overflow the box.
        expect(l.canvasW + SIDE_GAP + l.rail).toBeLessThanOrEqual(vw - 12 + 0.5);
        expect(l.canvasH + (l.side === "top" ? WORD_ROW : 0)).toBeLessThanOrEqual(vh - 8);
        expect(l.canvasW / Math.max(1, l.canvasH)).toBeCloseTo(16 / 9, 1);
      }
  });

  it("caps the rail and keeps the canvas 16:9", () => {
    const l = sidewaysLayout(1400, 400);
    expect(l.rail).toBe(RAIL_MAX);
    expect(l.canvasH).toBe(400);
    expect(l.canvasW).toBe(711);
  });

  it("never returns negative sizes for a tiny box", () => {
    const l = sidewaysLayout(40, 20);
    expect(l.canvasW).toBeGreaterThanOrEqual(0);
    expect(l.canvasH).toBeGreaterThanOrEqual(0);
  });
});

/** A fake element whose `closest` matches when one of `matches` appears in the selector list. */
const el = (...matches: string[]) => ({
  closest: (sel: string) => (sel.split(",").some((s) => matches.includes(s.trim())) ? {} : null),
});

describe("escapeClosesPanel", () => {
  it("closes on a plain Escape", () => {
    expect(escapeClosesPanel({ key: "Escape", defaultPrevented: false, target: el() })).toBe(true);
    expect(escapeClosesPanel({ key: "Escape", defaultPrevented: false, target: null })).toBe(true);
    expect(escapeClosesPanel({ key: "Escape", defaultPrevented: false, target: {} })).toBe(true); // window/document
  });

  it("ignores other keys", () => {
    expect(escapeClosesPanel({ key: "Enter", defaultPrevented: false, target: el() })).toBe(false);
  });

  it("leaves an Escape that something already handled", () => {
    expect(escapeClosesPanel({ key: "Escape", defaultPrevented: true, target: el() })).toBe(false);
  });

  it("leaves an Escape pressed inside a dialog (e.g. the Players dialog over the panel)", () => {
    for (const m of ["dialog", "[role=dialog]", "[aria-modal=true]"]) {
      expect(escapeClosesPanel({ key: "Escape", defaultPrevented: false, target: el(m) }), m).toBe(false);
    }
  });
});

describe("focusInPanel", () => {
  const button = el();
  const panel = { contains: (n: unknown) => n === button };
  it("is true for focus in the panel or the host bar it carries", () => {
    expect(focusInPanel(button, panel)).toBe(true);
    expect(focusInPanel(el(".host-bar"), panel)).toBe(true);
  });
  it("is false for focus elsewhere, nowhere, or with no panel", () => {
    expect(focusInPanel(el(), panel)).toBe(false);
    expect(focusInPanel(null, panel)).toBe(false);
    expect(focusInPanel(button, null)).toBe(false);
  });
});
