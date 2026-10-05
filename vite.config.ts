/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

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
  build: { chunkSizeWarningLimit: 700 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
