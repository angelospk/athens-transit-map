// The page's push API over HTTP (bot/main.ts serves it on 127.0.0.1, behind the Cloudflare tunnel):
// GET /key, and the bot's web() for /alerts. Only the map's origin may change alerts; small JSON bodies;
// a few new alerts per IP (Cloudflare's CF-Connecting-IP) in 10 minutes.

import type { IncomingMessage, ServerResponse } from "node:http";

type Web = (req: { method: string; path: string; body: unknown }) => Promise<{ status: number; body?: unknown }>;
export interface ApiOpts { key: string; origins: string[]; rate?: number; rateMs?: number; maxBody?: number }

export function pushApi(bot: { web: Web }, o: ApiOpts, after: () => void = () => {}) {
  const rate = o.rate ?? 20, rateMs = o.rateMs ?? 600_000, maxBody = o.maxBody ?? 4096;
  const posts = new Map<string, number[]>();
  return (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin ?? "";
    const allowed = o.origins.includes(origin);
    const send = (status: number, body?: unknown, extra: Record<string, string> = {}) => {
      if (res.headersSent) return;
      res.writeHead(status, {
        "cache-control": "no-store", vary: "Origin", ...extra,
        ...(allowed ? { "access-control-allow-origin": origin } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "OPTIONS")
      return send(204, undefined, { "access-control-allow-methods": "GET, POST, DELETE", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" });
    if (req.method === "GET" && path === "/key") return send(200, { key: o.key });
    if (req.method !== "POST" && req.method !== "DELETE") return send(405, { error: "method" });
    if (!allowed) return send(403, { error: "origin" });
    if (req.method === "POST") {
      const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "");
      const now = Date.now(), recent = (posts.get(ip) ?? []).filter(t => now - t < rateMs);
      if (recent.length >= rate) return send(429, { error: "rate" });
      posts.set(ip, [...recent, now]);
      if (posts.size > 10_000) for (const [k, v] of posts) if (v.every(t => now - t >= rateMs)) posts.delete(k);
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBody) { send(413, { error: "size" }, { connection: "close" }); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => {
      if (size > maxBody) return;
      let body: unknown = null;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null; } catch { return send(400, { error: "json" }); }
      bot.web({ method: req.method!, path, body }).then(r => { send(r.status, r.body); after(); },
        e => { console.error("web:", (e as Error).message); send(500, { error: "server" }); });
    });
  };
}
