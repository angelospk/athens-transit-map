// Single source of the film's timing (60 fps, 72 BPM: one beat = 50 frames, every scene starts on a beat).
// scripts/timing.ts turns this + the capture tracks into timing.json for the score and sfx.

export type Seg = { from: number; to: number; rate: number };
export type Key = { t: number; x: number; y: number; z: number };

export const SCENES = {
  hook: [0, 200],
  city: [200, 550],
  follow: [550, 1100],
  ring: [1100, 1450],
  card: [1450, 1700],
  planner: [1700, 2400],
  api: [2400, 2750],
  end: [2750, 3000],
} as const;
export type SceneId = keyof typeof SCENES;
export const DURATION = 3000;

const fit = (from: number, to: number, len: number): Seg => ({ from, to, rate: (to - from) / len });

// Capture segments played by each capture scene (capture frames → scene frames).
export const SEGS: Partial<Record<SceneId, { shot: string; segs: Seg[] }>> = {
  city: { shot: "city", segs: [fit(40, 400, 350)] },
  follow: { shot: "follow", segs: [fit(50, 660, 550)] },
  ring: { shot: "vehicle", segs: [fit(20, 250, 350)] },
  card: { shot: "vehicle", segs: [fit(250, 496, 250)] },
  planner: { shot: "planner", segs: [fit(40, 420, 317), fit(420, 598, 178), fit(598, 823, 205)] },
};

export const segLen = (s: Seg) => Math.round((s.to - s.from) / s.rate);

export function capAt(segs: Seg[], f: number): number {
  let start = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], len = segLen(s);
    if (f < start + len || i === segs.length - 1) return Math.min(s.to, s.from + Math.max(0, f - start) * s.rate);
    start += len;
  }
  return 0;
}

// Scene frame at which a capture frame is shown (first match), or null.
export function sceneAt(segs: Seg[], cap: number): number | null {
  let start = 0;
  for (const s of segs) {
    const len = segLen(s);
    if (cap >= s.from && cap < s.to) return start + Math.round((cap - s.from) / s.rate);
    start += len;
  }
  return null;
}
