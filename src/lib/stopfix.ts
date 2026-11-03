// «Λάθος θέση;» of the stop card, and the rule that decides when a stop really moves.
//
// A user drags a pin to where the pole stands; the report goes out as feedback text (feedback.ts),
// with a machine line (#stopfix …) that scripts/stopfix.ts reads back from the Sheet. Nothing moves
// on its own: a human commits a correction to scripts/stop-corrections.json (read by scripts/trips.ts)
// only when decideCorrection says yes, that is when the GPS measurement of where buses halt
// (lab/stops) supports it, or 3+ independent reports agree within AGREE_M and GPS does not contradict.

export type LatLon = [number, number];

export const MAX_MOVE_M = 80;   // a pin further than this from the map's stop is not sent, and not counted
export const AGREE_M = 15;      // reports agree when all lie within this of each other
export const MIN_REPORTS = 3;   // independent devices
export const MIN_MOVE_M = 5;    // smaller moves are noise
export const NEAR_GPS_M = 20;   // a report this close to the GPS halt point places the pole
export const CONFLICT_M = 30;   // GPS and a report group further apart than this: no correction

export function distM(a: LatLon, b: LatLon): number {
  return Math.hypot((a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180), a[0] - b[0]) * 111_320;
}

/** p moved n metres north and e metres east. */
export function offsetPoint(p: LatLon, n: number, e: number): LatLon {
  return [p[0] + n / 111_320, p[1] + e / (111_320 * Math.cos((p[0] * Math.PI) / 180))];
}

export interface StopReport { stop: string; lat: number; lon: number; device: string; at: number }

/** The feedback text of a report: a line for people, then the line scripts/stopfix.ts reads. */
export function stopReportText(r: StopReport & { name: string; from: LatLon }): string {
  const m = Math.round(distM(r.from, [r.lat, r.lon]));
  return `Λάθος θέση στάσης ${r.name} (${r.stop}): ${m} μ από τη θέση του χάρτη.\n`
    + `#stopfix stop=${r.stop} lat=${r.lat.toFixed(6)} lon=${r.lon.toFixed(6)} from=${r.from[0].toFixed(6)},${r.from[1].toFixed(6)} dev=${r.device}`;
}

const LINE = /#stopfix stop=([A-Za-z0-9_:-]+) lat=(-?\d+(?:\.\d+)?) lon=(-?\d+(?:\.\d+)?)(?: from=\S+)? dev=([A-Za-z0-9]+)/;

/** The stop reports among feedback rows (text and time); other rows are skipped. */
export function parseStopReports(rows: { text: string; at: number }[]): StopReport[] {
  const out: StopReport[] = [];
  for (const r of rows) {
    const m = LINE.exec(r.text);
    if (!m) continue;
    const lat = +m[2], lon = +m[3];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ stop: m[1], lat, lon, device: m[4], at: r.at });
  }
  return out;
}

export interface GpsMeasure { lat: number; lon: number; confidence: "high" | "medium" | "low" | "none"; suspect: boolean }
export type Basis = "gps" | "gps+reports" | "reports";
export type Decision =
  | { apply: true; lat: number; lon: number; basis: Basis; moved: number; reports: number }
  | { apply: false; reason: string; reports: number };

