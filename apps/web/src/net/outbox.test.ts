import { describe, expect, it } from "vitest";
import { LOOSE_LIMIT, Outbox } from "./outbox";

const collect = () => {
  const sent: string[] = [];
  return { sent, transmit: (m: string) => (sent.push(m), true) };
};

describe("Outbox", () => {
  it("holds messages until welcomed, then flushes them in order", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.send("a");
    ob.send("b");
    expect(sent).toEqual([]);
    ob.welcome();
    expect(sent).toEqual(["a", "b"]);
    ob.send("c");
    expect(sent).toEqual(["a", "b", "c"]);
  });

  it("stops sending directly after the connection closes, until welcomed again", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.welcome();
    ob.closed();
    ob.send("late");
    expect(sent).toEqual([]);
    ob.welcome();
    expect(sent).toEqual(["late"]);
  });

  it("drops the whole queue, and anything sent until the next welcome, once the cap overflows", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit, 3);
    // e.g. strokeBegin, append, append, append: losing only the begin would graft the appends onto the previous stroke.
    for (const m of ["begin", "a1", "a2", "a3", "a4"]) ob.send(m);
    ob.welcome();
    expect(sent).toEqual([]);
    ob.send("after");
    expect(sent).toEqual(["after"]);
  });

  it("defaults to a cap of 50", () => {
    const a = collect();
    const full = new Outbox(a.transmit);
    for (let i = 0; i < 50; i++) full.send(String(i));
    full.welcome();
    expect(a.sent).toHaveLength(50);
    const b = collect();
    const over = new Outbox(b.transmit);
    for (let i = 0; i < 51; i++) over.send(String(i));
    over.welcome();
    expect(b.sent).toEqual([]);
  });

  it("drops the whole queue on overflow while welcomed but the transport is down", () => {
    const sent: string[] = [];
    let open = false;
    const ob = new Outbox((m) => (open ? (sent.push(m), true) : false), 2);
    ob.welcome();
    for (const m of ["begin", "a1", "a2", "a3"]) ob.send(m);
    open = true;
    ob.send("a4");
    expect(sent).toEqual([]);
    ob.welcome();
    expect(sent).toEqual([]);
    ob.send("next");
    expect(sent).toEqual(["next"]);
  });

  it("discards queued messages on clear", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.send("x");
    ob.clear();
    ob.welcome();
    expect(sent).toEqual([]);
  });

  it("keeps a message queued when the transport can't send it", () => {
    const sent: string[] = [];
    let open = false;
    const ob = new Outbox((m) => (open ? (sent.push(m), true) : false));
    ob.welcome();
    ob.send("q");
    expect(sent).toEqual([]);
    open = true;
    ob.welcome();
    expect(sent).toEqual(["q"]);
  });
});

describe("Outbox staleness", () => {
  it("drops the whole queue when any queued message is older than the time-to-live", () => {
    const { sent, transmit } = collect();
    let t = 0;
    const ob = new Outbox(transmit, 50, 2000, () => t);
    ob.send("begin");
    t = 1500;
    ob.send("append");
    t = 2500;
    ob.welcome();
    expect(sent).toEqual([]);
    ob.send("next");
    expect(sent).toEqual(["next"]);
  });

  it("keeps messages that are exactly at the time-to-live", () => {
    const { sent, transmit } = collect();
    let t = 0;
    const ob = new Outbox(transmit, 50, 2000, () => t);
    ob.send("edge");
    t = 2000;
    ob.welcome();
    expect(sent).toEqual(["edge"]);
  });

  it("defaults to a time-to-live of about 2 seconds", () => {
    const { sent, transmit } = collect();
    let t = 0;
    const ob = new Outbox(transmit, 50, undefined, () => t);
    ob.send("a");
    t = 1999;
    ob.send("b");
    t = 2000;
    ob.welcome();
    expect(sent).toEqual(["a", "b"]);
    const c = collect();
    let u = 0;
    const late = new Outbox(c.transmit, 50, undefined, () => u);
    late.send("a");
    u = 2001;
    late.welcome();
    expect(c.sent).toEqual([]);
  });
});

describe("Outbox.sendNow (never queued)", () => {
  it("sends immediately once welcomed", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.welcome();
    expect(ob.sendNow("skip")).toBe(true);
    expect(sent).toEqual(["skip"]);
  });

  it("drops the message while not welcomed, and never sends it later", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    expect(ob.sendNow("start")).toBe(false);
    ob.welcome();
    ob.closed();
    expect(ob.sendNow("kick")).toBe(false);
    ob.welcome();
    expect(sent).toEqual([]);
  });

  it("drops the message when the transport can't send it", () => {
    const sent: string[] = [];
    let open = false;
    const ob = new Outbox((m) => (open ? (sent.push(m), true) : false));
    ob.welcome();
    expect(ob.sendNow("skip")).toBe(false);
    open = true;
    ob.welcome();
    expect(sent).toEqual([]);
  });
});

