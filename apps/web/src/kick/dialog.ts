/**
 * Open/close a <dialog>, falling back to the `open` attribute where the browser lacks the
 * showModal/close API (older WebViews). The fallback isn't modal, but the content still shows.
 */
export function openModalDialog(d: HTMLDialogElement): void {
  if (d.open) return;
  if (typeof d.showModal === "function") d.showModal();
  else d.setAttribute("open", "");
}

export function closeDialog(d: HTMLDialogElement): void {
  if (!d.open) return;
  if (typeof d.close === "function") d.close();
  else d.removeAttribute("open");
}
