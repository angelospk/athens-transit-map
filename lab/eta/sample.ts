// ETA lab sampler: every 60 s the live stop boards, every 30 s the vehicle fleet, to JSONL.
//   bun lab/eta/sample.ts <data dir>
// Keeps each live arrival as a pred, and fixes only for buses it has predicted in the last 90 min.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = (process.env.ETA_API ?? "https://transit.haroldpoi.dev").replace(/\/+$/, "");
const STOPS = ["61000", "10183", "530006", "790009", "590023", "481194"];   // GTFS stop ids
const UA = "athens-transit-eta-lab";
const KEEP_S = 5400;   // 90 min: how long a predicted bus keeps its fixes

const lastPred = new Map<string, number>();   // vehicle -> last q we saw it predicted
const seenFix = new Set<string>();            // vehicle|position_at, so a re-sent fix is written once

const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function get(path: string): Promise<any> {
  const res = await fetch(API + path, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function saveStop(dir: string, id: string, lat: number, lon: number, name: string): void {
  const file = join(dir, "stops.json");
  let all: Record<string, { lat: number; lon: number; name: string }> = {};
  try { all = JSON.parse(readFileSync(file, "utf8")); } catch { /* first run */ }
  all[id] = { lat, lon, name };
  writeFileSync(file, JSON.stringify(all, null, 1) + "\n");
}

let polling = false;   // a slow API can make one round outlast the 60 s interval

async function pollStops(dir: string): Promise<void> {
  if (polling) return;
  polling = true;
  try { await pollEach(dir); } finally { polling = false; }
}

async function pollEach(dir: string): Promise<void> {
  for (const id of STOPS) {
    try {
      const j = await get(`/v1/stops/${id}`);
      const q = Math.floor(Date.now() / 1000), s = j.stop;
      if (s) saveStop(dir, id, s.lat, s.lon, s.name);
      const kept = (j.arrivals ?? []).filter((a: any) => a.source === "live" && a.vehicle);
      if (kept.length) {
        const rows = kept.map((a: any) => JSON.stringify({ q, stop: id, line: a.line, vehicle: a.vehicle, at: a.at, position_at: a.position_at }));
        appendFileSync(join(dir, `preds-${day()}.jsonl`), rows.join("\n") + "\n");
      }
      for (const a of kept) lastPred.set(a.vehicle, q);
    } catch (e) {
      console.error(`stops ${id}: ${(e as Error).message}`);
    }
    await sleep(1000);   // be gentle with OASA
  }
}

async function pollVehicles(dir: string): Promise<void> {
  try {
    const j = await get("/v1/vehicles");
    const now = Math.floor(Date.now() / 1000), rows: string[] = [];
    for (const v of j.vehicles ?? []) {
      const q = lastPred.get(v.id);
      if (q === undefined || now - q > KEEP_S) continue;
      const key = `${v.id}|${v.position_at}`;
      if (seenFix.has(key)) continue;
      seenFix.add(key);
      rows.push(JSON.stringify({ vehicle: v.id, t: v.position_at, lat: v.lat, lon: v.lon, line: v.line }));
    }
    if (rows.length) appendFileSync(join(dir, `fixes-${day()}.jsonl`), rows.join("\n") + "\n");
  } catch (e) {
    console.error(`vehicles: ${(e as Error).message}`);
  }
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: bun lab/eta/sample.ts <data dir>");
  mkdirSync(dir, { recursive: true });
  console.log(`${dir}: ${STOPS.length} stops every 60 s, vehicles every 30 s, from ${API}`);
  void pollStops(dir);
  void pollVehicles(dir);
  setInterval(() => void pollStops(dir), 60_000);
  setInterval(() => void pollVehicles(dir), 30_000);
}
