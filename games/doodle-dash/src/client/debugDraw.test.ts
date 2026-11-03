import { describe, expect, it } from "vitest";
import { debugDrawEnabled, debugLines } from "./debugDraw";

describe("debugdraw flag", () => {
  it("is off unless the URL asks for it", () => {
    expect(debugDrawEnabled("")).toBe(false);
    expect(debugDrawEnabled("?foo=1")).toBe(false);
    expect(debugDrawEnabled("?debugdraw=0")).toBe(false);
    expect(debugDrawEnabled("?debugdraw=1")).toBe(true);
    expect(debugDrawEnabled("?x=2&debugdraw=1")).toBe(true);
  });

  it("prints the pointer, canvas rect, scroll and visual viewport numbers", () => {
    const lines = debugLines({
      clientX: 100.25, clientY: 200, rectLeft: 8, rectTop: 40.5, rectW: 604, rectH: 340,
      cellX: 92, cellY: 160, scrollY: 0, vvTop: 12, vvLeft: 0, vvScale: 1, innerH: 340,
    });
    expect(lines.join("\n")).toContain("client x 100.3 y 200.0");
    expect(lines.join("\n")).toContain("canvas left 8.0 top 40.5 604×340");
    expect(lines.join("\n")).toContain("vv top 12.0 left 0.0 scale 1.000");
  });

  it("shows a dash where there is no visual viewport", () => {
    const l = debugLines({
      clientX: 0, clientY: 0, rectLeft: 0, rectTop: 0, rectW: 1, rectH: 1,
      cellX: 0, cellY: 0, scrollY: 0, vvTop: null, vvLeft: null, vvScale: null, innerH: 1,
    });
    expect(l[3]).toBe("vv top – left – scale –");
  });
});
