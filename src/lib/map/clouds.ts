// Clouds over the map, where there are clouds now: Open-Meteo's cloud cover (free, no key; the same service the 3D
// rain uses) on a grid over the city, now and in the next hour, and clouds up in the sky to match it: heaped, with
// height (a cumulus' dome, grey underneath, bright on top), drifting slowly across the city in a loop. Where the cover
// grows or thins, clouds come and go there by themselves, smoothly, as the hour goes on and each new reading arrives.
// Under the map's names and everything the app draws, so they never hide a stop or a vehicle; they fade out as you
// zoom in (gone at street level). The cover is asked again every 20 minutes.

import { MercatorCoordinate, type CustomLayerInterface, type Map as MlMap } from "maplibre-gl";

const N = 6;                 // the grid: N × N points over the area
const SPAN = 0.42;           // degrees each side of the city's centre
const EVERY_MS = 20 * 60_000;

export type Cover = { at: [number, number]; cover: number }[];   // cover 0-1 at [lon, lat]
/** The sky: the cover now and in the next hour (each a grid), and when each holds (unix seconds). */
export interface Sky { now: Cover; next: Cover | null; t0: number; t1: number }

type OmPoint = { current?: { time?: number; cloud_cover?: number }; hourly?: { time?: number[]; cloud_cover?: number[] } };

