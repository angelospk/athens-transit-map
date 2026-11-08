// Athens metro entrance sign (the stainless pylon at every station entrance), built in three.js.
// Real-world metres, y up, origin on the ground midway between the two posts, front facing +z.
//
//   createMetroSign({ name: "Σύνταγμα", latin: "Syntagma" })  -> THREE.Group, ~3.1 m tall
//
// The roundel face is left blank on purpose: pass your own image as `roundel` (a URL, <img> or <canvas>).

import * as THREE from "three";

export type SignImage = string | HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface MetroSignOptions {
  name: string;           // Greek station name, e.g. "Σύνταγμα"
  latin?: string;         // Latin line under it, e.g. "Syntagma"
  roundel?: SignImage;    // square image for the round lightbox, drawn on both faces
  adFront?: SignImage;    // ad in the lower case, front face (replaces the street map)
  adBack?: SignImage;     // ad on the back of the case (otherwise plain steel)
  adFit?: "cover" | "contain"; // cover crops to fill the panel (default), contain shows the whole image
  lit?: boolean;          // lightboxes and ads glow (night look); default true
}

// Measured off the Syntagma photos (posts ~0.94 m apart, roundel as wide as the gap).
export const SIGN = {
  postX: 0.47, postR: 0.034, postH: 2.78,
  roundelY: 2.72, roundelR: 0.40, roundelD: 0.11,
  plateY: 2.13, plateW: 0.87, plateH: 0.30, plateD: 0.09,
  mapBottom: 1.02, mapTop: 1.93, mapD: 0.065,
  barY: 0.16,
} as const;

// Visible area of the ad panel behind the glass. Make ad artwork at this ratio (e.g. 1000 x 1046 px).
const PANEL_LIP = 0.025;
const panelW = SIGN.postX * 2 - SIGN.postR * 2 - PANEL_LIP * 2, panelH = SIGN.mapTop - SIGN.mapBottom - PANEL_LIP * 2;
export const AD_PANEL = { widthM: +panelW.toFixed(3), heightM: +panelH.toFixed(3), aspect: +(panelW / panelH).toFixed(4) } as const;

const shared = new Map<string, THREE.Material | THREE.Texture>();
function once<T extends THREE.Material | THREE.Texture>(key: string, make: () => T): T {
  let v = shared.get(key) as T | undefined;
  if (!v) shared.set(key, (v = make()));
  return v;
}

const steel = () => once("steel", () => new THREE.MeshStandardMaterial({ name: "brushed_steel", color: 0xc4c8cb, metalness: 0.9, roughness: 0.3 }));
const steelDark = () => once("steelDark", () => new THREE.MeshStandardMaterial({ name: "steel_back", color: 0x8e9396, metalness: 0.75, roughness: 0.45 }));
const glass = () => once("glass", () => new THREE.MeshStandardMaterial({ name: "glass", color: 0xdfeaf0, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.14, depthWrite: false }));

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, g: c.getContext("2d")! };
}

