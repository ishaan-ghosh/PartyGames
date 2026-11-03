import { useEffect, useRef, type ReactNode } from "react";
import { closeDialog, closeKeyAction, isTextField, lockScroll, openModalDialog, returnFocusTarget, trapTab } from "./dialog";
import "./kick.css";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal <dialog> (top layer, inert page behind it). Mount it to open, unmount to close.
 * Focus moves to the first `[data-autofocus]` element (or the first button) on open and whenever
 * `focusKey` changes; on unmount it returns to `returnFocus` (the element that opened it: Safari
 * doesn't focus a clicked button), else to whatever had focus before. Escape, a TV remote's
 * Back key (see isCloseKey; Backspace only outside a text field) and a click on the backdrop call
 * `onClose`; auto-repeats of a held key are swallowed, not treated as more presses. The page behind doesn't scroll while it's open. Without the <dialog> API the fallback
 * still traps Tab inside (see dialog.ts).
 */
export function Modal({ labelledBy, onClose, focusKey, returnFocus, className = "", children }: {
  labelledBy: string;
  onClose(): void;
  focusKey?: string;
  /** Where focus goes on close, if still in the page; read at close time. */
  returnFocus?: HTMLElement | null;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;
  // Set when a key press already closed (or stepped back); the dialog's own `cancel` for that same
  // press must not close a second time.
  const handledKey = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockScroll(document, window);
    openModalDialog(d);
    // Capture, so a game's own key handlers don't see Back/Escape meant for the dialog. Only while
    // the dialog is open: history and Backspace behave normally otherwise.
    const onKey = (e: KeyboardEvent) => {
      const action = closeKeyAction(e, isTextField(document.activeElement));
      if (action === "ignore") return;
      e.preventDefault(); // no native cancel, no Back navigation
      e.stopPropagation();
      // A held Back/Escape auto-repeats: only the first press closes, so it can't unwind the stack.
      if (action === "swallow") return;
      handledKey.current = true;
      setTimeout(() => (handledKey.current = false), 0);
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      closeDialog(d);
      unlock();
      // The trigger may be gone (e.g. the kicked player's chip); then focus falls back to the page.
      returnFocusTarget(returnFocusRef.current, prev)?.focus();
    };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    (d.querySelector<HTMLElement>("[data-autofocus]") ?? d.querySelector<HTMLElement>("button"))?.focus();
  }, [focusKey]);

  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        if (!handledKey.current) onCloseRef.current();
      }}
      // If the browser closes the dialog itself (e.g. a repeated Escape), keep React in sync. The
      // `open` check ignores the late close event from a StrictMode unmount/remount.
      onClose={() => {
        if (!ref.current?.open) onCloseRef.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current(); // the backdrop
      }}
      onKeyDown={(e) => {
        // Native modal dialogs already keep focus in the page; the fallback needs a trap.
        const d = e.currentTarget;
        if (e.key !== "Tab" || !d.hasAttribute("data-fallback")) return;
        const next = trapTab(Array.from(d.querySelectorAll<HTMLElement>(FOCUSABLE)), document.activeElement as HTMLElement | null, e.shiftKey);
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }}
    >
      <div className="modal-body card">{children}</div>
    </dialog>
  );
}
