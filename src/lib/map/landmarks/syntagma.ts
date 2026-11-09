// Σύνταγμα in the 3D mode: the Βουλή (the old palace) from its OpenStreetMap building parts, on the podium it stands on
// over Αμαλίας, with the Tomb of the Unknown Soldier in the podium's front wall (bronze shields along it), the stairs
// up beside it and the sentry boxes before it; across the avenue, the square: its paving and lawns, its fountain, and
// on its east side the marble steps up to the level of Αμαλίας between walls of ashlar, urns at their head.
// (Photographs of the place, 2026-11-09: the sand-coloured walls and grey-green shutters, the pediment over the
// middle of each front, the crest along the roofline, the grey roofs.)
//
// Built once in metres round ANCHOR (x east, y north, z up, as scene3d), one mesh per material. The building parts
// are as mapped: columns (parts under 1.6 m² and over 2.5 m tall) as round shafts with a capital, the walls with
// their windows, the roofs hipped. The rest is drawn from the mapped outlines with sizes of my own (marked so).

import * as THREE from "three";
import type { LngLat } from "../../map3d";
import { FORECOURT, FORECOURT_GARDENS, FOUNTAINS, INNER, LAWNS, PARLIAMENT_HULL, PARLIAMENT_PARTS, PLAZA, TOMB_AREA } from "./syntagmaData";

export const ANCHOR: LngLat = [23.7355, 37.9755];

const PODIUM = 4.5;      // the palace's terrace over Αμαλίας (estimated): the Tomb is cut into its front wall
const TERRACE = 2.7;     // the square lies this far under Αμαλίας: its east side is a terrace at the street's level
//                          (here the square is at 0 with the streets, so the terrace stands that high over it)
const RISE = 0.15;       // a step
const FLOOR = 7;         // the palace's storeys (21 m, three of them)
const BAY = 4.2;         // its window bays

type XY = [number, number];

const COLORS = {
  wall: 0xe9c9a2,        // the palace's sand
  marble: 0xf2ede3,
  stone: 0xffffff,       // the podium, the square's walls: ashlar (its texture)
  roof: 0xc6c3bc,        // grey, low, behind the crest
  glass: 0xaabdb3,       // the pitched glass roofs over the halls inside (green-grey from the air)
  cypress: 0x2f5a35,
  flat: 0xcbc8c1,
  bronze: 0x6d5a3c,
  urn: 0xe9e4d8,
  pave: 0xe9e7e2,        // light marble paving
  paveInner: 0xdedad2,
  lawn: 0x6e9a55,
  water: 0x5d9fd8,
  jet: 0xf4f8ff,
  relief: 0xbcae92,
  slab: 0x5d5a55,
  sentry: 0xf3f1ea,
  sentryRoof: 0x34558f,
};

/** Triangles gathered per material, merged into one mesh each at the end. */
class Acc {
  private sets = new Map<string, { mat: THREE.Material; pos: number[]; nor: number[]; uv: number[] }>();
  constructor(private mats: Record<string, THREE.Material>) {}
  private set(m: string) {
    let s = this.sets.get(m);
    if (!s) this.sets.set(m, (s = { mat: this.mats[m], pos: [], nor: [], uv: [] }));
    return s;
  }
  tri(m: string, a: number[], b: number[], c: number[], n?: number[], uv?: [number, number][]) {
    const s = this.set(m);
    const nn = n ?? normalOf(a, b, c);
    s.pos.push(...a, ...b, ...c);
    s.nor.push(...nn, ...nn, ...nn);
    s.uv.push(...(uv ? uv.flat() : [0, 0, 0, 0, 0, 0]));
  }
  quad(m: string, a: number[], b: number[], c: number[], d: number[], uv?: [number, number][]) {
    const n = normalOf(a, b, c);
    this.tri(m, a, b, c, n, uv && [uv[0], uv[1], uv[2]]);
    this.tri(m, a, c, d, n, uv && [uv[0], uv[2], uv[3]]);
  }
  geo(m: string, g: THREE.BufferGeometry, mat?: THREE.Matrix4) {
    const s = this.set(m), x = (g.index ? g.toNonIndexed() : g.clone());
    if (mat) x.applyMatrix4(mat);
    if (!x.attributes.normal) x.computeVertexNormals();
    s.pos.push(...(x.attributes.position.array as Float32Array));
    s.nor.push(...(x.attributes.normal.array as Float32Array));
    const uv = x.attributes.uv?.array as Float32Array | undefined;
    if (uv) s.uv.push(...uv); else for (let i = 0; i < x.attributes.position.count; i++) s.uv.push(0, 0);
    x.dispose();
  }
  meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [name, s] of this.sets) {
      if (!s.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(s.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(s.nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(s.uv, 2));
      const me = new THREE.Mesh(g, s.mat);
      me.name = `syntagma:${name}`;
      me.castShadow = !["water", "jet", "pave", "paveInner", "fore", "lawn"].includes(name);
      me.receiveShadow = name !== "jet";
      out.push(me);
    }
    return out;
  }
}

