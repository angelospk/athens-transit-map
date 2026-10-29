// The one store: chosen lines, live/static data, selection. Components read it; pollers write it.

import { isHidden } from "./directions";
import type { Only } from "./format";
import { fetchCity, fetchLine, fetchLines, fetchLineStatic, fetchRailMotion, fetchStatus, fetchTile, fetchTrains } from "./api";
import { cityKey, isCityLive } from "./city";
import { loadMetro, type MetroData } from "./metro";
import { loadSuburban, type SuburbanData } from "./suburban";
import { railMotions, type RailMotion, type StasyVehicle, type SuburbanTrain, type TrainSel } from "./trains";
import type { TripIndex } from "./trip";
import { LinePoller, type PollState } from "./poller";
import { BACKOFF_MS, ClockOffset } from "./schedule";
import { CityTiles, loadTiles, viewTiles, type Tile, type View } from "./tiles";
import { isTheme, type Theme } from "./theme";
import { MAX_LINES, selectionIds, splitKnown, toggle } from "./selection";
import { hitText, type AlertHit, type AlertSpec } from "./alerts";
import { assignSlots, colorOf, type LineColor } from "./lineColors";
import { retryStops, stopPush } from "./push";
import type { CityLive, CityVehicle, LineInfo, LineLive, LineStatic, Status, Vehicle } from "./types";
import { CardNav, cardFromQuery, cardQuery, sameCard, type Card } from "./cards";
import { busVehicleCard, cardTitle, legacyOf, routeCard, trainCard } from "./legacy";
import { stopIndex } from "./stops";
import { fold } from "./search";

export const STALE_S = 120;
// A picked line whose feed has no vehicles for this many updates in a row is taken off the map.
const EMPTY_DROPS = 2;
const STATUS_EVERY_MS = 60_000;
const TILE_TIMEOUT_MS = 15_000;

export type RailLine = { kind: "metro" | "suburban"; id: string };

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

