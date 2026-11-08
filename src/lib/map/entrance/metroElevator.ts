// Street-level elevator head of an Athens metro station: a point-fixed glass box stiffened by green glass
// fins, standing on a marble base. Inside, the lift's dark steel structure: chunky
// columns (one beside the doors) and a beam grid under the glass roof. Champagne-gold doors in a dark steel
// frame, and the lit accessible-entrance sign tilted out over them on tie rods.
// Real-world metres, y up, origin on the plaza at the centre of the door line, doors facing +z.
//
//   createMetroElevator({ name: "Σύνταγμα", latin: "Syntagma" })  -> THREE.Group, ~3.7 m tall

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { SignImage } from "./metroSign";

export interface ElevatorOptions {
  name: string;
  latin?: string;
  roundel?: SignImage;     // shown in the circle on the lightbox (blank otherwise)
  lit?: boolean;           // lightbox glows; default true
}

export const ELEVATOR = {
  width: 2.5, depth: 2.2,       // glass box footprint
  plinth: 0.36,                 // marble base height
  glassH: 3.3,                  // glass from the base to the roof
  doorW: 1.1, doorH: 2.2, doorX: 0,
} as const;

const FONT = `"Noto Sans", "Segoe UI", Arial, "DejaVu Sans", sans-serif`;

type Mats = Record<"glass" | "fin" | "edge" | "frame" | "doorFrame" | "door" | "doorGlass" | "steel" | "marble" | "floor", THREE.Material>;
let mats: Mats | null = null;
function materials(): Mats {
  if (mats) return mats;
  mats = {
    // thick laminated glass reads pale green face-on and deep green through its edges and fins
    glass: new THREE.MeshStandardMaterial({ name: "elevator_glass", color: 0xb9ddd3, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }),
    fin: new THREE.MeshStandardMaterial({ name: "glass_fin", color: 0x7fbfa9, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false }),
    edge: new THREE.MeshStandardMaterial({ name: "glass_edge", color: 0x5f9f8c, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.8 }),
    frame: new THREE.MeshStandardMaterial({ name: "lift_structure", color: 0x323d3b, metalness: 0.45, roughness: 0.6 }),
    doorFrame: new THREE.MeshStandardMaterial({ name: "door_frame", color: 0x2d3233, metalness: 0.6, roughness: 0.45 }),
    door: new THREE.MeshStandardMaterial({ name: "door_gold", color: 0xd2c29a, metalness: 0.8, roughness: 0.28 }),
    doorGlass: new THREE.MeshStandardMaterial({ name: "door_glass", color: 0x26302f, metalness: 0.3, roughness: 0.08, transparent: true, opacity: 0.7 }),
    steel: new THREE.MeshStandardMaterial({ name: "brushed_steel", color: 0xc4c8cb, metalness: 0.9, roughness: 0.3 }),
    marble: new THREE.MeshStandardMaterial({ name: "plinth_marble", color: 0xe2e2dd, roughness: 0.45 }),
    floor: new THREE.MeshStandardMaterial({ name: "lift_floor", color: 0x2b2d30, roughness: 0.8 }),
  };
  return mats;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
function merged(name: string, parts: THREE.BufferGeometry[], mat: THREE.Material, shadow = true) {
  const m = new THREE.Mesh(mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p))!, mat);
  m.name = name; m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

// The International Symbol of Access, drawn as simple shapes.
function wheelchair(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save(); g.translate(x, y); g.scale(s / 100, s / 100);
  g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); g.arc(38, 10, 9, 0, Math.PI * 2); g.fill();
  g.lineWidth = 10;
  g.beginPath(); g.moveTo(36, 26); g.lineTo(36, 58); g.lineTo(66, 58); g.lineTo(78, 86); g.stroke();
  g.beginPath(); g.moveTo(36, 40); g.lineTo(60, 40); g.stroke();
  g.lineWidth = 8;
  g.beginPath(); g.arc(40, 66, 26, -Math.PI * 0.7, Math.PI * 0.95); g.stroke();
  g.restore();
}

