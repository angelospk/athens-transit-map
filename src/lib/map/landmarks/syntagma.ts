// Σύνταγμα in the 3D mode: the Βουλή (the old palace) from its OpenStreetMap building parts, on the podium it stands on
// over Αμαλίας, with the Tomb of the Unknown Soldier in the podium's front wall (bronze shields along it), the stairs
// up beside it and the sentry boxes before it; the forecourt's paving fanning out from the Tomb, its cypress
// gardens; across the avenue, the square, under the street (syntagmaGround.ts): its paving and lawns, its fountains,
// and on its east side the wall under Αμαλίας with the marble steps up in three flights and the metro's entrances
// either side of them (photographs and Google's 3D view of the place, 2026-11-09).
// (Photographs of the place, 2026-11-09: the sand-coloured walls and grey-green shutters, the pediment over the
// middle of each front, the crest along the roofline, the grey roofs.)
//
// Built once in metres round ANCHOR (x east, y north, z up, as scene3d), one mesh per material. The building parts
// are as mapped: columns (parts under 1.6 m² and over 2.5 m tall) as round shafts with a capital, the walls with
// their windows, the roofs hipped. The rest is drawn from the mapped outlines with sizes of my own (marked so).

import * as THREE from "three";
import type { LngLat } from "../../map3d";
import { ANCHOR_LL, FORECOURT, FORECOURT_GARDENS, FOUNTAINS, LAWNS, NEAR_BUILDINGS, PARLIAMENT_HULL, PARLIAMENT_PARTS, TOMB_AREA } from "./syntagmaData";
import { at as atSq, clipS, DEPTH, floorS, groundM, O as EAST, PLAZA_M, S_FLAT, S_WALL, tOf, sOf } from "./syntagmaGround";

export const ANCHOR: LngLat = ANCHOR_LL;

const PODIUM = 4.5;      // the palace's terrace over Αμαλίας (estimated): the Tomb is cut into its front wall
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
      me.castShadow = !["water", "jet", "pave", "paveInner", "fore", "lawn", "glassRoof", "darkFloor"].includes(name);
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
/** The forecourt's paving (as from the air): dark grey slabs in bands of light marble fanning out from the Tomb, crossed
 *  by arcs round it. One picture over the whole forecourt: `w` by `h` metres, the Tomb at (cx, cy) metres in it. */
