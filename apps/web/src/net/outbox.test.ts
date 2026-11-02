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

  it("drops the oldest messages beyond the cap", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit, 3);
    for (const m of ["1", "2", "3", "4", "5"]) ob.send(m);
    ob.welcome();
    expect(sent).toEqual(["3", "4", "5"]);
  });

  it("defaults to a cap of 50", () => {
    const { sent, transmit } = collect();
    const ob = new Outbox(transmit);
    for (let i = 0; i < 60; i++) ob.send(String(i));
    ob.welcome();
    expect(sent).toHaveLength(50);
    expect(sent[0]).toBe("10");
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
