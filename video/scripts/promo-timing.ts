// bun scripts/promo-timing.ts → promo/timing-a.json, promo/timing-b.json: beats, cuts, and every sfx at the film frame
// its event is shown (finger taps from the capture tracks, keystrokes, API hits), plus the music cut points.
import { writeFileSync } from "node:fs";
import { PCAPS, sceneOf } from "../src/promo/kit";
import { API_A, DURATION_A, GA, SA, SEGS_A } from "../src/promo/FilmA";
import { API_B, DURATION_B, GB, SB, SEGS_B } from "../src/promo/FilmB";

type G = typeof GA;
function build(name: string, g: G, bpm: number, scenes: Record<string, readonly [number, number]>, segs: Record<string, { shot: string; segs: never[] } | undefined>,
  duration: number, extra: (push: (f: number | null, k: string) => void, at: (id: string) => number) => void, music: object) {
  const sfx: [number, string][] = [];
  const at = (id: string) => g.bar(scenes[id][0]);
  const push = (f: number | null, k: string) => { if (f != null && f >= 0 && f < duration) sfx.push([f, k]); };
  for (const [id, s] of Object.entries(segs)) {
    if (!s) continue;
    const end = g.bar(scenes[id][1]) - at(id);
    PCAPS[s.shot].track.forEach((t, i) => { if (t.c) { const l = sceneOf(s.segs, i); if (l != null && l < end) push(at(id) + l, "tap"); } });
  }
  extra(push, at);
  const cuts = Object.keys(scenes).map(at).filter(f => f > 0);
  for (const c of cuts) push(c, "whoosh");
  const timing = { name, fps: 60, bpm, beatFrames: g.beat, durationInFrames: duration, scenes: Object.fromEntries(Object.entries(scenes).map(([k, v]) => [k, [g.bar(v[0]), g.bar(v[1])]])),
    music, sfx: sfx.sort((a, b) => a[0] - b[0]) };
  writeFileSync(new URL(`../promo/timing-${name}.json`, import.meta.url), JSON.stringify(timing, null, 1));
  console.log(name, sfx.length, "sfx", duration, "frames");
}

const keys = (push: (f: number | null, k: string) => void, segs: { segs: never[] } | undefined, start: number, mark: number, n: number, every: number) => {
  if (!segs) return;
  for (let k = 0; k < n; k++) { const l = sceneOf(segs.segs, mark + k * every); if (l != null) push(start + l, "tick"); }
};
const pl = PCAPS.plan.marks, fv = PCAPS.fav.marks;

build("a", GA, 103, SA as never, SEGS_A as never, DURATION_A, (push, at) => {
  keys(push, SEGS_A.plan as never, at("plan"), pl.toType, 8, 4);
  for (const h of API_A.hits) push(at("api") + h, "pop");
  push(at("api") + API_A.qr, "chime");
  push(at("end") + 4, "end");
}, { file: "audio/track/soulprodmusic-corporate-upbeat-tech-208855.mp3", license: "Pixabay Content License", title: "Corporate Upbeat Tech", by: "SoulProdMusic",
  url: "https://pixabay.com/music/corporate-corporate-upbeat-tech-208855/", headFrom: 0.215 + 4 * 60 / 103, splice: GA.bar(SA.open[0]), tailFrom: 0.215 + 48 * 4 * 60 / 103 });

build("b", GB, 115, SB as never, SEGS_B as never, DURATION_B, (push, at) => {
  for (let k = 0; k < 41; k += 3) push(at("api") + API_B.type + Math.round(k / 1.2), "tick");
  push(at("api") + API_B.json, "pop");
  for (const h of API_B.hits) push(at("api") + h, "pop");
  push(at("api") + API_B.qr, "chime");
  push(at("end") + 4, "end");
  void fv;
}, { file: "audio/track/the_mountain-tech-corporate-593075.mp3", license: "Pixabay Content License", title: "Tech Corporate", by: "The_Mountain",
  url: "https://pixabay.com/music/corporate-tech-corporate-593075/", headFrom: 0.075, splice: GB.bar(SB.open[0]), tailFrom: 0.075 + 86 * 4 * 60 / 115 });