// A stop alert from the trip planner; label: the boarding stop's name; push: the bot's id for the same
// alert as web push (src/lib/push.ts).
export type StopAlert = AlertSpec & { label: string; push?: string };
const isPushAlert = (v: unknown) => {
  const a = v as StopAlert | null;
  return !!a && typeof a.push === "string" && typeof a.until === "number" && a.until > Date.now() / 1000 && Array.isArray(a.lines) && typeof a.n === "number";
};
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
  others = $state<Others>(stored("others", "hide", v => v === "normal" || v === "dim" || v === "hide"));
  showAges = $state(stored("showAges", false, isBool));
  // Off: every vehicle stays at its last GPS fix (no motion in between); its age is always shown.
  motion = $state(stored("motion", true, isBool));
  // Typical bus speed per road segment (public/speed/segments.geojson, lab/segspeed).
  speedOn = $state(stored("speedOn", false, isBool));
  // Map filters; the selected vehicle is always shown.
  only = $state.raw<Only>(stored("only", { fresh: false, onTime: false },
    v => !!v && isBool((v as Only).fresh) && isBool((v as Only).onTime)));
  // A line shown in detail because its vehicle was clicked on the city layer; not one of the picks.
  tempLine = $state<string | null>(null);
  // Light, dark, or the device's setting.
  theme = $state<Theme>(stored("theme", "system", isTheme));
  // Metro, ISAP and tram (static): every station, and each line's tracks. metroStation: the tapped station.
  metro = $state.raw<MetroData | null>(null);
  metroStation = $state<string | null>(null);
  // Suburban rail (Προαστιακός): its corridors and stations. railStation: the id of the tapped station,
  // whose card shows its live board.
  suburban = $state.raw<SuburbanData | null>(null);
  railStation = $state<string | null>(null);
  // Trains on the map (metro and tram from the timetable, Proastiakos by GPS) and the stations of all
  // three, while trainsOn ("Τρένα" in the map menu). train: the tapped one, whose card shows its run and
  // whose line is drawn. railLine: a metro/tram line or a suburban corridor shown on its own, as a bus
  // route is: its track drawn, its card listing its trains.
  trainsOn = $state(stored("trainsOn", true, isBool));
  railLine = $state.raw<RailLine | null>(null);
  stasyTrains = $state.raw<StasyVehicle[]>([]);
  // Each metro/tram trip's /v2 track and knots, by trip number: it runs on past its /v1 pair's stop.
  stasyMotion = $state.raw<Record<string, RailMotion>>({});
  suburbanTrains = $state.raw<SuburbanTrain[]>([]);
  train = $state.raw<TrainSel | null>(null);
  // Bus and trolley stops (stops.ts), drawn from zoom 15 once the map has loaded their index. busStop: the
  // tapped one (an index into stopIx.s), whose card shows its lines and live arrivals.
  stopIx = $state.raw<TripIndex | null>(null);
  busStop = $state<number | null>(null);
  // Starred bus lines: a chip row under the search, to show several at once.
  favorites = $state.raw<string[]>(stored("favorites", [], isIds));
  // Stop alert: the planner's lines that are still picked (a line taken off the map stops alerting; put
  // back, it alerts again until the alert ends); null once over. hits: arrivals shown until dismissed.
  // A push alert keeps all its lines (the bot watches them) and is kept through a reload.
  private alertSpec = $state.raw<StopAlert | null>(stored("pushAlert", null, isPushAlert));
  alert = $derived.by((): StopAlert | null => {
    const a = this.alertSpec;
    const lines = a?.push ? a.lines : a?.lines.filter(l => this.selected.includes(l.line)) ?? [];
    if (!a || !lines.length || this.serverNow / 1000 > a.until) return null;
    return lines.length === a.lines.length ? a : { ...a, lines };
  });
  hits = $state.raw<ShownHit[]>([]);
  private hitId = 0;
  private alertsStarted = false;
  // The trip planner's start and end ([lat, lon]), marked on the map while the planner is open.
  tripEnds = $state.raw<{ from: [number, number]; to: [number, number] } | null>(null);
  // The stops of the trip picked in the planner: where to get on, change and get off ([lat, lon]).
  tripStops = $state.raw<{ at: [number, number]; name: string }[]>([]);

  // Set by MapView: frame the given lines once their shapes are loaded; bring a point ([lon, lat]) into view.
  fit: (ids: string[]) => void = () => {};
  flyTo: (at: [number, number]) => void = () => {};

  private clock = new ClockOffset();
  private pollers = new Map<string, LinePoller>();
  private cityPoller: LinePoller<CityLive> | null = null;
  private cityTiles = new CityTiles();
  private tileSeq = 0;               // only the last view change publishes
  private tileCtrl: AbortController | null = null;   // the view change in flight
  private tileRetryAt = -Infinity;    // after a failed view change, the poller does the retrying
  private mapMoving = false;          // between the map's movestart and the view it reports once it rests
  private refreshHeld = new Set<() => void>();   // scheduled refreshes that wait for the map to rest
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  lineInfo = $derived(new Map(this.lines.map(l => [l.id, l])));

  // The cards open over the map (cards.ts): the top one shows. A map tap starts a new stack, a tap in a
  // card pushes, and the browser's Back pops one. Today's cards still read /v1 data: show() sets the
  // field each one reads (legacy.ts) from the top card.
  stack = $state.raw<Card[]>([]);
  private nav: CardNav | null = null;
  private baseTitle = "";

  // Lines drawn in detail (routes, DOM markers): the picks plus the temporary one.
  detailLines = $derived(this.tempLine && !this.selected.includes(this.tempLine) ? [...this.selected, this.tempLine] : this.selected);

  // Each detail line's colour slot (lineColors.ts); a line keeps its slot while it stays.
  private slotMemo = new Map<string, number>();
  lineSlots = $derived.by(() => (this.slotMemo = assignSlots(this.detailLines, this.slotMemo)));

  // A detail line's own colour; any other line keeps its operator colour.
  lineColor(id: string): LineColor {
    const info = this.lineInfo.get(id);
    return colorOf(this.lineSlots, id) ?? { bg: info?.color || "#3b5bdb", fg: info?.text_color || "#ffffff" };
  }

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
    this.baseTitle = document.title;
    this.nav = new CardNav(history, s => { this.stack = s; this.show(s[s.length - 1] ?? null); },
      s => location.pathname + cardQuery(s[s.length - 1] ?? null, this.selected) + location.hash);
    addEventListener("popstate", e => this.nav?.popped(e.state));
    this.nav.start(cardFromQuery(location.search));
    for (const id of this.selected) this.startLine(id);
    void Promise.allSettled(this.selected.map(fetchLineStatic)).then(() => this.fit(this.selected));
    this.loadLines();
    void this.refreshStatus();
    if (this.cityOn) this.startCity();
    this.loadMetro();
    this.startTrains();
    setInterval(() => (this.now = Date.now()), 1000);
    setInterval(() => { if (!document.hidden) void this.refreshStatus(); }, STATUS_EVERY_MS);
    document.addEventListener("visibilitychange", () => {
      this.now = Date.now();
      for (const p of this.pollers.values()) p.visibilityChanged();
      this.cityPoller?.visibilityChanged();
      if (!document.hidden) this.startTrains();   // the trains of now, not of the last poll
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

  // A map tap: a new stack with this card. A tap in a card: the card goes on top.
  open(c: Card) { this.nav?.open(c); }
  push(c: Card) { this.nav?.push(c); }
  back() { this.nav?.back(); }
  closeCards() { this.nav?.close(); }

  // A train's card, from what its feed says about it.
  cardOfTrain(sel: TrainSel): Card {
    if (sel.kind === "metro") {
      const v = this.stasyTrains.find(t => t.trip === sel.id);
      return trainCard(sel, v?.line ?? "", v ? `${v.line} → ${v.headsign}` : "Συρμός");
    }
    return trainCard(sel, this.suburbanTrains.find(t => t.train === sel.id)?.corridor ?? "", `Προαστιακός ${sel.id}`);
  }

  // Names the top card (the back button and the page title) once its data is in.
  retitle(title: string) {
    if (!this.nav) return;
    this.nav.retitle(title);
    this.stack = this.nav.stack;
    document.title = `${title} · ${this.baseTitle}`;
  }

  private isTop = (c: Card) => { const t = this.stack[this.stack.length - 1]; return !!t && sameCard(t, c); };

  // Shows the top card through the field its card reads; null: no card.
  private show(c: Card | null) {
    if (typeof document !== "undefined") document.title = c ? `${cardTitle(c)} · ${this.baseTitle}` : this.baseTitle;
    const l = c && legacyOf(c);
    this.metroStation = this.railStation = this.train = this.busStop = this.railLine = null;
    this.pendingStation = null;
    if (l?.kind !== "bus-vehicle" && l?.kind !== "route") this.clearSelection();
    if (!c || !l) return;
    switch (l.kind) {
      case "bus-vehicle":
        if (!c.title) this.retitle(`${l.line} · ${l.id}`);
        return this.selectCityVehicle(l.line, l.id);
      case "route": return this.showRoute(c, l.line, l.variant);
      case "bus-stop":
        void this.loadStops().then(ix => {
          const i = ix ? stopIndex(ix, l.code) : -1;
          if (!this.isTop(c)) return;
          if (i < 0) return this.say("Η στάση δεν βρέθηκε.");
          this.busStop = i;
          if (!c.title) this.retitle(ix!.s[i][0]);
        });
        return;
      case "station":
        if (l.name) this.metroStation = l.name;
        else { this.pendingStation = l.folded; this.findStation(); }
        return;
      case "rail-station": {
        this.railStation = l.id;
        const name = this.suburban?.stations.find(s => s.id === l.id)?.name;
        if (!c.title && name) this.retitle(name);
        return;
      }
      case "train": this.train = l.sel; return;
      case "rail-line": this.railLine = l.line; return;
    }
  }

  // A station from a link knows only its folded name: found once the metro data is in.
  private pendingStation = $state<string | null>(null);
  private findStation() {
    const want = this.pendingStation;
    if (!want || !this.metro) return;
    const s = this.metro.stations.find(s => fold(s.name).replace(/\s+/g, " ").trim() === want);
    this.pendingStation = null;
    if (s) { this.metroStation = s.name; this.retitle(s.name); }
    else this.say("Ο σταθμός δεν βρέθηκε.");
  }

  // A bus line's card: one direction drawn, the line shown for a while if it is not a pick. Without a
  // variant (a link), the line's first one.
  private showRoute(c: Card, line: string, variant?: string) {
    if (this.tempLine !== line) {
      this.dropTemp();
      if (!this.selected.includes(line)) { this.tempLine = line; this.startLine(line); }
    }
    if (variant) { this.selection = { kind: "route", line, variant }; return; }
    void fetchLineStatic(line).then(st => {
      const v = Object.keys(st.variants)[0];
      if (v && this.isTop(c)) { this.selection = { kind: "route", line, variant: v }; this.fit([line]); }
    }, () => { if (this.isTop(c)) this.say(`Άγνωστη γραμμή: ${line}.`); });
  }

  // A station tapped on the map (null: none). Its card replaces a vehicle's or route's.
  selectStation(name: string | null) {
    if (name) { this.clearSelection(); this.railStation = this.train = this.busStop = this.railLine = null; }
    this.metroStation = name;
  }

  // A suburban station tapped on the map (its id; null: none). Its card replaces any other.
  selectRailStation(id: string | null) {
    if (id) { this.clearSelection(); this.metroStation = this.train = this.busStop = this.railLine = null; }
    this.railStation = id;
  }

  // A bus stop tapped on the map (its index in stopIx; null: none). Its card replaces any other.
  selectBusStop(i: number | null) {
    if (i != null) { this.clearSelection(); this.metroStation = this.railStation = this.train = this.railLine = null; }
    this.busStop = i;
  }

  // The stop index (public/trips.json, shared with the planner), loaded once it is needed; null after a
  // failure (the next call tries again).
  loadStops(): Promise<TripIndex | null> {
    if (this.stopIx) return Promise.resolve(this.stopIx);
    return import("./trip").then(t => t.loadTripIndex()).then(ix => (this.stopIx = ix), () => null);
  }

  // A line tapped on a stop's card: shown for a while (as a city vehicle's line is) on its variants
  // through the stop, with the given bus selected, or else the route of the first variant.
  // Goes on the stack: the bus's card, else the line's.
  openLineAt(line: string, variants: string[], vehicle?: string) {
    if (variants.length) this.setFocus(line, variants);
    this.push(vehicle ? busVehicleCard(line, vehicle) : variants.length ? routeCard(line, variants[0]) : { kind: "line", id: `oasa:${line}`, title: line });
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
  // keepAlert: the same trip shown otherwise (one of its lines, all again); the alert stays while its lines stay.
  showTrip(lines: { id: string; variants: string[] }[], keepAlert = false): string[] {
    if (!lines.length) return [];
    const keep = lines.slice(0, MAX_LINES), ids = keep.map(l => l.id), left = lines.slice(MAX_LINES).map(l => l.id);
    if (!keepAlert || this.alert?.lines.some(l => !ids.includes(l.line))) this.setAlert(null);   // a new trip: the old alert no longer fits
    this.metroStation = this.railStation = this.train = this.busStop = this.railLine = null;
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

  constructor() {
    if (this.alertSpec) this.setAlert(this.alertSpec);   // a push alert from before the reload
    void retryStops();   // stops of push alerts the server did not confirm
  }

  // The watcher loads with the first alert and then follows app.alert.
  setAlert(a: StopAlert | null) {
    const old = this.alertSpec;
    if (old?.push && old.push !== a?.push) void stopPush(old.push);
    this.alertSpec = a;
    store("pushAlert", a?.push ? a : null);
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

  // A train tapped on the map (null: none). Its card replaces any other.
  selectTrain(t: TrainSel | null) {
    if (t) { this.clearSelection(); this.metroStation = this.railStation = this.busStop = this.railLine = null; }
    this.train = t;
  }

  // A rail line shown on its own (null: none). Its card replaces any other.
  selectRailLine(l: RailLine | null) {
    if (l) { this.clearSelection(); this.metroStation = this.railStation = this.busStop = this.train = null; }
    this.railLine = l;
  }

  setTrainsOn(on: boolean) {
    this.trainsOn = on;
    store("trainsOn", on);
    this.startTrains();
    if (!on) {
      const top = this.stack[this.stack.length - 1];
      if (top && !top.id.startsWith("oasa:")) this.closeCards();   // a rail card has nothing to show now
      this.selectTrain(null); this.selectRailLine(null); this.selectStation(null); this.selectRailStation(null);
      this.stasyTrains = this.suburbanTrains = [];
      this.stasyMotion = {};
    }
  }

  // Polls both networks while trainsOn and the tab is visible: the metro's every 15 s with its /v2 knots
  // (the client moves the trains between polls; without knots, by their /v1 pair), the Proastiakos's GPS
  // every 10 s. A failed poll keeps the last trains.
  // Each start ends the loops of the one before (trainGen).
  private trainGen = 0;
  private startTrains() {
    const gen = ++this.trainGen;
    if (!this.trainsOn) return;
    this.loadSuburban();   // the corridors' colours and paths
    const poll = async (kind: "metro" | "suburban", every: number) => {
      if (gen !== this.trainGen) return;
      if (!document.hidden) {
        if (kind === "metro") void fetchRailMotion(AbortSignal.timeout(10_000)).then(m => {   // not waited for
          if (gen === this.trainGen) this.stasyMotion = m?.status === 200 ? railMotions(m.body) : {};
        });
        const r = await fetchTrains(kind, AbortSignal.timeout(10_000));
        if (gen !== this.trainGen) return;
        const b = r.body as { vehicles?: unknown; trains?: unknown } | null;
        const list = kind === "metro" ? b?.vehicles : b?.trains;
        if (r.status === 200 && Array.isArray(list)) {
          if (kind === "metro") this.stasyTrains = list as StasyVehicle[];
          else this.suburbanTrains = list as SuburbanTrain[];
        }
      }
      setTimeout(() => void poll(kind, every), every);
    };
    void poll("metro", 15_000);
    void poll("suburban", 10_000);
  }

  // Loads the suburban data once, with the trains; after a failure, the next start tries again.
  private suburbanLoading = false;
  loadSuburban() {
    if (this.suburban || this.suburbanLoading) return;
    this.suburbanLoading = true;
    loadSuburban().then(d => (this.suburban = d), () => this.say("Δεν φόρτωσε ο Προαστιακός."))
      .finally(() => (this.suburbanLoading = false));
  }

  // Loads the metro data once; after a failure, the next call tries again (the layers menu calls it).
  private metroLoading = false;
  loadMetro() {
    if (this.metro || this.metroLoading) return;
    this.metroLoading = true;
    loadMetro().then(d => { this.metro = d; this.findStation(); }, () => this.say("Δεν φόρτωσαν οι γραμμές του μετρό."))
      .finally(() => (this.metroLoading = false));
  }

  setOthers(o: Others) {
    this.others = o;
    store("others", o);
  }

  setShowAges(on: boolean) {
    this.showAges = on;
    store("showAges", on);
  }

  setSpeedOn(on: boolean) {
    this.speedOn = on;
    store("speedOn", on);
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
    this.metroStation = this.railStation = this.train = this.busStop = this.railLine = null;
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
    this.metroStation = this.railStation = this.train = this.busStop = this.railLine = null;
    if (line !== this.tempLine) this.dropTemp();
    this.selection = { kind: "vehicle", line, id };
  }

  selectRoute(line: string, variant: string) {
    this.metroStation = this.railStation = this.train = this.busStop = this.railLine = null;
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
    this.mapMoving = false;
    const missing = this.cityTiles.want(viewTiles(view, zoom));
    const held = [...this.refreshHeld];
    this.refreshHeld.clear();
    if (held.length) {   // the refresh that waited loads every tile of the view: the load of the last view is not needed
      this.tileSeq++;
      this.tileCtrl?.abort();
      for (const go of held) go();
    }
    if (!this.cityOn) return;
    if (!this.cityPoller) return this.startCity();   // its first fetch loads the whole set
    if (!held.length) this.loadMissing(missing);
  }

  // The map started to move: no tile is asked for until it reports its view again.
  setCityMoving() {
    this.mapMoving = true;
  }

  // The poller's fetch: a refresh that falls due while the map moves waits until it rests.
  private async cityFetch(line: string, signal: AbortSignal) {
    if (this.mapMoving) {
      await new Promise<void>(go => {
        this.refreshHeld.add(go);
        signal.addEventListener("abort", () => { this.refreshHeld.delete(go); go(); }, { once: true });
      });
      if (signal.aborted) return { status: 0, body: null };
    }
    return fetchCity(this.cityTiles)(line, signal);
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
      fetchLine: (l, signal) => this.cityFetch(l, signal),
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
    const top = this.stack[this.stack.length - 1] ?? null;
    history.replaceState(history.state, "", location.pathname + cardQuery(top, this.selected) + location.hash);
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
