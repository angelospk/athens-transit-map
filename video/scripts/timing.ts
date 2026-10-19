// bun scripts/timing.ts → timing.json: scene starts, the drop, every sfx at the film frame its event is shown.
import { writeFileSync } from "node:fs";
import { DURATION, SCENES, SEGS, SceneId, sceneAt } from "../src/timeline";
import city from "../public/cap/city.json";
import follow from "../public/cap/follow.json";
import vehicle from "../public/cap/vehicle.json";
import planner from "../public/cap/planner.json";
import { API_T } from "../src/apiTiming";

const caps: Record<string, { track: { c: number }[]; marks: Record<string, number> }> = { city, follow, vehicle, planner };
const sfx: [number, string][] = [];
const at = (id: SceneId, cap: number) => { const l = sceneAt(SEGS[id]!.segs, cap); return l == null ? null : SCENES[id][0] + l; };
const push = (f: number | null, kind: string) => { if (f != null) sfx.push([f, kind]); };

// Real clicks in the captures (each shot's frames may appear in more than one scene; take the scene that shows them).
for (const id of Object.keys(SEGS) as SceneId[]) {
  const c = caps[SEGS[id]!.shot];
  c.track.forEach((t, i) => { if (t.c) push(at(id, i), "tap"); });
}
// Keystrokes (capture/capture.mjs types one char every 7 frames in follow, 5 in planner, from the type marks).
const keys = (id: SceneId, mark: number, n: number, every: number) => { for (let k = 0; k < n; k++) push(at(id, mark + k * every), "tick"); };
keys("follow", follow.marks.type0, 3, 7); keys("follow", follow.marks.type1, 2, 7); keys("follow", follow.marks.type2, 3, 7);
keys("planner", planner.marks.fromType, 8, 5); keys("planner", planner.marks.toType, 8, 5);
// Lines appear (Enter) → pop; the alert opens → bell chime.
for (const m of ["enter0", "enter1", "enter2"]) push(at("follow", follow.marks[m]), "pop");
push(at("planner", planner.marks.alert) , "chimeNotify");
// Ring pulses (hook beats, ring dive, end) and the curl command typing.
for (const b of [0, 50, 100, 150]) push(b, "ping");
for (const d of [0, 50, 100]) push(SCENES.ring[0] + 200 + d, "ping");
for (let k = 0; k < 41; k += 4) push(SCENES.api[0] + API_T.type + k, "tick");
push(SCENES.api[0] + API_T.json, "pop");
for (const h of API_T.hl) push(SCENES.api[0] + h, "tick");
push(SCENES.api[0] + API_T.token - 30, "pop");
push(SCENES.end[0] + 4, "chimeEnd");

const timing = {
  fps: 60, bpm: 72, beatFrames: 50, durationInFrames: DURATION,
  drop: SCENES.city[0], lift: [SCENES.follow[0], SCENES.planner[1]], endLogo: SCENES.end[0],
  // Music: audio/mix_track.py plays track [0.57 s, +40 s] then the track's ending from 120.57 s, joined on a downbeat at
  // the api cut; the track's final hit (126.41 s) lands on the end card.
  music: { file: "audio/track/lvymusic-calm-digital-technology-background-121521.mp3", headFrom: 0.57, splice: SCENES.api[0], tailFrom: 120.57 },
  scenes: SCENES, sfx: sfx.sort((a, b) => a[0] - b[0]),
  whoosh: (Object.keys(SCENES) as SceneId[]).slice(1).map(id => SCENES[id][0]),
};
writeFileSync(new URL("../timing.json", import.meta.url), JSON.stringify(timing, null, 1));
console.log(sfx.length, "sfx", DURATION, "frames");