function normalOf(a: number[], b: number[], c: number[]): number[] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

const area2 = (r: XY[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
/** Counter-clockwise, without the closing point. */
function ccw(r: XY[]): XY[] {
  const o = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r.slice();
  return area2(o) < 0 ? o.reverse() : o;
}
const centroid = (r: XY[]): XY => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
function inside(p: XY, r: XY[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function hull(pts: XY[]): XY[] {
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: XY[] = [], up: XY[] = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
/** The ring moved `d` metres outward (a mitre at each corner, capped). */
function grow(r: XY[], d: number): XY[] {
  return r.map((p, i) => {
    const a = r[(i - 1 + r.length) % r.length], b = r[(i + 1) % r.length];
    const e1 = norm([p[0] - a[0], p[1] - a[1]]), e2 = norm([b[0] - p[0], b[1] - p[1]]);
    const n1: XY = [e1[1], -e1[0]], n2: XY = [e2[1], -e2[0]];   // outward for a counter-clockwise ring
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]]), k = Math.min(3, 1 / Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]));
    return [p[0] + m[0] * d * k, p[1] + m[1] * d * k] as XY;
  });
}
const norm = (v: XY): XY => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/** A prism: walls from z0 to z1 (uv in metres / [uScale, vScale] from vBase), its top at z1. */
function prism(acc: Acc, ring: XY[], z0: number, z1: number, wall: string, top: string | null, uv?: { u: number; v: number; base: number }) {
  const r = ccw(ring);
  if (r.length < 3 || z1 <= z0) return;
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-3) continue;
    const t = uv ? [[s / uv.u, (z0 - uv.base) / uv.v], [(s + L) / uv.u, (z0 - uv.base) / uv.v], [(s + L) / uv.u, (z1 - uv.base) / uv.v], [s / uv.u, (z1 - uv.base) / uv.v]] as [number, number][] : undefined;
    acc.quad(wall, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], t);
    s += L;
  }
  if (top) cap(acc, r, z1, top);
}
function cap(acc: Acc, r: XY[], z: number, m: string) {
  const tris = THREE.ShapeUtils.triangulateShape(r.map(p => new THREE.Vector2(p[0], p[1])), []);
  for (const [i, j, k] of tris) acc.tri(m, [r[i][0], r[i][1], z], [r[j][0], r[j][1], z], [r[k][0], r[k][1], z], [0, 0, 1],
    [[r[i][0] / 4, r[i][1] / 4], [r[j][0] / 4, r[j][1] / 4], [r[k][0] / 4, r[k][1] / 4]]);
}
/** A hipped roof over a four-cornered ring: the ridge along its long side, `h` high. */
function hipRoof(acc: Acc, ring: XY[], z: number, h: number, m: string) {
  const r = ccw(ring);
  if (r.length !== 4) { prism(acc, r, z, z + Math.min(h, 1), m, m); return; }
  const l01 = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]), l12 = Math.hypot(r[2][0] - r[1][0], r[2][1] - r[1][1]);
  // Rotate so that edges 0-1 and 2-3 are the long ones.
  const q = l01 >= l12 ? r : [r[1], r[2], r[3], r[0]];
  const short = Math.min(l01, l12), c = centroid(q), along = norm([q[1][0] - q[0][0], q[1][1] - q[0][1]]);
  const half = Math.max(0, Math.max(l01, l12) / 2 - short / 2);
  const ra: number[] = [c[0] - along[0] * half, c[1] - along[1] * half, z + h], rb: number[] = [c[0] + along[0] * half, c[1] + along[1] * half, z + h];
  const P = q.map(p => [p[0], p[1], z]);
  acc.quad(m, P[0], P[1], rb, ra);   // the long slopes
  acc.quad(m, P[2], P[3], ra, rb);
  acc.tri(m, P[1], P[2], rb);        // the hips
  acc.tri(m, P[3], P[0], ra);
}
/** A pediment: a gabled block over a four-cornered ring, its ridge across the short side (so the triangle faces the
 *  long sides' ends: the front), the triangles `face`, the slopes `roof`. */
