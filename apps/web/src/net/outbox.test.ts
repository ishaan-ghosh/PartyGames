import { describe, expect, it } from "vitest";
import { Outbox } from "./outbox";

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
