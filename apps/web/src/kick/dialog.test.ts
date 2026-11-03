import { describe, expect, it } from "vitest";
import { closeDialog, openModalDialog } from "./dialog";

type FakeDialog = { open: boolean; attrs: Record<string, string>; showModal?: () => void; close?: () => void;
  setAttribute(n: string, v: string): void; removeAttribute(n: string): void };

function fake(withApi: boolean): FakeDialog & { calls: string[] } {
  const calls: string[] = [];
  const d: FakeDialog & { calls: string[] } = {
    open: false, attrs: {}, calls,
    setAttribute(n, v) { this.attrs[n] = v; if (n === "open") this.open = true; },
    removeAttribute(n) { delete this.attrs[n]; if (n === "open") this.open = false; },
  };
  if (withApi) {
    d.showModal = () => { calls.push("showModal"); d.open = true; };
    d.close = () => { calls.push("close"); d.open = false; };
  }
  return d;
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

  it("fall back to the open attribute without the <dialog> API", () => {
    const d = fake(false);
    openModalDialog(d as unknown as HTMLDialogElement);
    expect(d.attrs.open).toBe("");
    closeDialog(d as unknown as HTMLDialogElement);
    expect(d.attrs.open).toBeUndefined();
    expect(d.open).toBe(false);
  });
});
