// The metro's street entrances in the 3D mode (scene3d.ts): one model each (metroEntrance.ts: the stairwell with
// its sign pylon; metroElevator.ts: a glass lift) at the place and heading of public/entrances.json, or of the
// admin's edits.
//
// The stairwell goes below the street. Two invisible pieces at street level keep it to its opening: first a ground
// around it with a hole (only depth, no colour), which hides what is underground where the map has no street fill
// of its own (a square, a park); then the opening itself, pushing the depth back to the far plane where the
// street's fills wrote theirs. Through the opening the stairs show; everywhere else they stay under the street.
import type * as Three from "three";
import type { LngLat } from "../../map3d";
import { type Entrance3D } from "../../entrances";
import { mergeStatic } from "../mergeStatic";

type Lib = typeof import("./metroEntrance") & typeof import("./metroElevator");
type Built = { key: string; g: Three.Group };

// What a model is built from: a change here builds it again; a move or a turn only places it.
const buildKey = (e: Entrance3D) => JSON.stringify([e.kind ?? "stairs", e.name, e.latin ?? "", e.signSide ?? "right", e.directions ?? [],
  e.adFront ?? "", e.adBack ?? "", e.adFit ?? "cover", e.roundel ?? ""]);

// A picture of entrances.json (a file under public/), loaded before the model is built, so its textures are drawn
// whole the first time. One that fails to load is left out.
const pics = new Map<string, Promise<HTMLImageElement | null>>();
function picture(src: string | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const url = /^(data:|https?:|\/)/.test(src) ? src : `${import.meta.env?.BASE_URL ?? "/"}${src}`;
  let p = pics.get(url);
  if (!p) {
    p = new Promise(ok => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = url; });
    pics.set(url, p);
  }
  return p;
}

export class EntranceModels {
  private list: Entrance3D[] = [];
  private closed = new Set<string>();   // stations whose shutters are down (MapView: from their timetable)
  private objs = new Map<string, Built>();
  private lib: Promise<[Lib, typeof Three]> | null = null;
  private scene: Three.Scene | null = null;
  private local: ((p: LngLat) => [number, number]) | null = null;
  private shown = false;
  private queue: Promise<void> = Promise.resolve();
  /** Called after a change has been built and placed: the map should draw a frame. */
  onChange: (() => void) | null = null;

  set(list: Entrance3D[]) {
    this.list = list;
    this.sync();
  }

  /** The stations closed now, by the name on their entrances: their stairs get the shutter down. */
  setClosed(names: string[]) {
    const next = new Set(names);
    if (next.size === this.closed.size && [...next].every(n => this.closed.has(n))) return;
    this.closed = next;
    this.sync();
  }

  /** The scene (new after each style load) and its local metres; the models go into it and are placed again. */
  mount(scene: Three.Scene, local: (p: LngLat) => [number, number]) {
    this.scene = scene;
    this.local = local;
    this.sync();
  }

  /** Shown at street level only (scene3d.draw: close in, and not in the underground mode). */
  show(on: boolean) {
    this.shown = on;
    for (const { g } of this.objs.values()) g.visible = on;
  }

  private sync() {
    this.queue = this.queue.then(() => this.syncNow()).catch(() => undefined);
  }

  private async syncNow() {
    if (!this.scene || (!this.list.length && !this.objs.size)) return;
    const [lib, T] = await (this.lib ??= Promise.all([import("./metroEntrance"), import("./metroElevator"), import("three")])
      .then(([a, b, t]) => [{ ...a, ...b }, t] as [Lib, typeof Three]));
    const scene = this.scene, local = this.local;
    if (!scene || !local) return;
    const ids = new Set(this.list.map(e => e.id));
    for (const [id, b] of this.objs) if (!ids.has(id)) { b.g.removeFromParent(); dispose(b.g); this.objs.delete(id); }
    for (const e of this.list) {
      const shut = e.kind !== "elevator" && this.closed.has(e.name);
      const key = buildKey(e) + (shut ? "|shut" : "");
      let b = this.objs.get(e.id);
      if (!b || b.key !== key) {
        if (b) { b.g.removeFromParent(); dispose(b.g); this.objs.delete(e.id); }
        const [adFront, adBack, roundel] = await Promise.all([picture(e.adFront), picture(e.adBack), picture(e.roundel)]);
        if (!this.list.includes(e)) continue;   // changed again while the pictures loaded: the next pass builds it
        b = { key, g: build(lib, T, e, { adFront, adBack, roundel }, shut) };
        this.objs.set(e.id, b);
      }
      if (b.g.parent !== scene) scene.add(b.g);
      const [x, y] = local([e.at[1], e.at[0]]);
      b.g.position.set(x, y, e.elevation ?? 0);
      b.g.rotation.set(0, 0, (-e.heading * Math.PI) / 180);   // heading: clockwise from north
      b.g.visible = this.shown;
    }
    this.onChange?.();
  }
}

