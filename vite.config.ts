/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: { chunkSizeWarningLimit: 1300 },   // MapLibre alone is ~1.1 MB minified
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
