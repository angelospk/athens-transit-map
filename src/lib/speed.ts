// Typical bus speed per stop-to-stop segment, built offline from the fix history (lab/segspeed/build.py).
// Static file, loaded the first time the layer is turned on.

export interface SpeedMeta { from: number; to: number; samples: number; segments: number; min_samples: number }
export interface SpeedData extends GeoJSON.FeatureCollection { meta: SpeedMeta }

export const SPEED_URL = `${import.meta.env.BASE_URL}speed/segments.geojson`;

// km/h stops, slow (red) to fast (blue). The map and the legend use the same stops.
export const SPEED_STOPS: readonly [number, string][] = [[4, "#b2182b"], [8, "#ef6548"], [12, "#fdae61"], [16, "#d9ef8b"], [22, "#66bd63"], [30, "#2166ac"]];

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export function isSpeedData(v: unknown): v is SpeedData {
  const d = v as SpeedData | null;
  const m = d?.meta;
  return !!d && d.type === "FeatureCollection" && Array.isArray(d.features) && !!m
    && isNum(m.from) && isNum(m.to) && isNum(m.samples) && isNum(m.segments) && isNum(m.min_samples);
}

const day = (t: number) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", day: "numeric", month: "numeric" }).formatToParts(new Date(t * 1000));
  const n = (type: string) => Number(p.find(x => x.type === type)!.value);
  return `${n("day")}/${n("month")}`;
};

// The legend's facts: observation period (Athens days), sample count, minimum samples per segment shown.
export function speedNote(m: SpeedMeta) {
  const a = day(m.from), b = day(m.to);
  return { period: a === b ? a : `${a}–${b}`, samples: m.samples.toLocaleString("el-GR"), min: m.min_samples };
}

let loading: Promise<SpeedData> | null = null;
export function loadSpeed(): Promise<SpeedData> {
  loading ??= fetch(SPEED_URL).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(d => (isSpeedData(d) ? d : Promise.reject(new Error("bad speed data"))));
  loading.catch(() => (loading = null));   // a failure is tried again on the next switch-on
  return loading;
}
