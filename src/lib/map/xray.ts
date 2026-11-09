// The X-ray of the 3D mode: a bus, trolley or tram hidden behind a building (or anything else in front of it) shows
// through it as itself, tinted blue and see-through: its livery, its windows, its wheels and roof, its nearest side
// only. (Before 2026-11-09 it was one flat blue box.) Four passes over the X-ray layer, each only where a vehicle is
// hidden:
// 1. mark: where a vehicle's hull (one box, as big as it) is behind what is drawn there (and the vehicle is not seen
//    there: the normal pass left 1 in the stencil where it is), the stencil gets 2;
// 2. reset: there the depth goes back to the far plane (what stood in front is already drawn), the hull again;
// 3. depth: the vehicles' nearest surfaces there, depth only;
// 4. colour: each part in its X-ray look, only its nearest surface (no part seen through another), blended over.
// Depth stays at the hidden vehicle's afterwards, within its outline only.
import type * as Three from "three";

const TINT = 0x9cc4ff, GLOW = 0x16335f, OPACITY = 0.66;

export class XRay {
  private mark: Three.Material;
  private reset: Three.ShaderMaterial;
  private depth: Three.Material;
  private looks = new WeakMap<Three.Material, Three.Material>();
  private swapped: [Three.Mesh, Three.Material | Three.Material[]][] = [];

  /** layer: the vehicles' parts; hulls: their hulls (one box each, a draw per kind: the first two passes). */
  constructor(private T: typeof Three, private layer: number, private hulls: number) {
    const st = (ref: number, func: Three.StencilFunc, pass: Three.StencilOp, mask = 0xff) => ({
      stencilWrite: true, stencilRef: ref, stencilFunc: func, stencilFuncMask: mask, stencilWriteMask: 0xff,
      stencilFail: T.KeepStencilOp, stencilZFail: T.KeepStencilOp, stencilZPass: pass });
    // Bit 0 clear (0, or 2 already): not seen there. Its fragment behind what is drawn: 2.
    this.mark = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthFunc: T.GreaterDepth,
      ...st(2, T.EqualStencilFunc, T.ReplaceStencilOp, 1) });
    this.reset = new T.ShaderMaterial({
      vertexShader: `void main() {
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
      fragmentShader: "void main() { gl_FragColor = vec4(0.0); gl_FragDepth = 1.0; }",
      colorWrite: false, depthWrite: true, depthTest: true, depthFunc: T.AlwaysDepth,
      ...st(2, T.EqualStencilFunc, T.KeepStencilOp),
    });
    this.depth = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthFunc: T.LessEqualDepth,
      ...st(2, T.EqualStencilFunc, T.KeepStencilOp) });
  }

  /** Its X-ray look: the part's own picture and colours, tinted and lit, see-through, nearest surface only. */
  private look(m: Three.Material): Three.Material {
    let x = this.looks.get(m);
    if (!x) {
      const T = this.T, src = m as Three.MeshLambertMaterial;
      x = new T.MeshLambertMaterial({ color: TINT, emissive: GLOW, map: src.map ?? null, vertexColors: !!src.vertexColors,
        transparent: true, opacity: OPACITY, depthWrite: false, depthFunc: T.LessEqualDepth, side: src.side,
        stencilWrite: true, stencilRef: 2, stencilFunc: T.EqualStencilFunc, stencilFuncMask: 0xff, stencilWriteMask: 0,
        stencilFail: T.KeepStencilOp, stencilZFail: T.KeepStencilOp, stencilZPass: T.KeepStencilOp });
      this.looks.set(m, x);
    }
    return x;
  }

  render(renderer: Three.WebGLRenderer, scene: Three.Scene, camera: Three.Camera) {
    for (const mat of [this.mark, this.reset, this.depth]) {
      camera.layers.set(mat === this.depth ? this.layer : this.hulls);
      scene.overrideMaterial = mat;
      renderer.render(scene, camera);
    }
    camera.layers.set(this.layer);
    scene.overrideMaterial = null;
    // Each part in its own X-ray look (its picture: the livery, the windows).
    scene.traverseVisible(o => {
      const me = o as Three.Mesh;
      if (!me.isMesh || !me.layers.isEnabled(this.layer)) return;
      this.swapped.push([me, me.material]);
      me.material = Array.isArray(me.material) ? me.material.map(m => this.look(m)) : this.look(me.material);
    });
    renderer.render(scene, camera);
    for (const [me, m] of this.swapped) me.material = m;
    this.swapped.length = 0;
    camera.layers.set(0);
  }

  dispose() {
    for (const m of [this.mark, this.reset, this.depth]) m.dispose();
  }
}
