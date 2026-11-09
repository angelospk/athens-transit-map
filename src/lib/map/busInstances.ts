// Every bus (or every trolley) of the 3D mode drawn at once: one InstancedMesh per part of the model (mergeParts has
// already put its parts together by material), so a hundred buses cost the draws of one. Before (2026-11-09), each
// bus was a clone of the model, ~16 draws, and the frame spent most of its time in three.js handing them out.
// - the roof plate takes the line's colour from instanceColor;
// - both destination displays are one mesh whose picture is a cell of a shared atlas (a slot per line number, an
//   instanced offset picks it), so buses of different lines still share one draw;
// - the delay glow is one more instanced plane, coloured per bus, drawn only for those that have one;
// - the hull (one box) casts the shadow, instanced too; the X-ray (xray.ts) shows the parts themselves.
import type * as Three from "three";

export const SIGN_W = 512, SIGN_H = 72;        // one display's picture (Scene3D.sign drew the same size)
const ATLAS = 2048;
const COLS = Math.floor(ATLAS / SIGN_W), ROWS = Math.floor(ATLAS / SIGN_H), SLOTS = COLS * ROWS;   // 4 × 28

export type SignPainter = (x: CanvasRenderingContext2D, w: number, h: number, label: string) => void;

/** The displays' pictures, a slot per label; a label not drawn for a while gives its slot up when one is needed. */
export class SignAtlas {
  readonly texture: Three.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private slots = new Map<string, { i: number; used: number }>();
  private free: number[] = [];
  private frame = 0;
  private dirty = false;
  constructor(T: typeof Three, private paint: SignPainter) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = ATLAS;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.fillStyle = "#050506";
    this.ctx.fillRect(0, 0, ATLAS, ATLAS);
    this.texture = new T.CanvasTexture(this.canvas);
    this.texture.colorSpace = T.SRGBColorSpace;
    this.texture.anisotropy = 8;
    for (let i = SLOTS - 1; i >= 0; i--) this.free.push(i);
  }
  /** Once a frame, before slot(): labels used this frame keep their slots. Uploads what was drawn last frame. */
  tick() { this.frame++; if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; } }
  /** The atlas offset (u, v of the cell's corner) for `label`, drawing it the first time. */
  slot(label: string): [number, number] {
    let s = this.slots.get(label);
    if (!s) {
      let i = this.free.pop();
      if (i === undefined) {
        // Full: the label longest unused (not this frame's) gives its slot.
        let old: string | null = null, at = Infinity;
        for (const [k, v] of this.slots) if (v.used < at && v.used < this.frame) { at = v.used; old = k; }
        if (old == null) i = 0;   // more labels in one frame than slots: share the first (never seen in practice)
        else { i = this.slots.get(old)!.i; this.slots.delete(old); }
      }
      s = { i, used: this.frame };
      this.slots.set(label, s);
      const cx = (i % COLS) * SIGN_W, cy = Math.floor(i / COLS) * SIGN_H;
      this.ctx.save();
      this.ctx.translate(cx, cy);
      this.ctx.beginPath(); this.ctx.rect(0, 0, SIGN_W, SIGN_H); this.ctx.clip();
      this.paint(this.ctx, SIGN_W, SIGN_H, label);
      this.ctx.restore();
      this.dirty = true;
      this.texture.needsUpdate = true;
    }
    s.used = this.frame;
    // Canvas rows run down, texture v up (flipY): the cell's bottom-left corner in uv.
    const cx = (s.i % COLS) * SIGN_W, cy = Math.floor(s.i / COLS) * SIGN_H;
    return [cx / ATLAS, 1 - (cy + SIGN_H) / ATLAS];
  }
  get size() { return this.slots.size; }
  dispose() { this.texture.dispose(); }
}

export interface BusPose { x: number; y: number; rot: number; color: string; sign: string; glow: number | null }

/** One kind of vehicle (bus or trolley), all of them in a few draws. */
export class BusInstances {
  readonly root: Three.Group;
  private parts: Three.InstancedMesh[] = [];
  private plate: Three.InstancedMesh | null = null;
  private signs: Three.InstancedMesh | null = null;
  private signAt: Three.InstancedBufferAttribute | null = null;
  private beam: Three.InstancedMesh | null = null;
  private hull: Three.InstancedMesh;
  private glow: Three.InstancedMesh;
  private cap: number;
  private m4: Three.Matrix4;
  private sc: Three.Vector3;
  private col: Three.Color;
  private colors = new Map<string, Three.Color>();

  /** proto: the model as mergeParts left it (along +x, its named parts "plate", "sign" and "beam" apart); hull: the
   *  shadow and X-ray box; glowMat: the glow's material (white: each bus's colour multiplies it). */
  constructor(private T: typeof Three, proto: Three.Group, hullGeo: Three.BufferGeometry, hullMat: Three.Material,
    glowGeo: Three.BufferGeometry, glowMat: Three.Material, private atlas: SignAtlas, private scale: number,
    xrayLayer: number, hullLayer: number, cap = 256) {
    this.cap = cap;
    this.root = new T.Group();
    this.root.name = "bus-instances";
    this.m4 = new T.Matrix4(); this.sc = new T.Vector3(); this.col = new T.Color();
    proto.updateMatrixWorld(true);
    const signGeos: Three.BufferGeometry[] = [];
    proto.traverse(o => {
      const me = o as Three.Mesh;
      if (!me.isMesh) return;
      const geo = me.geometry.clone().applyMatrix4(me.matrixWorld);
      if (me.name === "sign") { signGeos.push(geo); return; }
      const mat = me.material as Three.Material;
      if (me.name === "beam") { this.beam = this.mesh(geo, instancedBeam(mat as Three.ShaderMaterial)); this.beam.renderOrder = 5; return; }
      const im = this.mesh(geo, mat);
      im.layers.enable(xrayLayer);   // seen through what hides it, as itself (xray.ts)
      if (me.name === "plate") {
        // White in the model: each bus's colour multiplies it.
        im.material = new T.MeshLambertMaterial({ color: 0xffffff });
        this.plate = im;
        im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      } else this.parts.push(im);
    });
    if (signGeos.length) {
      const geo = mergeGeos(T, signGeos);
      const at = new T.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      at.setUsage(T.DynamicDrawUsage);
      geo.setAttribute("signAt", at);
      this.signAt = at;
      this.signs = this.mesh(geo, atlasMaterial(T, atlas.texture));
    }
    this.hull = this.mesh(hullGeo, hullMat);
    this.hull.castShadow = true;
    this.hull.layers.enable(hullLayer);   // the X-ray's outline (xray.ts)
    this.glow = this.mesh(glowGeo, glowMat);
    this.glow.renderOrder = -1;
    this.glow.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  }

