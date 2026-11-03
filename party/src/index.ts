import { makeRoomCode } from "@party/shared";
import { getServerByName, routePartykitRequest } from "partyserver";
import type { Env } from "./env";
import { isAllowedPartyPath } from "./routes";

export { Room } from "./room";

async function createRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeRoomCode();
    const hostKey = crypto.randomUUID();
    const stub = await getServerByName(env.Room, code);
    if (await stub.create(hostKey)) return Response.json({ code, hostKey });
  }
  return Response.json({ error: "Couldn't find a free room code. Try again." }, { status: 503 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/rooms" && req.method === "POST") return createRoom(env);
    if (!isAllowedPartyPath(url.pathname)) return new Response("Not found", { status: 404 });
    return (await routePartykitRequest(req, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
