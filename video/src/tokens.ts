// Style bible tokens. Colours sampled from the app (src/app.css, src/lib/lineColors.ts in the repo root).
import { Easing } from "remotion";

export const C = {
  ink: "#111113",        // app dark --bg
  ink2: "#1c1c1f",
  paper: "#f5f5f7",      // app dark --fg
  muted: "#a1a1a6",      // app dark --muted
  pill: "#1a7f37",       // favicon pill / --ontime
  line: ["#0072B2", "#E69F00", "#009E73"],   // Okabe-Ito slots 1-3 (040, Α1, Χ95)
  delay: ["#1a7f37", "#a87c00", "#d9480f", "#c92a2a"],   // ontime, late1, late2, late3
};
export const FONT = "Inter, sans-serif";
export const MONO = "JBM, monospace";
export const FPS = 60;
export const BEAT = 30;
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
export const out = Easing.bezier(0.16, 1, 0.3, 1);
export const inn = Easing.bezier(0.7, 0, 0.84, 0);
export type Fmt = "16x9" | "9x16";
