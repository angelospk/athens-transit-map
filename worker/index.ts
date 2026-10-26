import { DurableObject, RpcTarget } from "cloudflare:workers";
import { oasaProxy, type OasaAction } from "../server/oasa";

// OASA accepts the edge Worker's egress but timed out from the deployed DO's egress.
// This per-request callback keeps network I/O at the edge; the DO still paces and caches it.
class OasaUpstream extends RpcTarget {
  async json(act: OasaAction, id: string): Promise<unknown> {
    if (!["getStopArrivals", "webRoutesForStop"].includes(act) || !/^[1-9]\d{0,8}$/.test(id)) throw new Error("Invalid OASA action");
    try {
      const response = await fetch(`https://telematics.oasa.gr/api/?act=${act}&p1=${id}`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.warn("OASA upstream failed", act, String(error));
      throw error;
    }
  }
}

// All edge locations share one object, hence one OASA budget and one stop/metadata cache.
export class OasaArrivals extends DurableObject<Env> {
  private handle = oasaProxy();

  async board(url: string, upstream: OasaUpstream): Promise<Response> {
    return await this.handle(new Request(url), (act, id) => upstream.json(act, id))
      ?? new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/oasa/")) {
      if (!/^\/oasa\/stops\/[1-9]\d{0,8}$/.test(url.pathname) || url.search)
        return Response.json({ error: "not_found" }, { status: 404 });
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
      return env.OASA.get(env.OASA.idFromName("global")).board(request.url, new OasaUpstream());
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