function gable(acc: Acc, ring: XY[], z: number, h: number, face: string, roof: string) {
  const r = ccw(ring);
  if (r.length !== 4) { prism(acc, r, z, z + h, face, roof); return; }
  const l01 = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]), l12 = Math.hypot(r[2][0] - r[1][0], r[2][1] - r[1][1]);
  // Edges 0-1 and 2-3 the long ones: the triangles stand on them, the ridge runs from the middle of one to the other.
  const q = l01 >= l12 ? r : [r[1], r[2], r[3], r[0]];
  const m01 = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2, z + h], m23 = [(q[2][0] + q[3][0]) / 2, (q[2][1] + q[3][1]) / 2, z + h];
  const P = q.map(p => [p[0], p[1], z]);
  acc.tri(face, P[0], P[1], m01);
  acc.tri(face, P[2], P[3], m23);
  acc.quad(roof, P[1], P[2], m23, m01);
  acc.quad(roof, P[3], P[0], m01, m23);
}
function box(acc: Acc, m: string, at: number[], size: number[], yaw = 0) {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  acc.geo(m, g, new THREE.Matrix4().makeRotationZ(yaw).setPosition(at[0], at[1], at[2]));
  g.dispose();
}
function cylinder(acc: Acc, m: string, at: XY, r0: number, r1: number, z0: number, z1: number, seg = 16) {
  const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1, false);
  g.rotateX(Math.PI / 2);
  acc.geo(m, g, new THREE.Matrix4().makeTranslation(at[0], at[1], (z0 + z1) / 2));
  g.dispose();
}
function ringTube(acc: Acc, m: string, at: XY, rOut: number, rIn: number, z0: number, z1: number, seg = 40) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const o0 = [at[0] + Math.cos(a0) * rOut, at[1] + Math.sin(a0) * rOut], o1 = [at[0] + Math.cos(a1) * rOut, at[1] + Math.sin(a1) * rOut];
    const i0 = [at[0] + Math.cos(a0) * rIn, at[1] + Math.sin(a0) * rIn], i1 = [at[0] + Math.cos(a1) * rIn, at[1] + Math.sin(a1) * rIn];
    acc.quad(m, [o0[0], o0[1], z0], [o1[0], o1[1], z0], [o1[0], o1[1], z1], [o0[0], o0[1], z1]);
    acc.quad(m, [i1[0], i1[1], z0], [i0[0], i0[1], z0], [i0[0], i0[1], z1], [i1[0], i1[1], z1]);
    acc.quad(m, [o0[0], o0[1], z1], [o1[0], o1[1], z1], [i1[0], i1[1], z1], [i0[0], i0[1], z1]);
  }
}
/** A flight of steps: from `foot` (on the ground at z0) up along `dir` to z1, `width` wide; each step a block. */
function steps(acc: Acc, m: string, foot: XY, dir: XY, width: number, z0: number, z1: number, tread: number) {
  const n = Math.max(1, Math.round((z1 - z0) / RISE)), rise = (z1 - z0) / n, yaw = Math.atan2(dir[1], dir[0]);
  for (let k = 0; k < n; k++) {
    const top = z0 + rise * (k + 1), d = tread * (k + 0.5);
    // Each block from the ground up, so the flight is solid under.
    box(acc, m, [foot[0] + dir[0] * d, foot[1] + dir[1] * d, (z0 + top) / 2], [tread, width, top - z0], yaw);
  }
}

