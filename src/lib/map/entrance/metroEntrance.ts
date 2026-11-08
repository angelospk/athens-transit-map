// Athens metro street entrance: the sunken stairwell (marble parapets, granite steps, a landing, steel
// handrails, the covered portal at the bottom) with the sign pylon and the glass elevator beside it.
// Real-world metres, y up. Origin is the top step's front edge at plaza level, centred on the stairs.
// You walk in from +z; the stairs go down towards -z.
//
//   createMetroEntrance({ name: "Σύνταγμα", latin: "Syntagma" })  -> THREE.Group
//   createMetroStairs()                                           -> just the stairwell

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createMetroSign, type MetroSignOptions } from "./metroSign";
import { createMetroElevator, ELEVATOR } from "./metroElevator";

export interface Direction { el: string; en?: string; airport?: boolean; color?: string } // color: the line's colour, as the stripe on top

export interface StairsOptions {
  width?: number;          // clear width between the walls; default 5.0
  upperSteps?: number;     // steps above the landing; default 8
  lowerSteps?: number;     // steps below the landing; default 9
  parapet?: number;        // wall height above the plaza; default 0.95
  directions?: Direction[]; // one or two panels on the band over the portal (defaults to Syntagma's; [] is a blank band)
  shutter?: boolean;       // roll-down shutter pulled down behind the band; default false
}

const SYNTAGMA: Direction[] = [
  { el: "Προς Ανθούπολη / Ελληνικό", en: "To Anthoupoli / Elliniko", color: "#e2231a" },
  { el: "Προς Δημοτικό Θέατρο / Αεροδρόμιο", en: "To Dimotiko Theatro / Airport", airport: true, color: "#0a64b4" },
];

export interface EntranceOptions extends MetroSignOptions, StairsOptions {
  plaza?: boolean | { width: number; depth: number }; // paved slab around the opening; default 18 x 24
  signSide?: "left" | "right";                          // side of the opening for the pylon; default right
  elevator?: boolean;                                   // glass elevator beyond the pylon; default true
}

const RISE = 0.155, TREAD = 0.32, LANDING = 2.0, WALL = 0.3, COPING = 0.42, PORTAL = 3.2, CLEAR = 2.35;

// ---- materials --------------------------------------------------------------------------------------