function forecourtTex(w: number, h: number, cx: number, cy: number) {
  const px = 12, W = Math.ceil(w * px), H = Math.ceil(h * px);
  return canvasTex(W, H, x => {
    x.fillStyle = "#8f8d88"; x.fillRect(0, 0, W, H);
    x.strokeStyle = "#e7e3da"; x.lineWidth = 0.35 * px;
    const ox = cx * px, oy = H - cy * px, R = Math.hypot(W, H);
    for (let k = -11; k <= 11; k++) {   // the rays, every 7.5 degrees across the half towards the square
      const a = (k * Math.PI) / 24;
      x.beginPath(); x.moveTo(ox, oy); x.lineTo(ox + Math.cos(a) * R, oy - Math.sin(a) * R); x.stroke();
    }
    for (let r = 9; r * px < R; r += 7.5) { x.beginPath(); x.arc(ox, oy, r * px, -Math.PI / 2, Math.PI / 2); x.stroke(); }
    // A band along the edges.
    x.lineWidth = 1.2 * px; x.strokeRect(0, 0, W, H);
  }, false);
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
  const paving = pavingTex("#ebe8e2", "#c9c4ba"), paving2 = pavingTex("#e2ded6", "#bdb6aa");
  const lambert = (c: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const mats: Record<string, THREE.Material> = {
    wall: lambert(COLORS.wall), windows: lambert(0xffffff, { map: win }), marble: lambert(COLORS.marble), stone: lambert(COLORS.stone, { map: ashlar }),
    roof: lambert(COLORS.roof), flat: lambert(COLORS.flat), pave: lambert(0xffffff, { map: paving }), paveInner: lambert(0xffffff, { map: paving2 }),
    bronze: lambert(COLORS.bronze), urn: lambert(COLORS.urn), glass: lambert(COLORS.glass), cypress: lambert(COLORS.cypress),
    stoneIn: lambert(COLORS.stone, { map: ashlar, side: THREE.DoubleSide }),
    dark: lambert(0x2b2d31, { side: THREE.DoubleSide }), darkFloor: lambert(0x55575c), sign: lambert(0x1f5fbf),
    glassRoof: lambert(0xb8d2dc, { transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
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
    // One picture over it, square to the palace's front (u along the wall, v away from it, west), the fan's centre
    // at the Tomb's slab.
    const U = (p: XY) => (p[0] - M[0]) * along[0] + (p[1] - M[1]) * along[1], V = (p: XY) => (p[0] - M[0]) * west[0] + (p[1] - M[1]) * west[1];
    const u0 = Math.min(...r.map(U)), u1 = Math.max(...r.map(U)), v0 = Math.min(...r.map(V)), v1 = Math.max(...r.map(V));
    // The texture's x runs along v (away from the wall), its y along u.
    mats.fore = lambert(0xffffff, { map: forecourtTex(v1 - v0, u1 - u0, 3 - v0, -u0) });
    const uv = (p: XY): [number, number] => [(V(p) - v0) / (v1 - v0), (U(p) - u0) / (u1 - u0)];
    for (const [i, j, k] of tris) acc.tri("fore", [r[i][0], r[i][1], z], [r[j][0], r[j][1], z], [r[k][0], r[k][1], z], [0, 0, 1], [uv(r[i]), uv(r[j]), uv(r[k])]);
    const c = at(0, 3, 0);
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

  // -- The square, under Αμαλίας (syntagmaGround.ts): its floor sloping down from Ερμού, walls of ashlar round it up to
  // the streets, and on its east side the wall under the terrace along Αμαλίας: in its middle the marble steps (three
  // flights, the lowest the widest, between balustrades with urns at their foot, their top cut into the terrace),
  // either side of them the metro's entrances (deep portals in a heavy frame), the station's glass roof on the
  // terrace to the north, its glass lift at the south end. The map's own street surfaces are cleared over the square
  // (a hole in the depth, as the metro's stairwells are), so the square shows below them.
  const below = clipS(PLAZA_M, S_WALL, true);
  const wallLine = below.filter(q => Math.abs(sOf(q) - S_WALL) < 0.05).map(tOf);
  const tA = Math.min(...wallLine), tB = Math.max(...wallLine);
  // The steps where they are mapped: their middle 0.52 of the way along the wall (the mapped flight), 12 m wide (the
  // lowest flight 17), cut 4 m into the terrace.
  const tS = tA + 0.5 * (tB - tA), hTop = 6, hLow = 8.5, cut = 4, rail = 0.6;
  const yawE = Math.atan2(EAST[1], EAST[0]);
  const P3 = (q: XY, z: number) => [q[0], q[1], z];
  // The floor: sloping part and flat part (each a plane, so its corners' heights are enough), paved.
  for (const part of [clipS(below, S_FLAT, true), clipS(below, S_FLAT, false)]) {
    if (part.length < 3) continue;
    const r = ccw(part as XY[]);
    const tris = THREE.ShapeUtils.triangulateShape(r.map(p => new THREE.Vector2(p[0], p[1])), []);
    const fz = (q: XY) => floorS(sOf(q));
    for (const [a, b, c] of tris) acc.tri("pave", P3(r[a], fz(r[a])), P3(r[b], fz(r[b])), P3(r[c], fz(r[c])), [0, 0, 1],
      [[r[a][0] / 4, r[a][1] / 4], [r[b][0] / 4, r[b][1] / 4], [r[c][0] / 4, r[c][1] / 4]]);
  }
  // The walls round it up to the streets (not the east one: below), a marble coping on top.
  {
    const r = ccw(below as XY[]);
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (Math.abs(sOf(a) - S_WALL) < 0.05 && Math.abs(sOf(b) - S_WALL) < 0.05) continue;
      const za = floorS(sOf(a)), zb = floorS(sOf(b));
      if (za > -0.05 && zb > -0.05) continue;
      // Facing into the square (the ring runs counter-clockwise: inside is on the left; the face is drawn both ways).
      acc.quad("stoneIn", P3(a, za), P3(b, zb), P3(b, 0), P3(a, 0), [[0, za / 2], [Math.hypot(b[0] - a[0], b[1] - a[1]) / 4, zb / 2], [Math.hypot(b[0] - a[0], b[1] - a[1]) / 4, 0], [0, 0]]);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      box(acc, "marble", [mid[0], mid[1], 0.45], [L, 0.45, 0.9], Math.atan2(b[1] - a[1], b[0] - a[0]));   // the balustrade
    }
  }
  // The wall under the terrace, facing the square: whole except at the steps and the two portals.
  const portalW = 6, portalH = 2.7, portalD = 6;
  const portals = [tS - hTop - rail - 5.5, tS + hTop + rail + 5.5];
  const gaps: [number, number, number][] = [[tS - hTop - rail, tS + hTop + rail, 0], ...portals.map(t => [t - portalW / 2, t + portalW / 2, -DEPTH + portalH] as [number, number, number])];
  gaps.sort((x, y) => x[0] - y[0]);
  const face = (t0: number, t1: number, z0: number, z1: number) => {
    if (t1 - t0 < 0.01 || z1 - z0 < 0.01) return;
    const a = atSq(t0, S_WALL), b = atSq(t1, S_WALL);
    acc.quad("stone", P3(b, z0), P3(a, z0), P3(a, z1), P3(b, z1), [[t1 / 4, z0 / 2], [t0 / 4, z0 / 2], [t0 / 4, z1 / 2], [t1 / 4, z1 / 2]]);
  };
  let tc = tA;
  for (const [g0, g1, top] of gaps) {
    face(tc, g0, -DEPTH, 0);
    if (top < 0) face(g0, g1, top, 0);   // over a portal: its lintel
    tc = g1;
  }
  face(tc, tB, -DEPTH, 0);
  // The terrace's edge over the wall: a parapet, open over the steps.
  for (const [t0, t1] of [[tA, tS - hTop - rail], [tS + hTop + rail, tB]]) {
    const m = atSq((t0 + t1) / 2, S_WALL + 0.3);
    box(acc, "marble", [m[0], m[1], 0.5], [0.6, t1 - t0, 1.0], yawE);
  }
  // The portals: a deep dark entrance, a heavy white frame round it, a slab over.
  for (const t of portals) {
    const z0 = -DEPTH, z1 = -DEPTH + portalH;
    const a = atSq(t - portalW / 2, S_WALL), b = atSq(t + portalW / 2, S_WALL), a2 = atSq(t - portalW / 2, S_WALL + portalD), b2 = atSq(t + portalW / 2, S_WALL + portalD);
    acc.quad("dark", P3(a2, z0), P3(b2, z0), P3(b2, z1), P3(a2, z1));   // the back
    acc.quad("dark", P3(a, z0), P3(a2, z0), P3(a2, z1), P3(a, z1));     // the sides
    acc.quad("dark", P3(b2, z0), P3(b, z0), P3(b, z1), P3(b2, z1));
    acc.quad("dark", P3(a, z1), P3(a2, z1), P3(b2, z1), P3(b, z1));     // the ceiling
    acc.quad("darkFloor", P3(a, z0 + 0.01), P3(b, z0 + 0.01), P3(b2, z0 + 0.01), P3(a2, z0 + 0.01));
    for (const side of [-1, 1]) {
      const j = atSq(t + side * (portalW / 2 + 0.3), S_WALL - 0.45);
      box(acc, "marble", [j[0], j[1], z0 + (portalH + 0.4) / 2], [0.9, 0.6, portalH + 0.4], yawE);
    }
    const l = atSq(t, S_WALL - 0.7);
    box(acc, "marble", [l[0], l[1], z1 + 0.25], [1.4, portalW + 1.8, 0.5], yawE);
    const sign = atSq(t, S_WALL - 0.02);   // the station's blue sign on the lintel
    box(acc, "sign", [sign[0], sign[1], z1 + 0.8], [0.06, 2.4, 0.5], yawE);
  }
  // The steps: from the square up east to the terrace. Lowest flight widest, then two narrower ones with landings.
  {
    const n = 7, rise = DEPTH / (n * 3), tread = 0.36, landing = 1.6, run = n * tread;
    const total = run * 3 + landing * 2, sTop = S_WALL + cut, sFoot = sTop - total;
    const flightAt = (k: number) => sFoot + k * (run + landing);
    const widths = [hLow * 2, hTop * 2, hTop * 2];
    for (let k = 0; k < 3; k++) {
      const s0 = flightAt(k), z0 = -DEPTH + k * n * rise, foot = atSq(tS, s0);
      steps(acc, "marble", foot, EAST as XY, widths[k], -DEPTH, -DEPTH + (k + 1) * n * rise, tread);
      if (k < 2) {
        // The landing after it, solid from the square's floor.
        const lm = atSq(tS, s0 + run + landing / 2), zl = z0 + n * rise;
        box(acc, "marble", [lm[0], lm[1], (-DEPTH + zl) / 2], [landing, widths[k + 1] + (k === 0 ? 2 * rail : 0), zl + DEPTH], yawE);
      }
    }
    // The cut in the terrace for the top flight: its walls, down to the steps.
    for (const side of [-1, 1]) {
      const t = tS + side * (hTop + rail / 2);
      // The balustrade beside the two upper flights and their landing, sloping with them (a block per step), on to
      // the top; pillars with urns at its foot.
      const sFrom = flightAt(1);
      for (let s = sFrom; s < sTop; s += tread) {
        const k = Math.min(2 * n, Math.max(0, Math.floor((s - sFrom) / (run + landing)) * n + Math.min(n, Math.floor(((s - sFrom) % (run + landing)) / tread) + 1)));
        const zt = -DEPTH + n * rise + k * rise + 1.0, m = atSq(t, s + tread / 2);
        box(acc, "marble", [m[0], m[1], (-DEPTH + zt) / 2], [tread + 0.01, rail, zt + DEPTH], yawE);
      }
      const f = atSq(t, sFrom - 0.5), zf = -DEPTH;
      box(acc, "marble", [f[0], f[1], zf + 0.75], [1.0, 1.0, 1.5], yawE);
      cylinder(acc, "urn", [f[0], f[1]], 0.28, 0.55, zf + 1.5, zf + 2.2, 20);
      cylinder(acc, "urn", [f[0], f[1]], 0.55, 0.6, zf + 2.2, zf + 2.32, 20);
      cylinder(acc, "lawn", [f[0], f[1]], 0.5, 0.15, zf + 2.32, zf + 2.8, 10);
      // The wall of the cut, under the terrace's edge.
      const c0 = atSq(t + side * rail / 2, S_WALL), c1 = atSq(t + side * rail / 2, sTop);
      acc.quad("stoneIn", P3(c0, -DEPTH), P3(c1, -DEPTH), P3(c1, 0), P3(c0, 0));
    }
  }
  // The station's glass roof on the terrace, north of the steps; its glass lift at the south end.
  {
    const t0 = portals[1] + portalW / 2 + 3, t1 = tB - 2;
    if (t1 - t0 > 6) {
      const a = atSq(t0, S_WALL + 1), b = atSq(t1, S_WALL + 1), c = atSq(t1, S_WALL + 8), d = atSq(t0, S_WALL + 8);
      prism(acc, [a, b, c, d], 0, 0.4, "marble", null);
      acc.quad("glassRoof", P3(a, 1.4), P3(b, 1.4), P3(c, 0.4), P3(d, 0.4));
      acc.quad("glassRoof", P3(a, 0.4), P3(b, 0.4), P3(b, 1.4), P3(a, 1.4));
    }
    const lift = atSq(tA + 4, S_WALL - 2.5);
    cylinder(acc, "glassRoof", lift, 1.9, 1.9, -DEPTH, 2.6, 32);
    cylinder(acc, "marble", lift, 2.1, 2.1, 2.6, 2.85, 32);
  }
  // Lawns, kerbed in marble, and the fountains (a wide basin, its water, a raised bowl and its jet; the one in the
  // middle of the square, the big one of the photographs, a third wider than mapped), on the sloping floor.
  for (const l of LAWNS) {
    const r = ccw(ring(l)), z = groundM(centroid(r));
    prism(acc, grow(r, 0.25), z - 0.3, z + 0.3, "marble", "marble");
    prism(acc, r, z - 0.3, z + 0.32, "lawn", "lawn");
  }
  FOUNTAINS.forEach(([lon, lat, r0], i) => {
    const c = xy([lon, lat]), z = groundM(c), main = i === 0, r = main ? r0 * 1.35 : r0;   // the first is the middle one
    ringTube(acc, "marble", c, r, r - 0.5, z - 0.3, z + 0.65);
    cylinder(acc, "marble", c, r - 0.5, r - 0.5, z - 0.3, z + 0.3, 48);
    cylinder(acc, "water", c, r - 0.5, r - 0.5, z + 0.3, z + 0.5, 48);
    cylinder(acc, "marble", c, 0.7, 0.5, z + 0.5, z + 1.1, 24);
    cylinder(acc, "marble", c, 1.0, r * 0.38, z + 1.1, z + 1.55, 40);
    cylinder(acc, "water", c, r * 0.38 - 0.15, r * 0.38 - 0.15, z + 1.5, z + 1.56, 40);
    cylinder(acc, "jet", c, 0.12, 0.04, z + 1.55, z + (main ? 3.4 : 2.6), 10);
  });
  // The hole in the depth: over the square (and the cut of the steps) the map's street surfaces are cleared, so the
  // square shows; round it, an invisible ground at 0 hides what is below where the map has no street of its own.
  const holes: XY[][] = [ccw(below as XY[]), ccw([atSq(tS - hTop, S_WALL - 0.1), atSq(tS + hTop, S_WALL - 0.1), atSq(tS + hTop, S_WALL + cut), atSq(tS - hTop, S_WALL + cut)])];
  const g = new THREE.Group();
  g.name = "syntagma";
  for (const me of acc.meshes()) g.add(me);
  {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const h of holes) for (const [x, y] of h) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const R = 40, shape = new THREE.Shape([new THREE.Vector2(x0 - R, y0 - R), new THREE.Vector2(x1 + R, y0 - R), new THREE.Vector2(x1 + R, y1 + R), new THREE.Vector2(x0 - R, y1 + R)]);
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    // (Always: the map's flat layers have written a depth of their own here, not the ground's.)
    const ground = new THREE.Mesh(new THREE.ShapeGeometry(shape).translate(0, 0, 0.005), new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, depthFunc: THREE.AlwaysDepth }));
    ground.name = "syntagma:ground";
    ground.renderOrder = -2;
    g.add(ground);
    const far = new THREE.ShaderMaterial({
      vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "void main() { gl_FragColor = vec4(0.0); gl_FragDepth = 1.0; }",
      // Always (the map's flat layers write a depth nearer than their place); the buildings round the square, which
      // this would clear too, are drawn again just after, depth only.
      colorWrite: false, depthWrite: true, depthTest: true, depthFunc: THREE.AlwaysDepth, side: THREE.DoubleSide,
    });
    for (const h of holes) {
      const hole = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(h.map(([x, y]) => new THREE.Vector2(x, y)))).translate(0, 0, 0.02), far);
      hole.name = "syntagma:hole";
      hole.renderOrder = -1;
      g.add(hole);
    }
    const dacc = new Acc({ depth: new THREE.MeshBasicMaterial({ colorWrite: false }) });
    for (const [lo, hi, r0] of NEAR_BUILDINGS) prism(dacc, ring(r0), lo, hi, "depth", "depth");
    for (const me of dacc.meshes()) { me.name = "syntagma:depth"; me.castShadow = me.receiveShadow = false; me.renderOrder = -0.5; g.add(me); }
  }
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
