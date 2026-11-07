// Read the sampler's JSONL for the days from..to (inclusive), shared by score.ts and publish.ts.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fix, Pred } from "./eta";

export function dates(dir: string): string[] {
  return [...new Set(readdirSync(dir).filter(f => /^(preds|fixes)-\d{4}-\d\d-\d\d\.jsonl$/.test(f)).map(f => f.slice(6, 16)))].sort();
}

export function load(dir: string, from: string, to: string) {
  const files = readdirSync(dir).filter(f => /^(preds|fixes)-\d{4}-\d\d-\d\d\.jsonl$/.test(f))
    .filter(f => f.slice(6, 16) >= from && f.slice(6, 16) <= to).sort();
  const preds: Pred[] = [], fixesByVehicle: Record<string, Fix[]> = {};
  let end = 0;
  for (const f of files) {
    for (const l of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!l.trim()) continue;
      const r = JSON.parse(l);
      if (f.startsWith("preds-")) preds.push({ q: r.q, stop: String(r.stop), vehicle: String(r.vehicle), at: r.at });
      else {
        (fixesByVehicle[r.vehicle] ??= []).push({ t: r.t, lat: r.lat, lon: r.lon });
        end = Math.max(end, r.t);
      }
    }
  }
  let stops: Record<string, { lat: number; lon: number }> = {};
  try { stops = JSON.parse(readFileSync(join(dir, "stops.json"), "utf8")); } catch { /* no stop list yet */ }
  return { preds, fixesByVehicle, stops, end };
}