function lightboxCanvas(name: string, latin: string | undefined, roundel: CanvasImageSource | null) {
  const W = 1100, H = 560;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f5f6f4"; g.fillRect(0, 0, W, H);
  // circle at the top for the network mark
  const r = 120, cx = W / 2, cy = 170;
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#ffffff"; g.fillRect(cx - r, cy - r, r * 2, r * 2);
  if (roundel) g.drawImage(roundel, cx - r, cy - r, r * 2, r * 2);
  g.restore();
  g.strokeStyle = "#c9ccc9"; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#1f3f95"; g.fillRect(150, 318, W - 300, 6);
  g.fillStyle = "#1f3f95"; g.strokeStyle = "#1f3f95"; wheelchair(g, 170, 340, 130);
  g.fillStyle = "#1b1d21"; g.textAlign = "left"; g.textBaseline = "middle";
  g.font = `700 74px ${FONT}`; g.fillText(name, 330, 390);
  if (latin) { g.font = `500 50px ${FONT}`; g.fillText(latin, 330, 462); }
  return c;
}

export function createMetroElevator(o: ElevatorOptions): THREE.Group {
  const M = materials(), E = ELEVATOR;
  const root = new THREE.Group(); root.name = "metro_elevator";
  const W = E.width, D = E.depth, P = E.plinth, top = P + E.glassH;
  const zf = 0, zb = -D;
  const dl = E.doorX - E.doorW / 2, dr = E.doorX + E.doorW / 2, fw = 0.09; // door opening and its frame width

  // ---- marble base: blocks either side of the doors (the threshold stays at plaza level), the floor
  // behind the doors and a step-out lip at the front
  const base: THREE.BufferGeometry[] = [];
  const bx0 = -W / 2 - 0.08, bx1 = W / 2 + 0.08, bd = D + 0.16, bz = -D / 2;
  base.push(box(dl - fw - bx0, P, bd, (bx0 + dl - fw) / 2, P / 2, bz));
  base.push(box(bx1 - dr - fw, P, bd, (dr + fw + bx1) / 2, P / 2, bz));
  base.push(box(dr - dl + fw * 2, P, bd - 0.7, E.doorX, P / 2, bz - 0.35));
  base.push(box(dl - fw - bx0 + 0.04, 0.05, 0.08, (bx0 + dl - fw) / 2, P - 0.025, zf + 0.12)); // front lips
  base.push(box(bx1 - dr - fw + 0.04, 0.05, 0.08, (dr + fw + bx1) / 2, P - 0.025, zf + 0.12));
  root.add(merged("base", base, M.marble));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(dr - dl, 0.7).rotateX(-Math.PI / 2).translate(E.doorX, 0.004, zf - 0.35), M.floor);
  floor.name = "threshold"; root.add(floor);

  // ---- lift structure inside the glass
  const f: THREE.BufferGeometry[] = [], c = 0.18, ins = 0.2;
  const fx = W / 2 - ins, fzF = zf - ins, fzB = zb + ins, fzM = (fzF + fzB) / 2, colH = top - P;
  for (const x of [-fx, fx]) for (const z of [fzF, fzB, fzM]) f.push(box(c, colH, c, x, P + colH / 2, z));
  f.push(box(c, colH, c, dr + fw + c / 2 + 0.02, P + colH / 2, fzF));            // the column beside the doors
  f.push(box(c, colH, c, -0.15, P + colH / 2, fzB));                              // back middle
  // ring beams at door-head height and under the roof, then a beam grid under the roof
  for (const [y, h] of [[E.doorH + 0.28, 0.16], [top - 0.16, 0.26]] as const) {
    f.push(box(fx * 2 + c, h, c, 0, y, fzF), box(fx * 2 + c, h, c, 0, y, fzB));
    f.push(box(c, h, fzF - fzB, -fx, y, fzM), box(c, h, fzF - fzB, fx, y, fzM));
  }
  for (const x of [-fx / 3, fx / 3]) f.push(box(0.14, 0.24, fzF - fzB, x, top - 0.16, fzM));
  f.push(box(fx * 2, 0.24, 0.14, 0, top - 0.16, fzM));
  // knee braces at the top corners of the front and back frames
  for (const z of [fzF, fzB]) for (const s of [-1, 1]) {
    f.push(rod(new THREE.Vector3(s * fx, top - 0.75, z), new THREE.Vector3(s * (fx - 0.55), top - 0.29, z), 0.045));
  }
  root.add(merged("lift_structure", f, M.frame));

  // ---- glass skin: panels in two rows, deep-green edges, a glass fin behind every vertical joint and
  // round point fixings at the panel corners
  const t = 0.02, rows = [P, P + 2.1, top], fin = 0.2;
  const panes: THREE.BufferGeometry[] = [], edges: THREE.BufferGeometry[] = [], fins: THREE.BufferGeometry[] = [], bolts: THREE.BufferGeometry[] = [];
  const bolt = (x: number, y: number, z: number, axis: "x" | "z") => {
    const b = new THREE.CylinderGeometry(0.032, 0.032, 0.035, 16);
    if (axis === "z") b.rotateX(Math.PI / 2); else b.rotateZ(Math.PI / 2);
    bolts.push(b.translate(x, y, z));
  };
  // a pane on the front/back (axis z, at depth z) or on a side (axis x, at x = z)
  const pane = (a0: number, a1: number, y0: number, y1: number, z: number, axis: "x" | "z") => {
    const w = a1 - a0, h = y1 - y0, ca = (a0 + a1) / 2, cy = (y0 + y1) / 2, gap = 0.01, out = Math.sign(z) || 1;
    if (axis === "z") {
      panes.push(box(w - gap, h - gap, t, ca, cy, z));
      edges.push(box(w - gap, 0.006, t + 0.002, ca, y1 - gap / 2, z), box(0.006, h - gap, t + 0.002, a1 - gap / 2, cy, z));
      for (const bx of [a0 + 0.07, a1 - 0.07]) for (const by of [y0 + 0.08, y1 - 0.08]) bolt(bx, by, z + out * 0.016, "z");
    } else {
      panes.push(box(t, h - gap, w - gap, z, cy, ca));
      edges.push(box(t + 0.002, 0.006, w - gap, z, y1 - gap / 2, ca), box(t + 0.002, h - gap, 0.006, z, cy, a1 - gap / 2));
      for (const bx of [a0 + 0.07, a1 - 0.07]) for (const by of [y0 + 0.08, y1 - 0.08]) bolt(z + out * 0.016, by, bx, "x");
    }
  };
  const finAt = (a: number, z: number, axis: "x" | "z") => {
    const inward = -(Math.sign(z) || 1) * (fin / 2 + t / 2);
    fins.push(axis === "z" ? box(0.02, top - P, fin, a, (P + top) / 2, z + inward) : box(fin, top - P, 0.02, z + inward, (P + top) / 2, a));
  };
  const split = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const bx = split(-W / 2, W / 2, 3), sz = split(zb, zf, 2);
  for (let r = 0; r < 2; r++) {
    const y0 = rows[r], y1 = rows[r + 1];
    for (let i = 0; i < 3; i++) pane(bx[i], bx[i + 1], y0, y1, zb, "z");
    for (const x of [-W / 2, W / 2]) for (let i = 0; i < 2; i++) pane(sz[i], sz[i + 1], y0, y1, x, "x");
    if (r === 0) {                                      // front, lower row: glass either side of the door frame
      pane(-W / 2, dl - fw, y0, y1, zf, "z");
      pane(dr + fw, W / 2, y0, y1, zf, "z");
    } else for (let i = 0; i < 3; i++) pane(bx[i], bx[i + 1], y0, y1, zf, "z");
  }
  for (const a of bx.slice(1, -1)) { finAt(a, zb, "z"); finAt(a, zf, "z"); }
  for (const x of [-W / 2, W / 2]) finAt(sz[1], x, "x");
  panes.push(box(W, t, D, 0, top + t / 2, -D / 2));                 // roof
  const glass = merged("glass", panes, M.glass, false); glass.renderOrder = 2;
  const finMesh = merged("glass_fins", fins, M.fin, false); finMesh.renderOrder = 2;
  root.add(glass, finMesh, merged("glass_edges", edges, M.edge, false), merged("point_fixings", bolts, M.steel));

  // ---- doors: a dark steel portal frame with a glass transom, two gold leaves that are mostly glass
  const df: THREE.BufferGeometry[] = [], dg: THREE.BufferGeometry[] = [], dl_: THREE.BufferGeometry[] = [];
  const dz = zf + 0.005, headY = rows[1];
  df.push(box(fw, headY, 0.16, dl - fw / 2, headY / 2, dz), box(fw, headY, 0.16, dr + fw / 2, headY / 2, dz));
  df.push(box(dr - dl + fw * 2, fw, 0.16, E.doorX, E.doorH + fw / 2, dz), box(dr - dl + fw * 2, 0.05, 0.16, E.doorX, headY - 0.025, dz));
  dg.push(box(dr - dl, headY - E.doorH - fw - 0.05, 0.02, E.doorX, (E.doorH + fw + headY - 0.05) / 2, dz));   // transom
  for (const side of [-1, 1]) {
    const lw = E.doorW / 2 - 0.006, cx = E.doorX + side * E.doorW / 4, rail = 0.07;
    dl_.push(box(rail, E.doorH, 0.045, cx - lw / 2 + rail / 2, E.doorH / 2, dz), box(rail, E.doorH, 0.045, cx + lw / 2 - rail / 2, E.doorH / 2, dz));
    dl_.push(box(lw, rail, 0.045, cx, E.doorH - rail / 2, dz), box(lw, 0.18, 0.045, cx, 0.09, dz), box(lw, 0.05, 0.045, cx, E.doorH * 0.48, dz));
    dg.push(box(lw - rail * 2, E.doorH - rail - 0.18, 0.02, cx, (0.18 + E.doorH - rail) / 2, dz));
  }
  root.add(merged("door_frame", df, M.doorFrame), merged("door_leaves", dl_, M.door), merged("door_glass", dg, M.doorGlass, false));

  // ---- the lit sign over the doors: a shallow box tilted out (top leaning forward), hung on two tie rods
  const lit = o.lit ?? true;
  const tex = new THREE.CanvasTexture(lightboxCanvas(o.name, o.latin, null));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const redraw = (img: CanvasImageSource) => { tex.image = lightboxCanvas(o.name, o.latin, img); tex.needsUpdate = true; };
  if (o.roundel) {
    if (typeof o.roundel === "string") { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => redraw(im); im.src = o.roundel; }
    else redraw(o.roundel as CanvasImageSource);
  }
  const face = new THREE.MeshStandardMaterial({ name: "elevator_lightbox", map: tex, roughness: 0.4,
    emissive: lit ? 0xffffff : 0x000000, emissiveMap: lit ? tex : null, emissiveIntensity: lit ? 0.1 : 0 });
  const sw = 1.2, sh = 0.6, tilt = 0.32;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.1), [M.steel, M.steel, M.steel, M.steel, face, M.steel]);
  sign.name = "lightbox"; sign.castShadow = true;
  const sy = headY + 0.42, sz0 = zf + 0.05 + Math.sin(tilt) * sh / 2 + 0.05;
  sign.position.set(E.doorX, sy, sz0); sign.rotation.x = tilt;   // face looks down at people at the door
  root.add(sign);
  const rods: THREE.BufferGeometry[] = [];
  const outerY = sy + Math.cos(tilt) * sh / 2, outerZ = sz0 + Math.sin(tilt) * sh / 2;   // the top edge sticks out
  for (const s of [-1, 1]) {
    const x = E.doorX + s * (sw / 2 + 0.06);
    const a = new THREE.Vector3(x, headY + 1.0, zf + 0.03), b = new THREE.Vector3(x, outerY - 0.02, outerZ);
    rods.push(rod(a, b, 0.012));
    rods.push(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16).rotateX(Math.PI / 2).translate(a.x, a.y, zf + 0.03));
    rods.push(box(0.03, 0.03, sz0 - zf, x - s * 0.04, sy, (sz0 + zf) / 2));                               // side bracket to the glass
  }
  root.add(merged("sign_rods", rods, M.steel));

  root.userData = { kind: "athens-metro-elevator", name: o.name, heightM: top };
  return root;
}
