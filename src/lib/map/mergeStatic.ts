// A model that never changes once built (a metro entrance, a lift) merged into one mesh per look: its parts with the
// same material, the same shadow flags and the same draw order become one geometry in the model's frame. A stairwell
// was ~44 meshes, a draw each and most of them again for the sun's shadow; merged, a dozen or so.
// Left as they are: parts with a material per face, shader materials, instanced meshes, and anything hidden.
import type * as Three from "three";

export function mergeStatic<O extends Three.Object3D>(T: typeof Three, root: O): O {
  root.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(root.matrixWorld).invert(), m4 = new T.Matrix4();
  const sets = new Map<string, { mat: Three.Material; cast: boolean; recv: boolean; order: number; parts: Three.BufferGeometry[]; from: Three.Mesh[] }>();
  root.traverse(o => {
    const me = o as Three.Mesh;
    if (!me.isMesh || (me as Three.InstancedMesh).isInstancedMesh || Array.isArray(me.material)) return;
    for (let a: Three.Object3D | null = me; a && a !== root; a = a.parent) if (!a.visible) return;
    const mat = me.material as Three.Material;
    if ((mat as Three.ShaderMaterial).isShaderMaterial || mat.onBeforeCompile !== T.Material.prototype.onBeforeCompile) return;
    const g = me.geometry;
    const names = ["position", "normal", "uv"].filter(n => g.attributes[n]);
    if (!names.includes("position") || !names.includes("normal") || g.morphAttributes.position) return;
    const geo = (g.index ? g.toNonIndexed() : g.clone());
    for (const n of Object.keys(geo.attributes)) if (!names.includes(n)) geo.deleteAttribute(n);
    geo.clearGroups();
    geo.applyMatrix4(m4.multiplyMatrices(inv, me.matrixWorld));
    // A mirrored part (a negative scale): three.js turns its faces round as it draws it; baked in, they are turned here.
    if (m4.determinant() < 0) for (const n of names) {
      const a = geo.attributes[n].array as Float32Array, k = geo.attributes[n].itemSize;
      for (let i = 0; i + 3 * k <= a.length; i += 3 * k) for (let c = 0; c < k; c++) { const t = a[i + k + c]; a[i + k + c] = a[i + 2 * k + c]; a[i + 2 * k + c] = t; }
    }
    const key = `${mat.uuid}|${me.castShadow}|${me.receiveShadow}|${me.renderOrder}|${names.join(",")}`;
    let set = sets.get(key);
    if (!set) sets.set(key, (set = { mat, cast: me.castShadow, recv: me.receiveShadow, order: me.renderOrder, parts: [], from: [] }));
    set.parts.push(geo);
    set.from.push(me);
  });
  for (const set of sets.values()) {
    // Only what merges with something else is worth rebuilding. (A part's own geometry is left alone: another
    // part may share it.)
    if (set.parts.length < 2) { set.parts[0].dispose(); continue; }
    for (const me of set.from) me.removeFromParent();
    const out = new T.BufferGeometry();
    for (const name of ["position", "normal", "uv"]) {
      if (!set.parts[0].attributes[name]) continue;
      const size = set.parts[0].attributes[name].itemSize;
      const arr = new Float32Array(set.parts.reduce((n, g) => n + g.attributes[name].count * size, 0));
      let at = 0;
      for (const g of set.parts) { arr.set(g.attributes[name].array as Float32Array, at); at += g.attributes[name].count * size; }
      out.setAttribute(name, new T.BufferAttribute(arr, size));
    }
    for (const g of set.parts) g.dispose();
    out.computeBoundingSphere();
    const me = new T.Mesh(out, set.mat);
    me.castShadow = set.cast; me.receiveShadow = set.recv; me.renderOrder = set.order;
    root.add(me);
  }
  return root;
}
