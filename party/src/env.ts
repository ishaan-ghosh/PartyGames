import type { Room } from "./room";
export interface Env {
  Room: DurableObjectNamespace<Room>;
}
