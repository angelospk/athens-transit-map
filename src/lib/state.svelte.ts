// The one store: chosen lines, live/static data, selection. Components read it; pollers write it.

import { isHidden } from "./directions";
import type { Only } from "./format";
import { fetchCity, fetchLine, fetchLines, fetchLineStatic, fetchStatus, fetchTile } from "./api";
import { cityKey, isCityLive } from "./city";
import { loadMetro, type MetroData } from "./metro";
import { LinePoller, type PollState } from "./poller";
import { BACKOFF_MS, ClockOffset } from "./schedule";
import { CityTiles, loadTiles, viewTiles, type Tile, type View } from "./tiles";
import { isTheme, type Theme } from "./theme";
import { MAX_LINES, selectionIds, serializeSelection, splitKnown, toggle } from "./selection";
import { hitText, type AlertHit, type AlertSpec } from "./alerts";
import type { CityLive, CityVehicle, LineInfo, LineLive, LineStatic, Status, Vehicle } from "./types";

export const STALE_S = 120;
// A picked line whose feed has no vehicles for this many updates in a row is taken off the map.
const EMPTY_DROPS = 2;
const STATUS_EVERY_MS = 60_000;
const TILE_TIMEOUT_MS = 15_000;

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
const isIds = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string");

// A stop alert from the trip planner; label: the boarding stop's name.
export type StopAlert = AlertSpec & { label: string };
export interface ShownHit { id: number; text: string }

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
  // City layer (/v1/vehicles/tiles): the live vehicles of the map view; null before data or when the server lacks it.
  city = $state.raw<CityLive | null>(null);
  cityState = $state<PollState | null>(null);
  cityOn = $state(stored("cityOn", true, isBool));
  others = $state<Others>(stored("others", "dim", v => v === "normal" || v === "dim" || v === "hide"));
  showAges = $state(stored("showAges", false, isBool));
  // The ? (what the map symbols mean) shows in the panel's bar until it has been pressed once.
  helpSeen = $state(stored("helpSeen", false, isBool));
  // Off: every vehicle stays at its last GPS fix (no motion in between); its age is always shown.
  motion = $state(stored("motion", true, isBool));
  // Map filters; the selected vehicle is always shown.
  only = $state.raw<Only>(stored("only", { fresh: false, onTime: false },
    v => !!v && isBool((v as Only).fresh) && isBool((v as Only).onTime)));
  // A line shown in detail because its vehicle was clicked on the city layer; not one of the picks.
  tempLine = $state<string | null>(null);
  // Light, dark, or the device's setting.
  theme = $state<Theme>(stored("theme", "system", isTheme));
  // Metro, ISAP and tram (static): the stations (a switch) and the pinned lines' tracks. metroStation: the
  // tapped station, whose card pins its lines.
  metroStations = $state(stored("metroStations", true, isBool));
  metroLines = $state.raw<string[]>(stored("metroLines", [], isIds));
  metro = $state.raw<MetroData | null>(null);
  metroStation = $state<string | null>(null);
  // Starred bus lines: a chip row under the search, to show several at once.
  favorites = $state.raw<string[]>(stored("favorites", [], isIds));
  // Stop alert: the planner's lines that are still picked (a line taken off the map stops alerting; put
  // back, it alerts again until the alert ends); null once over. hits: arrivals shown until dismissed.
  private alertSpec = $state.raw<StopAlert | null>(null);
  alert = $derived.by((): StopAlert | null => {
    const a = this.alertSpec;
    const lines = a?.lines.filter(l => this.selected.includes(l.line)) ?? [];
    if (!a || !lines.length || this.serverNow / 1000 > a.until) return null;
    return lines.length === a.lines.length ? a : { ...a, lines };
  });
  hits = $state.raw<ShownHit[]>([]);
  private hitId = 0;
  private alertsStarted = false;
  // The trip planner's start and end ([lat, lon]), marked on the map while the planner is open.
  tripEnds = $state.raw<{ from: [number, number]; to: [number, number] } | null>(null);

  // Set by MapView: frame the given lines once their shapes are loaded.
  fit: (ids: string[]) => void = () => {};

  private clock = new ClockOffset();
  private pollers = new Map<string, LinePoller>();
  private cityPoller: LinePoller<CityLive> | null = null;
  private cityTiles = new CityTiles();
  private tileSeq = 0;               // only the last view change publishes
  private tileCtrl: AbortController | null = null;   // the view change in flight
  private tileRetryAt = -Infinity;    // after a failed view change, the poller does the retrying
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
    this.loadMetro();
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
    this.empty.delete(id);
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
      this.tileSeq++;   // a late answer must not show
      this.tileCtrl?.abort();
      if (this.tempLine && this.selection?.line === this.tempLine) this.clearSelection();
    }
  }

  toggleMetroLine(id: string) {
    this.setMetroLines(this.metroLines.includes(id) ? this.metroLines.filter(l => l !== id) : [...this.metroLines, id]);
  }

  setMetroLines(ids: string[]) {
    this.metroLines = ids;
    store("metroLines", ids);
  }

  setMetroStations(on: boolean) {
    this.metroStations = on;
    store("metroStations", on);
    if (!on) this.metroStation = null;
  }

  // From a station's card: the stations go away, so the user is told where they come back.
  hideStations() {
    this.setMetroStations(false);
    this.say("Οι σταθμοί κρύφτηκαν. Ξαναφαίνονται στα Επίπεδα χάρτη (άνοιξε τον πίνακα με το βέλος).");
  }

  // A station tapped on the map (null: none). Its card replaces a vehicle's or route's.
  selectStation(name: string | null) {
    if (name && !this.metroStations) return;
    if (name) this.clearSelection();
    this.metroStation = name;
  }

  setTheme(t: Theme) {
    this.theme = t;
    store("theme", t);
  }

  toggleFavorite(id: string) {
    this.favorites = this.favorites.includes(id) ? this.favorites.filter(l => l !== id) : [...this.favorites, id];
    store("favorites", this.favorites);
  }

  // Add every starred line to the picks, as many as fit, and frame them together.
  showFavorites() {
    const add = this.favorites.filter(id => this.lineInfo.has(id) && !this.selected.includes(id));
    const fit = add.slice(0, MAX_LINES - this.selected.length);
    if (fit.length) {
      if (this.tempLine && fit.includes(this.tempLine)) this.tempLine = null;   // now a pick
      this.selected = [...this.selected, ...fit];
      this.writeUrl();
      for (const id of fit) this.startLine(id);
      void Promise.allSettled(fit.map(fetchLineStatic)).then(() => this.fit(fit));
    }
    if (fit.length < add.length)
      this.say(`Έως ${MAX_LINES} γραμμές ταυτόχρονα: έδειξα ${fit.length} από τις ${add.length} αγαπημένες.`);
  }

  // A trip from the planner replaces the picks: its first 5 lines, each shown only on the variants
  // that make the trip. Returns the lines left out. An empty trip changes nothing.
  private tripGen = 0;
  showTrip(lines: { id: string; variants: string[] }[]): string[] {
    if (!lines.length) return [];
    this.alertSpec = null;   // a new trip: the old alert no longer fits
    const keep = lines.slice(0, MAX_LINES), ids = keep.map(l => l.id), left = lines.slice(MAX_LINES).map(l => l.id);
    this.metroStation = null;
    this.selection = null;
    if (this.tempLine && ids.includes(this.tempLine)) this.tempLine = null;   // now a pick
    this.dropTemp();
    for (const id of this.selected) if (!ids.includes(id)) this.closeLine(id);
    const added = ids.filter(id => !this.selected.includes(id));
    this.selected = ids;
    this.writeUrl();
    for (const id of added) this.startLine(id);
    for (const l of keep) this.setFocus(l.id, l.variants);
    const gen = ++this.tripGen;
    void Promise.allSettled(ids.map(fetchLineStatic)).then(() => { if (gen === this.tripGen) this.fit(ids); });
    if (left.length) this.say(`Έως ${MAX_LINES} γραμμές ταυτόχρονα. Εκτός: ${left.join(", ")}.`);
    return left;
  }

  // The watcher loads with the first alert and then follows app.alert.
  setAlert(a: StopAlert | null) {
    this.alertSpec = a;
    if (!a || this.alertsStarted) return;
    this.alertsStarted = true;
    import("./alertWatch.svelte").then(m => m.watchAlerts(this), () => {
      this.alertsStarted = false;
      this.say("Η ειδοποίηση δεν φόρτωσε. Δοκίμασε ξανά.");
    });
  }

  alertHit(h: AlertHit, stop: string) {
    const text = hitText(h, stop);
    this.hits = [...this.hits, { id: ++this.hitId, text }].slice(-3);
    return text;
  }

  dismissHit(id: number) {
    this.hits = this.hits.filter(h => h.id !== id);
  }

  // Loads the metro data once; after a failure, the next call tries again (the layers menu calls it).
  private metroLoading = false;
  loadMetro() {
    if (this.metro || this.metroLoading) return;
    this.metroLoading = true;
    loadMetro().then(d => { this.metro = d; this.migrateMetro(); }, () => this.say("Δεν φόρτωσαν οι γραμμές του μετρό."))
      .finally(() => (this.metroLoading = false));
  }

  // The old single switch ("metroOn") becomes every line pinned, once, unless lines were already chosen.
  private migrateMetro() {
    if (!stored("metroOn", false, isBool) || !this.metro) return;
    try { if (localStorage.getItem("metroLines") != null) return localStorage.removeItem("metroOn"); } catch { return; }
    this.setMetroLines(this.metro.lines.map(l => l.id));
    try { localStorage.removeItem("metroOn"); } catch { /* blocked */ }
  }

  setOthers(o: Others) {
    this.others = o;
    store("others", o);
  }

  markHelpSeen() {
    if (this.helpSeen) return;
    this.helpSeen = true;
    store("helpSeen", true);
  }

  setShowAges(on: boolean) {
    this.showAges = on;
    store("showAges", on);
  }

  setMotion(on: boolean) {
    this.motion = on;
    store("motion", on);
  }

  setOnly(o: Partial<Only>) {
    this.only = { ...this.only, ...o };
    store("only", this.only);
  }

  // A vehicle clicked on the city layer: select it and show its line in detail for a while.
  selectCityVehicle(line: string, id: string) {
    this.metroStation = null;
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
    this.metroStation = null;
    if (line !== this.tempLine) this.dropTemp();
    this.selection = { kind: "vehicle", line, id };
  }

  selectRoute(line: string, variant: string) {
    this.metroStation = null;
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

  // The map reports its view when it loads and after every move. No tiles are fetched before the first view.
  setCityView(view: View, zoom: number) {
    const missing = this.cityTiles.want(viewTiles(view, zoom));
    if (!this.cityOn) return;
    if (!this.cityPoller) return this.startCity();   // its first fetch loads the whole set
    this.loadMissing(missing);
  }

  private loadMissing(missing: Tile[]) {
    const seq = ++this.tileSeq;
    this.tileCtrl?.abort();   // its tiles are asked for again below, unless they left the view
    // After a failure the poller's backoff rules: it asks for all tiles again, so moving does not hammer the API.
    if (missing.length && performance.now() < this.tileRetryAt) return this.publishCity();
    if (!missing.length) return this.publishCity();   // tiles only left
    const ctrl = this.tileCtrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TILE_TIMEOUT_MS);
    void loadTiles(this.cityTiles, missing, fetchTile, ctrl.signal).then(r => {
      clearTimeout(timer);
      if (seq !== this.tileSeq) return;   // a newer view change, or the layer was turned off
      if (r.status !== 200) this.tileRetryAt = performance.now() + BACKOFF_MS;
      this.publishCity();   // after a failure: only when the dropped tiles complete the set
    });
  }

  // Stale copies are held back per tile (CityTiles.put); a part of the view is not shown (snapshot is null).
  private publishCity() {
    const c = this.cityTiles.snapshot(), old = this.city;
    // A move that changed no tile gives the same vehicles: leave the map alone.
    if (c && !(old && c.updated_at === old.updated_at && c.vehicles.length === old.vehicles.length
      && c.vehicles.every((v, i) => v === old.vehicles[i]))) this.city = c;
  }

  private startCity() {
    if (!this.cityTiles.tiles.length) return;
    this.cityPoller ??= new LinePoller<CityLive>({
      line: "*",
      fetchLine: fetchCity(this.cityTiles),
      validate: isCityLive,
      clock: this.clock,
      onData: () => this.publishCity(),
      onState: s => (this.cityState = s),
    });
    this.cityPoller.start();
  }

  notify(text: string) {
    this.say(text);
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
    this.countEmpty(id, d);
  }

  // Updates in a row with no vehicles, per picked line. An update counts once, by its time: the same
  // data again, or an older cached copy arriving late, is ignored (also when it has vehicles).
  private empty = new Map<string, { n: number; at: number }>();
  private countEmpty(id: string, d: LineLive) {
    if (!this.selected.includes(id)) return;   // not picked: the line shown from the city layer, or a late answer
    const e = this.empty.get(id) ?? { n: 0, at: -Infinity };
    if (!(d.updated_at > e.at)) return;
    const n = d.vehicles.length ? 0 : e.n + 1;
    this.empty.set(id, { n, at: d.updated_at });
    if (n >= EMPTY_DROPS) {
      this.dropLine(id);
      this.say(`Η γραμμή ${id} δεν έχει οχήματα τώρα: αφαιρέθηκε.`);
    }
  }

  // Take a picked line off the map by itself (not a tap of the user): its stop alert, if any, follows
  // because the alert only counts picked lines.
  private dropLine(id: string) {
    this.selected = this.selected.filter(l => l !== id);
    if (this.selection?.line === id) this.selection = null;
    this.closeLine(id);
    this.writeUrl();
  }

  private onPollState(id: string, s: PollState) {
    this.pollState = { ...this.pollState, [id]: s };
    if (s === "unknown" && id === this.tempLine) this.clearSelection();
    if (s === "unknown" && this.selected.includes(id)) {
      this.dropLine(id);
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
