import { useEffect, useRef, type ReactNode } from "react";
import { closeDialog, openModalDialog } from "./dialog";
import "./kick.css";

/**
 * A modal <dialog> (top layer, inert page behind it). Mount it to open, unmount to close.
 * Focus moves to the first `[data-autofocus]` element (or the first button) on open and whenever
 * `focusKey` changes; on unmount it returns to whatever had focus before. Escape and a click on the
 * backdrop call `onClose`.
 */
export function Modal({ labelledBy, onClose, focusKey, className = "", children }: {
  labelledBy: string;
  onClose(): void;
  focusKey?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openModalDialog(d);
    return () => {
      closeDialog(d);
      // The trigger may be gone (e.g. the kicked player's chip); then focus falls back to the page.
      if (prev?.isConnected) prev.focus();
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
        onCloseRef.current();
      }}
      // If the browser closes the dialog itself (e.g. a repeated Escape), keep React in sync. The
      // `open` check ignores the late close event from a StrictMode unmount/remount.
      onClose={() => {
        if (!ref.current?.open) onCloseRef.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current(); // the backdrop
      }}
    >
      <div className="modal-body card">{children}</div>
    </dialog>
  );
}
