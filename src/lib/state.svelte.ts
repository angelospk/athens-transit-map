// The one store: chosen lines, live/static data, selection. Components read it; pollers write it.

import { isHidden } from "./directions";
import { fetchCity, fetchLine, fetchLines, fetchLineStatic, fetchStatus } from "./api";
import { cityKey, cleanCity, isCityLive } from "./city";
import { LinePoller, type PollState } from "./poller";
import { ClockOffset } from "./schedule";
import { MAX_LINES, selectionIds, serializeSelection, splitKnown, toggle } from "./selection";
import type { CityLive, CityVehicle, LineInfo, LineLive, LineStatic, Status, Vehicle } from "./types";

export const STALE_S = 120;
const STATUS_EVERY_MS = 60_000;

export type Selection =
  | { kind: "vehicle"; line: string; id: string }
  | { kind: "route"; line: string; variant: string };

// What the city layer does with the other vehicles while one is selected.
export type Others = "normal" | "dim" | "hide";

// Settings kept in localStorage; a broken or blocked storage just means defaults.
function stored<T>(key: string, fallback: T, ok: (v: unknown) => boolean): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return ok(v) ? (v as T) : fallback;
  } catch { return fallback; }
}
function store(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}
const isBool = (v: unknown) => typeof v === "boolean";

