// bun scripts/promo-timing.ts → promo/timing-a.json, promo/timing-b.json: beats, cuts, and every sfx at the film frame
// its event is shown (finger taps from the capture tracks, keystrokes, API hits), plus the music cut points.
import { writeFileSync } from "node:fs";
import { PCAPS, sceneOf } from "../src/promo/kit";
import { API_A, DURATION_A, GA, SA, SEGS_A } from "../src/promo/FilmA";
import { API_B, DURATION_B, GB, PIPE_B, SB, SEGS_B, STATS_B } from "../src/promo/FilmB";

type G = typeof GA;
// sfx names: A uses the numpy sounds of promo/audio.py (tap, tick, pop, whoosh, chime, end); B uses ids of the earshot
// bank (kind/member, rendered by promo/sfx.sh), passed in `ids` for the shared tap and cut sounds.
function build(name: string, g: G, bpm: number, scenes: Record<string, readonly [number, number]>, segs: Record<string, { shot: string; segs: never[] } | undefined>,
  duration: number, extra: (push: (f: number | null, k: string) => void, at: (id: string) => number) => void, music: object, ids = { tap: "tap", cut: "whoosh" }) {
  const sfx: [number, string][] = [];
  const at = (id: string) => g.bar(scenes[id][0]);
  const push = (f: number | null, k: string) => { if (f != null && f >= 0 && f < duration) sfx.push([f, k]); };
  for (const [id, s] of Object.entries(segs)) {
    if (!s) continue;
    const end = g.bar(scenes[id][1]) - at(id);
    PCAPS[s.shot].track.forEach((t, i) => { if (t.c) { const l = sceneOf(s.segs, i); if (l != null && l < end) push(at(id) + l, ids.tap); } });
  }
  extra(push, at);
  const cuts = Object.keys(scenes).map(at).filter(f => f > 0);
  for (const c of cuts) push(c, ids.cut);
  const timing = { name, fps: 60, bpm, beatFrames: g.beat, durationInFrames: duration, scenes: Object.fromEntries(Object.entries(scenes).map(([k, v]) => [k, [g.bar(v[0]), g.bar(v[1])]])),
    music, sfx: sfx.sort((a, b) => a[0] - b[0]) };
  writeFileSync(new URL(`../promo/timing-${name}.json`, import.meta.url), JSON.stringify(timing, null, 1));
  console.log(name, sfx.length, "sfx", duration, "frames");
}

const keys = (push: (f: number | null, k: string) => void, segs: { segs: never[] } | undefined, start: number, mark: number, n: number, every: number) => {
  if (!segs) return;
  for (let k = 0; k < n; k++) { const l = sceneOf(segs.segs, mark + k * every); if (l != null) push(start + l, "tick"); }
};
const pl = PCAPS.plan.marks;

build("a", GA, 103, SA as never, SEGS_A as never, DURATION_A, (push, at) => {
  keys(push, SEGS_A.plan as never, at("plan"), pl.toType, 8, 4);
  for (const h of API_A.hits) push(at("api") + h, "pop");
  push(at("api") + API_A.qr, "chime");
  push(at("end") + 4, "end");
}, { file: "audio/track/soulprodmusic-corporate-upbeat-tech-208855.mp3", license: "Pixabay Content License", title: "Corporate Upbeat Tech", by: "SoulProdMusic",
  url: "https://pixabay.com/music/corporate-corporate-upbeat-tech-208855/", headFrom: 0.215 + 4 * 60 / 103, splice: GA.bar(SA.open[0]), tailFrom: 0.215 + 48 * 4 * 60 / 103 });

build("b", GB, 115, SB as never, SEGS_B as never, DURATION_B, (push, at) => {
  const B = GB.beat, BAR = 4 * B;
  push(at("q") + 24, "ui_pop/soft");                                   // the question lands
  push(at("proto") + Math.round(B * 1.2), "knock/plastic");             // the repo chip
  const p0 = at("pipe");
  push(p0 + 6, "knock/wood");                                           // ΟΑΣΑ
  push(p0 + PIPE_B[1] + 12, "knock/wood");                              // backend
  for (let k = 0; k < 5; k++) push(p0 + PIPE_B[1] + 30 + k * 12, "ui_pop/blip");   // the first second of requests: 5
  push(p0 + PIPE_B[2], "knock/desk");                                   // history
  push(p0 + PIPE_B[3], "knock/wood");                                   // cache
  for (let i = 1; i <= 12; i++) push(p0 + PIPE_B[3] + 10 + Math.round((BAR * 1.2 - 10) * i / 12), "drip/plink");   // clients
  STATS_B.forEach((f, i) => { push(at("stats") + f, i ? "cut_hit/punch" : "cut_hit/sub"); });
  push(at("focus") + 130, "riser/snatch");                              // the 8× part
  push(at("alert") + Math.round(B), "notify/mid_tine");
  for (let k = 0; k < 41; k += 3) push(at("api") + API_B.type + Math.round(k / 1.2), "pro_typing_key/tick");
  push(at("api") + API_B.json, "ui_pop/boop");
  for (const h of API_B.hits) push(at("api") + h, "ui_pop/step");
  push(at("api") + API_B.qr, "mallet/flourish");
  push(at("end") + 4, "cut_hit/sub");
  push(at("end") + 8, "mallet/glock");
}, { file: "audio/track/the_mountain-tech-corporate-593075.mp3", license: "Pixabay Content License", title: "Tech Corporate", by: "The_Mountain",
  url: "https://pixabay.com/music/corporate-tech-corporate-593075/", headFrom: 0.075, splice: GB.bar(SB.open[0]), tailFrom: 0.075 + 86 * 4 * 60 / 115 },
  // no stop-downs: Harold heard the 0.35 s drop before the pitch as an abrupt cut; the music stops only at the end
  { tap: "tap/finger", cut: "swish/flick" });
