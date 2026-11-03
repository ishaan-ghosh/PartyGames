import { describe, expect, it } from "vitest";
import { closeDialog, closeKeyAction, inertOutside, isCloseKey, isTextField, lockScroll, openModalDialog, trapTab } from "./dialog";

type FakeDialog = { open?: boolean; attrs: Record<string, string>; showModal?: () => void; close?: () => void;
  hasAttribute(n: string): boolean; setAttribute(n: string, v: string): void; removeAttribute(n: string): void };

/**
 * With the API, a real HTMLDialogElement (`open` reflects the attribute). Without it, like a
 * browser lacking <dialog>: a plain element with no `open` property at all.
 */
function fake(withApi: boolean): FakeDialog & { calls: string[] } {
  const calls: string[] = [];
  const d: FakeDialog & { calls: string[] } = {
    attrs: {}, calls,
    hasAttribute(n) { return n in this.attrs; },
    setAttribute(n, v) { this.attrs[n] = v; if (withApi && n === "open") this.open = true; },
    removeAttribute(n) { delete this.attrs[n]; if (withApi && n === "open") this.open = false; },
  };
  if (withApi) {
    d.open = false;
    d.showModal = () => { calls.push("showModal"); d.open = true; };
    d.close = () => { calls.push("close"); d.open = false; };
  }
  return d;
}

/** A minimal element tree: just what inertOutside walks. */
type Node = { tagName: string; parentElement: Node | null; children: Node[]; attrs: Record<string, string>;
  hasAttribute(n: string): boolean; setAttribute(n: string, v: string): void; removeAttribute(n: string): void };
function el(tagName: string, children: Node[] = [], attrs: Record<string, string> = {}): Node {
  const n: Node = {
    tagName, parentElement: null, children, attrs,
    hasAttribute(a) { return a in this.attrs; },
    setAttribute(a, v) { this.attrs[a] = v; },
    removeAttribute(a) { delete this.attrs[a]; },
  };
  for (const c of children) c.parentElement = n;
  return n;
}

describe("dialog helpers", () => {
  it("use showModal/close when the browser has them", () => {
    const d = fake(true);
    openModalDialog(d as unknown as HTMLDialogElement);
    expect(d.open).toBe(true);
    openModalDialog(d as unknown as HTMLDialogElement); // already open: no second showModal (it would throw)
    closeDialog(d as unknown as HTMLDialogElement);
    expect(d.calls).toEqual(["showModal", "close"]);
    expect(d.open).toBe(false);
  });

  it("fall back to the open attribute without the <dialog> API, marked for the modal fallback styles", () => {
    const d = fake(false);
    openModalDialog(d as unknown as HTMLDialogElement);
    expect(d.attrs.open).toBe("");
    expect(d.attrs["data-fallback"]).toBe("");
    closeDialog(d as unknown as HTMLDialogElement);
    expect(d.attrs.open).toBeUndefined();
    expect(d.attrs["data-fallback"]).toBeUndefined();
    expect(d.open).toBeUndefined();
  });

  it("open and close the fallback only once each", () => {
    const d = fake(false);
    const attrs: string[] = [];
    const set = d.setAttribute.bind(d);
    d.setAttribute = (n, v) => { attrs.push(n); set(n, v); };
    openModalDialog(d as unknown as HTMLDialogElement);
    openModalDialog(d as unknown as HTMLDialogElement); // already open: not re-inerted
    expect(attrs).toEqual(["open", "data-fallback"]);
    closeDialog(d as unknown as HTMLDialogElement);
    closeDialog(d as unknown as HTMLDialogElement); // already closed: no-op
    expect(d.attrs).toEqual({});
  });

  it("make the fallback modal: the page outside the dialog goes inert until it closes", () => {
    const dialog = el("DIALOG");
    const chips = el("DIV");
    const panel = el("SECTION", [chips, dialog]);
    const bg = el("CANVAS");
    const root = el("DIV", [bg, panel]);
    const mute = el("BUTTON");
    el("BODY", [root, mute]);
    const d = Object.assign(dialog, fake(false), { attrs: dialog.attrs, hasAttribute: dialog.hasAttribute });
    openModalDialog(d as unknown as HTMLDialogElement);
    expect([chips, bg, mute].map((n) => n.hasAttribute("inert"))).toEqual([true, true, true]);
    expect([dialog, panel, root].map((n) => n.hasAttribute("inert"))).toEqual([false, false, false]);
    closeDialog(d as unknown as HTMLDialogElement);
    expect([chips, bg, mute].map((n) => n.hasAttribute("inert"))).toEqual([false, false, false]);
  });
});

describe("inertOutside", () => {
  it("leaves already-inert elements inert after restoring", () => {
    const target = el("DIALOG");
    const other = el("DIV", [], { inert: "" });
    const sib = el("DIV");
    el("BODY", [el("DIV", [target, other]), sib]);
    const restore = inertOutside(target as unknown as Element);
    expect(sib.hasAttribute("inert")).toBe(true);
    restore();
    expect(sib.hasAttribute("inert")).toBe(false);
    expect(other.hasAttribute("inert")).toBe(true);
  });
});

