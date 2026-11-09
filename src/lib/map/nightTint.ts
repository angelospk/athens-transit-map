// The hand-built models at night (the dark 3D look): their colours dimmed and cooled, as the city's walls are
// (scene3d nightTile), so a white marble square or a steel stairwell does not glare in the dark street. What gives
// light keeps it: emissive parts (lamps, lit signs, the cabin light) and see-through ones (glass, water).
// Each material once, however many parts share it.
import type * as Three from "three";

const DIM = 0.34;                     // how much of its colour by day it keeps
const COOL: [number, number, number] = [0.9, 0.95, 1.12];   // and a little blue, as moonlight and the street's

export function nightTint(root: Three.Object3D): void {
  const done = new Set<Three.Material>();
  root.traverse(o => {
    const me = o as Three.Mesh;
    if (!me.isMesh) return;
    for (const m of ([] as Three.Material[]).concat(me.material)) {
      if (done.has(m)) continue;
      done.add(m);
      const mat = m as Three.MeshLambertMaterial;
      if (!mat.color || mat.transparent) continue;
      if (mat.emissive && mat.emissive.getHex() !== 0) continue;
      mat.color.multiplyScalar(DIM);
      mat.color.r *= COOL[0]; mat.color.g *= COOL[1]; mat.color.b *= COOL[2];
    }
  });
}
