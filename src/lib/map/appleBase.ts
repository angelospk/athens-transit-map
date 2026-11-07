// Apple Maps as the base map in 2D (MapKit JS). MapKit has no way to draw our own layers inside it (no custom WebGL
// layer: only circles, lines, polygons and tiles), so it goes UNDER our map: MapLibre keeps every layer of ours (lines,
// stops, buses, the guide) on a transparent canvas with its own base map hidden, and moves the Apple map with it on
// every frame. 3D keeps MapLibre's own base map (the modelled streets need it). Rotation and tilt are off in 2D, so
// the two only need the same centre and scale.
//
// On only with a token: VITE_MAPKIT_TOKEN, a MapKit JS token (scripts/mapkit-token.mjs makes one from an Apple
// Developer key). Without it, or when Apple refuses it, the map stays as it was.

/* eslint-disable @typescript-eslint/no-explicit-any */
type MapKit = any;
declare global { interface Window { mapkit?: MapKit; __mapkitReady?: () => void } }

export const MAPKIT_TOKEN = (import.meta.env.VITE_MAPKIT_TOKEN as string | undefined) || "";
const SRC = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";

let kit: Promise<MapKit> | null = null;
function loadKit(token: string, onError: () => void): Promise<MapKit> {
  return (kit ??= new Promise<MapKit>((ok, fail) => {
    window.__mapkitReady = () => {
      const mk = window.mapkit;
      if (!mk) return fail(new Error("mapkit"));
      mk.addEventListener("error", onError);   // a token Apple refuses (expired, another origin)
      mk.init({ authorizationCallback: (done: (t: string) => void) => done(token), language: "el" });
      ok(mk);
    };
    const s = document.createElement("script");
    s.src = SRC;
    s.crossOrigin = "anonymous";
    s.async = true;
    s.dataset.callback = "__mapkitReady";
    s.dataset.libraries = "map";
    s.onerror = () => fail(new Error("mapkit script"));
    document.head.append(s);
  }));
}

export class AppleBase {
  private el: HTMLDivElement;
  private map: MapKit = null;
  private mk: MapKit = null;
  failed = false;
  /** Called once if Apple refuses the token or the script does not load: the caller shows its own base map again. */
  onFail: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "applemap";
    this.el.setAttribute("aria-hidden", "true");
    this.el.hidden = true;
    parent.prepend(this.el);   // under MapLibre's canvas, which comes after it
  }

  private fail = () => {
    if (this.failed) return;
    this.failed = true;
    this.el.hidden = true;
    this.onFail();
  };

  /** Shows the Apple map (loading MapKit the first time); false when it can't. */
  async show(dark: boolean): Promise<boolean> {
    if (this.failed || !MAPKIT_TOKEN) return false;
    try {
      this.mk ??= await loadKit(MAPKIT_TOKEN, this.fail);
    } catch {
      this.fail();
      return false;
    }
    const mk = this.mk;
    if (!this.map) {
      this.map = new mk.Map(this.el, {
        isScrollEnabled: false, isZoomEnabled: false, isRotationEnabled: false,
        showsCompass: mk.FeatureVisibility.Hidden, showsScale: mk.FeatureVisibility.Hidden,
        showsZoomControl: false, showsMapTypeControl: false, showsUserLocationControl: false,
        // Our own stops and stations are drawn over it; Apple's shops and sights would only crowd them.
        pointOfInterestFilter: mk.PointOfInterestFilter.excludingAllCategories,
        padding: new mk.Padding(0, 0, 0, 0),
      });
    }
    this.setDark(dark);
    this.el.hidden = false;
    return !this.failed;
  }

  hide() { this.el.hidden = true; }

  setDark(dark: boolean) {
    if (this.map && this.mk) this.map.colorScheme = dark ? this.mk.Map.ColorSchemes.Dark : this.mk.Map.ColorSchemes.Light;
  }

  /** The same view as MapLibre's: its centre, and its scale (512 px tiles: the world is 512·2^zoom px wide). */
  sync(center: { lat: number; lng: number }, zoom: number, width: number, height: number) {
    if (!this.map || this.el.hidden) return;
    const mk = this.mk, world = 512 * 2 ** zoom, w = width / world, h = height / world;
    const p = new mk.Coordinate(center.lat, center.lng).toMapPoint();
    this.map.setVisibleMapRectAnimated(new mk.MapRect(p.x - w / 2, p.y - h / 2, w, h), false);
  }
}
