import { parseOasa, parseOasaRoutes, type OasaRoute } from "../src/lib/oasa.ts";

// Fixed arrivals and route-metadata actions. One paced queue also covers rapid stop switching.
export function oasaProxy(fetchUpstream: typeof fetch = fetch) {
  const cache = new Map<string, { until: number; response: Response }>();
  const pending = new Map<string, Promise<Response>>();
  const routes = new Map<string, { checked: number; retry: number; rows: OasaRoute[] }>();
  let queue = Promise.resolve(), next = 0;
  const upstreamJSON = async (act: "getStopArrivals" | "webRoutesForStop", id: string) => {
    if (next > Date.now()) await new Promise(r => setTimeout(r, next - Date.now()));
    next = Date.now() + 250;
    const response = await fetchUpstream(`https://telematics.oasa.gr/api/?act=${act}&p1=${id}`,
      { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error("upstream");
    return response.json();
  };
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/oasa/")) return null;
    const match = /^\/oasa\/stops\/([1-9]\d{0,8})$/.exec(url.pathname);
    if (!match || url.search) return Response.json({ error: "not_found" }, { status: 404 });
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    const id = match[1], hit = cache.get(id);
    if (hit && hit.until > Date.now()) {
      const response = hit.response.clone();
      response.headers.set("Cache-Control", `public, max-age=${Math.max(0, Math.floor((hit.until - Date.now()) / 1000))}`);
      return response;
    }
    let task = pending.get(id);
    if (!task) {
      if (pending.size >= 32) return Response.json({ error: "busy" }, { status: 503 });
      const turn = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      task = (async () => {
        await turn;
        let response: Response;
        try {
          const arrivals = parseOasa(await upstreamJSON("getStopArrivals", id));
          if (!arrivals) throw new Error("invalid arrivals");
          const now = Math.floor(Date.now() / 1000);
          const known = routes.get(id);
          const missing = arrivals.some(a => !known?.rows.some(r => r.code === a.route_code));
          if (!known || (now >= known.retry && (now - known.checked >= 21600 || missing && now - known.checked >= 300))) {
            try {
              const rows = parseOasaRoutes(await upstreamJSON("webRoutesForStop", id));
              if (!rows) throw new Error("invalid routes");
              routes.delete(id);
              routes.set(id, { checked: now, retry: now + 300, rows });
            } catch {
              routes.set(id, { checked: known?.checked ?? 0, retry: now + 30, rows: known?.rows ?? [] });
            }
            if (routes.size > 128) routes.delete(routes.keys().next().value!);
          }
          response = Response.json({ stop_id: id, updated_at: now, next_update_at: now + 30, arrivals, routes: routes.get(id)?.rows ?? [] });
        } catch {
          response = Response.json({ error: "oasa_unavailable" }, { status: 502 });
        } finally { release(); }
        const ttl = response.ok ? 30 : 10;
        response.headers.set("Cache-Control", `public, max-age=${ttl}`);
        response.headers.set("Access-Control-Allow-Origin", "*");
        cache.delete(id);
        cache.set(id, { until: Date.now() + ttl * 1000, response });
        if (cache.size > 128) cache.delete(cache.keys().next().value!);
        return response;
      })().finally(() => pending.delete(id));
      pending.set(id, task);
    }
    return (await task).clone();
  };
}
