/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "node:child_process";
import pkg from "./package.json" with { type: "json" };

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

export default defineConfig({
  plugins: [svelte(), maplibreWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILT__: JSON.stringify(built),
    __APP_COMMIT__: JSON.stringify(commit()),
  },
  build: { chunkSizeWarningLimit: 700 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
