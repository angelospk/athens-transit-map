/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_STATIC_BASE?: string;
  readonly VITE_STATS_BASE?: string;
  readonly VITE_MOCK?: string;
  readonly VITE_GEOCODE_URL?: string;
  readonly VITE_DEMO_VIDEO_URL?: string;
  readonly VITE_FEEDBACK_URL?: string;
}

// vite.config.ts `define`: the build's version.
declare const __APP_VERSION__: string;
declare const __APP_BUILT__: string;
declare const __APP_COMMIT__: string;

declare module "virtual:maplibre-worker" {
  const url: string;
  export default url;
}