describe("isCloseKey", () => {
  it("treats Escape and TV-remote Back keys as close", () => {
    for (const k of ["Escape", "Esc", "BrowserBack", "GoBack"]) expect(isCloseKey(k, false)).toBe(true);
    expect(isCloseKey("Escape", true)).toBe(true);
  });
  it("treats Backspace as Back only outside text fields", () => {
    expect(isCloseKey("Backspace", false)).toBe(true);
    expect(isCloseKey("Backspace", true)).toBe(false);
  });
  it("treats Tizen and webOS Back as close, by key or keyCode", () => {
    expect(isCloseKey("XF86Back", false)).toBe(true);
    expect(isCloseKey("Unidentified", false, 10009)).toBe(true); // Tizen
    expect(isCloseKey("Unidentified", true, 461)).toBe(true); // webOS
  });
  it("ignores other keys", () => {
    for (const k of ["Enter", " ", "Tab", "ArrowLeft", "Delete", "b"]) expect(isCloseKey(k, false)).toBe(false);
    expect(isCloseKey("Unidentified", false, 13)).toBe(false);
  });
});

describe("closeKeyAction", () => {
  it("closes on a fresh close-key press", () => {
    expect(closeKeyAction({ key: "Escape" }, false)).toBe("close");
    expect(closeKeyAction({ key: "Unidentified", keyCode: 461, repeat: false }, false)).toBe("close");
  });
  it("swallows auto-repeats of a held Back key, so it can't close the whole dialog stack", () => {
    expect(closeKeyAction({ key: "Escape", repeat: true }, false)).toBe("swallow");
    expect(closeKeyAction({ key: "BrowserBack", repeat: true }, false)).toBe("swallow");
  });
  it("ignores other keys, handled events and Backspace in a text field", () => {
    expect(closeKeyAction({ key: "Enter" }, false)).toBe("ignore");
    expect(closeKeyAction({ key: "Escape", defaultPrevented: true }, false)).toBe("ignore");
    expect(closeKeyAction({ key: "Backspace", repeat: true }, true)).toBe("ignore");
  });
});

describe("isTextField", () => {
  const e = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as Element;
  it("spots places where Backspace edits text", () => {
    expect(isTextField(e("TEXTAREA"))).toBe(true);
    expect(isTextField(e("INPUT", { type: "text" }))).toBe(true);
    expect(isTextField(e("INPUT", { type: "search" }))).toBe(true);
    expect(isTextField(e("DIV", { isContentEditable: true }))).toBe(true);
  });
  it("does not count buttons, checkboxes or nothing", () => {
    expect(isTextField(e("BUTTON"))).toBe(false);
    expect(isTextField(e("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTextField(e("INPUT", { type: "range" }))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe("trapTab", () => {
  const [a, b, c] = ["a", "b", "c"];
  it("wraps from the last to the first and back", () => {
    expect(trapTab([a, b, c], c, false)).toBe(a);
    expect(trapTab([a, b, c], a, true)).toBe(c);
  });
  it("lets the browser move focus inside the dialog", () => {
    expect(trapTab([a, b, c], a, false)).toBeNull();
    expect(trapTab([a, b, c], c, true)).toBeNull();
  });
  it("pulls focus back in when it is outside the dialog", () => {
    expect(trapTab([a, b, c], "x", false)).toBe(a);
    expect(trapTab([a, b, c], null, true)).toBe(c);
  });
  it("has nothing to do in an empty dialog", () => {
    expect(trapTab([], null, false)).toBeNull();
  });
});

describe("lockScroll", () => {
  function page(scrollY: number) {
    const html = { style: { overflow: "" } as Record<string, string> };
    const body = { style: { overflow: "auto", position: "", top: "", left: "", right: "", width: "" } as Record<string, string> };
    const scrolls: number[][] = [];
    const win = { scrollX: 0, scrollY, scrollTo(x: number, y: number) { scrolls.push([x, y]); } };
    return { doc: { documentElement: html, body }, win, html, body, scrolls };
  }

  it("pins the page where it was and restores it exactly", () => {
    const p = page(240);
    const unlock = lockScroll(p.doc, p.win);
    expect(p.html.style.overflow).toBe("hidden");
    expect(p.body.style).toMatchObject({ overflow: "hidden", position: "fixed", top: "-240px", width: "100%" });
    unlock();
    expect(p.html.style.overflow).toBe("");
    expect(p.body.style).toMatchObject({ overflow: "auto", position: "", top: "", width: "" });
    expect(p.scrolls).toEqual([[0, 240]]);
  });

  it("nests: only the last unlock restores", () => {
    const p = page(0);
    const u1 = lockScroll(p.doc, p.win);
    const u2 = lockScroll(p.doc, p.win);
    u2();
    expect(p.body.style.overflow).toBe("hidden");
    u1();
    expect(p.body.style.overflow).toBe("auto");
    u1(); // a repeated unlock is a no-op
    expect(p.body.style.overflow).toBe("auto");
  });
});