function toTexture(c: HTMLCanvasElement | HTMLImageElement | ImageBitmap) {
  const t = new THREE.Texture(c as HTMLCanvasElement);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function imageTexture(src: SignImage): THREE.Texture {
  if (typeof src !== "string") return toTexture(src);
  const t = new THREE.TextureLoader().load(src);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Draws an ad into a canvas at the panel's ratio, cropped (cover) or letterboxed (contain).
// URLs load asynchronously; the texture updates itself once the image arrives.
function adTexture(src: SignImage, fit: "cover" | "contain") {
  const H = 1400, W = Math.round(H * AD_PANEL.aspect);
  const { c, g } = canvas(W, H);
  const t = toTexture(c);
  const draw = (img: CanvasImageSource & { width: number; height: number }) => {
    const iw = (img as HTMLImageElement).naturalWidth || img.width, ih = (img as HTMLImageElement).naturalHeight || img.height;
    const k = fit === "cover" ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
    g.fillStyle = "#101113"; g.fillRect(0, 0, W, H);
    g.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
    t.needsUpdate = true;
  };
  g.fillStyle = "#101113"; g.fillRect(0, 0, W, H);
  if (typeof src === "string") {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => draw(img);
    img.src = src;
  } else draw(src as HTMLImageElement);
  return t;
}

function lightbox(map: THREE.Texture, lit: boolean, name: string) {
  return new THREE.MeshStandardMaterial({
    name, map, roughness: 0.35, metalness: 0,
    emissive: lit ? 0xffffff : 0x000000, emissiveMap: lit ? map : null, emissiveIntensity: lit ? 0.2 : 0,
  });
}

// ---- textures ---------------------------------------------------------------------------------------

const FONT = `"Noto Sans", "Segoe UI", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif`;

function fitText(g: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number) {
  g.font = `${weight} ${size}px ${FONT}`;
  const w = g.measureText(text).width;
  if (w > maxW) g.font = `${weight} ${Math.floor(size * maxW / w)}px ${FONT}`;
}

function plateTexture(name: string, latin?: string) {
  const W = 1024, H = Math.round(W * SIGN.plateH / SIGN.plateW);
  const { c, g } = canvas(W, H);
  g.fillStyle = "#f7f8f6"; g.fillRect(0, 0, W, H);
  const band = Math.round(H * 0.085), inset = Math.round(H * 0.07);
  g.fillStyle = "#d42e31"; g.fillRect(0, inset, W, band);          // red stripe on top
  g.fillStyle = "#1f3f95"; g.fillRect(0, H - inset - band, W, band); // blue stripe at the bottom
  g.fillStyle = "#1b1d21";
  g.textAlign = "center"; g.textBaseline = "middle";
  const mid = H / 2;
  if (latin) {
    fitText(g, name, 700, H * 0.34, W * 0.86);
    g.fillText(name, W / 2, mid - H * 0.09);
    fitText(g, latin, 600, H * 0.2, W * 0.8);
    g.fillText(latin, W / 2, mid + H * 0.19);
  } else {
    fitText(g, name, 700, H * 0.4, W * 0.86);
    g.fillText(name, W / 2, mid);
  }
  return toTexture(c);
}

function blankRoundel() {
  const S = 512, { c, g } = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "#ffffff"); grd.addColorStop(1, "#eceeec");
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return toTexture(c);
}

// A made-up street map: beige blocks, white streets, a park and a square. Seeded so it never changes.
function streetMapTexture() {
  return once("streetMap", () => {
    const W = 768, H = Math.round(W * (SIGN.mapTop - SIGN.mapBottom) / SIGN.plateW);
    const { c, g } = canvas(W, H);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.fillStyle = "#e4d8bf"; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.18); g.translate(-W, -H);
    for (let y = 0; y < H * 2; y += 34 + rnd() * 26) for (let x = 0; x < W * 2; x += 40 + rnd() * 34) {
      g.fillStyle = rnd() > 0.85 ? "#cdbb98" : "#ead9b8";
      g.fillRect(x + 4, y + 4, 30 + rnd() * 20, 24 + rnd() * 18);
    }
    g.restore();
    g.strokeStyle = "#ffffff"; g.lineCap = "round";
    for (let i = 0; i < 26; i++) {
      g.lineWidth = rnd() > 0.8 ? 9 : 4;
      const vertical = rnd() > 0.5, p = rnd();
      g.beginPath();
      if (vertical) { g.moveTo(p * W, 0); g.lineTo(p * W + (rnd() - 0.5) * 160, H); }
      else { g.moveTo(0, p * H); g.lineTo(W, p * H + (rnd() - 0.5) * 160); }
      g.stroke();
    }
    g.fillStyle = "#8fbf6a";
    g.beginPath(); g.moveTo(W * 0.58, H * 0.42); g.lineTo(W * 0.95, H * 0.38); g.lineTo(W * 0.97, H * 0.92); g.lineTo(W * 0.6, H * 0.95); g.closePath(); g.fill();
    g.fillStyle = "#e7a98e"; g.fillRect(W * 0.42, H * 0.36, W * 0.12, H * 0.08);
    g.fillStyle = "#d42e31"; g.beginPath(); g.arc(W * 0.47, H * 0.4, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#3a6fb8"; g.lineWidth = 3; g.strokeRect(6, 6, W - 12, H - 12);
    return toTexture(c);
  });
}

// ---- geometry ---------------------------------------------------------------------------------------

function mesh(name: string, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function post(x: number) {
  const g = new THREE.Group(); g.name = x < 0 ? "post_left" : "post_right";
  const tube = mesh("tube", new THREE.CylinderGeometry(SIGN.postR, SIGN.postR, SIGN.postH, 32), steel());
  tube.position.set(x, SIGN.postH / 2, 0);
  const cap = mesh("cap", new THREE.SphereGeometry(SIGN.postR, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), steel());
  cap.position.set(x, SIGN.postH, 0);
  const foot = mesh("foot", new THREE.CylinderGeometry(0.075, 0.08, 0.012, 32), steel());
  foot.position.set(x, 0.006, 0);
  g.add(tube, cap, foot);
  return g;
}

function bar(y: number, r: number, from: number, to: number, z = 0, mat = steel()) {
  const b = mesh("bar", new THREE.CylinderGeometry(r, r, to - from, 16), mat);
  b.rotation.z = Math.PI / 2;
  b.position.set((from + to) / 2, y, z);
  return b;
}

function roundel(face: THREE.Material) {
  const { roundelR: R, roundelD: D, roundelY: Y, postX } = SIGN;
  const g = new THREE.Group(); g.name = "roundel";
  const drum = mesh("drum", new THREE.CylinderGeometry(R, R, D, 64, 1, true), steel());
  drum.rotation.x = Math.PI / 2;
  g.add(drum);
  for (const side of [1, -1]) {
    const rim = mesh("rim", new THREE.TorusGeometry(R - 0.008, 0.016, 12, 64), steel());
    rim.position.z = side * D / 2;
    const f = mesh("face", new THREE.CircleGeometry(R - 0.018, 64), face);
    f.position.z = side * (D / 2 - 0.004);
    if (side < 0) f.rotation.y = Math.PI;
    g.add(rim, f);
  }
  g.position.y = Y;
  // short arms tying the drum to each post
  g.add(bar(0, 0.014, -postX, -R + 0.01), bar(0, 0.014, R - 0.01, postX));
  return g;
}

function plate(face: THREE.Material) {
  const { plateH: H, plateD: D, plateY: Y, postX, postR } = SIGN;
  const g = new THREE.Group(); g.name = "name_plate";
  const inner = postX * 2 - postR * 2;
  const frame = mesh("frame", new THREE.BoxGeometry(inner, H, D), steel());
  g.add(frame);
  for (const side of [1, -1]) {
    const f = mesh("face", new THREE.PlaneGeometry(inner - 0.03, H - 0.03), face);
    f.position.z = side * (D / 2 + 0.001);
    if (side < 0) f.rotation.y = Math.PI;
    g.add(f);
  }
  g.position.y = Y;
  return g;
}

function mapCase(front: THREE.Material, back?: THREE.Material) {
  const { mapBottom: B, mapTop: T, mapD: D, postX, postR } = SIGN;
  const g = new THREE.Group(); g.name = "map_case";
  const w = postX * 2 - postR * 2, h = T - B, lip = PANEL_LIP;
  g.add(mesh("body", new THREE.BoxGeometry(w, h, D), steelDark()));
  // a framed, glazed face; side 1 is the front, -1 the back
  const face = (side: 1 | -1, art: THREE.Material, name: string) => {
    const f = new THREE.Group(); f.name = name;
    const fz = D / 2 + 0.006;
    const top = mesh("frame_top", new THREE.BoxGeometry(w, lip, 0.014), steel()); top.position.set(0, h / 2 - lip / 2, fz);
    const bot = mesh("frame_bottom", new THREE.BoxGeometry(w, lip, 0.014), steel()); bot.position.set(0, -h / 2 + lip / 2, fz);
    const l = mesh("frame_left", new THREE.BoxGeometry(lip, h, 0.014), steel()); l.position.set(-w / 2 + lip / 2, 0, fz);
    const r = mesh("frame_right", new THREE.BoxGeometry(lip, h, 0.014), steel()); r.position.set(w / 2 - lip / 2, 0, fz);
    const pic = mesh("art", new THREE.PlaneGeometry(w - lip * 2, h - lip * 2), art); pic.position.z = D / 2 + 0.002;
    const pane = mesh("glass", new THREE.PlaneGeometry(w - lip * 2, h - lip * 2), glass()); pane.position.z = D / 2 + 0.01;
    pane.castShadow = false;
    f.add(top, bot, l, r, pic, pane);
    if (side < 0) f.rotation.y = Math.PI;
    return f;
  };
  g.add(face(1, front, "face_front"));
  if (back) g.add(face(-1, back, "face_back"));
  g.position.y = B + h / 2;
  return g;
}

export function createMetroSign(opts: MetroSignOptions): THREE.Group {
  const lit = opts.lit ?? true;
  const root = new THREE.Group();
  root.name = `metro_sign_${opts.latin ?? opts.name}`.replace(/\s+/g, "_");

  const roundelTex = opts.roundel ? imageTexture(opts.roundel) : once("blankRoundel", blankRoundel);
  const fit = opts.adFit ?? "cover";
  const front = opts.adFront
    ? lightbox(adTexture(opts.adFront, fit), lit, "ad_front")
    : new THREE.MeshStandardMaterial({ name: "map_face", map: streetMapTexture(), roughness: 0.6 });
  const back = opts.adBack ? lightbox(adTexture(opts.adBack, fit), lit, "ad_back") : undefined;

  root.add(
    post(-SIGN.postX), post(SIGN.postX),
    bar(SIGN.barY, 0.017, -SIGN.postX, SIGN.postX),
    roundel(lightbox(roundelTex, lit, "roundel_face")),
    plate(lightbox(plateTexture(opts.name, opts.latin), lit, "name_plate_face")),
    mapCase(front, back),
  );
  root.userData = { kind: "athens-metro-sign", name: opts.name, latin: opts.latin ?? null, heightM: SIGN.roundelY + SIGN.roundelR };
  return root;
}

// Disposes everything a sign owns except the shared steel/glass/street-map resources.
export function disposeMetroSign(sign: THREE.Object3D) {
  const keep = new Set(shared.values());
  sign.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of [m.material].flat()) {
      if (keep.has(mat)) continue;
      const s = mat as THREE.MeshStandardMaterial;
      if (s.map && !keep.has(s.map)) s.map.dispose();
      mat.dispose();
    }
  });
}
