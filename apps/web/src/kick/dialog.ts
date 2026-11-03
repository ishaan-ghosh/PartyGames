/**
 * Open/close a <dialog>, falling back to the `open` attribute where the browser lacks the
 * showModal/close API (older WebViews). The fallback is made modal enough by hand: `data-fallback`
 * styles it as a full-screen overlay (its own backdrop), and every sibling of the dialog and of each
 * of its ancestors up to <body> gets the `inert` attribute (see inertOutside), removed again on
 * close. WebViews that lack <dialog> may lack `inert` too, so Modal also traps Tab in the fallback,
 * and adds Escape/Back handling and initial focus.
 *
 * The fallback branches check the `open` attribute, not `d.open`: without <dialog> support the
 * element is a plain HTMLUnknownElement and has no `open` property.
 */
const fallbackRestore = new WeakMap<HTMLDialogElement, () => void>();

export function openModalDialog(d: HTMLDialogElement): void {
  if (typeof d.showModal === "function") {
    if (!d.open) d.showModal();
    return;
  }
  if (d.hasAttribute("open")) return;
  d.setAttribute("open", "");
  d.setAttribute("data-fallback", "");
  fallbackRestore.set(d, inertOutside(d));
}

export function closeDialog(d: HTMLDialogElement): void {
  if (typeof d.close === "function") {
    if (d.open) d.close();
    return;
  }
  if (!d.hasAttribute("open")) return;
  d.removeAttribute("open");
  d.removeAttribute("data-fallback");
  fallbackRestore.get(d)?.();
  fallbackRestore.delete(d);
}

/**
 * Makes everything outside `el` inert: every sibling of `el` and of each of its ancestors up to
 * <body>. Returns a restore that un-inerts only what it changed.
 */
export function inertOutside(el: Element): () => void {
  const changed: Element[] = [];
  let node: Element = el;
  for (let parent = node.parentElement; parent; node = parent, parent = parent.parentElement) {
    for (const sib of Array.from(parent.children)) {
      if (sib !== node && !sib.hasAttribute("inert")) {
        sib.setAttribute("inert", "");
        changed.push(sib);
      }
    }
    if (parent.tagName === "BODY") break;
  }
  return () => {
    for (const e of changed) e.removeAttribute("inert");
    changed.length = 0;
  };
}

/** Back keyCodes on TV platforms whose `key` may be "Unidentified": Tizen (Samsung) and webOS (LG). */
const TIZEN_BACK = 10009;
const WEBOS_BACK = 461;

/**
 * Keys that close a dialog: Escape, plus what TV browsers and remotes send for Back (BrowserBack,
 * GoBack, Tizen's XF86Back / keyCode 10009, webOS's keyCode 461). Backspace counts only outside
 * text fields, where it would otherwise delete text.
 */
export function isCloseKey(key: string, inTextField: boolean, keyCode?: number): boolean {
  if (key === "Escape" || key === "Esc" || key === "BrowserBack" || key === "GoBack" || key === "XF86Back") return true;
  if (keyCode === TIZEN_BACK || keyCode === WEBOS_BACK) return true;
  return key === "Backspace" && !inTextField;
}

/**
 * What a modal does with a keydown: "close" it, "swallow" it (a close key held down: auto-repeats
 * must not close the dialogs underneath one by one, nor fall through to Back navigation), or
 * "ignore" it.
 */
export function closeKeyAction(
  e: { key: string; keyCode?: number; repeat?: boolean; defaultPrevented?: boolean },
  inTextField: boolean,
): "close" | "swallow" | "ignore" {
  if (e.defaultPrevented || !isCloseKey(e.key, inTextField, e.keyCode)) return "ignore";
  return e.repeat ? "swallow" : "close";
}

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || "text").toLowerCase());
}

/**
 * Tab trap: where focus should go for a Tab (or Shift+Tab) press, or null to let the browser move
 * it normally within the dialog. Wraps at either end and pulls stray focus back in.
 */
export function trapTab<T>(focusables: T[], active: T | null, shift: boolean): T | null {
  if (focusables.length === 0) return null;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const i = active === null ? -1 : focusables.indexOf(active);
  if (i === -1) return shift ? last : first;
  if (shift && i === 0) return last;
  if (!shift && i === focusables.length - 1) return first;
  return null;
}

type StyleHost = { style: Record<string, string> | CSSStyleDeclaration };
type ScrollWindow = { scrollX: number; scrollY: number; scrollTo(x: number, y: number): void };

let locks = 0;
let restoreScroll: (() => void) | null = null;

/**
 * Stops the page behind a modal from scrolling; nested locks share one. `overflow: hidden` covers
 * desktop browsers; pinning <body> with `position: fixed` at the current offset covers iOS Safari,
 * which ignores overflow for touch scrolling. The returned unlock restores the previous inline
 * styles and scroll position (and is safe to call twice).
 */
export function lockScroll(doc: { documentElement: StyleHost; body: StyleHost }, win: ScrollWindow): () => void {
  if (locks++ === 0) {
    const html = doc.documentElement.style as Record<string, string>;
    const body = doc.body.style as Record<string, string>;
    const keys = ["overflow", "position", "top", "left", "right", "width"] as const;
    const saved = { html: html.overflow ?? "", body: Object.fromEntries(keys.map((k) => [k, body[k] ?? ""])) };
    const { scrollX: x, scrollY: y } = win;
    html.overflow = "hidden";
    Object.assign(body, { overflow: "hidden", position: "fixed", top: `-${y}px`, left: "0", right: "0", width: "100%" });
    restoreScroll = () => {
      html.overflow = saved.html;
      Object.assign(body, saved.body);
      win.scrollTo(x, y);
    };
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--locks === 0) {
      restoreScroll?.();
      restoreScroll = null;
    }
  };
}
