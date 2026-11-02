import type { Env as RoomEnv } from "../../src/env";

// `cloudflare:test`'s `env` is typed as `Cloudflare.Env`; give it this worker's bindings.
declare global {
  namespace Cloudflare {
    interface Env extends RoomEnv {}
  }
}
