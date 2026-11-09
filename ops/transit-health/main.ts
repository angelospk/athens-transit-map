// Hourly feed health check for the map's bus data: fetch every city, judge it with rules.ts, keep the quiet
// hours quiet (persistRuns), send one ntfy message when something starts or stops, append one log line.
// Built to one file for node 22 (`bun run health:build` → dist-health/transit-health.mjs), deployed by
// ops/transit-health/deploy.sh as a systemd user timer on the Oracle VPS.
//
// Env: NTFY_TOPIC (required unless --dry-run; it lives only in ~/.config/transit-health/env), STATE_DIR
// (default ~/.local/state/transit-health: state.json and health.log).

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import rawCfg from "./config.json";
import { CITYBUS, CITYBUS_API } from "../../src/lib/citybus";
import {
  athensHour, evaluateCity, formatMessage, fromTiles, fromV2, inService, logLine, step, tilesFor,
  type CityResult, type HealthConfig, type HealthState, type Sample,
} from "./rules";

const cfg = rawCfg as unknown as HealthConfig;

const UA = "staseis-transit-health";
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;

type Fetchable =
  | { city: string; kind: "v2"; url: string }
  | { city: string; kind: "tiles"; api: string; code: string; tiles: [number, number][] };

const TARGETS: Fetchable[] = [
  { city: "athens", kind: "v2", url: "https://transit.haroldpoi.dev/v2/vehicles" },
  { city: "thessaloniki", kind: "v2", url: "https://transit-thess.haroldpoi.dev/v2/vehicles" },
  ...CITYBUS.map((c): Fetchable => ({
    city: c.slug, kind: "tiles", api: CITYBUS_API, code: c.code, tiles: tilesFor(c.box, 9),
  })),
];

function args(argv: string[]) {
  let dryRun = false;
  let stateDir = process.env.STATE_DIR || join(homedir(), ".local/state/transit-health");
  const simulate: { city: string; code: string }[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--state") stateDir = argv[++i] ?? stateDir;
    else if (a === "--simulate") {
      const v = argv[++i] ?? "";
      const cut = v.indexOf(":");
      if (cut > 0) simulate.push({ city: v.slice(0, cut), code: v.slice(cut + 1) });
    }
  }
  // A simulated code saved in the real state would fire a real alert later: keep simulations elsewhere.
  if (simulate.length > 0 && !argv.includes("--state")) {
    console.error("--simulate needs --state <scratch dir>");
    process.exit(2);
  }
  return { dryRun, stateDir, simulate };
}

async function getJson(url: string): Promise<{ body: any } | { error: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": UA } });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    try {
      return { body: await r.json() };
    } catch {
      return { error: "bad JSON" };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const failed = (city: string, error: string): Sample =>
  ({ city, error, updatedAt: null, sources: [], vehicles: [] });

// A body of the wrong shape makes normalisation throw: that city is an error, the run goes on.
async function fetchCity(t: Fetchable): Promise<Sample> {
  try {
    return await fetchCityOrThrow(t);
  } catch (e) {
    return failed(t.city, `bad body: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function fetchCityOrThrow(t: Fetchable): Promise<Sample> {
  if (t.kind === "v2") {
    const r = await getJson(t.url);
    return "error" in r ? failed(t.city, r.error) : fromV2(t.city, r.body);
  }
  const bodies: any[] = [];
  for (const [x, y] of t.tiles) {
    const r = await getJson(`${t.api}/${t.code}/v1/vehicles/tiles/9/${x}/${y}`);
    if ("error" in r) return failed(t.city, r.error);   // one missing tile is a gap in that city's view
    bodies.push(r.body);
  }
  return fromTiles(t.city, bodies);
}

// At most CONCURRENCY cities in flight: each city's tiles run in order, the cities side by side.
async function fetchAll(targets: Fetchable[]): Promise<Sample[]> {
  const out: Sample[] = new Array(targets.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
    while (next < targets.length) {
      const i = next++;
      out[i] = await fetchCity(targets[i]);
    }
  }));
  return out;
}

async function main() {
  const { dryRun, stateDir, simulate } = args(process.argv.slice(2));
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  const stateFile = `${stateDir}/state.json`;
  let prev: HealthState = {};
  try { prev = JSON.parse(readFileSync(stateFile, "utf8")) as HealthState; } catch { /* first run */ }

  const nowMs = Date.now();
  const nowS = Math.floor(nowMs / 1000);
  const iso = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  const day = inService(athensHour(new Date(nowMs)), cfg);

  const samples = await fetchAll(TARGETS);
  const results: CityResult[] = samples.map((s) => evaluateCity(s, cfg, nowS, day));
  for (const sim of simulate) {
    const r = results.find((x) => x.city === sim.city);
    if (!r) continue;
    r.anomalies.push({ code: sim.code, detail: "simulated" });
    if (!r.checked.includes(sim.code)) r.checked.push(sim.code);
  }

  const { state, events } = step(prev, results, cfg.persistRuns);

  const line = logLine(iso, day, results, events);
  appendFileSync(`${stateDir}/health.log`, `${line}\n`);
  console.log(line);

  // The state is saved only once its events are delivered: after a failed POST the next run fires them again.
  const code = await deliver(formatMessage(events), dryRun);
  if (code === 0) {
    writeFileSync(`${stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${stateFile}.tmp`, stateFile);
  }
  return code;
}

async function deliver(message: { title: string; body: string } | null, dryRun: boolean): Promise<number> {
  if (!message) return 0;

  if (dryRun) {
    console.log(message.title);
    console.log(message.body);
    return 0;
  }

  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) {
    console.error("NTFY_TOPIC is not set: ~/.config/transit-health/env (NTFY_TOPIC=...)");
    return 1;
  }
  try {
    const r = await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic, title: message.title, message: message.body, priority: 4, tags: ["bus"] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      console.error(`ntfy POST failed: HTTP ${r.status}`);
      return 1;
    }
  } catch (e) {
    console.error(`ntfy POST failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
