// The landmarks modelled by hand for the 3D mode (scene3d.ts), as the metro's entrances are: built once into the scene
// (a new one after each style load, or a move of the scene's origin), shown at street level only. Σύνταγμα for now.
import type * as Three from "three";
import type { LngLat } from "../../map3d";
import { nightTint } from "../nightTint";

type Lib = typeof import("./syntagma");

export class Landmarks {
  private lib: Promise<Lib> | null = null;
  private g: Three.Group | null = null;
  private scene: Three.Scene | null = null;
  private shown = false;
  private gen = 0;
  /** The dark 3D look: the models dimmed as the city's walls are (nightTint). Set before mount. */
  night = false;
  /** Called once a model is in the scene: the map should draw a frame. */
  onChange: (() => void) | null = null;

  /** The scene and its local metres: the models are built into it (again). */
  mount(scene: Three.Scene, local: (p: LngLat) => [number, number]) {
    this.scene = scene;
    const gen = ++this.gen;
    void (this.lib ??= import("./syntagma")).then(lib => {
      if (gen !== this.gen || this.scene !== scene) return;
      if (this.g) { this.g.removeFromParent(); lib.disposeSyntagma(this.g); }
      this.g = lib.buildSyntagma(local);
      if (this.night) nightTint(this.g);
      this.g.visible = this.shown;
      scene.add(this.g);
      this.onChange?.();
    });
  }

  /** Shown at street level only (scene3d.draw: close in, not underground). */
  show(on: boolean) {
    this.shown = on;
    if (this.g) this.g.visible = on;
  }
}