// ---- Textures ----------------------------------------------------------------------------------------------------
function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, repeat = true): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
/** One bay of the palace's front, one storey: the ochre wall, a tall window in a white frame, a cornice over it. */
function windowTex() {
  return canvasTex(128, 212, x => {
    x.fillStyle = hex(COLORS.wall); x.fillRect(0, 0, 128, 212);
    // v runs up the wall: the canvas's top is the storey's top.
    x.fillStyle = "#f6f1e6"; x.fillRect(34, 40, 60, 132);           // the frame
    x.fillRect(28, 30, 72, 9);                                       // its cornice
    x.fillRect(30, 172, 68, 6);                                      // the sill
    x.fillStyle = "#93a89c"; x.fillRect(41, 47, 46, 120);           // the shutters, grey-green
    x.fillStyle = "#7d9286"; x.fillRect(62, 47, 4, 120);            // where they meet
    for (let y = 52; y < 166; y += 7) x.fillRect(41, y, 46, 2);     // their slats
    x.fillStyle = "rgba(0,0,0,.06)"; x.fillRect(0, 204, 128, 8);    // the floor band
  });
}
/** Ashlar: courses of stone blocks (a tile 4 m along, 2 m up: four courses, blocks staggered). */
function ashlarTex() {
  return canvasTex(256, 128, x => {
    x.fillStyle = "#d9cfba"; x.fillRect(0, 0, 256, 128);
    for (let r = 0; r < 4; r++) {
      const y = r * 32, off = r % 2 ? 42 : 0;
      for (let i = -1; i < 4; i++) {
        const bx = off + i * 85;
        x.fillStyle = ["#d6ccb6", "#ddd3bf", "#d2c7b0", "#dbd1bc"][(r + i + 4) % 4]; x.fillRect(bx + 2, y + 2, 81, 28);
      }
      x.fillStyle = "#b9ad95"; x.fillRect(0, y, 256, 2);
    }
  });
}
/** Paving: marble slabs in a grid (a tile 4 m square), a darker band every other line. */
function pavingTex(light: string, line: string) {
  return canvasTex(128, 128, x => {
    x.fillStyle = light; x.fillRect(0, 0, 128, 128);
    x.fillStyle = line;
    for (let i = 0; i <= 128; i += 32) { x.fillRect(i, 0, 1, 128); x.fillRect(0, i, 128, 1); }
    x.fillRect(0, 0, 128, 3); x.fillRect(0, 0, 3, 128);
  });
}
/** The forecourt's paving (as from the air): dark grey slabs in a diamond grid of light marble bands. */
function forecourtTex() {
  return canvasTex(256, 256, x => {
    x.fillStyle = "#8d8c88"; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "#e9e6de"; x.lineWidth = 7;
    for (let k = -256; k <= 512; k += 128) {
      x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 256, 256); x.stroke();
      x.beginPath(); x.moveTo(k, 256); x.lineTo(k + 256, 0); x.stroke();
    }
  });
}
/** The Tomb's relief: the fallen hoplite, lying, his shield by him (drawn as a carving: lighter and darker stone). */
function reliefTex() {
  return canvasTex(512, 160, x => {
    x.fillStyle = hex(COLORS.relief); x.fillRect(0, 0, 512, 160);
    x.strokeStyle = "#8f8268"; x.lineWidth = 6; x.strokeRect(6, 6, 500, 148);
    x.fillStyle = "#a59777"; x.strokeStyle = "#6f644e"; x.lineWidth = 3;
    x.beginPath();   // the body, lying left to right
    x.moveTo(70, 112); x.bezierCurveTo(140, 96, 220, 100, 300, 104); x.bezierCurveTo(360, 106, 410, 98, 450, 112);
    x.lineTo(452, 124); x.bezierCurveTo(380, 126, 200, 128, 70, 126); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.arc(84, 100, 17, 0, Math.PI * 2); x.fill(); x.stroke();                  // the helmet
    x.beginPath(); x.moveTo(70, 86); x.quadraticCurveTo(84, 62, 104, 84); x.stroke();          // its crest
    x.beginPath(); x.ellipse(250, 78, 40, 26, -0.2, 0, Math.PI * 2); x.fill(); x.stroke();     // the shield
    x.beginPath(); x.moveTo(140, 104); x.lineTo(210, 70); x.stroke();                           // an arm
    x.beginPath(); x.moveTo(320, 132); x.lineTo(470, 92); x.lineWidth = 4; x.stroke();         // the spear
  }, false);
}

