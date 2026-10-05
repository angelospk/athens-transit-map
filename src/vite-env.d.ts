/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_STATIC_BASE?: string;
  readonly VITE_MOCK?: string;
}

declare module "virtual:maplibre-worker" {
  const url: string;
  export default url;
}
