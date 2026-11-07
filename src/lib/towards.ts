// Which way the buses leave a stop: the bearing to the next stop and the terminus names of the lines
// that go through it. Built into trips.json (scripts/trips.ts), loaded with the planner only.

import type { TripIndex } from "./trip";
import { bearingDeg } from "./heading";
import { distanceM } from "./glide";
import { fold } from "./search";
import { titleCase } from "./nearby";

// n: the unique cleaned terminus names; s: per stop, [] or [bearing, ...indexes into n].
export interface StopDirs { n: string[]; s: (number | null)[][] }

const rad = Math.PI / 180;
const circ = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// A terminus name without its numbers and ΑΦΕΤΗΡΙΑ/ΤΕΡΜΑ words: the place a bus ends at.
export function cleanTerminus(name: string): string {
  return name.trim().replace(/\s+/g, " ").split(" - ").flatMap(seg => {
    const words = seg.split(" ").filter(w => !/\d/.test(w));   // "122-", "543-543Α", "Χ96"
    if (words[0] === "ΑΦΕΤΗΡΙΑ") words.shift();
    const out = words.join(" ");
    return out && out !== "ΑΦΕΤΗΡΙΑ" && out !== "ΤΕΡΜΑ" ? [out] : [];
  }).join(" - ").trim();
}

// The bearing most votes agree on (within 45°, at least two thirds of them); null when they split.
function arrow(votes: number[]): number | null {
  if (!votes.length) return null;
  let at = 0, best = -1;
  votes.forEach((v, i) => {
    const support = votes.filter(x => circ(x, v) <= 45).length;
    if (support > best) { best = support; at = i; }
  });
  if (best * 3 < votes.length * 2) return null;
  const near = votes.filter(x => circ(x, votes[at]) <= 45);
  const s = near.reduce((t, x) => t + Math.sin(x * rad), 0);
  const c = near.reduce((t, x) => t + Math.cos(x * rad), 0);
  const mean = Math.round((Math.atan2(s, c) / rad + 360) % 360) % 360;
  // A wide group (0° to 90°) can average to a bearing most lines do not take: check the mean too.
  return votes.filter(x => circ(x, mean) <= 45).length * 3 < votes.length * 2 ? null : mean;
}

// Bearing and terminus names for every stop of the index, from the order of each line's variants.
export function stopDirections(ix: TripIndex): StopDirs {
  const n: string[] = [];
  const at = new Map<string, number>();
  const votes = ix.s.map(() => new Map<string, number>());       // stop → line|next → bearing
  const names = ix.s.map(() => new Map<string, Set<string>>());  // stop → terminus → lines
  const pt = (k: number): [number, number] => [ix.s[k][2], ix.s[k][1]];
  const index = (name: string) => {
    let k = at.get(name);
    if (k == null) {
      at.set(name, (k = n.length));
      n.push(name);
    }
    return k;
  };

  for (const [line, variants] of Object.entries(ix.l)) for (const seq of Object.values(variants)) {
    if (seq.length < 2) continue;
    const loop = seq[0] === seq[seq.length - 1];
    let turn = -1;
    for (let i = 1, far = -1; loop && i < seq.length; i++) {
      const d = distanceM(pt(seq[0]), pt(seq[i]));
      if (d > far) { far = d; turn = i; }
    }
    for (let i = 0; i < seq.length - 1; i++) {   // the last position never counts
      const k = seq[i], nx = seq[i + 1];
      if (distanceM(pt(k), pt(nx)) >= 3) {
        const key = `${line}|${nx}`;
        if (!votes[k].has(key)) votes[k].set(key, bearingDeg(pt(k), pt(nx)));
      }
      const t = loop ? (i < turn ? seq[turn] : seq[0]) : seq[seq.length - 1];
      const name = cleanTerminus(ix.s[t][0]), own = ix.s[k][0];
      if (!name || fold(name) === fold(cleanTerminus(own)) || fold(name) === fold(own)) continue;
      let set = names[k].get(name);
      if (!set) names[k].set(name, (set = new Set()));
      set.add(line);
    }
  }

  const s = ix.s.map((_, k) => {
    const bearing = arrow([...votes[k].values()]);
    const top = [...names[k]].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0], "el"))
      .slice(0, 2).map(([name]) => index(name));
    if (bearing == null && !top.length) return [];
    return [bearing, ...top];
  });
  return { n, s };
}

// The direction of a stop of the index, ready to show; nothing for an index without directions.
export function towardsOf(ix: TripIndex, i: number): { bearing: number | null; towards: string[] } {
  const e = ix.d?.s[i];
  if (!e || !e.length) return { bearing: null, towards: [] };
  return { bearing: typeof e[0] === "number" ? e[0] : null, towards: e.slice(1).map(x => titleCase(ix.d!.n[x as number])) };
}

const byId = new WeakMap<TripIndex, Map<string, number>>();

// The direction of a stop from a /v2 id (oasa:<GTFS stop id>); other ids and no index: null.
export function towardsOfId(ix: TripIndex | null, id: string): { bearing: number | null; towards: string[] } | null {
  if (!ix || !id.startsWith("oasa:")) return null;
  let m = byId.get(ix);
  if (!m) {
    m = new Map();
    ix.s.forEach((x, k) => { if (x[3] && !m!.has(x[3])) m!.set(x[3], k); });
    byId.set(ix, m);
  }
  const k = m.get(id.slice(5));
  return k == null ? null : towardsOf(ix, k);
}

// The directions as one line: «προς Μουσειο · Πολυγωνο», empty with no names.
export const towardsText = (names: string[]) => (names.length ? `προς ${names.join(" · ")}` : "");