  private mesh(geo: Three.BufferGeometry, mat: Three.Material): Three.InstancedMesh {
    const im = new this.T.InstancedMesh(geo, mat, this.cap);
    im.instanceMatrix.setUsage(this.T.DynamicDrawUsage);
    im.frustumCulled = false;   // spread across the view: one sphere would never cull
    im.castShadow = false;
    im.count = 0;
    this.root.add(im);
    return im;
  }

  /** The materials whose fragments mark the stencil where the bus is seen (the X-ray shows only what is hidden). */
  get seenMaterials(): Three.Material[] {
    return [...this.parts, this.plate, this.signs].flatMap(m => (m ? [m.material as Three.Material] : []));
  }
  private colorOf(c: string) {
    let k = this.colors.get(c);
    if (!k) { k = new this.T.Color(c); this.colors.set(c, k); if (this.colors.size > 512) this.colors.clear(); }
    return k;
  }

  /** This frame's buses of this kind. */
  set(poses: BusPose[]) {
    if (poses.length > this.cap) poses = poses.slice(0, this.cap);
    const n = poses.length, s = this.scale;
    let g = 0;
    for (let i = 0; i < n; i++) {
      const p = poses[i];
      this.m4.makeRotationZ(p.rot).scale(this.sc.set(s, s, s)).setPosition(p.x, p.y, 0);
      for (const im of this.parts) im.setMatrixAt(i, this.m4);
      this.hull.setMatrixAt(i, this.m4);
      if (this.beam) this.beam.setMatrixAt(i, this.m4);
      if (this.plate) { this.plate.setMatrixAt(i, this.m4); this.plate.setColorAt(i, this.colorOf(p.color)); }
      if (this.signs && this.signAt) {
        this.signs.setMatrixAt(i, this.m4);
        const [u, v] = this.atlas.slot(p.sign);
        this.signAt.setXY(i, u, v);
      }
      if (p.glow != null) {
        this.glow.setMatrixAt(g, this.m4);
        this.glow.setColorAt(g++, this.col.setHex(p.glow));
      }
    }
    const all = [...this.parts, this.hull, this.plate, this.signs, this.beam];
    for (const im of all) if (im) { im.count = n; im.visible = n > 0; im.instanceMatrix.needsUpdate = true; }
    if (this.plate?.instanceColor) this.plate.instanceColor.needsUpdate = true;
    if (this.signAt) this.signAt.needsUpdate = true;
    this.glow.count = g; this.glow.visible = g > 0;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }

  /** Everything shown, for the shader warm-up (prewarm): one instance each. */
  showAllForCompile(): () => void {
    const all = [...this.parts, this.hull, this.plate, this.signs, this.beam, this.glow].flatMap(m => (m ? [m] : []));
    const was = all.map(im => [im.visible, im.count] as const);
    for (const im of all) { im.visible = true; im.count = Math.max(im.count, 1); }
    return () => all.forEach((im, i) => { [im.visible, im.count] = was[i]; });
  }
}

// Geometries joined into one (position, normal, uv), each already in the model's frame.
function mergeGeos(T: typeof Three, geos: Three.BufferGeometry[]): Three.BufferGeometry {
  const flat = geos.map(g => (g.index ? g.toNonIndexed() : g));
  const out = new T.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    if (!flat.every(g => g.attributes[name])) continue;
    const size = flat[0].attributes[name].itemSize;
    const arr = new Float32Array(flat.reduce((n, g) => n + g.attributes[name].count * size, 0));
    let at = 0;
    for (const g of flat) { arr.set(g.attributes[name].array as Float32Array, at); at += g.attributes[name].count * size; }
    out.setAttribute(name, new T.BufferAttribute(arr, size));
  }
  return out;
}

// The displays' material: self-lit (readable day and night), the picture its instance's cell of the atlas.
function atlasMaterial(T: typeof Three, map: Three.Texture): Three.MeshBasicMaterial {
  const mat = new T.MeshBasicMaterial({ map });
  const sx = SIGN_W / ATLAS, sy = SIGN_H / ATLAS;
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 signAt;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vec2(uv.x * ${sx.toFixed(6)}, uv.y * ${sy.toFixed(6)}) + signAt;\n#endif`);
  };
  mat.customProgramCacheKey = () => "x3d-sign-atlas";
  return mat;
}

// The headlights' beam (shaders.headlightBeam), placed by each instance.
function instancedBeam(src: Three.ShaderMaterial): Three.ShaderMaterial {
  const mat = src.clone();
  mat.vertexShader = `varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * p;
    }`;
  return mat;
}