const mid = (v: number[]) => {
  const s = [...v].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const centre = (rs: StopReport[]): LatLon => [mid(rs.map(r => r.lat)), mid(rs.map(r => r.lon))];
const spread = (rs: StopReport[]) => Math.max(0, ...rs.flatMap(a => rs.map(b => distM([a.lat, a.lon], [b.lat, b.lon]))));

// The largest group of reports that all lie within AGREE_M of each other (ties: the tighter one): the
// maximal cliques of the "within AGREE_M" graph (Bron-Kerbosch with a pivot). null when the search
// would take too long (a flood of reports): then nothing moves and a person looks.
const GROUP_STEPS = 200_000;
function agreeing(rs: StopReport[]): StopReport[] | null {
  const near = rs.map(a => rs.map(b => a !== b && distM([a.lat, a.lon], [b.lat, b.lon]) <= AGREE_M));
  let best: number[] = [], bestSpread = Infinity, steps = 0;
  const bk = (r: number[], p: number[], x: number[]): boolean => {
    if (++steps > GROUP_STEPS) return false;
    if (!p.length && !x.length) {
      const sp = spread(r.map(i => rs[i]));
      if (r.length > best.length || (r.length === best.length && sp < bestSpread)) { best = r; bestSpread = sp; }
      return true;
    }
    if (r.length + p.length < best.length) return true;
    const u = [...p, ...x].reduce((m, i) => (p.filter(j => near[i][j]).length > p.filter(j => near[m][j]).length ? i : m));
    for (const v of p.filter(j => !near[u][j])) {
      if (!bk([...r, v], p.filter(j => near[v][j]), x.filter(j => near[v][j]))) return false;
      p = p.filter(j => j !== v);
      x = [...x, v];
    }
    return true;
  };
  return bk([], rs.map((_, i) => i), []) ? best.map(i => rs[i]) : null;
}

/** Whether a stop moves, where to and on what basis. Pure: the caller gathers the inputs. */
export function decideCorrection(stop: { id: string; lat: number; lon: number }, gps: GpsMeasure | null, all: StopReport[]): Decision {
  const here: LatLon = [stop.lat, stop.lon];
  // One report per device per stop (the latest), and none beyond MAX_MOVE_M.
  const latest = new Map<string, StopReport>();
  for (const r of all) if (r.stop === stop.id && (!latest.has(r.device) || latest.get(r.device)!.at <= r.at)) latest.set(r.device, r);
  const rs = [...latest.values()].filter(r => distM(here, [r.lat, r.lon]) <= MAX_MOVE_M);
  const n = rs.length;
  const no = (reason: string): Decision => ({ apply: false, reason, reports: n });
  const found = agreeing(rs);
  if (!found) return no(`${n} reports: too many to group, check by hand`);
  const group = found;
  const grouped = group.length >= MIN_REPORTS ? centre(group) : null;
  const yes = (p: LatLon, basis: Basis): Decision => {
    const moved = distM(here, p);
    return moved < MIN_MOVE_M ? no(`move ${moved.toFixed(1)} m < ${MIN_MOVE_M} m`) : { apply: true, lat: p[0], lon: p[1], basis, moved, reports: n };
  };

  if (gps?.suspect && gps.confidence === "high") {
    const g: LatLon = [gps.lat, gps.lon];
    if (grouped && distM(g, grouped) > CONFLICT_M) return no(`GPS halt point and ${group.length} reports are ${Math.round(distM(g, grouped))} m apart`);
    const near = rs.filter(r => distM(g, [r.lat, r.lon]) <= NEAR_GPS_M);
    return near.length ? yes(centre(near), "gps+reports") : yes(g, "gps");
  }
  if (!grouped) return no(`${group.length} agreeing reports (of ${n}), need ${MIN_REPORTS}`);
  if (gps && (gps.confidence === "high" || gps.confidence === "medium")) {
    const g: LatLon = [gps.lat, gps.lon];
    if (distM(g, grouped) > CONFLICT_M || distM(g, here) + MIN_MOVE_M < distM(g, grouped))
      return no(`GPS (${gps.confidence}) puts the halts nearer the current position than the reports`);
  }
  return yes(grouped, "reports");
}

/**
 * A row of lab/stops/measured.csv as decideCorrection's GPS input. A suspect moves a stop on its own only
 * when OSM confirms it (osm_check "agrees"): the hand check found most unconfirmed suspects to be queues
 * at junctions. Those are "medium": they cannot move a stop, but reports that lead away from where
 * buses halt are still refused.
 */
export function gpsFromAudit(r: { halt_lat: string; halt_lon: string; confidence: string; suspect: string; osm_check: string }): GpsMeasure | null {
  const lat = parseFloat(r.halt_lat), lon = parseFloat(r.halt_lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const suspect = r.suspect === "1";
  if (suspect && r.osm_check !== "agrees") return { lat, lon, confidence: "medium", suspect: false };
  const c = r.confidence;
  return { lat, lon, confidence: c === "high" || c === "medium" || c === "low" ? c : "none", suspect };
}

/** Rows of a CSV text (RFC 4180: quoted cells may hold commas, quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export interface Correction { lat: number; lon: number; basis: Basis; note: string }

/** A stop's position after the corrections file. */
export function applyCorrections(id: string, lat: number, lon: number, c: Record<string, Correction>): LatLon {
  const k = c[id];
  return k && Number.isFinite(k.lat) && Number.isFinite(k.lon) ? [k.lat, k.lon] : [lat, lon];
}

// Browser side: an anonymous device id (for "one report per device per stop") and the stops this
// device already reported. Storage may throw (private mode): then nothing is remembered.
const DEV_KEY = "stopfix.dev", SENT_KEY = "stopfix.sent";

const local = (): Storage | undefined => globalThis.localStorage;   // the getter itself may throw

export function deviceId(store?: Storage): string {
  try {
    const st = store ?? local();
    const old = st?.getItem(DEV_KEY);
    if (old && /^[a-f0-9]{12}$/.test(old)) return old;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, "0")).join("");
    st?.setItem(DEV_KEY, id);
    return id;
  } catch { return "anon"; }
}

export function reportedStops(store?: Storage): string[] {
  try {
    const v = JSON.parse((store ?? local())?.getItem(SENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
  } catch { return []; }
}

export function markReported(stop: string, store?: Storage) {
  try { (store ?? local())?.setItem(SENT_KEY, JSON.stringify([...new Set([...reportedStops(store), stop])].slice(-500))); } catch { /* not remembered */ }
}