function rng(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function tex(draw: (g: CanvasRenderingContext2D, S: number) => void, S = 1024) {
  const c = document.createElement("canvas"); c.width = c.height = S;
  draw(c.getContext("2d")!, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

let mats: Record<"marble" | "granite" | "paving" | "tactile" | "steel" | "dark" | "shutter" | "white" | "nosing" | "passage" | "lamp" | "adGlow", THREE.Material> | null = null;
function materials() {
  if (mats) return mats;
  // white Pentelic-style marble: pale slabs with soft grey veins and visible joints
  const marble = tex((g, S) => {
    const r = rng(11);
    g.fillStyle = "#d9d9d4"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(105,110,116,${0.1 + r() * 0.2})`; g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.3) * 120; y += (r() - 0.5) * 60; g.lineTo(x, y); }
      g.stroke();
    }
    g.strokeStyle = "rgba(80,82,86,0.5)"; g.lineWidth = 3;
    for (let p = 0; p <= S; p += S / 2) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke(); }
    for (let p = 0; p <= S; p += S / 4) { g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke(); }
  });
  // grey granite steps: fine speckle
  const granite = tex((g, S) => {
    const r = rng(5);
    g.fillStyle = "#6f7276"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 26000; i++) {
      const v = 60 + Math.floor(r() * 120); g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
      g.fillRect(r() * S, r() * S, 1 + r() * 2.5, 1 + r() * 2.5);
    }
  }, 512);
  // plaza: white marble slabs in staggered rows (texture covers 4 x 4 m: 60 x 40 cm slabs)
  const paving = tex((g, S) => {
    const r = rng(3), w = S / 6.667, h = S / 10;
    g.fillStyle = "#9d9c97"; g.fillRect(0, 0, S, S);
    for (let row = 0; row < 10; row++) for (let col = -1; col < 8; col++) {
      const x = col * w + (row % 2) * w / 2, y = row * h, v = 214 + Math.floor(r() * 22);
      g.fillStyle = `rgb(${v},${v},${v - 3})`; g.fillRect(x + 2, y + 2, w - 3, h - 3);
      g.save(); g.beginPath(); g.rect(x + 2, y + 2, w - 3, h - 3); g.clip();
      for (let k = 0; k < 3; k++) {
        g.strokeStyle = `rgba(110,114,118,${0.08 + r() * 0.16})`; g.lineWidth = 0.6 + r() * 1.6;
        g.beginPath(); let vx = x + r() * w, vy = y + r() * h; g.moveTo(vx, vy);
        for (let q = 0; q < 5; q++) { vx += (r() - 0.4) * 40; vy += (r() - 0.5) * 22; g.lineTo(vx, vy); }
        g.stroke();
      }
      if (r() > 0.9) { g.fillStyle = "rgba(60,58,54,0.08)"; g.fillRect(x + 2, y + 2, w - 3, h - 3); } // weathered slab
      g.restore();
    }
  });
  // tactile guide tiles: raised parallel bars (texture covers 0.6 m)
  const tactile = tex((g, S) => {
    g.fillStyle = "#a9aaa6"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4; i++) {
      const x = S * (0.1 + i * 0.24);
      const grd = g.createLinearGradient(x, 0, x + S * 0.1, 0);
      grd.addColorStop(0, "#c9cac6"); grd.addColorStop(0.5, "#e2e3df"); grd.addColorStop(1, "#8c8d89");
      g.fillStyle = grd; g.fillRect(x, 0, S * 0.1, S);
    }
    g.fillStyle = "#7d7e7a"; g.fillRect(0, S / 2 - 2, S, 4);
  }, 256);
  // roll-down shutter: silver slats on a 6 cm pitch (texture covers 0.6 m). The slats are micro-perforated,
  // so the alpha map lets the lit passage show through them, and fully through the joints.
  const SLATS = 10;
  const shutter = tex((g, S) => {
    const p = S / SLATS;
    for (let i = 0; i < SLATS; i++) {
      const y = i * p, grd = g.createLinearGradient(0, y, 0, y + p);
      grd.addColorStop(0, "#e9ebec"); grd.addColorStop(0.35, "#c9cdd0"); grd.addColorStop(0.8, "#8f9498"); grd.addColorStop(1, "#5d6165");
      g.fillStyle = grd; g.fillRect(0, y, S, p);
    }
  }, 256);
  const shutterAlpha = tex((g, S) => {
    const p = S / SLATS;
    g.fillStyle = "#000"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < SLATS; i++) { g.fillStyle = "#c4c4c4"; g.fillRect(0, i * p + 2, S, p - 5); }
  }, 256);
  shutterAlpha.colorSpace = THREE.NoColorSpace;
  mats = {
    marble: new THREE.MeshStandardMaterial({ name: "marble", map: marble, roughness: 0.42 }),
    granite: new THREE.MeshStandardMaterial({ name: "granite", map: granite, roughness: 0.7 }),
    paving: new THREE.MeshStandardMaterial({ name: "paving", map: paving, roughness: 0.55 }),
    tactile: new THREE.MeshStandardMaterial({ name: "tactile_paving", map: tactile, roughness: 0.8 }),
    shutter: new THREE.MeshStandardMaterial({ name: "shutter", map: shutter, alphaMap: shutterAlpha, transparent: true, depthWrite: false, side: THREE.DoubleSide, metalness: 0.55, roughness: 0.4 }),
    passage: new THREE.MeshStandardMaterial({ name: "passage_floor", map: paving, roughness: 0.35 }),
    lamp: new THREE.MeshStandardMaterial({ name: "ceiling_light", color: 0xffffff, emissive: 0xfff4e2, emissiveIntensity: 1.6 }),
    adGlow: new THREE.MeshStandardMaterial({ name: "passage_lightbox", color: 0xe98a86, emissive: 0xe0605c, emissiveIntensity: 0.9, roughness: 0.5 }),
    white: new THREE.MeshStandardMaterial({ name: "white_metal", color: 0xe8e8e6, roughness: 0.45 }),
    nosing: new THREE.MeshStandardMaterial({ name: "step_nosing", color: 0x4a4c4f, roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ name: "brushed_steel", color: 0xc4c8cb, metalness: 0.9, roughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ name: "tunnel", color: 0x1c1d20, roughness: 0.9 }),
  };
  return mats;
}

// Box-projected UVs in world metres, so slabs and joints keep their real size on every surface.
function worldUV(geo: THREE.BufferGeometry, metresPerRepeat: number) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u / metresPerRepeat; uv[i * 2 + 1] = v / metresPerRepeat;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function merged(name: string, parts: THREE.BufferGeometry[], mat: THREE.Material, uvScale?: number) {
  let g = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p))!;
  if (uvScale) g = worldUV(g, uvScale);
  const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = true; m.receiveShadow = true;
  return m;
}

// A steel tube through a list of points, as straight cylinders with ball joints.
function rail(points: THREE.Vector3[], r: number) {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 12, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(g);
  }
  for (const p of points) parts.push(new THREE.SphereGeometry(r, 12, 8).translate(p.x, p.y, p.z));
  return parts;
}

// The airport pictogram: a plane seen from above, nose up-right.
function plane(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4); g.scale(size / 100, size / 100);
  g.beginPath();
  g.moveTo(0, -48); g.quadraticCurveTo(6, -44, 6, -30); g.lineTo(6, -8); g.lineTo(46, 14); g.lineTo(46, 22); g.lineTo(6, 10);
  g.lineTo(5, 32); g.lineTo(18, 42); g.lineTo(18, 48); g.lineTo(0, 43); g.lineTo(-18, 48); g.lineTo(-18, 42); g.lineTo(-5, 32);
  g.lineTo(-6, 10); g.lineTo(-46, 22); g.lineTo(-46, 14); g.lineTo(-6, -8); g.lineTo(-6, -30); g.quadraticCurveTo(-6, -44, 0, -48);
  g.fill(); g.restore();
}

// Backlit direction band: warm cream panels, each topped by its line's colour, dark lettering, and the
// navy airport tile at the end of the panel that heads to the airport.
function bandTexture(dirs: Direction[], widthM: number, heightM: number) {
  const H = 256, W = Math.min(4096, Math.round(H * widthM / heightM));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const font = `"Noto Sans", "Segoe UI", Arial, "DejaVu Sans", sans-serif`;
  g.fillStyle = "#ece3c9"; g.fillRect(0, 0, W, H);
  const n = Math.min(2, dirs.length), pw = W / Math.max(1, n), stripe = Math.round(H * 0.07);
  for (let i = 0; i < n; i++) {
    const d = dirs[i], x0 = i * pw, tile = d.airport ? H : 0;
    if (d.color) { g.fillStyle = d.color; g.fillRect(x0, 0, pw - tile, stripe); }
    if (i > 0) { g.fillStyle = "#3b3c3e"; g.fillRect(x0 - 4, 0, 8, H); }
    const cx = x0 + (pw - tile) / 2, maxW = pw - tile - 70;
    g.fillStyle = "#1d1d1b"; g.textAlign = "center"; g.textBaseline = "middle";
    const fit = (t: string, w: number, size: number) => { g.font = `${w} ${size}px ${font}`; const m = g.measureText(t).width; if (m > maxW) g.font = `${w} ${Math.floor(size * maxW / m)}px ${font}`; };
    fit(d.el, 700, 96); g.fillText(d.el, cx, d.en ? H * 0.42 : H * 0.56);
    if (d.en) { fit(d.en, 600, 60); g.fillText(d.en, cx, H * 0.78); }
    if (tile) {
      const x = x0 + pw - tile;
      g.fillStyle = "#1b2a6b"; g.fillRect(x, 0, tile, H);
      g.fillStyle = "#ffffff"; plane(g, x + tile / 2, H / 2, tile * 0.72);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---- the stairwell ----------------------------------------------------------------------------------

export function stairsLayout(o: StairsOptions = {}) {
  const width = o.width ?? 5.0, up = o.upperSteps ?? 8, low = o.lowerSteps ?? 9, parapet = o.parapet ?? 0.95;
  const z1 = -up * TREAD, y1 = -up * RISE;                 // foot of the upper flight
  const z2 = z1 - LANDING;                                  // end of the landing
  const z3 = z2 - low * TREAD, y3 = y1 - low * RISE;        // foot of the lower flight (bottom floor level)
  const z4 = z3 - PORTAL;                                   // back of the covered portal
  return { width, up, low, parapet, z1, y1, z2, z3, y3, z4, lintel: y3 + CLEAR, outer: width / 2 + WALL };
}

export function createMetroStairs(o: StairsOptions = {}): THREE.Group {
  const M = materials(), L = stairsLayout(o);
  const { width, up, low, parapet, z1, y1, z2, z3, y3, z4, lintel } = L;
  const half = width / 2, root = new THREE.Group(); root.name = "metro_stairs";

  // steps and landing: each step is a solid block down to the floor line, so no gaps show from the side
  const steps: THREE.BufferGeometry[] = [];
  for (let i = 0; i < up; i++) {
    const top = -(i + 1) * RISE, z = -i * TREAD - TREAD / 2;
    steps.push(box(width, top - (y3 - 0.3) , TREAD, 0, (top + y3 - 0.3) / 2, z));
  }
  steps.push(box(width, y1 - (y3 - 0.3), LANDING, 0, (y1 + y3 - 0.3) / 2, z1 - LANDING / 2));
  for (let i = 0; i < low; i++) {
    const top = y1 - (i + 1) * RISE, z = z2 - i * TREAD - TREAD / 2;
    steps.push(box(width, top - (y3 - 0.3), TREAD, 0, (top + y3 - 0.3) / 2, z));
  }
  root.add(merged("steps", steps, M.granite, 1.2));
  root.add(merged("passage_floor", [box(width, 0.3, PORTAL, 0, y3 - 0.15, z3 - PORTAL / 2)], M.passage, 4)); // marble floor inside
  // darker anti-slip strip along every nosing, so the steps read from above
  const nosings: THREE.BufferGeometry[] = [];
  // (on the edge you step off, i.e. the downhill side of each tread)
  for (let i = 0; i < up; i++) nosings.push(box(width - 0.02, 0.004, 0.05, 0, -(i + 1) * RISE + 0.002, -(i + 1) * TREAD + 0.03));
  for (let i = 0; i < low; i++) nosings.push(box(width - 0.02, 0.004, 0.05, 0, y1 - (i + 1) * RISE + 0.002, z2 - (i + 1) * TREAD + 0.03));
  root.add(merged("nosings", nosings, M.nosing));

  // side walls (full depth, below the plaza) + the parapets above the plaza along the open stretch
  const walls: THREE.BufferGeometry[] = [];
  const wallH = 0 - (y3 - 0.3), wallLen = -z4;
  for (const s of [-1, 1]) {
    const x = s * (half + WALL / 2);
    walls.push(box(WALL, wallH, wallLen, x, (y3 - 0.3) / 2, z4 / 2));
    walls.push(box(WALL, parapet, -z3, x, parapet / 2, z3 / 2));
  }
  // head wall over the portal opening: from the lintel up to the parapet top
  // (the marble fascia, about 1.2 m tall, sits 4 cm proud of the side walls)
  walls.push(box(width + WALL * 2 + 0.08, parapet - lintel, WALL + 0.04, 0, (parapet + lintel) / 2, z3 - WALL / 2 + 0.02));
  walls.push(box(width + WALL * 2, -0.01 - lintel, PORTAL, 0, (lintel - 0.01) / 2, z3 - PORTAL / 2)); // portal ceiling, under the plaza
  root.add(merged("walls", walls, M.marble, 2.4));

  // white coping on the parapets, slightly overhanging both faces
  const cope: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) cope.push(box(COPING, 0.08, -z3 + COPING / 2, s * (half + WALL / 2), parapet + 0.04, z3 / 2 - COPING / 4));
  cope.push(box(width + WALL * 2 + COPING - WALL, 0.08, COPING, 0, parapet + 0.04, z3 - WALL / 2));
  root.add(merged("coping", cope, M.marble, 1.6));

  // the station wall behind the gate, with a backlit panel set into it (a niche, not a box on its face)
  const pw = 1.3, ph = 1.6, px = -half + 1.1, py = y3 + 1.25, wt = 0.3, wz = z4 - wt / 2, H = CLEAR + 0.3, yb = y3 - 0.15;
  const l = px - pw / 2, r = px + pw / 2, b = py - ph / 2, t = py + ph / 2;
  const inner: THREE.BufferGeometry[] = [
    box(l + half, H, wt, (-half + l) / 2, yb + H / 2, wz),               // left of the niche
    box(half - r, H, wt, (r + half) / 2, yb + H / 2, wz),                // right of the niche
    box(pw, b - yb, wt, px, (yb + b) / 2, wz),                           // below
    box(pw, yb + H - t, wt, px, (t + yb + H) / 2, wz),                   // above
  ];
  root.add(merged("passage_walls", inner, M.marble, 2.4));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), M.adGlow);
  panel.name = "passage_lightbox"; panel.position.set(px, py, z4 - wt + 0.06); root.add(panel);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, 0.03, 0.25), M.lamp);
  lamp.name = "ceiling_light"; lamp.position.set(0, lintel - 0.02, z3 - PORTAL / 2); root.add(lamp);
  const glow = new THREE.PointLight(0xfff1dc, 3.5, 7, 2);
  glow.name = "passage_light"; glow.position.set(0, lintel - 0.35, z3 - PORTAL / 2); root.add(glow);

  // direction band: fills the top of the opening, face flush with the fascia
  const bandW = width, bandH = 0.32, dirs = o.directions ?? SYNTAGMA;
  const bandFace = new THREE.MeshStandardMaterial({ name: "direction_band", map: bandTexture(dirs, bandW, bandH), emissive: 0xffffff, emissiveIntensity: 0.14, roughness: 0.45 });
  bandFace.emissiveMap = bandFace.map;
  const band = new THREE.Mesh(new THREE.BoxGeometry(bandW, bandH, 0.12), [M.steel, M.steel, M.steel, M.steel, bandFace, M.steel]);
  band.name = "direction_band"; band.castShadow = true;
  band.position.set(0, lintel - bandH / 2, z3 - 0.06);
  root.add(band);

  // roll-down shutter right behind the band: housing, side guide channels, slat curtain and bottom bar
  const sz = z3 - 0.16, shutTop = lintel - bandH, guide = 0.07;
  const metal: THREE.BufferGeometry[] = [box(width, 0.34, 0.3, 0, lintel - 0.17, sz - 0.14)];          // housing behind the band
  for (const s of [-1, 1]) {
    const x = s * (half - guide / 2);
    metal.push(box(guide, shutTop - y3, 0.012, x, (shutTop + y3) / 2, sz - 0.035), box(guide, shutTop - y3, 0.012, x, (shutTop + y3) / 2, sz + 0.035));
    metal.push(box(0.012, shutTop - y3, 0.08, x + s * guide / 2, (shutTop + y3) / 2, sz));
  }
  if (o.shutter) {
    const curtainW = width - guide, curtainH = shutTop - y3 - 0.09;
    const g = new THREE.PlaneGeometry(curtainW, curtainH).translate(0, y3 + 0.09 + curtainH / 2, sz);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * curtainW / 0.6, uv.getY(i) * curtainH / 0.6);
    const curtain = new THREE.Mesh(g, M.shutter);
    curtain.name = "shutter"; curtain.renderOrder = 1; root.add(curtain);
    metal.push(box(curtainW, 0.09, 0.05, 0, y3 + 0.045, sz));                                          // bottom bar
    metal.push(box(0.14, 0.05, 0.012, 0, y3 + 0.045, sz + 0.03));                                       // lock plate
  }
  root.add(merged("shutter_steel", metal, M.steel));

  // CCTV: conduit down the fascia, a twin camera head under it
  const cam: THREE.BufferGeometry[] = [];
  const cz = z3 + 0.07, cx = 0.35;
  cam.push(box(0.04, 0.55, 0.04, cx, lintel + 0.62, cz));
  cam.push(box(0.12, 0.05, 0.12, cx, lintel + 0.33, cz + 0.03));
  for (const s of [-1, 1]) cam.push(new THREE.CylinderGeometry(0.035, 0.04, 0.16, 16).rotateX(Math.PI / 2 - 0.35).rotateY(s * 0.4).translate(cx + s * 0.05, lintel + 0.27, cz + 0.1));
  root.add(merged("cctv", cam, M.white));

  // handrails: the nosing line, then rails offset above it
  const nose = (z: number) => z >= 0 ? 0 : z >= z1 ? (z / TREAD) * RISE : z >= z2 ? y1 : z >= z3 ? y1 + ((z - z2) / TREAD) * RISE : y3;
  const along = (x: number, h: number, from = 0.3, to = z3 - 0.6) =>
    [from, 0, z1, z2, z3, to].filter((z, i, a) => z <= from && (i === 0 || z !== a[i - 1])).map(z => new THREE.Vector3(x, nose(z) + h, z));
  const steel: THREE.BufferGeometry[] = [];
  // centre rail on posts, two tubes
  // the top end loops: the upper tube runs past the first post and turns down into the lower one
  const loop = 0.38, top = along(0, 0.92, 0.1), lowr = along(0, 0.62, 0.1);
  steel.push(...rail([new THREE.Vector3(0, 0.62, loop), new THREE.Vector3(0, 0.92, loop), ...top], 0.026));
  steel.push(...rail([new THREE.Vector3(0, 0.62, loop), ...lowr], 0.02));
  for (let z = 0.1; z > z3 - 0.6; z -= 1.25) {
    const y = nose(z);
    steel.push(new THREE.CylinderGeometry(0.03, 0.03, 0.92, 12).translate(0, y + 0.46, z));
    steel.push(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 16).translate(0, y + 0.005, z));
  }
  // wall rails on brackets
  for (const s of [-1, 1]) {
    const x = s * (half - 0.07);
    steel.push(...rail(along(x, 0.9, -0.2), 0.022));
    for (let z = -0.6; z > z3; z -= 1.6) {
      const y = nose(z) + 0.9;
      steel.push(new THREE.CylinderGeometry(0.011, 0.011, 0.07, 8).rotateZ(Math.PI / 2).translate(s * (half - 0.035), y - 0.03, z));
    }
  }
  root.add(merged("handrails", steel, M.steel));

  root.userData = { kind: "athens-metro-stairs", depthM: -y3, lengthM: -z4, widthM: L.outer * 2 };
  return root;
}

// ---- the whole entrance -----------------------------------------------------------------------------

export function createMetroEntrance(o: EntranceOptions): THREE.Group {
  const root = new THREE.Group();
  root.name = `metro_entrance_${o.latin ?? o.name}`.replace(/\s+/g, "_");
  const L = stairsLayout(o);
  root.add(createMetroStairs(o));

  if (o.plaza !== false) {
    // paved slab around the opening, as four pieces so the hole needs no boolean geometry
    const { width: W, depth: D } = typeof o.plaza === "object" ? o.plaza : { width: 18, depth: 24 };
    const front = D / 2 + L.z3 / 2, back = L.z3 / 2 - D / 2, T = 0.3, y = -T / 2;
    const side = (W / 2 - L.outer);
    const parts = [
      box(W, T, front, 0, y, front / 2),                                  // in front of the top step
      box(W, T, L.z3 - back, 0, y, (L.z3 + back) / 2),                    // over the portal and beyond
      box(side, T, -L.z3, -(L.outer + side / 2), y, L.z3 / 2),            // left of the opening
      box(side, T, -L.z3, L.outer + side / 2, y, L.z3 / 2),               // right of the opening
    ];
    const slab = merged("plaza", parts, materials().paving, 4);
    slab.castShadow = false;
    root.add(slab);
    // tactile guide strip for blind passengers, running in to the top of the stairs
    const sx = -L.width / 4, len = Math.min(front - 0.4, 9);
    const strip = merged("tactile_strip", [box(0.3, 0.012, len, sx, 0.006, 0.4 + len / 2)], materials().tactile);
    // bars run along the walking direction: map the texture along z
    const uv = strip.geometry.attributes.uv as THREE.BufferAttribute, pos = strip.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - sx + 0.15) / 0.3, pos.getZ(i) / 0.6);
    strip.castShadow = false;
    root.add(strip);
  }

  const side = o.signSide === "left" ? -1 : 1;
  const sign = createMetroSign(o);
  sign.position.set(side * (L.outer + 0.9), 0, 0.4);
  root.add(sign);
  if (o.elevator !== false) {
    const lift = createMetroElevator(o);
    lift.position.set(side * (L.outer + 1.9 + ELEVATOR.width / 2), 0, -1.0);
    root.add(lift);
  }

  root.userData = { kind: "athens-metro-entrance", name: o.name, latin: o.latin ?? null };
  return root;
}
