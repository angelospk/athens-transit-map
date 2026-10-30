// Loads MapKit JS 5 from Apple's CDN once, and authorizes it with tokens from our Worker (workers/mapkit-token).
/// <reference types="apple-mapkit-js-browser" />

export const TOKEN_URL: string | undefined = import.meta.env.VITE_MAPKIT_TOKEN_URL;
const SRC = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";
const LIBRARIES = "full-map,services";

let ready: Promise<typeof mapkit> | null = null;

// Rejects with a short Greek reason the view shows.
export function loadMapKit(tokenUrl: string, onError: (status: string) => void): Promise<typeof mapkit> {
  ready ??= new Promise<typeof mapkit>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.crossOrigin = "anonymous";
    s.dataset.libraries = LIBRARIES;
    // core.js loads the libraries itself, then calls this global.
    s.dataset.callback = "__atmMapKitReady";
    (window as unknown as Record<string, () => void>).__atmMapKitReady = init;
    s.onerror = () => { ready = null; reject(new Error("Δεν φόρτωσε το MapKit JS από την Apple.")); };
    function init() {
      mapkit.init({
        language: "el",
        authorizationCallback: done => {
          fetch(tokenUrl).then(r => (r.ok ? r.text() : Promise.reject(new Error(`token ${r.status}`))))
            .then(done, () => onError("Token"));
        },
      });
      // Unauthorized, Too Many Requests, Malformed Response…
      mapkit.addEventListener("error", (e: { status?: string }) => onError(e.status ?? "Error"));
      resolve(mapkit);
    }
    document.head.append(s);
  });
  return ready;
}
