import type { Avatar, HostCommand, ServerMsg } from "@party/shared";
import PartySocket from "partysocket";
import { useCallback, useEffect, useRef, useState } from "react";
import { storage } from "../lib/storage";
import { Outbox } from "./outbox";
import { FATAL_ERRORS, initialRoomState, reduceServerMsg, type ClientRoomState } from "./roomState";

export interface HelloInfo { role: "screen" | "player"; name?: string; avatar?: Avatar }
export interface RoomConnection extends ClientRoomState {
  sendAction(payload: unknown): void;
  sendHost(cmd: HostCommand): void;
  onEvent(cb: (payload: unknown) => void): () => void;
  serverNow(): number;
}

export function useRoom(code: string, hello: HelloInfo | null): RoomConnection {
  const [state, setState] = useState<ClientRoomState>(initialRoomState);
  const outboxRef = useRef<Outbox | null>(null);
  const listeners = useRef(new Set<(payload: unknown) => void>());
  const offset = useRef(0);
  offset.current = state.clockOffset;
  const helloKey = hello
    ? [hello.role, hello.name ?? "", hello.avatar?.emoji ?? "", hello.avatar?.color ?? ""].join("|")
    : null;

  useEffect(() => {
    if (!hello) return;
    setState(initialRoomState);
    const ws = new PartySocket({
      host: window.location.host,
      protocol: window.location.protocol === "https:" ? "wss" : "ws",
      party: "room",
      room: code,
      // Never let PartySocket queue: its queue flushes before our hello, and the server rejects that.
      maxEnqueuedMessages: 0,
    });
    // Our own queue only flushes once the server has welcomed the current connection.
    const outbox = new Outbox((m) => {
      if (ws.readyState !== ws.OPEN) return false;
      ws.send(m);
      return true;
    });
    outboxRef.current = outbox;
    // Every (re)connect re-introduces us with our token, so the server returns us to our seat.
    const onOpen = () => {
      setState((s) => (s.status === "closed" ? s : { ...s, status: "open" }));
      ws.send(JSON.stringify({
        type: "hello",
        role: hello.role,
        token: storage.getToken(code, hello.role) ?? undefined,
        hostKey: storage.getHostKey(code) ?? undefined,
        name: hello.name,
        avatar: hello.avatar,
      }));
    };
    const onClose = () => {
      outbox.closed();
      setState((s) => (s.status === "closed" ? s : { ...s, status: "reconnecting" }));
    };
    const onMessage = (e: MessageEvent) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.type === "event") {
        for (const l of listeners.current) l(msg.payload);
        return;
      }
      if (msg.type === "welcome") storage.setToken(code, hello.role, msg.token);
      if (msg.type === "error" && FATAL_ERRORS.has(msg.code)) {
        if (msg.code === "KICKED") storage.clearToken(code, hello.role);
        // The room is gone and its code may be reused: forget our seat, role and host key for it.
        if (msg.code === "ROOM_NOT_FOUND") storage.clearRoom(code);
        outbox.clear();
        ws.close(); // stops PartySocket from reconnecting
      }
      setState((s) => reduceServerMsg(s, msg, Date.now()));
      if (msg.type === "welcome") outbox.welcome();
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("close", onClose);
    ws.addEventListener("message", onMessage);
    return () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("close", onClose);
      ws.removeEventListener("message", onMessage);
      outbox.clear();
      ws.close();
      if (outboxRef.current === outbox) outboxRef.current = null;
    };
    // `hello` is captured via helloKey on purpose: reconnect only when identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, helloKey]);

  const sendAction = useCallback((payload: unknown) => {
    outboxRef.current?.send(JSON.stringify({ type: "action", payload }));
  }, []);
  const sendHost = useCallback((cmd: HostCommand) => {
    outboxRef.current?.send(JSON.stringify({ type: "host", cmd }));
  }, []);
  const onEvent = useCallback((cb: (payload: unknown) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);
  const serverNow = useCallback(() => Date.now() + offset.current, []);

  return { ...state, sendAction, sendHost, onEvent, serverNow };
}