type Pics = { adFront: HTMLImageElement | null; adBack: HTMLImageElement | null; roundel: HTMLImageElement | null };

function build(lib: Lib, T: typeof Three, e: Entrance3D, p: Pics, shut: boolean): Three.Group {
  const outer = new T.Group();
  outer.name = `entrance:${e.id}`;
  // The models are built y up, walking down the stairs (or into the lift) towards -z; turned a quarter about x they
  // stand z up here, walking towards +y (north), so the outer group's turn about z is the heading.
  const lift = e.kind === "elevator";
  const model = lift
    ? lib.createMetroElevator({ name: e.name, latin: e.latin, roundel: p.roundel ?? undefined })
    : lib.createMetroEntrance({ name: e.name, latin: e.latin, plaza: false, elevator: false, signSide: e.signSide ?? "right", directions: e.directions ?? [],
      adFront: p.adFront ?? undefined, adBack: p.adBack ?? undefined, adFit: e.adFit ?? "cover", roundel: p.roundel ?? undefined, shutter: shut });
  model.rotation.x = Math.PI / 2;
  // No scene environment to reflect here: the brushed steel would come out near black, so it is made less metallic.
  model.traverse(o => {
    const m = o as Three.Mesh;
    if (!m.isMesh) return;
    for (const mat of ([] as Three.Material[]).concat(m.material)) {
      const s = mat as Three.MeshStandardMaterial;
      if (s.isMeshStandardMaterial && s.metalness > 0.5) { s.metalness = 0.3; s.roughness = Math.max(s.roughness, 0.4); }
    }
  });
  // Built once and never changed: its parts merged by material (a stairwell was ~44 draws, most twice with the shadow).
  mergeStatic(T, model);
  outer.add(model);
  if (lift) return outer;
  // At street level, invisible (see the top of this file): the ground around the opening, wide enough to cover
  // the stairwell's depth seen from a low tilt, then the opening.
  const L = lib.stairsLayout({}), R = 24, half = L.width / 2, len = -L.z3;
  const ring = new T.Shape().moveTo(-R, -R).lineTo(R, -R).lineTo(R, len + R).lineTo(-R, len + R).closePath();
  ring.holes.push(new T.Path().moveTo(-half, 0).lineTo(-half, len).lineTo(half, len).lineTo(half, 0).closePath());
  const ground = new T.Mesh(
    new T.ShapeGeometry(ring).rotateX(-Math.PI / 2).translate(0, 0.005, 0),   // the shape's y becomes -z: down the stairs
    new T.MeshBasicMaterial({ colorWrite: false, side: T.DoubleSide }),
  );
  ground.name = "ground";
  ground.renderOrder = -2;
  model.add(ground);
  const hole = new T.Mesh(
    new T.PlaneGeometry(L.width, -L.z3).rotateX(-Math.PI / 2).translate(0, 0.01, L.z3 / 2),
    new T.ShaderMaterial({
      vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "void main() { gl_FragColor = vec4(0.0); gl_FragDepth = 1.0; }",
      colorWrite: false, depthWrite: true, depthTest: true, depthFunc: T.AlwaysDepth,
    }),
  );
  hole.name = "opening";
  hole.renderOrder = -1;   // before the stairs
  model.add(hole);
  return outer;
}

function dispose(g: Three.Object3D) {
  g.traverse(o => {
    const m = o as Three.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of ([] as Three.Material[]).concat(m.material)) {
      const s = mat as Three.MeshStandardMaterial;
      s.map?.dispose();
      s.emissiveMap?.dispose();
      mat.dispose();
    }
  });
}
