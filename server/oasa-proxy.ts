// Optional standalone host for the static frontend: bun run oasa:proxy
import { oasaProxy } from "./oasa.ts";

const handle = oasaProxy();
const server = Bun.serve({
  hostname: process.env.OASA_HOST ?? "127.0.0.1",
  port: Number(process.env.OASA_PORT ?? 8096),
  fetch: async request => await handle(request) ?? new Response("Not found", { status: 404 }),
});
console.log(`OASA arrivals proxy: ${server.url}oasa/stops/{stop_id}`);