describe("Outbox loose sends (independent actions such as guesses)", () => {
  const loose = (keepMs = 20_000, stillValid?: (v: unknown) => boolean) => ({ keepMs, stillValid });

  it("keeps a loose message past the ordered time-to-live and sends it once synced", () => {
    const { sent, transmit } = collect();
    let t = 0;
    const ob = new Outbox(transmit, 50, 2000, () => t);
    ob.send("guess", loose());
    t = 10_000;
    ob.welcome();
    expect(sent).toEqual([]); // waits for the post-welcome view
    ob.synced({});
    expect(sent).toEqual(["guess"]);
  });

  it("drops only the stale ordered messages, not a fresh loose one", () => {
    const { sent, transmit } = collect();
    let t = 0;
    const ob = new Outbox(transmit, 50, 2000, () => t);
    ob.send("begin");
    ob.send("append");
    ob.send("guess", loose());
    t = 5000;
    ob.welcome();
    ob.synced({});
    expect(sent).toEqual(["guess"]);
  });

  it("still flushes fresh ordered messages on welcome, before the sync", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.send("guess", loose());
    ob.send("begin");
    ob.welcome();
    expect(sent).toEqual(["begin"]);
    ob.synced({});
    expect(sent).toEqual(["begin", "guess"]);
  });

  it("drops a loose message older than its own keepMs", () => {
    const { sent, transmit } = collect();
    let t = 0;
    const ob = new Outbox(transmit, 50, 2000, () => t);
    ob.send("old", loose(20_000));
    t = 15_000;
    ob.send("new", loose(20_000));
    t = 20_001;
    ob.welcome();
    ob.synced({});
    expect(sent).toEqual(["new"]);
  });

  it("drops a loose message whose check fails against the fresh view (e.g. a later turn)", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.send("turn1", loose(20_000, (v) => (v as { turn: number }).turn === 1));
    ob.send("turn2", loose(20_000, (v) => (v as { turn: number }).turn === 2));
    ob.welcome();
    ob.synced({ turn: 2 });
    expect(sent).toEqual(["turn2"]);
  });

  it("drops a checked loose message when the sync has no view (back in the lobby)", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.send("checked", loose(20_000, () => true));
    ob.send("unchecked", loose());
    ob.welcome();
    ob.synced(null);
    expect(sent).toEqual(["unchecked"]);
  });

  it("holds loose sends between welcome and sync, then sends directly", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.welcome();
    ob.send("g1", loose());
    expect(sent).toEqual([]);
    ob.synced({});
    expect(sent).toEqual(["g1"]);
    ob.send("g2", loose());
    expect(sent).toEqual(["g1", "g2"]);
    ob.synced({}); // later views don't resend anything
    expect(sent).toEqual(["g1", "g2"]);
  });

  it("requires a fresh sync after each reconnect", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.welcome();
    ob.synced({});
    ob.closed();
    ob.send("g", loose(20_000, (v) => v === "same"));
    ob.welcome();
    expect(sent).toEqual([]);
    ob.synced("other");
    expect(sent).toEqual([]);
  });

  it("is not affected by an ordered overflow, and ordered sends aren't affected by loose ones", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit, 2);
    for (const m of ["begin", "a1", "a2"]) ob.send(m);
    ob.send("guess", loose());
    ob.send("a3"); // discarded: ordered overflow
    ob.welcome();
    ob.synced({});
    expect(sent).toEqual(["guess"]);
  });

  it("caps loose messages by dropping the oldest", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    for (let i = 0; i < LOOSE_LIMIT + 3; i++) ob.send(`g${i}`, loose());
    ob.welcome();
    ob.synced({});
    expect(sent).toHaveLength(LOOSE_LIMIT);
    expect(sent[0]).toBe("g3");
    expect(sent.at(-1)).toBe(`g${LOOSE_LIMIT + 2}`);
  });

  it("keeps a loose message queued if the transport can't send it on sync", () => {
    const sent: string[] = [];
    let open = false;
    const ob = new Outbox((m) => (open ? (sent.push(m), true) : false));
    ob.welcome();
    ob.synced({});
    ob.send("g", loose());
    expect(sent).toEqual([]);
    open = true;
    ob.welcome();
    ob.synced({});
    expect(sent).toEqual(["g"]);
  });

  it("discards loose messages on clear", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    ob.send("g", loose());
    ob.clear();
    ob.welcome();
    ob.synced({});
    expect(sent).toEqual([]);
  });
});
