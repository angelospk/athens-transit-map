// OASA getStopArrivals. Minutes are OASA's prediction at the time of the response.
export interface OasaArrival { route_code: string; veh_code: string; minutes: number }
export interface OasaRoute { code: string; line: string; description: string }
export interface OasaBoard {
  stop_id: string;
  updated_at: number;
  next_update_at: number;
  arrivals: OasaArrival[];
  routes: OasaRoute[];
}

export function parseOasaRoutes(body: unknown): OasaRoute[] | null {
  if (!Array.isArray(body)) return null;
  const routes: OasaRoute[] = [];
  for (const r of body) {
    if (!r || typeof r.RouteCode !== "string" || !r.RouteCode || typeof r.LineID !== "string" || !r.LineID.trim()
      || typeof r.RouteDescr !== "string") return null;
    routes.push({ code: r.RouteCode, line: r.LineID.trim(), description: r.RouteDescr.trim() });
  }
  return routes;
}

export function parseOasa(body: unknown): OasaArrival[] | null {
  if (body === null) return [];   // OASA returns null when no arrivals are predicted
  if (!Array.isArray(body)) return null;
  const rows: OasaArrival[] = [];
  for (const a of body) {
    if (!a || typeof a.route_code !== "string" || !a.route_code || typeof a.veh_code !== "string" || !a.veh_code
      || !["string", "number"].includes(typeof a.btime2) || String(a.btime2).trim() === "") return null;
    const minutes = Number(a.btime2);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    rows.push({ route_code: a.route_code, veh_code: a.veh_code, minutes });
  }
  return rows.sort((a, b) => a.minutes - b.minutes);
}

export function isOasaBoard(body: unknown): body is OasaBoard {
  const b = body as OasaBoard;
  return !!b && typeof b.stop_id === "string" && Number.isFinite(b.updated_at) && Number.isFinite(b.next_update_at)
    && Array.isArray(b.routes) && b.routes.every(r => typeof r.code === "string" && typeof r.line === "string" && typeof r.description === "string")
    && Array.isArray(b.arrivals) && b.arrivals.every(a => typeof a.route_code === "string" && typeof a.veh_code === "string"
      && Number.isFinite(a.minutes) && a.minutes >= 0);
}