/** The cloud cover on a grid round a centre, now and the next hour, from Open-Meteo (all points in one request). */
export async function fetchSky(center: [number, number], signal?: AbortSignal): Promise<Sky | null> {
  const lats: number[] = [], lons: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    lons.push(+(center[0] - SPAN + (2 * SPAN * i) / (N - 1)).toFixed(3));
    lats.push(+(center[1] - SPAN + (2 * SPAN * j) / (N - 1)).toFixed(3));
  }
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}`
      + "&current=cloud_cover&hourly=cloud_cover&forecast_hours=3&timeformat=unixtime", { signal });
    if (!r.ok) return null;
    const j = (await r.json()) as OmPoint[] | OmPoint;
    const all = Array.isArray(j) ? j : [j];
    if (all.length !== lats.length) return null;
    const pct = (v: number | undefined) => Math.max(0, Math.min(1, (v ?? 0) / 100));
    const t0 = all[0].current?.time ?? Math.floor(Date.now() / 1000);
    const k1 = (all[0].hourly?.time ?? []).findIndex(t => t > t0);
    const now: Cover = all.map((x, k) => ({ at: [lons[k], lats[k]], cover: pct(x.current?.cloud_cover) }));
    const next: Cover | null = k1 < 0 ? null : all.map((x, k) => ({ at: [lons[k], lats[k]], cover: pct(x.hourly?.cloud_cover?.[k1]) }));
    return { now, next, t0, t1: k1 < 0 ? t0 + 3600 : all[0].hourly!.time![k1] };
  } catch { return null; }
}
/** The cover now only (the older call; kept for the rain and the tests). */
export async function fetchCover(center: [number, number], signal?: AbortSignal): Promise<Cover | null> {
  return (await fetchSky(center, signal))?.now ?? null;
}

/** How much cloud (0-1) at a point of the image (u, v in 0-1, v down), from the grid (bilinear). */
export function coverAt(cover: Cover, u: number, v: number): number {
  const fx = u * (N - 1), fy = (1 - v) * (N - 1), i = Math.min(N - 2, Math.floor(fx)), j = Math.min(N - 2, Math.floor(fy));
  const tx = fx - i, ty = fy - j, c = (a: number, b: number) => cover[b * N + a]?.cover ?? 0;
  return c(i, j) * (1 - tx) * (1 - ty) + c(i + 1, j) * tx * (1 - ty) + c(i, j + 1) * (1 - tx) * ty + c(i + 1, j + 1) * tx * ty;
}
/** The cover between now and the next hour, at a time (unix seconds). */
export function coverWhen(sky: Sky, t: number): number[] {
  const f = sky.next ? Math.max(0, Math.min(1, (t - sky.t0) / Math.max(1, sky.t1 - sky.t0))) : 0;
  return sky.now.map((p, k) => p.cover * (1 - f) + (sky.next?.[k].cover ?? p.cover) * f);
}

// ---- The field: every cloud the sky can hold, fixed once; the cover decides which show. A cloud has a threshold
// (it shows where the cover is above it), so a sky a third covered shows about a third of them, the same ones as the
// cover grows, others joining them; none flicker.
const ALT = 1500;             // metres: a cloud's base
export const HALF = SPAN * 111_000 * 0.82;   // metres: the cover grid, each side of the centre
const FIELD = HALF * 2;                      // metres: the clouds' pattern, each side (it repeats beyond)
export type Puff = { x: number; y: number; z: number; r: number; t: number; shade: number; phase: number };

/** Every puff of every cloud (metres east and north of the centre, up), with its cloud's threshold. Pure. */
export function cloudField(seed = 5): Puff[] {
  const out: Puff[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647), s / 2147483647);
  const step = 3400;
  for (let y = -FIELD; y < FIELD; y += step) for (let x = -FIELD; x < FIELD; x += step) {
    // A cloud: a flat-bottomed heap, the big puffs low in its middle, smaller ones up and round them (a cumulus).
    const cx = x + (rnd() - 0.5) * step, cy = y + (rnd() - 0.5) * step, t = rnd(), size = 1100 + rnd() * 1300, tall = 500 + rnd() * 900;
    const n = 14 + Math.round(rnd() * 12), phase = rnd() * 6.28;
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * size, inner = 1 - d / size;
      const up = Math.pow(rnd(), 1.6) * tall * (0.35 + 0.65 * inner);
      out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.7, z: ALT + up, t,
        r: (650 + rnd() * 750) * (0.6 + 0.6 * inner) * (1 - 0.35 * up / tall), shade: up / tall, phase: phase + k * 0.37 });
    }
  }
  return out;
}

/** The puffs that show under a cover (each cloud where its threshold is under the cover there). For the tests. */
export function cloudPuffs(cover: Cover, seed = 5): Puff[] {
  const at = (m: number) => Math.max(0, Math.min(1, (m + HALF) / (2 * HALF)));
  return cloudField(seed).filter(p => coverAt(cover, at(p.x), 1 - at(p.y)) * 0.95 > p.t);
}

/** The clouds on a map, in the sky (a three.js layer under the map's names). show() again after a restyle; the sky is
 *  kept and asked again every 20 minutes, and the layer follows it without being built again. */
type T3 = typeof import("three");
type Layer = CustomLayerInterface & { setCover(c: number[]): void };
export class Clouds {
  private sky: Sky | null = null;
  private at = 0;
  private busy = false;
  private layer: Layer | null = null;
  private timer = 0;
  async show(map: MlMap, center: [number, number], dark: boolean, before?: string) {
    if (!this.sky || Date.now() - this.at > EVERY_MS) {
      if (this.busy) return;
      this.busy = true;
      const got = await fetchSky(center, AbortSignal.timeout(10_000));
      this.busy = false;
      if (got) { this.sky = got; this.at = Date.now(); }
      if (!this.sky) return;
    }
    if (!map.getStyle()) return;
    if (map.getLayer("clouds3d") && this.layer) { this.follow(); return; }   // there: it takes the new cover by itself
    const T = (await import("three")) as T3;
    if (map.getLayer("clouds3d")) map.removeLayer("clouds3d");
    this.layer = cloudLayer(T, cloudField(), center, dark);
    map.addLayer(this.layer as never, before);
    this.follow();
  }
  // The cover as the hour goes on (between now and the next hour), every 15 s; the layer eases to it.
  private follow() {
    clearInterval(this.timer);
    const put = () => { if (this.sky && this.layer) this.layer.setCover(coverWhen(this.sky, Date.now() / 1000)); };
    put();
    this.timer = window.setInterval(put, 15_000);
  }
}

// ---- Drawing: each puff a soft billboard (always facing the camera, so a cloud has height from any angle), its size
// in metres, its texture a puff of noise; grey under, white on top. The field drifts with the wind in a loop (a puff
// leaving one side comes back at the other, faded near the edges), slowly breathing; a cloud fades in or out where the
// cover crosses its threshold. The cover reaches the GPU as a 6 × 6 texture, eased each frame towards the latest.
const WIND = 90, WIND_DIR = [0.93, 0.36];   // m/s: a time-lapse of the real drift (at ~10 m/s it would not be seen move)

function puffTexture(T: T3) {
  const S = 128, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!, img = g.createImageData(S, S);
  // Value noise, a few octaves, inside a round falloff: a puff with a ragged, soft edge.
  const L = 16, grid = Array.from({ length: (L + 1) * (L + 1) }, () => Math.random());
  const vn = (x: number, y: number, f: number) => {
    const fx = (x / S) * f, fy = (y / S) * f, i = Math.floor(fx) % L, j = Math.floor(fy) % L, tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), q = (a: number, b: number) => grid[b * (L + 1) + a];
    return (q(i, j) * (1 - sx) + q(i + 1, j) * sx) * (1 - sy) + (q(i, j + 1) * (1 - sx) + q(i + 1, j + 1) * sx) * sy;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2), d = Math.sqrt(dx * dx + dy * dy);
    const n = vn(x, y, 3) * 0.55 + vn(x, y, 6) * 0.3 + vn(x, y, 12) * 0.15;
    const fall = Math.max(0, 1 - d), a = Math.max(0, Math.min(1, fall * fall * (0.55 + 0.9 * n) * 1.6 - 0.12));
    const k = (y * S + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
    img.data[k + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

const VERT = `
attribute float aR; attribute float aT; attribute float aShade; attribute float aPhase;
uniform vec2 uOffset; uniform float uHalf; uniform sampler2D uCover; uniform vec2 uViewport; uniform float uTime; uniform vec2 uCam;
varying float vA; varying float vShade; varying float vFar;
void main() {
  vec3 p = position;
  // The field is a pattern that repeats every 2·uHalf; each puff is drawn in the copy nearest the camera, so the
  // clouds stay put on the map and there are always some around wherever you look.
  p.xy = mod(p.xy + uOffset - uCam + uHalf, 2.0 * uHalf) - uHalf + uCam;
  vec2 uv = p.xy / ${HALF.toFixed(1)} * 0.5 + 0.5;
  float c = texture2D(uCover, (clamp(uv, 0.0, 1.0) * 5.0 + 0.5) / 6.0).r;
  float on = smoothstep(aT - 0.05, aT + 0.05, c * 0.95);
  // No square: a round edge that waves (mockup 36), thinning out from well inside it.
  vec2 q = p.xy - uCam;
  float d = length(q), th = atan(q.y, q.x);
  float R = uHalf * 0.96 * (1.0 + 0.12 * sin(3.0 * th + 1.3) + 0.07 * sin(7.0 * th + 0.4) + 0.04 * sin(13.0 * th));
  float edge = 1.0 - smoothstep(0.55 * R, R, d);
  vA = on * edge;
  vFar = smoothstep(0.35 * R, 0.9 * R, d);
  vShade = aShade;
  float r = aR * (0.8 + 0.3 * c) * (1.0 + 0.07 * sin(uTime * 0.12 + aPhase));
  mat4 m = projectionMatrix * modelViewMatrix;
  vec4 a = m * vec4(p, 1.0), bx = m * vec4(p + vec3(r, 0.0, 0.0), 1.0), bz = m * vec4(p + vec3(0.0, 0.0, r), 1.0);
  vec2 s = a.xy / a.w;
  float px = max(length((bx.xy / bx.w - s) * uViewport), length((bz.xy / bz.w - s) * uViewport));
  gl_Position = a;
  gl_PointSize = vA < 0.01 || a.w <= 0.0 ? 0.0 : clamp(2.0 * px, 0.0, 512.0);   // a diameter
}`;
const FRAG = `
uniform sampler2D uTex; uniform float uOpacity; uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uHaze;
varying float vA; varying float vShade; varying float vFar;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  float light = clamp(vShade * 0.55 + (1.0 - gl_PointCoord.y) * 0.45, 0.0, 1.0);
  float a = t.a * vA * uOpacity;
  if (a < 0.004) discard;
  // Far off they lose their shading into a flat haze, as clouds near the horizon do.
  gl_FragColor = vec4(mix(mix(uBottom, uTop, light), uHaze, vFar * 0.75), a);
}`;

function cloudLayer(T: T3, puffs: Puff[], center: [number, number], dark: boolean): Layer {
  let renderer: import("three").WebGLRenderer | null = null, scene: import("three").Scene | null = null, camera: import("three").Camera | null = null;
  let mat: import("three").ShaderMaterial | null = null, pts: import("three").Points | null = null;
  let map: MlMap | null = null, tick = 0, shown = false;
  const ref = MercatorCoordinate.fromLngLat(center, 0), scale = ref.meterInMercatorCoordinateUnits(), born = performance.now();
  const target = new Float32Array(N * N), shownCover = new Float32Array(N * N), texData = new Uint8Array(N * N * 4);
  const tex = new T.DataTexture(texData, N, N, T.RGBAFormat);
  tex.magFilter = tex.minFilter = T.LinearFilter;
  tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
  let first = true;
  const ease = () => {   // the shown cover a step towards the latest (fully at once the first time)
    let moved = false;
    for (let k = 0; k < N * N; k++) {
      const v = first ? target[k] : shownCover[k] + (target[k] - shownCover[k]) * 0.02;
      if (Math.abs(v - shownCover[k]) > 1e-4) moved = true;
      shownCover[k] = v;
      texData[k * 4] = Math.round(v * 255);
    }
    first = false;
    if (moved) tex.needsUpdate = true;
  };
  return {
    id: "clouds3d", type: "custom", renderingMode: "3d",
    setCover(c: number[]) { c.forEach((v, k) => (target[k] = v)); if (first) ease(); },
    onAdd(m, gl) {
      map = m;
      renderer = new T.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      scene = new T.Scene();
      camera = new T.Camera();
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.Float32BufferAttribute(puffs.flatMap(p => [p.x, p.y, p.z]), 3));
      geo.setAttribute("aR", new T.Float32BufferAttribute(puffs.map(p => p.r), 1));
      geo.setAttribute("aT", new T.Float32BufferAttribute(puffs.map(p => p.t), 1));
      geo.setAttribute("aShade", new T.Float32BufferAttribute(puffs.map(p => p.shade), 1));
      geo.setAttribute("aPhase", new T.Float32BufferAttribute(puffs.map(p => p.phase), 1));
      mat = new T.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
        uniforms: { uOffset: { value: new T.Vector2() }, uHalf: { value: FIELD }, uCover: { value: tex }, uViewport: { value: new T.Vector2(1, 1) },
          uTime: { value: 0 }, uTex: { value: puffTexture(T) }, uOpacity: { value: 0.6 }, uCam: { value: new T.Vector2() },
          uHaze: { value: new T.Color(dark ? 0x9aa3b3 : 0xdfe4ea) },
          uTop: { value: new T.Color(dark ? 0xd5dbe6 : 0xffffff) }, uBottom: { value: new T.Color(dark ? 0x7c8494 : 0xb9c1cc) } },
      });
      pts = new T.Points(geo, mat);
      pts.frustumCulled = false;
      scene.add(pts);
      // The drift, smooth: ten frames a second while the clouds show (and the page does).
      tick = window.setInterval(() => { if (shown && !document.hidden) m.triggerRepaint(); }, 100);
    },
    render(gl, args) {
      if (!renderer || !scene || !camera || !mat || !pts || !map) return;
      const z = map.getZoom();
      const op = z >= 13 ? 0 : z <= 9 ? 0.62 : z <= 11 ? 0.62 - (z - 9) * 0.1 : 0.42 * (13 - z) / 2;
      shown = op > 0.01;
      if (!shown) return;
      ease();
      const sec = (performance.now() - born) / 1000, d = sec * WIND;
      mat.uniforms.uOpacity.value = op;
      mat.uniforms.uTime.value = sec;
      (mat.uniforms.uOffset.value as import("three").Vector2).set(d * WIND_DIR[0], d * WIND_DIR[1]);
      const cm = MercatorCoordinate.fromLngLat(map.getCenter(), 0);
      (mat.uniforms.uCam.value as import("three").Vector2).set((cm.x - ref.x) / scale, -(cm.y - ref.y) / scale);
      (mat.uniforms.uViewport.value as import("three").Vector2).set(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2);
      const main = (args as unknown as { defaultProjectionData: { mainMatrix: number[] } }).defaultProjectionData.mainMatrix;
      const l = new T.Matrix4().makeTranslation(ref.x, ref.y, ref.z).scale(new T.Vector3(scale, -scale, scale));
      camera.projectionMatrix = new T.Matrix4().fromArray(main).multiply(l);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() { clearInterval(tick); pts?.geometry.dispose(); (mat?.uniforms.uTex.value as import("three").Texture | undefined)?.dispose(); tex.dispose(); mat?.dispose(); renderer?.dispose(); renderer = null; },
  };
}
