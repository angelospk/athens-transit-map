/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_STATIC_BASE?: string;
  readonly VITE_STATS_BASE?: string;
  readonly VITE_MOCK?: string;
  readonly VITE_GEOCODE_URL?: string;
  readonly VITE_DEMO_VIDEO_URL?: string;
  readonly VITE_MAPKIT_TOKEN_URL?: string;   // experiment: workers/mapkit-token, for ?map=apple
}

declare module "virtual:maplibre-worker" {
  const url: string;
  export default url;
}