// ---- The model ---------------------------------------------------------------------------------------------------
/** The model, in metres round ANCHOR; `local` turns [lon, lat] into the scene's metres. */
export function buildSyntagma(local: (p: LngLat) => [number, number]): THREE.Group {
  const [ax, ay] = local(ANCHOR);
  const xy = (p: LngLat): XY => { const [x, y] = local(p); return [x - ax, y - ay]; };
  const ring = (r: LngLat[]) => r.map(xy);

  const win = windowTex(), relief = reliefTex(), ashlar = ashlarTex();
  const paving = pavingTex("#ebe8e2", "#c9c4ba"), paving2 = pavingTex("#e2ded6", "#bdb6aa"), fore = forecourtTex();
  const lambert = (c: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const mats: Record<string, THREE.Material> = {
    wall: lambert(COLORS.wall), windows: lambert(0xffffff, { map: win }), marble: lambert(COLORS.marble), stone: lambert(COLORS.stone, { map: ashlar }),
    roof: lambert(COLORS.roof), flat: lambert(COLORS.flat), pave: lambert(0xffffff, { map: paving }), paveInner: lambert(0xffffff, { map: paving2 }),
    bronze: lambert(COLORS.bronze), urn: lambert(COLORS.urn), glass: lambert(COLORS.glass), cypress: lambert(COLORS.cypress),
    fore: lambert(0xffffff, { map: fore }),
    lawn: lambert(COLORS.lawn), water: lambert(COLORS.water, { transparent: true, opacity: 0.88, emissive: 0x0d2a46 }),
    jet: lambert(COLORS.jet, { transparent: true, opacity: 0.55, emissive: 0x404850 }), relief: lambert(0xffffff, { map: relief }),
    slab: lambert(COLORS.slab), sentry: lambert(COLORS.sentry), sentryRoof: lambert(COLORS.sentryRoof),
  };
  const acc = new Acc(mats);

  // -- The Tomb's wall: the paving before it (TOMB_AREA) ends at it; its two ends are that paving's east corners.
  const tomb = ring(TOMB_AREA);
  const A = tomb[7], B = tomb[2];                      // south and north ends of the wall
  const along = norm([B[0] - A[0], B[1] - A[1]]), west: XY = [-along[1], along[0]];
  const M: XY = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], wallLen = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const yaw = Math.atan2(along[1], along[0]);

  // -- The podium: round every part of the palace, out to the Tomb's wall, PODIUM high.
  const podium = hull([...ring(PARLIAMENT_HULL), A, B]);
  prism(acc, podium, 0, PODIUM, "stone", "flat", { u: 4, v: 2, base: 0 });
  // Bronze shields along its front (the faces towards the square), every 7 m, clear of the relief.
  {
    const P = ccw(podium);
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), e = norm([b[0] - a[0], b[1] - a[1]]);
      const out: XY = [e[1], -e[0]];
      if (out[0] * west[0] + out[1] * west[1] < 0.8 || L < 8) continue;
      for (let s = 3.5; s < L - 3; s += 7) {
        const c: XY = [a[0] + e[0] * s, a[1] + e[1] * s];
        if (Math.hypot(c[0] - M[0], c[1] - M[1]) < 8.5) continue;
        const g = new THREE.CylinderGeometry(0.62, 0.62, 0.12, 24);   // its axis along the wall's normal
        acc.geo("bronze", g, new THREE.Matrix4().makeRotationZ(Math.atan2(out[1], out[0]) - Math.PI / 2).setPosition(c[0] + out[0] * 0.06, c[1] + out[1] * 0.06, 2.6));
        g.dispose();
      }
    }
  }
  // Its coping, a marble band along the top.
  prism(acc, grow(ccw(podium), 0.25), PODIUM - 0.35, PODIUM + 0.05, "marble", null);

  // -- The palace, on the podium.
  for (const [lo, hi, r0] of PARLIAMENT_PARTS) {
    const r = ccw(ring(r0)), a = Math.abs(area2(r)), z0 = lo + PODIUM, z1 = hi + PODIUM;
    if (r.length < 3) continue;
    if (a < 1.6 && hi - lo >= 2.5) {
      // A column: a shaft a little narrower at the top, its base and its capital.
      const c = centroid(r), rad = Math.max(0.22, Math.min(0.6, Math.sqrt(a / Math.PI)));
      cylinder(acc, "marble", c, rad * 1.25, rad * 1.25, z0, z0 + 0.3);
      cylinder(acc, "marble", c, rad, rad * 0.86, z0 + 0.3, z1 - 0.45);
      cylinder(acc, "marble", c, rad * 0.86, rad * 1.15, z1 - 0.45, z1 - 0.25);
      box(acc, "marble", [c[0], c[1], z1 - 0.125], [rad * 2.5, rad * 2.5, 0.25], yaw);
    } else if (lo >= 21.5 && a > 100) {
      // Over the middle of each front: the pediment.
      gable(acc, r, z0, Math.max(3, hi - lo), "wall", "roof");
      prism(acc, grow(r, 0.3), z0 - 0.5, z0 + 0.1, "marble", null);
    } else if (lo >= 19.5 && a > 100) {
      hipRoof(acc, r, z0, Math.min(2.4, Math.max(1.4, hi - lo)), "glass");
    } else if (lo <= 1 && hi >= 15) {
      // A wing of the palace: its storeys of windows, a cornice round the top with its crest, a plinth.
      prism(acc, r, z0, z1, "windows", "flat", { u: BAY, v: FLOOR, base: z0 });
      const cr = grow(r, 0.55);
      prism(acc, cr, z1 - 0.9, z1 - 0.15, "marble", "marble");
      for (let i = 0; i < cr.length; i++) {
        const p = cr[i], q = cr[(i + 1) % cr.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]), ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        for (let t = 0.6; t < L - 0.3; t += 1.25) box(acc, "marble", [p[0] + ((q[0] - p[0]) * t) / L, p[1] + ((q[1] - p[1]) * t) / L, z1 + 0.1], [0.3, 0.22, 0.5], ang);
      }
      prism(acc, grow(r, 0.2), z0, z0 + 1.2, "stone", null, { u: 4, v: 2, base: z0 });   // the plinth
    } else {
      prism(acc, r, z0, z1, a > 50 && hi - lo > 3 ? "wall" : "marble", a > 50 ? "flat" : "marble");
    }
  }

  // -- The Tomb of the Unknown Soldier: the relief in the podium's wall, a cornice over the wall, the slab before it,
  // the two sentry boxes of the Evzones; the stairs up to the palace at either end.
  const at = (s: number, w: number, z: number) => [M[0] + along[0] * s + west[0] * w, M[1] + along[1] * s + west[1] * w, z];
  const rw = Math.min(12, wallLen * 0.45), rh = rw * (160 / 512);
  {
    // The relief, a thin slab on the wall's face (facing west): its texture on the west face only.
    const p0 = at(-rw / 2, 0.12, 0.7), p1 = at(rw / 2, 0.12, 0.7), p2 = at(rw / 2, 0.12, 0.7 + rh), p3 = at(-rw / 2, 0.12, 0.7 + rh);
    acc.quad("relief", p1, p0, p3, p2, [[1, 0], [0, 0], [0, 1], [1, 1]]);
    box(acc, "marble", at(0, 0.18, 0.7 + rh + 0.2), [rw + 1.2, 0.36, 0.4], yaw);     // the lintel over it
    box(acc, "marble", at(0, 0.18, 0.5), [rw + 1.2, 0.36, 0.4], yaw);                 // and the sill
    box(acc, "marble", at(0, 0.25, PODIUM - 0.1), [wallLen, 0.5, 0.5], yaw);         // the wall's cornice
  }
  box(acc, "slab", at(0, 3.2, 0.12), [4.2, 1.5, 0.24], yaw);                          // the slab
  for (const s of [-5.4, 5.4]) {
    box(acc, "sentry", at(s, 2.6, 1.3), [1.3, 1.3, 2.6], yaw);
    const roofG = new THREE.ConeGeometry(1.05, 0.6, 4, 1);
    roofG.rotateX(Math.PI / 2); roofG.rotateZ(Math.PI / 4 + yaw);
    acc.geo("sentryRoof", roofG, new THREE.Matrix4().makeTranslation(...(at(s, 2.6, 2.9) as [number, number, number])));
    roofG.dispose();
  }
  // The stairs: from the forecourt at each end of the wall, up along the podium's face, away from the Tomb.
  const flight = (sign: 1 | -1) => {
    const end = sign > 0 ? B : A, dir: XY = [along[0] * sign, along[1] * sign];
    const foot: XY = [end[0] + west[0] * 2.4 + dir[0] * 0.5, end[1] + west[1] * 2.4 + dir[1] * 0.5];
    steps(acc, "marble", foot, dir, 4.4, 0, PODIUM, 0.5);
  };
  flight(1); flight(-1);

  // -- The forecourt on Αμαλίας: dark paving in a diamond grid (its texture 16 m a tile), a ring of marble before the
  // Tomb, the gardens at either end with their cypresses; the paving before the Tomb.
  {
    const r = ccw(ring(FORECOURT)), z = 0.06;
    const tris = THREE.ShapeUtils.triangulateShape(r.map(p => new THREE.Vector2(p[0], p[1])), []);
    // Its grid square to the palace's front: the texture turned with the wall.
    const ux = along[0], uy = along[1], uv = (p: XY): [number, number] => [(p[0] * ux + p[1] * uy) / 16, (-p[0] * uy + p[1] * ux) / 16];
    for (const [i, j, k] of tris) acc.tri("fore", [r[i][0], r[i][1], z], [r[j][0], r[j][1], z], [r[k][0], r[k][1], z], [0, 0, 1], [uv(r[i]), uv(r[j]), uv(r[k])]);
    const c = at(0, 9, 0);
    ringTube(acc, "marble", [c[0], c[1]], 5.2, 4.7, 0.06, 0.1, 48);
    ringTube(acc, "marble", [c[0], c[1]], 2.4, 2.0, 0.06, 0.1, 32);
    for (const g of FORECOURT_GARDENS) {
      const gr = ccw(ring(g));
      prism(acc, grow(gr, 0.3), 0, 0.45, "marble", "marble");
      prism(acc, gr, 0, 0.5, "lawn", "lawn");
      // Cypresses: tall and narrow, a few to a garden, by its size.
      const gc = centroid(gr), n = Math.max(1, Math.min(4, Math.round(Math.abs(area2(gr)) / 80)));
      for (let k = 0; k < n; k++) {
        const ang = k * 2.4, d = n > 1 ? 2.2 : 0, p: XY = [gc[0] + Math.cos(ang) * d, gc[1] + Math.sin(ang) * d], h = 10 + ((k * 37) % 5);
        cylinder(acc, "cypress", p, 1.15, 0.05, 0.5, 0.5 + h, 10);
        cylinder(acc, "wall", p, 0.18, 0.15, 0.5, 1.2, 6);
      }
    }
  }
  cap(acc, ccw(tomb), 0.09, "paveInner");

  // -- The square: its paving, its four lawns (kerbed in marble). Its east side, along Αμαλίας, is a terrace at the
  // street's level with walls of ashlar towards the square, and in its middle (where the mapped steps run) the
  // marble steps up to it, urns on pedestals at their head.
  cap(acc, ccw(ring(PLAZA)), 0.06, "pave");
  const inner = ccw(ring(INNER));
  cap(acc, inner, 0.08, "paveInner");
  for (const l of LAWNS) {
    const r = ccw(ring(l));
    prism(acc, grow(r, 0.25), 0, 0.3, "marble", "marble");
    prism(acc, r, 0, 0.32, "lawn", "lawn");
  }
  {
    // The inner square's east side: the line the terrace's wall stands on.
    let ei = 0, best = -Infinity;
    const ic = centroid(inner);
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i], b = inner[(i + 1) % inner.length], mx = (a[0] + b[0]) / 2;
      if (mx - ic[0] > best) { best = mx - ic[0]; ei = i; }
    }
    let a = inner[ei], b = inner[(ei + 1) % inner.length];
    if (a[1] > b[1]) [a, b] = [b, a];                                  // a south, b north
    const e = norm([b[0] - a[0], b[1] - a[1]]), out: XY = [e[1], -e[0]].map(v => v) as XY;
    const east: XY = out[0] > 0 ? out : [-out[0], -out[1]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Where the steps are: across the mapped flight (its middle), 22 m wide; 14 m deep (as mapped).
    const stairsAt = 0.52 * L, half = 11, depth = 14, flat = 3;
    const pt = (t: number, d: number, z: number) => [a[0] + e[0] * t + east[0] * d, a[1] + e[1] * t + east[1] * d, z];
    // The terrace: from the wall (d 0) east to `depth`, TERRACE high; past it the top runs down to the street.
    const block = (t0: number, t1: number) => {
      if (t1 - t0 < 0.5) return;
      const ring2: XY[] = [pt(t0, 0, 0), pt(t1, 0, 0), pt(t1, depth, 0), pt(t0, depth, 0)].map(p => [p[0], p[1]] as XY);
      prism(acc, ring2, 0, TERRACE, "stone", "pave", { u: 4, v: 2, base: 0 });
      prism(acc, grow(ccw(ring2), 0.2), TERRACE - 0.3, TERRACE + 0.08, "marble", null);   // its coping
      // Its top down to the pavement of Αμαλίας.
      acc.quad("pave", pt(t0, depth, TERRACE), pt(t1, depth, TERRACE), pt(t1, depth + 10, 0.08), pt(t0, depth + 10, 0.08));
    };
    // The terrace stops short of the metro's entrances at the south end (at the street's level) and of the north end.
    block(L * 0.18, stairsAt - half - 1.5);
    block(stairsAt + half + 1.5, L * 0.92);
    // The steps: up east from the square to the terrace, between two walls.
    const foot: XY = [pt(stairsAt, 0, 0)[0], pt(stairsAt, 0, 0)[1]];
    const n = Math.round(TERRACE / RISE), tread = (depth - flat) / n;
    steps(acc, "marble", foot, east, half * 2, 0, TERRACE, tread);
    const land: XY[] = [pt(stairsAt - half, depth - flat, 0), pt(stairsAt + half, depth - flat, 0), pt(stairsAt + half, depth, 0), pt(stairsAt - half, depth, 0)].map(p => [p[0], p[1]] as XY);
    prism(acc, land, 0, TERRACE, "marble", "pave");
    acc.quad("pave", pt(stairsAt - half, depth, TERRACE), pt(stairsAt + half, depth, TERRACE), pt(stairsAt + half, depth + 10, 0.08), pt(stairsAt - half, depth + 10, 0.08));
    for (const side of [-1, 1]) {
      // The walls beside the steps, sloping with them, and the urns at their head.
      const t = stairsAt + side * (half + 0.75);
      for (let k = 0; k < n; k++) {
        const d = tread * (k + 0.5), z = RISE * (k + 1) + 0.5;
        box(acc, "marble", pt(t, d, z / 2), [tread + 0.02, 1.5, z], Math.atan2(east[1], east[0]));
      }
      box(acc, "marble", pt(t, depth - flat / 2, (TERRACE + 0.5) / 2), [flat, 1.5, TERRACE + 0.5], Math.atan2(east[1], east[0]));
      const head = pt(t, depth - 1.2, TERRACE);
      box(acc, "marble", [head[0], head[1], TERRACE + 0.9], [1.4, 1.4, 1.8], Math.atan2(east[1], east[0]));
      cylinder(acc, "urn", [head[0], head[1]], 0.35, 0.75, TERRACE + 1.8, TERRACE + 2.7, 20);
      cylinder(acc, "urn", [head[0], head[1]], 0.75, 0.8, TERRACE + 2.7, TERRACE + 2.85, 20);
      cylinder(acc, "lawn", [head[0], head[1]], 0.7, 0.2, TERRACE + 2.85, TERRACE + 3.4, 12);
    }
  }
  // The fountains: a marble basin, its water, a jet.
  // The fountains: a wide marble basin, its water, a raised bowl in the middle with its jet (the one in the inner
  // square, the big one of the photographs, a third wider than mapped; its basin's rim is a seat).
  for (const [lon, lat, r0] of FOUNTAINS) {
    const c = xy([lon, lat]), main = inside(c, inner), r = main ? r0 * 1.35 : r0, z = 0.08;
    ringTube(acc, "marble", c, r, r - 0.5, z, z + 0.65);
    cylinder(acc, "marble", c, r - 0.5, r - 0.5, z, z + 0.3, 48);
    cylinder(acc, "water", c, r - 0.5, r - 0.5, z + 0.3, z + 0.5, 48);
    cylinder(acc, "marble", c, 0.7, 0.5, z + 0.5, z + 1.1, 24);                  // the bowl's stem
    cylinder(acc, "marble", c, 1.0, r * 0.38, z + 1.1, z + 1.55, 40);             // the bowl
    cylinder(acc, "water", c, r * 0.38 - 0.15, r * 0.38 - 0.15, z + 1.5, z + 1.56, 40);
    cylinder(acc, "jet", c, 0.12, 0.04, z + 1.55, z + (main ? 3.4 : 2.6), 10);
  }

  const g = new THREE.Group();
  g.name = "syntagma";
  for (const me of acc.meshes()) g.add(me);
  g.position.set(ax, ay, 0);
  return g;
}

export function disposeSyntagma(g: THREE.Group) {
  g.traverse(o => {
    const me = o as THREE.Mesh;
    if (!me.isMesh) return;
    me.geometry.dispose();
    const m = me.material as THREE.MeshLambertMaterial;
    m.map?.dispose();
    m.dispose();
  });
}
