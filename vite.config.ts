/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import pkg from "./package.json" with { type: "json" };
import { parseTimetable } from "./src/lib/muniTimes";

// The version shown in the ⓘ sheet: package version, build day (Athens) and commit.
const commit = () => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
};
const built = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());

// `import workerUrl from "virtual:maplibre-worker"`. In the build, MapLibre's worker is an
// extra chunk of the main bundle, so it shares the maplibre-gl-shared chunk (a `?worker`
// import would bundle that ~150 KB gzip chunk a second time) and gets a content hash.
function maplibreWorker(): Plugin {
  const id = "\0maplibre-worker";
  let build = false;
  return {
    name: "maplibre-worker",
    configResolved: c => void (build = c.command === "build"),
    resolveId: s => (s === "virtual:maplibre-worker" ? id : undefined),
    load(i) {
      if (i !== id) return;
      if (!build) return `export default "/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs";`;
      const ref = this.emitFile({ type: "chunk", id: "maplibre-gl/dist/maplibre-gl-worker.mjs", name: "maplibre-worker" });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
  };
}

// /municipal-times.json for the app: every hand-transcribed timetable (data/municipal) that passes
// parseTimetable, without the watch list. The web bundles the same files (muniTables.ts).
function municipalTimes(): Plugin {
  return {
    name: "municipal-times",
    apply: "build",
    generateBundle() {
      const dir = "data/municipal";
      const tables = readdirSync(dir).filter(f => f.endsWith(".json")).sort()
        .map(f => parseTimetable(JSON.parse(readFileSync(`${dir}/${f}`, "utf8"))))
        .filter(t => t !== null)
        .map(({ watch: _, ...t }) => t);
      this.emitFile({ type: "asset", fileName: "municipal-times.json", source: JSON.stringify({ v: 1, tables }) });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), maplibreWorker(), municipalTimes()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILT__: JSON.stringify(built),
    __APP_COMMIT__: JSON.stringify(commit()),
  },
  build: { chunkSizeWarningLimit: 700 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