export interface PlacedVehicle { line: string; v: Vehicle; faded: boolean }   // faded: direction unknown under focus

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class AppState {
  lines = $state.raw<LineInfo[]>([]);
  linesFailed = $state(false);
  selected = $state.raw<string[]>([]);
  live = $state.raw<Record<string, LineLive>>({});
  statics = $state.raw<Record<string, LineStatic>>({});
  pollState = $state.raw<Record<string, PollState>>({});
  status = $state.raw<Status | null>(null);
  statusFailed = $state(false);
  selection = $state.raw<Selection | null>(null);
  // Per line, the variants of the one direction to show (route card, "μόνο → …").
  focus = $state.raw<Record<string, string[]>>({});
  notice = $state<string | null>(null);
  now = $state(Date.now());
  // City layer (/v1/vehicles): every live vehicle; null before data or when the server lacks it.
  city = $state.raw<CityLive | null>(null);
  cityState = $state<PollState | null>(null);
  cityOn = $state(stored("cityOn", true, isBool));
  others = $state<Others>(stored("others", "dim", v => v === "normal" || v === "dim" || v === "hide"));
  showAges = $state(stored("showAges", false, isBool));
  // A line shown in detail because its vehicle was clicked on the city layer; not one of the picks.
  tempLine = $state<string | null>(null);

  // Set by MapView: frame the given lines once their shapes are loaded.
  fit: (ids: string[]) => void = () => {};

  private clock = new ClockOffset();
  private pollers = new Map<string, LinePoller>();
  private cityPoller: LinePoller<CityLive> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  lineInfo = $derived(new Map(this.lines.map(l => [l.id, l])));

  // Lines drawn in detail (routes, DOM markers): the picks plus the temporary one.
  detailLines = $derived(this.tempLine && !this.selected.includes(this.tempLine) ? [...this.selected, this.tempLine] : this.selected);

  vehicles: PlacedVehicle[] = $derived(this.detailLines.flatMap(line => {
    const f = this.focus[line] ? new Set(this.focus[line]) : undefined;
    const known = new Set(Object.keys(this.statics[line]?.variants ?? {}));
    return (this.live[line]?.vehicles ?? []).flatMap(v =>
      isHidden(v.variant, f, known) ? [] : [{ line, v, faded: !!f && !(v.variant && f.has(v.variant)) }]);
  }));

  cityByKey = $derived(new Map((this.city?.vehicles ?? []).map(v => [cityKey(v), v])));

  // Picked lines when there are any, else the whole city.
  stats = $derived.by(() => {
    const vs: { delay_s: number | null }[] = this.selected.length || !this.cityOn ? this.vehicles.map(p => p.v) : this.city?.vehicles ?? [];
    return {
      vehicles: vs.length,
      matched: vs.filter(v => v.delay_s != null).length,
      median: median(vs.flatMap(v => (v.delay_s == null ? [] : [v.delay_s]))),
    };
  });

  // Server time in ms, corrected for client clock skew; ticks every second.
  serverNow = $derived(this.now + this.clock.ms);
  // The same, read continuously (animation frames).
  serverMs = () => Date.now() + this.clock.ms;

  // Detail lines with data are drawn as DOM markers, so the city layer leaves them out. Until a
  // line's data arrives its vehicles stay on the city layer.
  cityExclude = $derived(new Set(this.detailLines.filter(l => this.live[l])));

  // Seconds since the oldest selected line was updated; null before any data.
  oldestAge = $derived.by(() => {
    const ts = this.selected.flatMap(l => (this.live[l] ? [this.live[l].updated_at] : []));
    return ts.length ? this.serverNow / 1000 - Math.min(...ts) : null;
  });

  newestUpdate = $derived.by(() => {
    const ts = this.selected.flatMap(l => (this.live[l] ? [this.live[l].updated_at] : []));
    return ts.length ? Math.max(...ts) : null;
  });

  selectedVehicle = $derived.by(() => {
    const s = this.selection;
    if (s?.kind !== "vehicle") return null;
    // From the visible vehicles: one hidden by a direction focus has no card or highlight.
    return this.vehicles.find(p => p.line === s.line && p.v.id === s.id) ?? null;
  });

  // The selected vehicle on the city layer: the info card uses it until its line's data arrives.
  selectedCity = $derived.by((): CityVehicle | null => {
    const s = this.selection;
    return s?.kind === "vehicle" ? this.cityByKey.get(cityKey(s)) ?? null : null;
  });

  // The variant to emphasise on the map, from a clicked vehicle or route.
  highlight = $derived.by((): { line: string; variant: string } | null => {
    const s = this.selection;
    if (s?.kind === "route") return s;
    const sv = this.selectedVehicle;
    if (sv) return sv.v.variant ? { line: sv.line, variant: sv.v.variant } : null;
    const c = this.selectedCity;   // its line's data is still loading
    return c?.variant ? { line: c.line, variant: c.variant } : null;
  });

  init() {
    const ids = selectionIds(location.search);
    this.selected = ids.slice(0, MAX_LINES);
    if (ids.length > MAX_LINES) this.say(`Ο σύνδεσμος είχε ${ids.length} γραμμές. Κράτησα τις πρώτες ${MAX_LINES}.`);
    this.writeUrl();
    for (const id of this.selected) this.startLine(id);
    void Promise.allSettled(this.selected.map(fetchLineStatic)).then(() => this.fit(this.selected));
    this.loadLines();
    void this.refreshStatus();
    if (this.cityOn) this.startCity();
    setInterval(() => (this.now = Date.now()), 1000);
    setInterval(() => { if (!document.hidden) void this.refreshStatus(); }, STATUS_EVERY_MS);
    document.addEventListener("visibilitychange", () => {
      this.now = Date.now();
      for (const p of this.pollers.values()) p.visibilityChanged();
      this.cityPoller?.visibilityChanged();
    });
  }

  toggleLine(id: string) {
    if (id === this.tempLine) {
      // Picking the line shown from the city layer: it stays, now as a pick.
      const next = toggle(this.selected, id);
      if (next === this.selected) return this.say("Έως 5 γραμμές ταυτόχρονα. Αφαίρεσε μία για να προσθέσεις άλλη.");
      this.tempLine = null;
      this.selected = next;
      this.writeUrl();
      return;
    }
    const next = toggle(this.selected, id);
    if (next === this.selected) {
      this.say("Έως 5 γραμμές ταυτόχρονα. Αφαίρεσε μία για να προσθέσεις άλλη.");
      return;
    }
    this.selected = next;
    this.writeUrl();
    if (next.includes(id)) {
      this.startLine(id);
      void fetchLineStatic(id).then(() => this.fit([id]), () => {});
    } else {
      if (this.selection?.line === id) this.selection = null;
      this.closeLine(id);
    }
  }

  // Stop a line and forget its data: reopened, it must not show (or hide city vehicles behind)
  // an old copy. The poller is kept, so its pacing survives.
  private closeLine(id: string) {
    this.pollers.get(id)?.stop();
    this.setFocus(id, null);
    const { [id]: _, ...rest } = this.live;
    this.live = rest;
  }

  setCityOn(on: boolean) {
    this.cityOn = on;
    store("cityOn", on);
    if (on) this.startCity();
    else {
      this.cityPoller?.stop();
      if (this.tempLine && this.selection?.line === this.tempLine) this.clearSelection();
    }
  }

  setOthers(o: Others) {
    this.others = o;
    store("others", o);
  }

  setShowAges(on: boolean) {
    this.showAges = on;
    store("showAges", on);
  }

  // A vehicle clicked on the city layer: select it and show its line in detail for a while.
  selectCityVehicle(line: string, id: string) {
    if (this.tempLine !== line) {
      this.dropTemp();
      if (!this.selected.includes(line)) {
        this.tempLine = line;
        this.startLine(line);
      }
    }
    this.selection = { kind: "vehicle", line, id };
  }

  // Show one direction of a line (variants), or all (null). Keeps the selection consistent.
  setFocus(line: string, variants: string[] | null) {
    const { [line]: _, ...rest } = this.focus;
    this.focus = variants ? { ...rest, [line]: variants } : rest;
    const s = this.selection;
    if (!variants || s?.line !== line) return;
    if (s.kind === "route" && !variants.includes(s.variant)) this.selection = { kind: "route", line, variant: variants[0] };
    if (s.kind === "vehicle" && !this.vehicles.some(p => p.line === line && p.v.id === s.id)) this.selection = null;
  }

  selectVehicle(line: string, id: string) {
    if (line !== this.tempLine) this.dropTemp();
    this.selection = { kind: "vehicle", line, id };
  }

  selectRoute(line: string, variant: string) {
    if (line !== this.tempLine) this.dropTemp();
    this.selection = { kind: "route", line, variant };
  }

  clearSelection() {
    this.selection = null;
    this.dropTemp();
  }

  private dropTemp() {
    const t = this.tempLine;
    if (!t) return;
    this.tempLine = null;
    if (!this.selected.includes(t)) this.closeLine(t);
  }

  private startCity() {
    this.cityPoller ??= new LinePoller<CityLive>({
      line: "*",
      fetchLine: fetchCity,
      validate: isCityLive,
      clock: this.clock,
      onData: d => {
        if (this.city && d.updated_at < this.city.updated_at) return;   // a stale cached copy
        this.city = { ...d, vehicles: cleanCity(d.vehicles) };
      },
      onState: s => (this.cityState = s),
    });
    this.cityPoller.start();
  }

  private say(text: string) {
    // Notices that arrive together (e.g. from one shared link) are shown together.
    this.notice = !this.notice ? text : this.notice.includes(text) ? this.notice : `${this.notice} ${text}`;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (this.notice = null), 4000);
  }

  private writeUrl() {
    history.replaceState(history.state, "", location.pathname + serializeSelection(this.selected) + location.hash);
  }

  private startLine(id: string) {
    let p = this.pollers.get(id);
    if (!p) {
      p = new LinePoller({
        line: id,
        fetchLine,
        clock: this.clock,
        onData: d => this.onData(id, d),
        onState: s => this.onPollState(id, s),
      });
      this.pollers.set(id, p);
    }
    if (!this.live[id]) this.pollState = { ...this.pollState, [id]: "loading" };
    p.start();
    fetchLineStatic(id).then(s => (this.statics = { ...this.statics, [id]: s }), () => {});
  }

  private onData(id: string, d: LineLive) {
    this.live = { ...this.live, [id]: d };
    const s = this.selection;
    if (s?.kind === "vehicle" && s.line === id && !d.vehicles.some(v => v.id === s.id)) this.clearSelection();
  }

  private onPollState(id: string, s: PollState) {
    this.pollState = { ...this.pollState, [id]: s };
    if (s === "unknown" && id === this.tempLine) this.clearSelection();
    if (s === "unknown" && this.selected.includes(id)) {
      this.selected = this.selected.filter(l => l !== id);
      if (this.selection?.line === id) this.selection = null;
      this.setFocus(id, null);
      this.writeUrl();
      this.say(`Η γραμμή ${id} δεν υπάρχει.`);
    }
  }

  private loadLines() {
    fetchLines().then(
      ix => {
        this.lines = ix.lines;
        this.linesFailed = false;
        // Drop ids from an old or hand-edited link that are not lines.
        const { dropped } = splitKnown(this.selected, new Set(this.lineInfo.keys()));
        for (const id of dropped) this.toggleLine(id);
        if (dropped.length) this.say(`Άγνωστη γραμμή: ${dropped.join(", ")}. Αφαιρέθηκε από την επιλογή.`);
      },
      () => (this.linesFailed = true),
    );
  }

  private async refreshStatus() {
    const s = await fetchStatus();
    this.statusFailed = !s;
    if (s) this.status = s;
  }
}
