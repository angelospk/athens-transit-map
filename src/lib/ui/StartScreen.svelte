<script lang="ts">
  // «Θέλω να πάω», the first screen of a visit, in a box in the middle: one sentence filled in as fields. «Πού» (with
  // «Από» under it, the user's location when the browser allows it), «Πότε», «Πώς»; under them the best route for what
  // is filled in, live, as it changes. «Πάμε» hands it all to the trip planner (the Ταξίδι tab), which opens on it. Each end is the user's
  // location, a point picked on the map, or what they type (a stop, an area, a street with its number: the stop index
  // and the geocoder). Shown at every plain visit (not a shared link), and again from «Πού πας;» on Τώρα. The same
  // box, one field only, sets «Σπίτι» and «Δουλειά» (app.savingPlace).
  import { busId, isBusId } from "../busNs";
  import { flushSync, tick, untrack } from "svelte";
  import { centre, distM, geocode, reverseGeocode, loadTripIndex, places, placeStop, savedPlaces, stationPlaces, suggest, type Place, type TripIndex } from "../trip";
  import { distText, titleCase } from "../nearby";
  import type { AppState, TripMode, TripPrefs } from "../state.svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import MoreHint from "./MoreHint.svelte";
  import RouteCard from "./RouteCard.svelte";
  import RemindSheet from "./RemindSheet.svelte";
  import Sheet from "./Sheet.svelte";
  import { guideFromPlan } from "../guide";
  import { fallbackPlan, type LineLook } from "../fallbackPlan";
  import { loadMetro } from "../metro";
  import { loadSuburban } from "../suburban";
  import { CITIES, type CityId } from "../cities";
  import { item, open as reveal, pop, rise, soft } from "../anim";
  import { fetchStop, fetchV2Lines, fetchV2Stop, fetchV2Stops, getJSON } from "../api";
  import { findMuniLines, findMuniStops, lineStopPoints, type MuniStopHit, type StopEntry } from "../finder";
  import type { MuniCard } from "../muniLine";
  import { intents, lineAlias, modeWord, ownEnd, parseTrip, searchLines, searchNamed, type Ctx, type Intent } from "../searchEngine";
  import { fold } from "../search";
  import { checkLive, liveCount } from "../liveLines";
  import { stopRows, type V2Arrival, type V2Line } from "../v2";
  import { arrivalGroups, linesAt, placeNote, toward, type StopArrival } from "../stops";
  import { busStopCard } from "../legacy";
  import { destsOf, type Dest } from "../destinations";
  import DestIcon from "./DestIcon.svelte";
  import LineChip from "./LineChip.svelte";
  import ShortcutSheet from "./ShortcutSheet.svelte";
  import LinesPage from "./LinesPage.svelte";
  import { clockHM } from "../trains";
  import { API_BASE } from "../config";
  import { durText } from "../format";
  import { withMetro } from "../metroBridge";
  import { euro, tripFare } from "../fares";
  import { parsePlan, planFC, planSummary, planUrl, scaledLegs, type Itinerary, type PlanResponse } from "../plan";
  import { arriveOrder, athensAt, dayOf, hhmm, quick, slots, wall, whenLabel, type When } from "../when";

  let { app }: { app: AppState } = $props();

  type Field = "from" | "to";
  const ME = "Η θέση μου";
  const MAP = "Σημείο στον χάρτη";
  let ends = $state<Record<Field, { text: string; place: Place | null }>>({ from: { text: "", place: null }, to: { text: "", place: null } });
  let open = $state<Field | null>(null);
  // The suggestions list: on a phone a short fade (a sliding height fights the keyboard rising in the same moment),
  // on a computer the slide.
  const listIn = (node: Element) => (wide ? reveal(node) : soft(node, { duration: 120 }));
  // What the local search looks for: the text as typed, a moment after each key (a phone types faster than it can
  // search thousands of stops and lines on every key); cleared or set at once.
  let typed = $state<Record<Field, string>>({ from: "", to: "" });
  let typedT: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const t = { from: ends.from.text, to: ends.to.text };
    clearTimeout(typedT);
    if ((t.from === "" || t.from.trim().length < 2) && (t.to === "" || t.to.trim().length < 2)) { typed = t; return; }
    typedT = setTimeout(() => (typed = t), 90);
  });
  let geo = $state.raw<{ text: string; places: Place[] } | null>(null);
  let busy = $state(false);
  let locating = $state<Field | null>(null);
  let err = $state<string | null>(null);
  let own = $state.raw<Place[]>([]);
  let ix = $state.raw<TripIndex | null>(null);
  let boxEl = $state<HTMLElement>();
  const inputs = $state<Record<Field, HTMLInputElement | undefined>>({ from: undefined, to: undefined });

  // The choices (kept for the visit: coming back to «Πού πας;» finds them as they were). «Πότε» and «Πώς» are fields
  // like «Πού», each opening its own list under it.
  const ALL: TripMode[] = ["bus", "trolley", "metro", "tram"];
  const WHEN = [{ value: 0, label: "Τώρα", hint: "Με τα ζωντανά δρομολόγια" }, { value: 15, label: "Σε 15 λεπτά", hint: "" },
    { value: 30, label: "Σε 30 λεπτά", hint: "" }, { value: 60, label: "Σε 1 ώρα", hint: "Με το πρόγραμμα" }] as const;
  let later = $state(0);
  // A phone's «Πότε» (mockup 46 Γ): now, leaving at, or arriving by a time; a list under its chip sets it.
  let when = $state.raw<When>({ kind: "now" });
  let whenOpen = $state(false);
  let dKind = $state<When["kind"]>("now"), dMin = $state(0), dEarly = $state(5);
  function openWhen() {
    if (whenOpen) { whenOpen = false; return; }
    const now = untrack(() => app.serverNow) / 1000, w = when;
    dKind = w.kind;
    dMin = w.kind === "now" ? quick(now)[0] ?? slots(now)[0] ?? 0 : wall(w.at).min + (dayOf(now, w.at) > 0 ? 24 * 60 : 0);
    dEarly = w.kind === "arrive" ? w.early : 5;
    whenOpen = true;
  }
  function setKind(k: When["kind"]) {
    dKind = k;
    if (k === "now") { when = { kind: "now" }; whenOpen = false; }
  }
  // A time picked that has gone by meanwhile: the first one left.
  $effect(() => {
    const s = slots(app.serverNow / 1000);
    if (whenOpen && s.length && !s.includes(dMin)) untrack(() => { dMin = s.find(m => m >= dMin) ?? s[0]; });
  });
  function applyWhen() {
    const at = athensAt(app.serverNow / 1000, 0, dMin);
    when = dKind === "leave" ? { kind: "leave", at } : dKind === "arrive" ? { kind: "arrive", at, early: dEarly } : { kind: "now" };
    whenOpen = false;
  }
  // A time that has gone by is now again.
  $effect(() => { const w = when; if (w.kind !== "now" && w.at < app.serverNow / 1000 - 300) untrack(() => { when = { kind: "now" }; }); });
  // The selected time in the middle of its list (the list scrolls, not the panel under it).
  function inView(node: HTMLElement, _key: number) {
    const show = () => requestAnimationFrame(() => {
      const el = node.querySelector<HTMLElement>("[aria-selected='true']");
      if (el) node.scrollTop = el.offsetTop - (node.clientHeight - el.offsetHeight) / 2;
    });
    show();
    return { update: show };
  }
  // Under «Πότε», two chips (mockup 27): which means the trip may use (their badges, overlapped; a list to tick them
  // in, one at least), and which routes come first: the earliest there, the cheapest, the shortest.
  const MEANS: { m: TripMode; label: string; icon: IconName; color: string }[] = [
    { m: "bus", label: "Λεωφορείο", icon: "bus", color: "#1f5fc8" }, { m: "trolley", label: "Τρόλεϊ", icon: "trolley", color: "#e8930c" },
    { m: "metro", label: "Μετρό", icon: "metro", color: "#e2231a" }, { m: "tram", label: "Τραμ", icon: "tram", color: "#16a34a" }];
  let means = $state<TripMode[]>([...ALL]);
  const modes = $derived<TripMode[]>(means);
  function toggleMean(m: TripMode) {
    const next = means.includes(m) ? means.filter(x => x !== m) : [...means, m];
    if (next.length) means = ALL.filter(x => next.includes(x));
  }
  const meansOn = $derived(MEANS.filter(x => means.includes(x.m)));
  const meansLabel = $derived(meansOn.length === MEANS.length ? "Όλα" : meansOn.length === 1 ? meansOn[0].label : `${meansOn.length} μέσα`);
  type Sort = "time" | "price" | "dist";
  const SORTS: { id: Sort; label: string; hint: string; icon: IconName }[] = [
    { id: "time", label: "Χρόνος", hint: "Φτάνεις νωρίτερα", icon: "clock" },
    { id: "price", label: "Τιμή", hint: "Τα λιγότερα ευρώ, π.χ. χωρίς Express", icon: "ticket" },
    { id: "dist", label: "Απόσταση", hint: "Τα λιγότερα χιλιόμετρα, και λιγότερο περπάτημα", icon: "route" },
  ];
  let sortId = $state<Sort>("time");
  const sort = $derived(SORTS.find(x => x.id === sortId) ?? SORTS[0]);
  const RADIUS = 500;
  let menu = $state<"when" | "means" | "sort" | null>(null);
  const toggleMenu = (m: "when" | "means" | "sort") => { open = null; menu = menu === m ? null : m; };

  // A computer keeps the map live beside the panel: a click on a bus, a stop or a line there opens its card, and
  // «Πού πας;» steps aside for it (it comes back from the search pill or «/»).
  $effect(() => {
    if (app.stack.length && untrack(() => app.start && !app.pickFor)) app.start = false;
  });
  $effect(() => {
    if (!app.start || own.length) return;
    loadTripIndex().then(i => { ix = i; own = places(i); }, () => {});
  });
  // Opened: on the destination, the keyboard up (a phone), the cursor in it (a computer).
  $effect(() => {
    if (!app.start || app.pickFor) return;
    untrack(() => {
      menu = null;
      if (!ends.to.place && wide) setTimeout(() => inputs.to?.focus(), 60);
      // Whether the browser would give the location without asking (it is offered first then), or never (not offered).
      navigator.permissions?.query({ name: "geolocation" }).then(r => { geoPerm = r.state; r.onchange = () => (geoPerm = r.state); }, () => {});
    });
  });

  // The suggestions of the open field: the two ways to choose without typing, then what the typed text finds.
  const opts = $derived.by(() => {
    if (!open) return [] as Place[];
    const q = typed[open].trim();
    if (q.length < 2 || ends[open].place) return [];
    // Our engine (searchEngine.ts): words in any order, short forms, a slip, «αεροδρόμιο»; a station before a pole,
    // a stop with more lines before one with fewer, the nearer first.
    const mine = findOwn(q, 6);
    return suggest(mine, geo && geo.text === q ? geo.places : [], 7);
  });
  // Lines too, in «Πού» (not a place: picking one opens it live on the map). By number (308, Χ95, Μ3, Τ6) first,
  // before the places; by a word for the kind («μετρό», «τραμ», «τρόλεϊ», «προαστιακός») all of that kind; by name
  // (Κηφισιά) a few, after the places.
  let allLines = $state.raw<V2Line[]>([]);
  let allStops = $state.raw<StopEntry[]>([]);
  $effect(() => {
    if (!app.start || allLines.length) return;
    fetchV2Lines().then(r => { if (r.status === 200) allLines = (r.body as { lines: V2Line[] }).lines; }, () => {});
    fetchV2Stops().then(r => { if (r.status === 200) allStops = (r.body as { stops: StopEntry[] }).stops; }, () => {});
  });
  const ctx = $derived<Ctx>({ at: app.myPos ?? app.mapCenter, favLines: new Set(app.favs.lines.map(l => l.id)),
    favStops: new Set(app.favs.stops.map(x => x.id)), live: id => liveCount(id) });
  // The planner's own places (stops by name, stations, areas) by our engine: a station before a pole, a stop with more
  // lines before one with fewer, the nearer first.
  function findOwn(q: string, max: number): Place[] {
    const at = app.myPos ?? app.mapCenter;
    return searchNamed([...rail, ...own], q, p => p.label, p => (p.kind === "metro" ? -0.8 : 0) - Math.min(0.3, p.lines.length / 40)
      + (at ? Math.min(1, distM(at, centre(p.pts)) / 8000) : 0)).slice(0, max).map(x => x.item);
  }
  // Two asks in one line: «040 Σύνταγμα», a line at a stop (searchEngine intents); «Σύνταγμα προς σπίτι», «από εδώ
  // στο Σύνταγμα», «Σπίτι → Δουλειά», a trip, its ends the user's own words (home, work, here) or any place.
  type End = { label: string; place: Place | null; me?: true; missing?: "home" | "work" };
  type Ask = Intent | { kind: "go"; from: End; to: End };
  function endOf(t: string): End | null {
    const w = ownEnd(t);
    if (w === "home" || w === "work") {
      const p = savedPlaces(app.places).find(x => x.kind === w);
      return p ? { label: p.label, place: p } : { label: w === "home" ? "Σπίτι" : "Δουλειά", place: null, missing: w };
    }
    if (w === "me") return { label: ME, place: app.myPos ? { label: ME, pts: [app.myPos], lines: [], kind: "me" } : null, me: true };
    const hit = findOwn(t, 1)[0];
    return hit ? { label: titleCase(hit.label), place: hit } : null;
  }
  const asks = $derived.by((): Ask[] => {
    const q = typed.to;
    if (open !== "to" || app.savingPlace || ends.to.place || !q.trim().includes(" ")) return [];
    const t = parseTrip(q);
    if (t) {
      const a = endOf(t.from), b = endOf(t.to);
      return a && b && a.label !== b.label ? [{ kind: "go", from: a, to: b }] : [];
    }
    return allLines.length && allStops.length ? intents(allLines, allStops, q, ctx).filter(x => x.kind === "lineAt") : [];
  });
  const lineHits = $derived.by((): { first: V2Line[]; last: V2Line[] } => {
    const q = open === "to" && !app.savingPlace ? typed.to.trim() : "";
    if (!q || ends.to.place || !allLines.length) return { first: [], last: [] };
    const fq = fold(q);
    const found = searchLines(allLines, q, [], ctx).map(x => x.item);
    if (lineAlias(q) || modeWord(q)) return { first: found.slice(0, 8), last: [] };
    const byLabel = found.filter(l => l.label && fold(l.label).replace(/^0+/, "").startsWith(fq.replace(/^0+/, "")));
    return { first: byLabel.slice(0, 5), last: found.filter(l => !byLabel.includes(l)).slice(0, 3) };
  });
  // Each line found: running now or not, asked quietly a moment after the typing stops (liveLines.ts).
  let liveTick = $state(0);
  $effect(() => {
    const ids = [...lineHits.first, ...lineHits.last].map(l => l.id);
    if (!ids.length) return;
    const t = setTimeout(() => checkLive(ids, () => liveTick++), 250);
    return () => clearTimeout(t);
  });
  const liveOf = (id: string) => { void liveTick; return liveCount(id); };
  // «Δημοτικά», while that layer is on: municipal lines (also by municipality, «Χολαργός») and named stops.
  const muniQ = $derived(open === "to" && !app.savingPlace && !ends.to.place && app.municipalOn && app.municipal ? typed.to.trim() : "");
  const muniLines = $derived(muniQ.length >= 2 ? findMuniLines(app.muniCards, muniQ).slice(0, 4) : []);
  const muniStops = $derived(muniQ.length >= 2 && app.municipal ? findMuniStops(app.municipal.stops, app.municipal.routes, muniQ).slice(0, 3) : []);
  const town = (m: string) => m.replace(/^Δήμος\s+/, "");
  // The stations (metro, tram, Προαστιακός) a walk from where the user is (or the map's middle), offered in an empty
  // field: a trip often starts, or ends, best at one.
  let rail = $state.raw<Place[]>([]);   // every metro, tram and Προαστιακός station, by its proper name (trip.ts)
  $effect(() => {
    if (!app.start || rail.length) return;
    Promise.all([loadMetro().catch(() => null), loadSuburban().catch(() => null)]).then(([m, sb]) => { rail = stationPlaces(m, sb); });
  });
  // Near the user (or the start they chose, or the map's middle): the two nearest stations, however far (a suburb's
  // is a bus ride away), and the bus stops a short walk off. Each with how far and what runs there.
  const dist = (d: number) => (d < 1000 ? `${Math.round(d / 10) * 10} μ` : `${(d / 1000).toFixed(1).replace(".", ",")} χλμ`);
  const nearAt = $derived(app.myPos ?? (ends.from.place && ends.from.place.kind !== "metro-any" ? centre(ends.from.place.pts) : null) ?? app.mapCenter);
  const nearStations = $derived.by((): Place[] => {
    const at = nearAt;
    if (!at || app.savingPlace) return [];
    // One per name: the metro's «Συνταγμα» and the tram's «Σύνταγμα (Κέντρο)» are one place to walk to.
    const seen = new Set<string>();
    return rail.map(p => ({ p, d: distM(at, centre(p.pts)) })).filter(x => x.d < 6000).sort((a, b) => a.d - b.d)
      .filter(({ p }) => { const k = fold(p.label.replace(/\s*\(.*\)\s*/, "")); return !seen.has(k) && !!seen.add(k); }).slice(0, 2)
      .map(({ p, d }) => ({ ...p, hint: `${dist(d)} · ${p.hint}` }));
  });
  const nearStops = $derived.by((): Place[] => {
    const at = nearAt;
    if (!at) return [];   // setting «Σπίτι»: the stops near are a choice too (compact mockup 16)
    return own.flatMap(p => { const d = Math.min(...p.pts.map(q => distM(at, q))); return d < 500 ? [{ p, d }] : []; })
      .sort((a, b) => a.d - b.d).slice(0, 3).map(({ p, d }) => ({ ...p, hint: `${dist(d)} · ${stopHint(p)}` }));
  });
  // A bus stop's own label in the lists: what it is and the lines through it.
  const stopHint = (p: Place) => `Στάση${p.lines.length ? ` · ${p.lines.slice(0, 4).join(", ")}${p.lines.length > 4 ? ` +${p.lines.length - 4}` : ""}` : ""}`;
  type Row = { key: string; me?: true; map?: true; place?: Place; line?: V2Line; ask?: Ask; head?: string; muniLine?: MuniCard; muniStop?: MuniStopHit };
  const lineRow = (l: V2Line, head?: string): Row => ({ key: `line|${l.id}`, line: l, head });
  const rows = $derived.by((): Row[] => {
    if (!open) return [];
    // Nothing typed, or a field already set (tapped to change it): the ways to choose without typing.
    if (!ends[open].text.trim() || ends[open].place) {
      const near = [...nearStations, ...nearStops].map((p, k): Row => ({ key: `near|${p.kind}|${p.label}|${p.pts[0].join()}`, place: p, head: k === 0 ? (app.savingPlace ? "Στάσεις κοντά σου" : app.myPos ? "Κοντά σου" : "Κοντά") : undefined }));
      return [{ key: "me", me: true }, ...(app.savingPlace ? [] : savedPlaces(app.places).map(p => ({ key: p.kind!, place: p }))), ...near, { key: "map", map: true }];
    }
    const { first, last } = lineHits;
    const places = opts.map((p, k): Row => ({ key: `${p.kind}|${p.label}|${p.pts[0].join()}`, place: p, head: k === 0 && (first.length || last.length) ? "Μέρη" : undefined }));
    const quick = asks.map((a, k): Row => ({ key: `ask|${a.kind}`, ask: a, head: k === 0 ? "Γρήγορα" : undefined }));
    if (quick.length && !first.length && places[0]) places[0].head = "Μέρη";
    const muni = [...muniLines.map((c): Row => ({ key: `muni|${c.id}`, muniLine: c })), ...muniStops.map((h): Row => ({ key: `munistop|${h.id}`, muniStop: h }))];
    if (muni[0]) muni[0].head = "Δημοτικά";
    return [...quick, ...first.map((l, k) => lineRow(l, k === 0 ? "Γραμμές" : undefined)), ...places,
      ...last.map((l, k) => lineRow(l, k === 0 && !first.length ? "Γραμμές" : undefined)), ...muni, { key: "map", map: true }];
  });
  const MODE_NAME: Record<string, [string, IconName]> = { bus: ["Λεωφορείο", "bus"], trolley: ["Τρόλεϊ", "bus"], metro: ["Μετρό", "metro"],
    tram: ["Τραμ", "tram"], suburban: ["Προαστιακός", "suburban"] };
  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  function badge(l: V2Line) {
    const text = l.label ?? native(l.id);
    if (isBusId(l.id)) { const c = app.lineColor(native(l.id)); return { text, bg: c.bg, fg: c.fg }; }
    return { text, bg: l.color ?? "#6b7280", fg: l.text_color ?? "#ffffff" };
  }
  function openCard(c: { kind: "line" | "stop"; id: string; title: string }) {
    app.savingPlace = null;
    app.start = false;
    app.pickFor = null;
    app.setTab("map");
    app.open(c);
  }
  function openLine(l: V2Line) {
    app.savingPlace = null;
    app.start = false;
    app.pickFor = null;
    app.setTab("map");
    app.open({ kind: "line", id: l.id, title: badge(l).text });
    // A bus line frames its route once the route loads; the other modes frame their stops.
    if (!isBusId(l.id)) app.fitPoints(lineStopPoints(allStops, l.id));
  }
  let active = $state(-1);
  $effect(() => { void open; void rows.length; active = -1; });
  const stopPlace = (x: StopEntry): Place => ({ label: titleCase(x[1]), pts: [[x[2], x[3]]], lines: [], kind: x[4].some(m => m === "metro") ? "metro" : "stop" });
  function runAsk(a: Ask) {
    if (a.kind === "lineAt") {
      app.savingPlace = null; app.start = false; app.pickFor = null;
      app.setTab("map");
      app.stopOnly = native(a.line.id);
      app.open({ kind: "stop", id: a.stop[0], title: titleCase(a.stop[1]) });
    } else if (a.kind === "trip") {
      ends = { from: { text: titleCase(a.from[1]), place: stopPlace(a.from) }, to: { text: titleCase(a.to[1]), place: stopPlace(a.to) } };
      open = null;
      inputs.to?.blur();
    } else {
      // Each end as found; where the user is, asked for now if not known yet; an end not set (no home saved) left
      // empty with its field open, to choose it there.
      const fill = (e: End): { text: string; place: Place | null } => ({ text: e.place || e.me ? e.label : "", place: e.place });
      ends = { from: fill(a.from), to: fill(a.to) };
      open = null;
      for (const [f, e] of [["from", a.from], ["to", a.to]] as const) if (e.me && !e.place) locate(f);
      const gap = (["to", "from"] as const).find(f => !ends[f].place && !(a[f].me));
      if (gap) { open = gap; setTimeout(() => inputs[gap]?.focus(), 60); }
      else inputs.to?.blur();
    }
  }
  function run(f: Field, r: Row) {
    if (r.ask) runAsk(r.ask);
    else if (r.me) locate(f);
    else if (r.line) openLine(r.line);
    else if (r.muniLine) openCard({ kind: "line", id: r.muniLine.id, title: r.muniLine.ref ?? r.muniLine.name });
    else if (r.muniStop) openCard({ kind: "stop", id: `muni:${r.muniStop.id.replace(/^osm:/, "")}`, title: r.muniStop.name });
    else if (r.map) pick(f);
    else if (r.place) choose(f, r.place);
  }
  function key(f: Field, e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open = f;
      const n = rows.length;
      if (n) active = e.key === "ArrowDown" ? (active + 1) % n : (active <= 0 ? n - 1 : active - 1);
      document.getElementById(`start-opt-${active}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = rows[active] ?? (opts[0] || asks[0] || lineHits.first[0] ? rows[0] : undefined);
      if (r) run(f, r);
      else if (ready) go();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      if (open) open = null;
      else if (app.savingPlace) { app.savingPlace = null; app.start = false; }
      else explore();   // Escape leaves for the map from the field too, as the hint beside «Μόνο ο χάρτης» says
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctl: AbortController | null = null;
  function edit(f: Field, text: string) {
    menu = null;
    if (locating === f) locating = null;   // typing wins over a location still on its way
    ends[f] = { text, place: null };
    open = f;
    err = null;
    clearTimeout(timer);
    ctl?.abort();
    const q = text.trim();
    if (q.length < 3) { busy = false; return; }
    busy = true;
    // Near the trip's other end, else near the user (or the map's centre): of the many «Ερμού» the near one first.
    const other = ends[f === "from" ? "to" : "from"].place;
    const near = other ? centre(other.pts) : app.myPos ?? app.mapCenter ?? undefined;
    timer = setTimeout(() => {
      const c = (ctl = new AbortController());
      geocode(q, c.signal, near).then(
        r => { if (ctl === c) geo = { text: q, places: r }; },
        () => {},
      ).finally(() => { if (ctl === c) busy = false; });
    }, 350);
  }

  // ---- Setting «Σπίτι» or «Δουλειά» on a phone (compact mockups 16, 16β): the search opens at once, «Εδώ που είσαι
  // τώρα» first with the address there, then the map and the stops near. Where the user is, by its address.
  const savingWord = $derived(app.savingPlace === "home" ? "Σπίτι" : app.savingPlace === "work" ? "Δουλειά" : "");
  $effect(() => {
    if (!app.start || !app.savingPlace || wide || app.pickFor || open !== null) return;
    untrack(() => { open = "to"; typingOn = true; });
  });
  let hereAddr = $state.raw<Place | null>(null);
  $effect(() => {
    const me = app.myPos, on = !!app.savingPlace && app.start;
    if (!on || !me) return;
    const ac = new AbortController();
    void reverseGeocode(me, ac.signal).then(p => { if (!ac.signal.aborted) hereAddr = p; }).catch(() => {});
    return () => ac.abort();
  });
  const hereText = $derived(hereAddr ? [hereAddr.label, hereAddr.hint?.split(",")[0]].filter(Boolean).join(", ") : "");
  function cancelSaving() { app.savingPlace = null; app.start = false; open = null; }

  function choose(f: Field, p: Place) {
    // Setting «Σπίτι» or «Δουλειά» (the home screen's shortcuts): the place picked is saved, and the screen closes.
    const saving = app.savingPlace;
    if (saving) {
      const label = p.kind === "me" ? (hereText || ME) : titleCase(p.label);
      app.setPlace(saving, { label, at: centre(p.pts) });
      app.notify(`${saving === "home" ? "Σπίτι" : "Δουλειά"}: ${label}`);
      app.savingPlace = null;
      app.start = false;
      app.pickFor = null;
      ends = { from: ends.from, to: { text: "", place: null } };
      open = null;
      return;
    }
    if (find && f === "to") { open = null; showFound(p); return; }
    ends[f] = { text: titleCase(p.label), place: p };
    open = null;
    // The destination chosen: the start is asked right under it (the field appears; the cursor goes there), unless
    // the user's location is on its way there.
    const other: Field = f === "from" ? "to" : "from";
    // The start is not typed for the user: its field offers the likely ones (suggestions under it) to tap.
    if (other === "to" && !ends.to.place && !quietPick) setTimeout(() => inputs.to?.focus(), 80);
    else inputs[f]?.blur();
  }

  // «Η θέση μου» stays where the user is: a move of over 80 m (the location the map follows) moves the start with it.
  $effect(() => {
    const at = app.myPos;
    untrack(() => {
      for (const f of ["from", "to"] as Field[]) {
        const p = ends[f].place;
        if (p?.kind === "me" && at && distM(p.pts[0], at) > 80) ends[f] = { text: ends[f].text, place: { ...p, pts: [at] } };
      }
    });
  });
  let quietPick = false;
  function locate(f: Field, quiet = false) {
    ends[f] = { text: ME, place: null };
    if (!quiet) open = null;
    locating = f;
    err = null;
    navigator.geolocation?.getCurrentPosition(
      p => {
        if (locating !== f) return;
        locating = null;
        quietPick = quiet;
        choose(f, { label: ME, hint: `±${Math.round(p.coords.accuracy)} μ.`, pts: [[p.coords.latitude, p.coords.longitude]], lines: [], kind: "me" });
        quietPick = false;
      },
      e => {
        if (locating !== f) return;
        locating = null;
        ends[f] = { text: "", place: null };
        if (!quiet) err = e.code === 1 ? "Ο browser δεν επιτρέπει την τοποθεσία. Διάλεξε στον χάρτη ή γράψε μια διεύθυνση." : "Δεν βρέθηκε η τοποθεσία σου. Δοκίμασε ξανά.";
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  // On the map: the screen steps aside, a crosshair marks the centre, «Εδώ» takes it. The label is the nearest stop.
  function pick(f: Field) {
    open = null;
    app.setTab("map");   // the map alone under the crosshair (App.svelte hides its buttons while picking)
    app.pickFor = f;
  }
  const takeCentre = () => takeAt(app.mapCenter);
  $effect(() => {
    const c = app.mapPick;
    if (!c) return;
    untrack(() => { app.mapPick = null; if (app.pickFor) takeAt(c); });
  });
  // Checking an end on the map (the band's map buttons): the picking view, the map flown to the place. «Πίσω»
  // keeps it; «Άλλαξε εδώ» takes the centre, unless the map was not moved (then the place stays as it was named).
  let checking = $state.raw<{ f: Field; place: Place } | null>(null);
  $effect(() => { if (!app.pickFor) checking = null; });
  function checkOnMap(f: Field) {
    const p = ends[f].place;
    if (!p?.pts.length) return;
    const at = centre(p.pts);
    checking = { f, place: p };
    app.pickFor = f;
    app.centerOn([at[1], at[0]]);
  }
  function takeAt(c: [number, number] | null) {
    const f = app.pickFor, was = checking, sn = app.pickSnap;
    if (f && sn && c === app.mapCenter) {   // «Εδώ» on a stop or a station the circle snapped onto: that place itself
      app.pickFor = null;
      choose(f, { label: sn.name, hint: sn.kind, pts: [sn.at], lines: sn.station ? sn.lines : [], kind: sn.station ? "metro" : "stop" });
      return;
    }
    app.pickFor = null;
    if (!f || !c) return;
    if (was && was.f === f && distM(centre(was.place.pts), c) < 25) return;
    let near: string | null = null, best = 400;
    for (const s of ix?.s ?? []) {
      const d = distM([s[1], s[2]], c);
      if (d < best) { best = d; near = s[0]; }
    }
    choose(f, { label: near ? `Κοντά στη στάση ${titleCase(near)}` : MAP, hint: `${c[0].toFixed(5)}, ${c[1].toFixed(5)}`, pts: [c], lines: [], kind: "area" });
  }

  // ---- The map pick on a phone (compact mockups 8, 8β): the address field on top, and a sheet with the point (the
  // stop the circle snapped onto, or the address there), the stops and the station a short walk from it, «Κράτα το ως»,
  // «Πήγαινέ με εδώ».
  const pickAt = $derived<[number, number] | null>(app.pickSnap?.at ?? app.mapCenter);
  let pickAddr = $state.raw<Place | null>(null);
  $effect(() => {
    const c = app.mapCenter, on = !!app.pickFor && !wide;
    pickAddr = null;
    if (!on || !c) return;
    const ac = new AbortController();
    const t = setTimeout(() => reverseGeocode(c, ac.signal).then(p => { if (!ac.signal.aborted) pickAddr = p; }).catch(() => {}), 250);
    return () => { clearTimeout(t); ac.abort(); };
  });
  const walkMin = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));
  const pickNear = $derived.by(() => {
    const c = app.mapCenter;
    if (!app.pickFor || wide || !c || !ix) return [] as { key: string; name: string; lines: string[]; at: [number, number]; walk: number; station: boolean }[];
    const byName = new Map<string, { name: string; lines: Set<string>; at: [number, number]; m: number }>();
    ix.s.forEach((x, i) => {
      if (Math.abs(x[1] - c[0]) > 0.004 || Math.abs(x[2] - c[1]) > 0.005) return;
      const m = distM([x[1], x[2]], c);
      if (m > 350) return;
      const k = fold(x[0]), g = byName.get(k);
      const ls = linesAt(ix!, i).map(l => l.line);
      if (!g) byName.set(k, { name: titleCase(x[0]), lines: new Set(ls), at: [x[1], x[2]], m });
      else { ls.forEach(l => g.lines.add(l)); if (m < g.m) { g.m = m; g.at = [x[1], x[2]]; } }
    });
    const bus = [...byName.values()].sort((a, b) => a.m - b.m).slice(0, 2)
      .map(g => ({ key: `b|${g.name}`, name: g.name, lines: [...g.lines].slice(0, 3), at: g.at, walk: walkMin(g.m), station: false }));
    let st: { key: string; name: string; lines: string[]; at: [number, number]; walk: number; station: boolean } | null = null, best = 700;
    for (const x of app.metro?.stations ?? []) {
      const m = distM([x.lat, x.lon], c);
      if (m < best) { best = m; st = { key: `m|${x.name}`, name: titleCase(x.name), lines: x.lines, at: [x.lat, x.lon], walk: walkMin(m), station: true }; }
    }
    return [...bus, ...(st ? [st] : [])];
  });
  const pickTitle = $derived(app.pickSnap?.name ?? pickAddr?.label ?? "Σημείο στον χάρτη");
  const pickSub = $derived.by(() => {
    const at = pickAt, me = app.myPos;
    const far = at && me ? distM(me, at) : null;
    const what = app.pickSnap ? app.pickSnap.kind : pickAddr?.hint ?? (at ? `${at[0].toFixed(5)}, ${at[1].toFixed(5)}` : "");
    return [what, far != null && far > 40 ? `${distText(far)} από εδώ` : ""].filter(Boolean).join(" · ");
  });
  function pickType() {
    const f = app.pickFor;
    if (!f) return;
    app.pickFor = null;
    open = f;
    startTyping(true);
    void tick().then(() => inputs[f]?.focus());
  }
  const pickMe = () => { if (app.myPos) app.centerOn([app.myPos[1], app.myPos[0]]); };
  async function pickShare() {
    const at = pickAt;
    if (!at) return;
    const url = `https://www.openstreetmap.org/?mlat=${at[0].toFixed(6)}&mlon=${at[1].toFixed(6)}#map=18/${at[0].toFixed(6)}/${at[1].toFixed(6)}`;
    try { if (navigator.share) await navigator.share({ title: pickTitle, url }); else await navigator.clipboard.writeText(url); } catch { /* closed */ }
  }
  const keptAs = (k: "home" | "work") => { const p = app.places[k], at = pickAt; return !!p && !!at && distM(p.at, at) < 30; };
  function keepAs(k: "home" | "work") {
    const at = pickAt;
    if (!at) return;
    app.setPlace(k, keptAs(k) ? null : { label: pickTitle, at });
  }
  const pickFav = $derived(app.pickSnap?.code ? busId(app.pickSnap.code) : null);

  // Αντιστροφή: the two ends change places; the button turns and each text slides in from the other row.
  let turned = $state(false);
  let swapped = $state(false);
  let swapTimer: ReturnType<typeof setTimeout> | undefined;
  function swap() {
    ends = { from: ends.to, to: ends.from };
    open = null;
    turned = !turned;
    swapped = false;
    clearTimeout(swapTimer);
    requestAnimationFrame(() => { swapped = true; swapTimer = setTimeout(() => (swapped = false), 400); });
  }
  const ready = $derived(!!ends.from.place && !!ends.to.place);
  // «Από», left empty for the user to choose: under it the likely starts, one tap each. Their location first when the
  // browser gives it without asking (it is where most trips start), then «Σπίτι» and «Δουλειά» unless the trip goes
  // there, then a point on the map. Location is not offered where the browser refuses it.
  let geoPerm = $state<PermissionState | "unknown">("unknown");
  type Sugg = { key: string; label: string; icon: IconName; best: boolean; run: () => void };
  const fromChips = $derived.by((): Sugg[] => {
    const to = ends.to.place, out: Sugg[] = [];
    if (geoPerm !== "denied" && typeof navigator !== "undefined" && navigator.geolocation)
      out.push({ key: "me", label: ME, icon: "locate", best: geoPerm === "granted", run: () => locate("from") });
    for (const p of savedPlaces(app.places)) {
      if (to && Math.min(...to.pts.map(a => distM(a, p.pts[0]))) < 800) continue;
      out.push({ key: p.kind!, label: p.label, icon: p.kind === "home" ? "home" : "work", best: false, run: () => choose("from", p) });
    }
    if (!out.some(c => c.best) && out[0] && out[0].key !== "me") out[0].best = true;
    out.push({ key: "map", label: "Στον χάρτη", icon: "map", best: false, run: () => pick("from") });
    return out;
  });
  // The start field shows once the destination is set (or once something was typed in it: back from a later step).
  const askFrom = $derived(!!ends.to.place || !!ends.from.text || !!ends.from.place);
  function go() {
    if (!ready) return;
    app.tripPrefs = { modes, order: sortId === "dist" ? "walk" : "time", later, radius: RADIUS, pick: best?.at };
    app.tripFrom = ends.from.place;
    if (ends.from.place && ends.to.place) remember(ends.from.place, ends.to.place);
    app.tripTo = ends.to.place;
    app.start = false;
    app.setTab("trip");
  }
  function explore() {
    app.savingPlace = null;
    app.start = false;
    app.pickFor = null;
    app.setTab("map");
  }
  // The rail lines' own colours (metro.json; the Προαστιακός's purple), for the station rows' chips.
  const LINE_TINT: Record<string, string> = { M1: "#098b4a", M2: "#d7171f", M3: "#1b388c", T6: "#f39200", T7: "#f39200", Π: "#7b3fa0" };
  const iconOf = (p: Place): IconName => p.kind === "home" || p.kind === "work" ? p.kind : p.kind === "street" ? "street" : p.kind === "area" ? "area"
    : p.kind === "metro" || p.kind === "metro-any" ? "metro" : p.kind === "poi" ? "pin" : "stop";

  // A computer (a wide window): the screen is a panel on the left and the live map stays open beside it. Before a
  // destination is chosen the panel offers the ways in: the search, what comes near me, the map, a few places to go
  // straight to (with how long it takes from here, once the start is known).
  let wide = $state(typeof matchMedia === "function" && matchMedia("(min-width: 1024px)").matches);
  $effect(() => {
    const q = matchMedia("(min-width: 1024px)");
    const on = () => (wide = q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  });
  const intro = $derived(wide && !app.savingPlace && !ends.to.place && !app.finding);
  // The quick search (the map's top-left button): one field; a line opens live, a stop its card, a place the map on it.
  const find = $derived(app.finding && !app.savingPlace);
  // The quick search has its own field: it opens empty, and what was typed there does not stay in «Πού θέλεις να πας»
  // (the trip's destination comes back as it was).
  let tripTo: { text: string; place: Place | null } | null = null;
  $effect(() => {
    const on = find;
    untrack(() => {
      if (on && !tripTo) { tripTo = ends.to; ends.to = { text: "", place: null }; open = null; }
      else if (!on && tripTo) { ends.to = tripTo; tripTo = null; open = null; }
    });
  });
  $effect(() => { if (!app.start) app.finding = false; });
  // The ends the planner handed over (a phone): into the fields, the empty one open for typing.
  $effect(() => {
    const se = app.startEnds;
    if (!se || !app.start) return;
    untrack(() => {
      app.startEnds = null;
      if (se.from) ends.from = { text: se.from.label, place: se.from };
      ends.to = se.to ? { text: se.to.label, place: se.to } : { text: "", place: null };
      if (!se.to) setTimeout(() => inputs.to?.focus(), 120);
    });
  });
  $effect(() => { if (find && app.start && !app.pickFor) untrack(() => setTimeout(() => inputs.to?.focus(), 80)); });
  function showFound(p: Place) {
    app.finding = false; app.start = false; app.pickFor = null;
    const at = centre(p.pts);
    app.setTab("map");
    if (p.kind === "stop" && ix) {
      // The stop's own card: of the place's stops, the one nearest its centre.
      const k = placeStop(ix, p);
      if (k >= 0) { app.push(busStopCard(ix.s[k][3]!, titleCase(ix.s[k][0]))); return; }
    }
    app.flyTo([at[1], at[0]]);
  }
  // The places most asked for, in the page's city (none for a city not listed here).
  const QUICK_BY: Partial<Record<CityId, Place[]>> = {
    athens: [
      { label: "Αεροδρόμιο", hint: "Ελ. Βενιζέλος", pts: [[37.9364, 23.9445]], lines: [], kind: "area" },
      { label: "Λιμάνι Πειραιά", hint: "Πύλες Ε1–Ε12", pts: [[37.9420, 23.6465]], lines: [], kind: "area" },
      { label: "Σύνταγμα", hint: "Κέντρο", pts: [[37.9755, 23.7348]], lines: [], kind: "area" },
      { label: "Κηφισιά", hint: "Πλατεία", pts: [[38.0740, 23.8110]], lines: [], kind: "area" },
    ],
    thessaloniki: [
      { label: "Αεροδρόμιο", hint: "Μακεδονία", pts: [[40.5197, 22.9709]], lines: [], kind: "area" },
      { label: "Λευκός Πύργος", hint: "Παραλία", pts: [[40.6264, 22.9484]], lines: [], kind: "area" },
      { label: "Αριστοτέλους", hint: "Πλατεία", pts: [[40.6325, 22.9410]], lines: [], kind: "area" },
    ],
  };
  const QUICK = $derived(QUICK_BY[app.cityId] ?? []);
  const OF_CITY: Partial<Record<CityId, string>> = { athens: "της Αθήνας", thessaloniki: "της Θεσσαλονίκης" };
  let quickMin = $state.raw<Record<string, number>>({});
  $effect(() => {
    const from = intro && app.start ? ends.from.place : null;
    if (!from) return;
    const a = centre(from.pts), c = new AbortController();
    for (const q of QUICK) {
      if (distM(a, q.pts[0]) < 600) continue;
      getJSON(planUrl(API_BASE, a, q.pts[0], undefined, 1), c.signal).then(res => {
        const r = res.status === 200 ? parsePlan(res.body) : null, it = r?.itineraries[0];
        if (it && !c.signal.aborted) quickMin = { ...quickMin, [q.label]: Math.round((it.arrive_at - untrack(() => app.serverNow) / 1000) / 60) };
      }, () => {});
    }
    return () => c.abort();
  });
  // ---- The intro's own things (mockup 32): home and work with the trip there now, the favourite stops live (and the
  // favourite lines, one tap to the map), the last trips to take again.
  type EndTrip = { line: string; inMin: number; arrive: number; mins: number } | null;
  let endTrip = $state.raw<Record<string, EndTrip>>({});
  $effect(() => {
    // From the start set, else from where the user is (the intro's start is the user).
    const from = (intro || !wide) && app.start ? (ends.from.place ? centre(ends.from.place.pts) : app.myPos) : null;
    if (!from) return;
    const a = from, c = new AbortController();
    for (const p of savedPlaces(app.places)) {
      const k = p.kind!;
      if (distM(a, p.pts[0]) < 300) { endTrip = { ...untrack(() => endTrip), [k]: null }; continue; }
      getJSON(planUrl(API_BASE, a, p.pts[0], undefined, 1), c.signal).then(res => {
        const r = res.status === 200 ? parsePlan(res.body) : null, it = r?.itineraries[0];
        if (!r || !it || c.signal.aborted) return;
        const ride = it.legs.find(l => l.kind === "ride"), now = untrack(() => app.serverNow) / 1000;
        endTrip = { ...untrack(() => endTrip), [k]: { line: ride ? r.lines[ride.line ?? ""]?.label ?? native(ride.line ?? "") : "",
          inMin: ride ? Math.max(0, Math.round((ride.depart_at - now) / 60)) : 0, arrive: it.arrive_at, mins: Math.max(1, Math.round((it.arrive_at - now) / 60)) } };
      }, () => {});
    }
    return () => c.abort();
  });
  const mine = $derived(([["home", "Σπίτι"], ["work", "Δουλειά"]] as const).map(([k, label]) => {
    const p = savedPlaces(app.places).find(x => x.kind === k);
    return { k, label, place: p ?? null, trip: endTrip[k] };
  }));
  function goMine(k: "home" | "work", p: Place | null) {
    if (!p) { app.savingPlace = k; return; }
    choose("to", p);
  }

  const favStops = $derived(app.favs.stops.slice(0, 3));
  const favKey = $derived(favStops.map(s => s.id).join("|"));
  let favBoards = $state.raw<Record<string, V2Arrival[]>>({});
  // The phone's first screen (no destination yet, nothing being typed) shows them too.
  const phoneHome = $derived(!wide && !app.savingPlace && !find && !ends.to.place && open === null);
  $effect(() => {
    if (!((intro || phoneHome) && app.start) || !favKey) return;
    const ids = favKey.split("|");
    let dead = false, t: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      for (const id of ids) {
        const r = await fetchV2Stop(id);
        if (dead) return;
        const b = r.body as { arrivals?: V2Arrival[] } | null;
        if (r.status === 200 && b) favBoards = { ...untrack(() => favBoards), [id]: b.arrivals ?? [] };
      }
      if (!dead) t = setTimeout(load, 30_000);
    };
    void load();
    return () => { dead = true; clearTimeout(t); };
  });
  const minOf = (at: number) => Math.max(0, Math.round((at - nowS) / 60));
  const favCards = $derived(favStops.map(s => {
    const b = favBoards[s.id], rows = b ? stopRows(b, nowS) : null;
    const first = rows?.flatMap(r => r.times.slice(0, 1).map(t => ({ r, t }))).sort((x, y) => x.t.at - y.t.at)[0] ?? null;
    const late = first?.t.delay_s != null && first.t.delay_s >= 120 ? Math.round(first.t.delay_s / 60) : 0;
    return { s, loading: !b, first, late,
      deps: (rows ?? []).slice(0, 3).map(r => ({ line: native(r.line), to: titleCase(placeNote(toward(r.headsign)).place), min: r.times[0] ? minOf(r.times[0].at) : null })) };
  }));
  const favLines = $derived(app.favs.lines.slice(0, 6));
  // The line shortcuts' minutes, live: each stop asked once a minute while «Πού πας;» is open.
  let scMin = $state<Record<string, number | null>>({});
  $effect(() => {
    const list = app.lineShortcuts, on = app.start;
    if (!on || !list.length) return;
    let stop = false;
    const load = async () => {
      for (const code of new Set(list.map(x => x.stop))) {
        const r = await fetchStop(code).catch(() => null);
        if (stop) return;
        const b = r?.status === 200 ? (r.body as { arrivals?: StopArrival[] } | null) : null;
        if (!b?.arrivals) continue;
        const gs = arrivalGroups(b.arrivals, app.serverMs());
        const next = { ...scMin };
        for (const x of list.filter(y => y.stop === code)) {
          const g = gs.find(g => g.line === x.line && g.variant === x.variant) ?? gs.find(g => g.line === x.line);
          next[`${x.line}|${x.variant}|${x.stop}`] = g ? g.times[0].min : null;
        }
        scMin = next;
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(t); };
  });
  // A favourite stop as the trip's end (its own label, the stop's place).
  function goFav(st: { id: string; name: string; lat: number; lon: number }) {
    choose("to", { label: app.stopLabel(st.id, titleCase(st.name)), pts: [[st.lat, st.lon]], lines: [], kind: "stop" });
  }
  function openFav(st: { id: string; name: string }) {
    app.savingPlace = null; app.start = false; app.pickFor = null;
    app.setTab("map");
    app.push(busStopCard(native(st.id), titleCase(st.name)));
  }

  type Recent = { from: Place; to: Place; at: number };
  const loadRecent = (): Recent[] => { try { const v = JSON.parse(localStorage.getItem("recentTrips") ?? "[]"); return Array.isArray(v) ? v.filter(x => x?.from?.pts && x?.to?.pts) : []; } catch { return []; } };
  let recent = $state.raw<Recent[]>(loadRecent());
  function remember(from: Place, to: Place) {
    const same = (a: Place, b: Place) => a.label === b.label && distM(a.pts[0], b.pts[0]) < 200;
    recent = [{ from, to, at: Date.now() }, ...recent.filter(x => !(same(x.from, from) && same(x.to, to)))].slice(0, 3);
    try { localStorage.setItem("recentTrips", JSON.stringify(recent)); } catch { /* private mode */ }
  }
  // What was typed, in bold in each result (compact mockup 3): the first place where it matches, accents aside.
  function hl(text: string, q: string): [string, boolean][] {
    const qf = fold(q.trim());
    if (!qf) return [[text, false]];
    const chars = [...text], parts = chars.map(c => fold(c));
    const at: number[] = [];
    let joined = "";
    parts.forEach((x, i) => { at.push(joined.length); joined += x; void i; });
    const i = joined.indexOf(qf);
    if (i < 0) return [[text, false]];
    const a = at.findIndex(v => v >= i), end = i + qf.length;
    let b = at.findIndex(v => v >= end);
    if (b < 0) b = chars.length;
    return [[chars.slice(0, a).join(""), false], [chars.slice(a, b).join(""), true], [chars.slice(b).join(""), false]].filter(x => x[0]) as [string, boolean][];
  }
  function clearRecent() {
    recent = [];
    try { localStorage.removeItem("recentTrips"); } catch { /* private mode */ }
  }
  // ↖: the place's name into «Προς», to go on typing from it.
  // Typing (compact mockup 3): the row Enter would take is lit; the lines go in one row of chips, each with its other end.
  const firstLine = $derived(rows.findIndex(r => r.line));
  const topRow = $derived(rows[0] && !rows[0].line && !rows[0].map && (!rows[0].me || !!app.savingPlace) ? 0 : -1);   // what Enter takes
  const lineHead = (q: string) => (/\d/.test(q) ? "Γραμμές" : "Γραμμές που περνούν");
  function otherEnd(name: string, q: string): string {
    const parts = titleCase(name).split(/\s+[-–]\s+/), fq = fold(q.trim());
    return parts.find(x => !fq || !fold(x).includes(fq)) ?? parts[0];
  }
  function fillTo(label: string) {
    edit("to", label);
    setTimeout(() => inputs.to?.focus(), 30);
  }
  // Compact mockup 2: the shortcuts (the way now first: Δουλειά when the user is at home), «Βρες γραμμή», «Δημοφιλή».
  const shortcuts = $derived([...mine].sort((a, b) => (a.trip === null ? 1 : b.trip === null ? -1 : a.trip && !b.trip ? -1 : !a.trip && b.trip ? 1 : 0)));
  const popular = $derived(destsOf(app.cityId));
  const goDest = (d: Dest) => choose("to", { label: d.label, hint: d.hint, pts: [d.at], lines: [], kind: "area" });
  let addSheet = $state(false);
  function close() { app.savingPlace = null; app.pickFor = null; app.start = false; }
  // «Βρες γραμμή» (compact mockup 7): its own page in this screen; «‹» comes back here.
  let linesPage = $state(false);
  $effect(() => { if (!app.start) linesPage = false; });
  $effect(() => { if (app.start && app.startLines) untrack(() => { app.startLines = false; linesPage = true; }); });
  function findLine() { linesPage = true; }
  function again(x: Recent) {
    // From «Η θέση μου»: from where the user is now (the start already set to it), not where they were then.
    if (x.from.label !== ME || !ends.from.place) ends.from = { text: x.from.label, place: x.from };
    choose("to", x.to);
  }
  // Beside the panel the map shows the city with its vehicles live, then, once both ends are known, the two of them.
  const CITY = $derived.by((): [number, number][] => {
    if (app.cityId === "athens") return [[23.63, 37.90], [23.86, 38.07]];
    const [lon, lat] = CITIES[app.cityId].center;
    return [[lon - 0.08, lat - 0.06], [lon + 0.08, lat + 0.06]];
  });
  const ll = (p: Place): [number, number] => { const [la, lo] = centre(p.pts); return [lo, la]; };
  let framed = "";
  $effect(() => {
    if (!wide || !app.start || app.pickFor || app.savingPlace) { framed = ""; return; }
    const a = ends.from.place, b = ends.to.place;
    const want = a && b ? JSON.stringify([centre(a.pts), centre(b.pts)]) : b ? "" : "city";
    if (!want || want === framed) return;
    framed = want;
    const city = CITY;
    untrack(() => setTimeout(() => app.fitPoints(want === "city" ? city : [ll(a!), ll(b!)]), 80));
  });

  function nearMe() {
    app.savingPlace = null;
    app.start = false;
    app.pickFor = null;
    app.setTab("now");
    app.locate();
  }

  // The best route for what is filled in, asked as soon as both ends are known and again when «Πότε» changes; «Πώς»
  // only picks among the options (no new request). The same /v2/plan the trip planner asks, so «Πάμε» opens on it.
  const MODE_OF: Record<string, TripMode> = { bus: "bus", trolley: "trolley", metro: "metro", tram: "tram" };
  let plan = $state.raw<{ key: string; r: PlanResponse | null } | null>(null);
  // The planner's own word on its data (each Source's state): a bus source still loading gives no bus routes yet,
  // an expired metro timetable gives its times only roughly. Said in a line each, and asked again while loading.
  let planSources = $state.raw<PlanResponse["sources"]>([]);
  let planAgain = $state(0);
  const pKey = $derived(ends.from.place && ends.to.place && !app.savingPlace
    ? JSON.stringify([centre(ends.from.place.pts), centre(ends.to.place.pts), later, when]) : null);
  $effect(() => { void pKey; planSources = []; });
  $effect(() => {
    if (!planSources.some(x => x.state === "warming_up")) return;
    const t = setTimeout(() => planAgain++, 45_000);
    return () => clearTimeout(t);
  });
  const SOURCE_NOTE: Record<string, Record<string, string>> = {
    oasa: { warming_up: "Τα δεδομένα των λεωφορείων φορτώνουν ακόμα στον server: διαδρομές με λεωφορείο έρχονται σε λίγο (ξαναψάχνω μόνο του).",
      stale: "Τα λεωφορεία δεν ενημερώνονται αυτή τη στιγμή: οι ώρες τους μπορεί να μην είναι οι τωρινές.",
      indicative: "Λεωφορεία: ώρες από παλιό πρόγραμμα, κατά προσέγγιση.", down: "Δεν υπάρχουν δεδομένα για τα λεωφορεία αυτή τη στιγμή." },
    stasy: { warming_up: "Το πρόγραμμα του μετρό και του τραμ φορτώνει ακόμα.",
      indicative: "Μετρό και τραμ: το πρόγραμμά τους έληξε, οι ώρες είναι από την ίδια μέρα παλιότερου προγράμματος, κατά προσέγγιση.",
      down: "Δεν υπάρχει πρόγραμμα για μετρό και τραμ αυτή τη στιγμή." },
  };
  const sourceNotes = $derived(planSources.map(x => SOURCE_NOTE[x.id]?.[x.state]).filter((x): x is string => !!x));
  $effect(() => {
    const k = pKey;
    if (!k || !app.start) return;
    void planAgain;   // asked again while a source loads; the routes shown stay until the new answer
    const [a, b, off, w] = JSON.parse(k) as [[number, number], [number, number], number, When];
    const c = new AbortController();
    // When to ask from: now (or «σε 15′»), the time to leave, or, arriving by a time, an hour and a quarter before it
    // (then again from just the time the quickest route needs, below).
    const nowAsk = untrack(() => app.serverNow) / 1000;
    const after = w.kind === "leave" ? w.at : w.kind === "arrive" ? Math.max(nowAsk, w.at - 75 * 60) : off ? nowAsk + off * 60 : undefined;
    const t = setTimeout(() => getJSON(planUrl(API_BASE, a, b, after, 5), c.signal).then(
      async res => {
        if (c.signal.aborted) return;
        const r0 = res.status === 200 ? parsePlan(res.body) : null;
        planSources = Array.isArray(r0?.sources) ? r0.sources : [];
        // No route from the server: the app finds some itself (fallbackPlan.ts), timed from the live boards: only now.
        if (w.kind !== "now" && (!r0 || !r0.itineraries.length)) { plan = { key: k, r: r0 }; return; }
        if (!r0 || !r0.itineraries.length) {
          const fb = await fallback(a, b, c.signal);
          if (!c.signal.aborted) plan = { key: k, r: fb ?? r0 };
          return;
        }
        const r = r0;
        plan = { key: k, r };
        // Each later answer joins the list (the options it adds, its lines and stops), if the ends are still the same.
        const add = (m: PlanResponse | null) => {
          const cur = plan?.key === k ? plan.r : null;
          if (c.signal.aborted || !m || !cur) return;
          const id = (x: Itinerary) => `${x.depart_at}-${x.arrive_at}-${x.transfers}`, seen = new Set(cur.itineraries.map(id));
          plan = { key: k, r: { ...cur, itineraries: [...cur.itineraries, ...m.itineraries.filter(x => !seen.has(id(x)))],
            lines: { ...m.lines, ...cur.lines }, stops: { ...m.stops, ...cur.stops } } };
        };
        const ask = (f: [number, number], t: [number, number], after?: number) =>
          getJSON(planUrl(API_BASE, f, t, after, 5), c.signal).then(x => (x.status === 200 ? parsePlan(x.body) : null), () => null);
        // The next ones too (the server gives 5 at a time): after the last, for the list.
        const last = r.itineraries.at(-1);
        if (last && !r.last) void ask(a, b, last.depart_at + 60).then(add);
        // Arriving by a time: again from as late as the quickest route allows, so the latest that make it are there.
        if (w.kind === "arrive") {
          const quickest = Math.min(...r.itineraries.map(x => x.arrive_at - x.depart_at));
          const late = Math.max(nowAsk, w.at - w.early * 60 - quickest - 10 * 60);
          if (Number.isFinite(late) && Math.abs(late - (after ?? 0)) > 5 * 60) void ask(a, b, late).then(add);
        }
        // A metro option, when the server gave none (metroBridge.ts).
        void withMetro(r, a, b, after, untrack(() => app.serverNow) / 1000, ask)
          .then(m => { if (m !== r) add(m); }, () => {});
      },
      async () => { const fb = c.signal.aborted ? null : await fallback(a, b, c.signal); if (!c.signal.aborted) plan = { key: k, r: fb }; }), 120);
    return () => { clearTimeout(t); c.abort(); };
  });
  const nowS = $derived(app.serverNow / 1000);
  const lineLook = (line: string): LineLook => { const c = app.lineColor(line); return { label: line, color: c.bg, text: c.fg, mode: app.lineInfo.get(line)?.kind === "trolley" ? "trolley" : "bus" }; };
  async function fallback(a: [number, number], b: [number, number], signal: AbortSignal) {
    const i = ix ?? (await loadTripIndex().catch(() => null));
    if (!i || signal.aborted) return null;
    return fallbackPlan(i, a, b, untrack(() => app.serverNow) / 1000, lineLook, signal).catch(() => null);
  }
  // A leg's length from its shape ([lat, lon]), when the server gives none.
  const lineM = (sh: [number, number][]) => {
    let m = 0;
    for (let i = 1; i < sh.length; i++) {
      const [a, b] = [sh[i - 1], sh[i]];
      m += Math.hypot((b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180), (b[0] - a[0]) * 110540);
    }
    return m;
  };
  const routes = $derived.by(() => {
    const r = plan && plan.key === pKey ? plan.r : null;
    if (!r) return null;
    const all = r.itineraries.filter(it => it.depart_at > nowS - 60);
    const ok = (it: Itinerary) => it.legs.every(l => l.kind !== "ride" || modes.includes(MODE_OF[l.mode ?? r.lines[l.line ?? ""]?.mode ?? "bus"] ?? "bus"));
    const fit = all.filter(ok), its = [...(fit.length ? fit : all)];
    // Each option's price (the fare it needs, full or reduced as set) and its length (every leg, on foot too).
    const eur = (it: Itinerary) => { const f = tripFare(it, r); return f ? f.total[app.fareReduced ? 1 : 0] : 0; };
    const km = (it: Itinerary) => it.legs.reduce((t, l) => t + (l.distance_m ?? lineM(l.shape)), 0) / 1000;
    const key = sortId === "price" ? eur : sortId === "dist" ? km : (it: Itinerary) => it.arrive_at;
    // Arriving by a time: the latest to leave that still makes it first (when.ts); by price or length, among those.
    const w = when;
    const fits = w.kind === "arrive" ? arriveOrder(its, w.at, w.early) : null;
    const fitOf = new Map(fits?.map(f => [f.it, f]) ?? []);
    const order = fits && sortId === "time" ? fits.map(f => f.it)
      : (fits ? (fits.some(f => f.tone !== "late") ? fits.filter(f => f.tone !== "late").map(f => f.it) : fits.map(f => f.it)) : its)
        .map(it => ({ it, k: key(it) })).sort((x, y) => x.k - y.k || x.it.arrive_at - y.it.arrive_at).map(({ it }) => it);
    return order.map(it => ({ it, ft: fitOf.get(it) ?? null })).map(({ it, ft }) => ({ fit: ft,
      key: `${it.depart_at}-${it.arrive_at}-${sortId}`, at: [it.depart_at, it.arrive_at] as [number, number], it,
      ...planSummary(it, r, nowS), legs: scaledLegs(it, r), ignored: !fit.length,
      metric: sortId === "price" ? euro(eur(it)) : sortId === "dist" ? `${km(it).toFixed(1).replace(".", ",")} χλμ` : "" }));
  });
  // The one «Πάμε» opens: the best by «Πώς», or another the user tapped; the rest under it, faded until hovered.
  let chosen = $state<string | null>(null);
  $effect(() => { void pKey; void sortId; void modes; chosen = null; });
  const top = $derived(routes?.[0] ?? null);
  // The route «Πάμε» opens, drawn on the map beside the panel (a computer) and framed when the choice changes.
  $effect(() => {
    const r = plan && plan.key === pKey ? plan.r : null, b = best;
    const it = app.start && !app.pickFor && r && b ? r.itineraries.find(x => x.depart_at === b.at[0] && x.arrive_at === b.at[1]) : undefined;
    app.startPreview = it && r ? planFC(it, r) : null;
  });
  let previewFramed = "";
  $effect(() => {
    const fc = app.startPreview, k = best?.key ?? "";
    if (!wide || !fc || !k || k === previewFramed) return;
    previewFramed = k;
    const pts = fc.features.flatMap(f => f.geometry.coordinates as [number, number][]);
    if (pts.length) untrack(() => setTimeout(() => app.fitPoints(pts), 60));
  });
  const best = $derived(routes?.find(x => x.key === chosen) ?? top);
  const others = $derived(routes ? routes.slice(1) : []);

  // ---- Not a wide window (mockup 39): two questions, «Από πού ξεκινάς;» then «Πού θέλεις να πας;», with home, work
  // and the last trips under them; both answered, the answer: the trip in one card (each half with its «Αλλαγή»), the
  // routes as compact cards (where each one's bus is now), one opened step by step; «Ξεκίνα» starts the navigator.
  let asking = $state(true);
  let wasReady = false;
  $effect(() => { const r = ready; untrack(() => { if (r && !wasReady) asking = false; wasReady = r; }); });
  $effect(() => { if (!app.start) untrack(() => { asking = !ready; }); });
  // Leaving the answer (‹, ✕, Ξεκίνα, the map): «Πού πας;» opens on a new question next time, not on the trip just left.
  let leftAnswer = false;
  $effect(() => { const a = answer; untrack(() => { if (a) leftAnswer = true; }); });
  $effect(() => {
    if (app.start) return;
    untrack(() => { if (leftAnswer) { leftAnswer = false; ends = { ...ends, to: { text: "", place: null } }; asking = true; open = null; } });
  });
  // The trip was closed: the destination goes (the start stays: usually where the user is), the questions come back.
  $effect(() => {
    if (!app.tripReset) return;
    untrack(() => { ends = { ...ends, to: { text: "", place: null } }; asking = true; open = null; });
  });
  // «Βρες» (the search button) is never the trip asked, even with both ends of an earlier trip still set.
  const answer = $derived(!wide && ready && !asking && !app.savingPlace && !app.finding);
  // Typing on a phone: the field goes to the top of the screen (the heading and the other field step aside), its
  // list under it and no lower than the keyboard; «‹» or a choice brings the screen back.
  // The screen changes only once the tap is over (its click): changed at the focus, the field moved under the finger
  // and the click landed elsewhere, which closed it again (the field seemed not to take the tap).
  let typingOn = $state(false);
  let typingT: ReturnType<typeof setTimeout> | undefined;
  const typing = $derived(!wide && open !== null && !answer && typingOn);
  // A phone's «Πού πας;» (compact mockup 2): «Από» and «Προς» as one block, «‹» before it, the swap after it.
  const pair = $derived(!wide && !app.savingPlace && !find && !typing && !answer);
  $effect(() => { if (open === null) { clearTimeout(typingT); typingOn = false; } });
  // The pair swaps only two places (one end empty, it would leave «Από» blank).
  const canSwap = $derived(!!ends.from.place && !!ends.to.place);
  // The pair with «Προς» set and «Από» empty (and no location on its way): «Από» opens for typing, as a tap on it
  // would, instead of a page with nothing under the pair. Once per such change: «Άκυρο» leaves it closed.
  let fromAsked: Place | null = null;
  $effect(() => {
    if (!ends.to.place || ends.from.place || ends.from.text) { fromAsked = null; return; }
    if (!pair) return;
    untrack(() => {
      if (fromAsked === ends.to.place) return;
      fromAsked = ends.to.place;
      if (open !== null || locating === "from") return;
      open = "from";
      startTyping(true);
      void tick().then(() => inputs.from?.focus());
    });
  });
  function startTyping(now = false) {
    clearTimeout(typingT);
    if (now) typingOn = true;
    else typingT = setTimeout(() => (typingOn = true), 350);   // a focus with no tap (from the code): a moment later
  }
  function stopTyping() {
    const f = open;
    open = null;
    if (f) inputs[f]?.blur();
  }
  $effect(() => {
    if (!typing) return;
    // The screen's own scroll back to the top (the field is there now). Not the page's: moving it while the keyboard
    // is up shifts what a tap hits on iOS.
    void tick().then(() => boxEl?.closest(".start")?.scrollTo(0, 0));
  });
  // The list's height: down to the top of the keyboard (the visual viewport), scrolling inside.
  function aboveKeys(node: HTMLElement) {
    if (wide) return;
    const vv = visualViewport;
    const fit = () => {
      const bottom = vv ? vv.offsetTop + vv.height : innerHeight;
      node.style.maxHeight = `${Math.max(160, Math.floor(bottom - node.getBoundingClientRect().top - 12))}px`;
    };
    fit();
    const t = setTimeout(fit, 350);
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    return { destroy() { clearTimeout(t); vv?.removeEventListener("resize", fit); vv?.removeEventListener("scroll", fit); } };
  }
  let openKey = $state<string | null>(null);
  let allShown = $state(false);
  $effect(() => { void pKey; void sortId; void modes; openKey = null; allShown = false; });
  let sheet = $state<"opts" | "remind" | null>(null);
  $effect(() => { if (!app.start) sheet = null; });
  // The start, found by itself where the browser gives the location without asking (once per opening).
  let autoFrom = false;
  $effect(() => {
    if (!app.start) { autoFrom = false; return; }
    if (wide || app.savingPlace || app.finding || geoPerm !== "granted") return;
    untrack(() => { if (!autoFrom && !ends.from.place && !ends.from.text) { autoFrom = true; locate("from", true); } });
  });
  const planR = $derived(plan && plan.key === pKey ? plan.r : null);
  const allIts = $derived(planR?.itineraries ?? []);
  const shownRoutes = $derived(routes ? (allShown ? routes : routes.slice(0, 5)) : []);
  const bestTag = $derived(!top ? "" : sortId === "price" ? `Η φθηνότερη · ${top.metric}` : sortId === "dist" ? `Η πιο σύντομη · ${top.metric}`
    : when.kind === "arrive" ? (top.fit?.tone === "ok" ? "Η καλύτερη" : "") : when.kind === "leave" ? "Η καλύτερη" : later ? `Η καλύτερη σε ${later}′` : "Η καλύτερη τώρα");
  const whenWord = $derived(when.kind !== "now" ? whenLabel(when, nowS) : later ? (later === 60 ? "σε 1 ώρα" : `σε ${later} λεπτά`) : "τώρα");
  const meansWord = $derived(meansOn.length === MEANS.length ? "όλα τα μέσα" : meansOn.map(x => x.label.toLowerCase()).join(" και "));
  // The phone's list (mockup 14): the order in words for its button, the fastest option, the fare when every option costs
  // the same, and a row's word on an old metro or tram timetable (said there instead of a box above the list).
  let leaveOf = $state<Record<string, number>>({});   // each row's «Φύγε» in minutes (RouteCard counts its live bus)
  const SORT_LIST: Record<Sort, string> = { time: "Γρηγορότερες", price: "Φθηνότερες", dist: "Πιο σύντομες" };
  const fastKey = $derived(routes && routes.length > 1 ? routes.reduce((a, b) => (b.it.duration_s < a.it.duration_s ? b : a)).key : "");
  const sameFare = $derived.by(() => {
    if (!routes?.length || !planR) return "";
    const t = routes.map(o => { const f = tripFare(o.it, planR!); return f?.lines.length ? f.total[app.fareReduced ? 1 : 0] : null; });
    return t.every(x => x != null && x === t[0]) ? euro(t[0]!) : "";
  });
  const railOldNote = SOURCE_NOTE.stasy.indicative;
  const railIsOld = $derived(planSources.some(x => x.id === "stasy" && x.state === "indicative"));
  function railOld(it: Itinerary) {
    if (!railIsOld || !planR) return "";
    const ms = new Set(it.legs.flatMap(l => (l.kind === "ride" ? [l.mode ?? planR!.lines[l.line ?? ""]?.mode ?? ""] : [])));
    const m = ms.has("metro") && ms.has("tram") ? "Μετρό και τραμ" : ms.has("metro") ? "Μετρό" : ms.has("tram") ? "Τραμ" : "";
    return m ? `${m} από παλιό πρόγραμμα · ώρα κατά προσέγγιση` : "";
  }
  const SORT_WORD: Record<Sort, string> = { time: "Να φτάσω γρήγορα", price: "Να πληρώσω λιγότερο", dist: "Να περπατήσω λιγότερο" };
  const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  // A tap on «Από» or «Προς» of the band: back to the two fields, that one focused (its text selected).
  // Straight to typing in that field (no pass through the two fields, which flashed an empty screen), focused inside
  // the tap so the keyboard comes up on iOS, its text selected to type over.
  function editEnd(f: Field, e?: Event) {
    e?.stopPropagation();
    flushSync(() => { asking = true; open = f; typingOn = true; });
    const el = inputs[f];
    el?.focus();
    el?.select();
  }
  const fromWord = (p: Place | null) => !p ? "" : p.kind === "me" ? "εδώ που είσαι" : p.kind === "home" ? "το σπίτι" : p.kind === "work" ? "τη δουλειά" : titleCase(p.label);
  const armed = $derived(!!best && app.leaveRemind?.key === `${best.at[0]}-${best.at[1]}` ? app.leaveRemind : null);
  function pickCard(k: string) { chosen = k; openKey = openKey === k ? null : k; }
  function startNow() {
    const r = planR, b = best, to = ends.to.place, from = ends.from.place;
    if (!r || !b || !to || !from) return;
    remember(from, to);
    app.startGuide(guideFromPlan(b.it, r, ix, titleCase(to.label)));
  }
  // The other options light up as they scroll into the panel: each card's --v goes from 0 (just in at the foot,
  // small and faint, tucked under the one above) to 1 (well inside: full size). Scripted, so every browser does it.
  function stack(node: HTMLElement) {
    let sc: HTMLElement | null = null, raf = 0;
    const find = () => {
      for (let p = node.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowY;
        if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
      }
      return null;
    };
    const update = () => {
      raf = 0;
      const v = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      // What shows of the panel: down to «Πάμε», which stays over its foot. At the end of the list, every card full.
      const acts = (sc ?? document).querySelector<HTMLElement>(".acts");
      const foot = acts ? Math.min(v.bottom, acts.getBoundingClientRect().top) : v.bottom;
      const h = foot - v.top;
      const end = sc ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4 : innerHeight + scrollY >= document.body.scrollHeight - 4;
      for (const li of Array.from(node.children) as HTMLElement[]) {
        const r = li.getBoundingClientRect();
        li.style.setProperty("--v", end ? "1" : Math.max(0, Math.min(1, (foot - r.top) / (h * 0.32))).toFixed(3));
      }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    const bind = () => {
      const next = find();
      if (next === sc) return;
      (sc ?? window).removeEventListener("scroll", on);
      sc = next;
      (sc ?? window).addEventListener("scroll", on, { passive: true });
    };
    bind();
    addEventListener("resize", on);
    const mo = new MutationObserver(() => { bind(); on(); });
    mo.observe(node, { childList: true, subtree: true });
    update();
    return { destroy() { (sc ?? window).removeEventListener("scroll", on); removeEventListener("resize", on); mo.disconnect(); cancelAnimationFrame(raf); } };
  }
  const waiting = $derived(!!pKey && plan?.key !== pKey);
  const walkOnly = $derived(plan && plan.key === pKey ? plan.r?.walk_only ?? null : null);
</script>

<!-- The «Πού» list closes on the click, not on the press: closed on the press, everything under it moves up before the
     button is released, and the click lands on something else (a chip such as «Σύνταγμα» did nothing). -->
<svelte:document onclick={e => {
  const t = e.target as Element;
  if (open && t.isConnected && !t.closest?.(".field, .opts, .cancel, input")) stopTyping();
}} onpointerdown={e => {
  const t = e.target as Element;
  if (menu && !t.closest?.(".pickf, .opts")) menu = null;
  if (whenOpen && !t.closest?.(".whenpop, .tchip.when")) whenOpen = false;
}} />
<!-- A computer: «/» or ⌘K opens «Πού πας;», the one search; Escape leaves the map pick, goes a step back, or leaves for the map. -->
<svelte:window onkeydown={e => {
  const typing = (e.target as Element | null)?.closest?.("input, textarea, [contenteditable]");
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); if (app.start) explore(); else app.start = true; }
  else if (e.key === "/" && !typing && !app.start) { e.preventDefault(); app.start = true; }
  else if (e.key === "Escape" && app.start && app.pickFor) app.pickFor = null;
  else if (e.key === "Escape" && app.start && menu) menu = null;
  else if (e.key === "Escape" && app.start && whenOpen) whenOpen = false;
  else if (e.key === "Escape" && app.start && !open && !typing) explore();
  else if (e.key === "Enter" && app.start && !typing && !app.pickFor && !menu && ready) go();
}} />

{#if app.start && app.pickFor}
  <!-- Picking on the map: a crosshair at the centre and two buttons; the map stays free to move. -->
  <!-- A blue circle at the centre; over a stop or a station it snaps onto it, grows round its mark, its name above. -->
  {@const sn = app.pickSnap}
  <div class="aim" class:snap={!!sn} style:--x="{sn?.x ?? 0}px" style:--y="{sn?.y ?? 0}px" aria-hidden="true">
    <i class="ring"></i><i class="core" class:svc={!!app.savingPlace && !sn}>{#if app.savingPlace && !sn}<Icon name={app.savingPlace} size={15} />{:else if sn}<img src="{import.meta.env.BASE_URL}icons/{sn.station ? (sn.kind === "στάση τραμ" ? "tram-logo.svg" : "metro-logo.svg") : "oasa.png"}" alt="" />{/if}</i>
    {#if sn}
      {#key sn.at.join()}
        <span class="slabel" in:rise={{ y: 6, duration: 220 }}><i class="stip"></i>
          <span class="st2"><b>{sn.name}</b><small>{sn.kind}</small></span>
          {#if sn.chips.length}<span class="schips">{#each sn.chips as c (c.t)}<span style:background={c.bg} style:color={c.fg}>{c.t}</span>{/each}</span>{/if}
        </span>
      {/key}
    {/if}
  </div>
  {#if !wide}
  <div class="ptop" transition:rise={{ y: -16 }}>
    <button type="button" class="pcirc" aria-label="Πίσω" onclick={() => (app.pickFor = null)}><Icon name="back" size={20} /></button>
    <button type="button" class="pfield" onclick={pickType}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 20 20" /></svg><span>Ή γράψε διεύθυνση</span></button>
  </div>
  {#if !app.pickSnap}<span class="phint" transition:soft><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" /></svg>Σύρε τον χάρτη ή πάτα ένα σημείο</span>{/if}
  <div class="psheet" transition:rise={{ y: 40 }}>
    {#if app.myPos}<button type="button" class="pcirc pme" aria-label="Η θέση μου" onclick={pickMe}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.8 10.6a.6.6 0 0 0 .05 1.12l6.6 2.03 2.03 6.6a.6.6 0 0 0 1.12.05z" fill="currentColor" /></svg></button>{/if}
    <i class="pgrip" aria-hidden="true"></i>
    {#if app.savingPlace}<span class="psave">{app.savingPlace === "home" ? "Το Σπίτι σου εδώ;" : "Η Δουλειά σου εδώ;"}</span>{/if}
    <div class="phead" class:saving={!!app.savingPlace}>
      <span class="pmk {app.pickFor}"><svg width="16" height="18" viewBox="0 0 24 28" aria-hidden="true"><path d="M12 27s-9-8.5-9-15a9 9 0 0 1 18 0c0 6.5-9 15-9 15zm0-11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" fill="currentColor" /></svg></span>
      <span class="ptx"><b>{pickTitle}</b><small>{pickSub}</small></span>
      <button type="button" class="pcirc sm" aria-label="Μοιράσου το σημείο" onclick={pickShare}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v7h14v-7" /></svg></button>
    </div>
    {#if app.savingPlace && pickNear.find(n => !n.station)}
      {@const n = pickNear.find(n => !n.station)!}
      <div class="pnearest"><span class="oasa"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span><span>Πιο κοντινή στάση: <b>{n.name}</b></span><span class="pw"><Icon name="walk" size={13} />{n.walk}′</span></div>
    {:else if pickNear.length && !app.savingPlace}
      <div class="pnear">
        {#each pickNear as n (n.key)}
          <button type="button" class="pn" onclick={() => app.centerOn([n.at[1], n.at[0]])}>
            {#if n.station}<img class="pnm" src="{import.meta.env.BASE_URL}icons/{n.lines.every(l => l.startsWith("T")) ? "tram" : "metro"}-logo.svg" alt="" />
            {:else}{@const c = app.lineColor(n.lines[0] ?? "")}<LineChip label={n.lines.join(" · ")} bg={c.bg} fg={c.fg} mode="bus" city={app.cityId} />{/if}
            <b>{n.name}</b><span>{n.walk}′</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if !app.savingPlace}
    <div class="pkeep">
      <span>Κράτα το ως</span>
      <button type="button" class="pk" class:on={keptAs("home")} aria-pressed={keptAs("home")} onclick={() => keepAs("home")}><Icon name="home" size={15} /><b>Σπίτι</b></button>
      <button type="button" class="pk" class:on={keptAs("work")} aria-pressed={keptAs("work")} onclick={() => keepAs("work")}><Icon name="work" size={15} /><b>Δουλειά</b></button>
      {#if pickFav && app.pickSnap}
        {@const on = app.isFavStop(pickFav)}
        <button type="button" class="pk round" class:on aria-pressed={on} aria-label={on ? "Αφαίρεση από τις αγαπημένες" : "Στα αγαπημένα"}
          onclick={() => app.toggleFavStop({ id: pickFav!, name: app.pickSnap!.name, lat: app.pickSnap!.at[0], lon: app.pickSnap!.at[1] })}><Icon name={on ? "star-filled" : "star"} size={16} /></button>
      {/if}
    </div>
    {/if}
    <div class="pgo">
      <button type="button" class="pcancel" onclick={() => (app.pickFor = null)}>{checking ? "Πίσω" : "Άκυρο"}</button>
      <button type="button" class="pgomain" disabled={!app.mapCenter} onclick={takeCentre}><Icon name={app.savingPlace ?? "route"} size={18} /><span>{checking ? "Άλλαξε εδώ" : app.savingPlace ? `Αυτό είναι ${app.savingPlace === "home" ? "το Σπίτι" : "η Δουλειά"}` : app.pickFor === "from" ? "Ξεκίνα από εδώ" : "Πήγαινέ με εδώ"}</span></button>
    </div>
  </div>
  {:else}
  <div class="pickbar" class:check={!!checking} role="status" transition:rise={{ y: -16 }}>
    <span class="dot {app.pickFor}"></span>
    {#if checking}
      <span class="chk"><b>{checking.f === "from" ? "Από" : "Προς"}: {checking.place.kind === "me" ? "Εδώ που είσαι" : titleCase(checking.place.label)}</b><small>Αυτό είναι το σημείο. Για άλλο, σύρε τον χάρτη και πάτα «Άλλαξε εδώ».</small></span>
    {:else}
      <span class="phone">{app.pickFor === "from" ? "Μετακίνησε τον χάρτη στην αφετηρία" : "Μετακίνησε τον χάρτη στον προορισμό"}</span>
      <span class="pc">{app.pickFor === "from" ? "Κάνε κλικ στην αφετηρία" : "Κάνε κλικ στον προορισμό"}<kbd>Esc</kbd></span>
    {/if}
  </div>
  <div class="pickacts" transition:rise>
    <button type="button" class="ghost" onclick={() => (app.pickFor = null)}>{checking ? "Πίσω" : "Άκυρο"}</button>
    <button type="button" class="primary" disabled={!app.mapCenter} onclick={takeCentre}>{checking ? "Άλλαξε εδώ" : "Εδώ"}</button>
  </div>
  {/if}
{:else if app.start}
  <div class="start" class:side={wide} role="dialog" aria-modal={!wide} aria-labelledby="start-h" transition:soft>
    <div class="box" class:ans={answer} class:typing bind:this={boxEl} in:rise={{ y: 32, duration: 360 }}>
      {#if linesPage}
        <h1 id="start-h" class="sr">Βρες γραμμή</h1>
        <LinesPage {app} lines={allLines} onopen={openLine} onclose={() => (linesPage = false)} />
      {:else}
      {#snippet brandRow()}
        <div class="brandrow">
          <p class="brand" in:item={{ i: 1 }}><span class="logo" aria-hidden="true"><Icon name="bus" size={15} /></span>Στάσεις</p>
          {#if !wide}<button type="button" class="xclose" aria-label="Κλείσιμο" title="Κλείσιμο" onclick={() => { app.savingPlace = null; app.pickFor = null; app.start = false; }}><Icon name="close" size={16} /></button>{/if}
        </div>
      {/snippet}
      {#if answer}
        <!-- The trip asked (mockups 42 B, 44): a band of its own at the top, apart from the routes under it. «Από» and
             «Προς» are fields (a tap edits that end), the swap between them; when and with what, two chips. -->
        <div class="band" in:item={{ i: 2, y: 12 }}>
          <h1 id="start-h" class="sr">Οι διαδρομές</h1>
          <!-- Mockup 14: «‹», «Από» and «Προς» as two rows of one box (a tap edits that end; the small map button shows
               it), the swap; under them the choices as small chips in a row that scrolls sideways. -->
          <div class="tends">
            <button type="button" class="tback" aria-label="Κλείσιμο" title="Κλείσιμο" onclick={() => { app.savingPlace = null; app.pickFor = null; app.start = false; }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <div class="tfields">
              {#each ["from", "to"] as Field[] as f (f)}
                {@const p = ends[f].place}
                <div class="tfw">
                  <button type="button" class="tfield" onclick={e => editEnd(f, e)}><i class="tmk {f}" aria-hidden="true"></i><span class="tk">{f === "from" ? "Από" : "Προς"}</span>
                    <span class="tv" class:tvme={p?.kind === "me"}>{f === "from" ? capital(fromWord(p)) : p ? titleCase(p.label) : ""}</span></button>
                  <button type="button" class="tview" aria-label="Δες το «{f === "from" ? "Από" : "Προς"}» στον χάρτη" title="Δες το στον χάρτη" onclick={() => checkOnMap(f)}><Icon name="map" size={14} /></button>
                </div>
              {/each}
            </div>
            <button type="button" class="tswap" class:turned aria-label="Αντιστροφή αφετηρίας και προορισμού" title="Αντιστροφή" onclick={swap}><Icon name="swap" size={17} /></button>
          </div>
          <div class="tchips">
            <button type="button" class="tchip when" class:set={when.kind !== "now"} aria-haspopup="listbox" aria-expanded={whenOpen} onclick={openWhen}><Icon name="clock" size={14} /><span>{capital(whenWord)}</span><span class="tcv" class:up={whenOpen} aria-hidden="true"><Icon name="chevron" size={11} /></span></button>
            <button type="button" class="tchip" aria-haspopup="dialog" onclick={() => (sheet = "opts")}>{#if meansOn.length < MEANS.length}<Icon name={meansOn.length === 1 ? meansOn[0].icon : "bus"} size={14} />{/if}<span>{capital(meansWord)}</span><span class="tcv" aria-hidden="true"><Icon name="chevron" size={11} /></span></button>
          </div>
          {#if whenOpen}
            <!-- «Πότε» (mockup 46 Γ): now, leave at, arrive by; the day and the time as two lists; arriving, how early. -->
            <div class="whenpop" role="dialog" aria-label="Πότε" transition:reveal>
              <div class="wseg" role="radiogroup" aria-label="Πότε">
                {#each [["now", "Τώρα"], ["leave", "Φεύγω"], ["arrive", "Φτάνω"]] as [k, t] (k)}
                  <button type="button" role="radio" aria-checked={dKind === k} class:on={dKind === k} onclick={() => setKind(k as When["kind"])}>{t}</button>
                {/each}
              </div>
              {#if dKind !== "now"}
                {@const qs = quick(nowS)}
                {#if qs.length}
                  <div class="wquick">{#each qs as m (m)}<button type="button" class:on={dMin === m} onclick={() => (dMin = m)}>{hhmm(m)}</button>{/each}</div>
                {/if}
                <ul class="wlist" role="listbox" aria-label="Ώρα" use:inView={dMin}>
                  {#each slots(nowS) as m (m)}<li><button type="button" role="option" aria-selected={dMin === m} class:on={dMin === m} onclick={() => (dMin = m)}>{hhmm(m)}{#if m >= 24 * 60}<small>αύριο</small>{/if}</button></li>{/each}
                </ul>
                <p class="wnote">Ως τις 03:00: τόσο μπροστά βλέπει το πρόγραμμα των διαδρομών.</p>
                {#if dKind === "arrive"}
                  <span class="wl">Να είμαι εκεί</span>
                  <div class="wseg small" role="radiogroup" aria-label="Να είμαι εκεί">
                    {#each [[0, "στην ώρα"], [5, "~5′ νωρίτερα"], [10, "~10′ νωρίτερα"]] as [e, t] (e)}
                      <button type="button" role="radio" aria-checked={dEarly === e} class:on={dEarly === e} onclick={() => (dEarly = e as number)}>{t}</button>
                    {/each}
                  </div>
                {/if}
                <button type="button" class="wok" onclick={applyWhen}>Εντάξει</button>
              {/if}
            </div>
          {/if}
        </div>
      {:else if !typing && (wide || app.savingPlace || find)}
        {@render brandRow()}
      {/if}
      {#if answer || typing}
        <!-- its heading is in the band; or typing on a phone: the field at the top, its list under it, over the keyboard -->
      {:else if app.savingPlace}
        <h1 id="start-h" in:item={{ i: 2 }}>{app.savingPlace === "home" ? "Πού είναι το Σπίτι;" : "Πού είναι η Δουλειά;"}</h1>
      {:else if find}
        <h1 id="start-h" in:item={{ i: 2 }}>Βρες</h1>
      {:else if wide}
        <h1 id="start-h" class="hero" in:item={{ i: 2 }}>Κάθε λεωφορείο<br />{OF_CITY[app.cityId] ?? app.cityInfo.inName},<br /><span>εκεί που είναι.</span></h1>
      {:else}
        <h1 id="start-h" class="sr">Πού πας;</h1>
      {/if}

      {#if answer}
        <!-- the band above holds the trip asked -->
      {:else}
      <div class="fields" class:raised={menu !== null}>
        <div class="ends" class:group={!intro && wide} class:asks={!wide && !app.savingPlace} class:pair={pair} class:typing in:item={{ i: 3, y: 12 }}>
        {#if pair}
          <button type="button" class="pback" aria-label="Πίσω" onclick={close}><Icon name="back" size={20} /></button>
          <button type="button" class="pswap" class:turned aria-label="Αντιστροφή αφετηρίας και προορισμού" aria-disabled={!canSwap} onclick={() => { if (canSwap) swap(); }}><Icon name="swap" size={19} /></button>
        {/if}
        {#if typing && app.savingPlace}
          <div class="svhead">
            <button type="button" class="svback" aria-label="Πίσω" onclick={cancelSaving}><Icon name="back" size={20} /></button>
            <span class="svic"><Icon name={app.savingPlace} size={18} /></span>
            <span class="svt"><b>Όρισε {app.savingPlace === "home" ? "το" : "τη"} {savingWord}</b><small>για να βλέπεις πόσο θες ως εκεί, με ένα πάτημα</small></span>
          </div>
        {/if}
        {#each (app.savingPlace || intro || find ? ["to"] : !wide ? ["from", "to"] : askFrom ? ["to", "from"] : ["to"]) as Field[] as f (f)}
          {#if !typing || f === open}
          <div class="field end {f}" class:open={open === f} class:set={!!ends[f].place} class:swapped class:search={intro}>
            {#if intro}<label class="fs" for="start-{f}"><Icon name="search" size={20} /><span class="sr">Πού πας;</span></label>
            {:else if find}<label class="sr" for="start-{f}">Βρες γραμμή, στάση ή μέρος</label><span class="fs2" aria-hidden="true"><Icon name="search" size={19} /></span>
            {:else if wide || (app.savingPlace && !typing) || pair}<span class="mk {f}" aria-hidden="true"></span><label class="fl" for="start-{f}">{f === "from" ? "Από" : pair ? "Προς" : "Πού"}</label>
            {:else}<label class="sr" for="start-{f}">{f === "from" ? "Από πού ξεκινάς" : "Πού θέλεις να πας"}</label>{#if typing}<span class="fs2 on" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 20 20" /></svg></span>{:else if ends[f].place?.kind === "me"}<span class="mearr" aria-hidden="true"><svg class="arr" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.8 10.6a.6.6 0 0 0 .05 1.12l6.6 2.03 2.03 6.6a.6.6 0 0 0 1.12.05z" fill="currentColor" /></svg></span>{:else if !ends[f].place}<span class="fs2" aria-hidden="true"><Icon name="search" size={19} /></span>{/if}{/if}
            <input id="start-{f}" bind:this={inputs[f]} value={ends[f].text} autocomplete="off" spellcheck="false"
              placeholder={find ? "Γραμμή, στάση ή μέρος" : typing && app.savingPlace ? "Διεύθυνση, περιοχή ή στάση" : f === "from" ? (wide ? "Από πού ξεκινάς;" : "Από πού;") : intro ? "Πού πας; Διεύθυνση, στάση ή γραμμή" : wide ? "Στάση, περιοχή, οδός" : "Πού πας;"} role="combobox" aria-expanded={open === f} aria-controls="start-{f}-list"
              onfocus={e => { open = f; menu = null; if (ends[f].place) e.currentTarget.select(); startTyping(); }} onclick={() => startTyping(true)} oninput={e => edit(f, e.currentTarget.value)}
              aria-activedescendant={open === f && active >= 0 ? `start-opt-${active}` : undefined} onkeydown={e => key(f, e)} />
            {#if ends[f].text && locating !== f && (!ends[f].place || typing)}
              <button type="button" class="clear" aria-label="Καθάρισμα" title="Καθάρισμα" onclick={() => { ends[f] = { text: "", place: null }; inputs[f]?.focus(); }}>{#if typing}<span class="cx"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></span>{:else}<Icon name="close" size={13} />{/if}</button>
            {/if}
            {#if ends[f].place && !typing}
              {#if ends[f].place?.kind === "me" && !wide && app.myFix}<span class="melive">ζωντανά</span>{/if}
              <button type="button" class="chg" onclick={() => { ends[f] = { text: "", place: null }; inputs[f]?.focus(); }}>Αλλαγή</button>
            {:else if intro && !ends[f].text}
              <kbd class="slash" aria-hidden="true">/</kbd>
            {:else if locating === f}
              <span class="fi"><span class="spin" aria-hidden="true"></span></span>
            {/if}
          </div>
          {#if typing && open === f && !app.savingPlace}<button type="button" class="cancel" onclick={stopTyping}>Άκυρο</button>{/if}
          {#if !wide && open === f}{@render list(f)}{/if}
          {#if f === "from" && !pair && !ends.from.place && !ends.from.text && open !== "from"}
            <div class="sugg" role="group" aria-label="Από πού ξεκινάς" transition:reveal>
              {#each fromChips as c, k (c.key)}
                <button type="button" class="sc" class:best={c.best} onclick={c.run} in:item={{ i: k, y: 6 }}><Icon name={c.icon} size={15} /><span>{c.label}</span></button>
              {/each}
            </div>
          {/if}
          {/if}
        {/each}
        {#if askFrom && !intro && !app.savingPlace && open === null && wide}
          <button type="button" class="swap" class:turned aria-label="Αντιστροφή αφετηρίας και προορισμού" title="Αντιστροφή" onclick={swap} transition:soft><Icon name="swap" size={16} /></button>
        {/if}
        </div>
        {#if open && wide}{@render list(open)}{/if}
        {#if pair && ends.to.place && !ends.from.place && !ends.from.text && open === null}
          <!-- «Προς» set, «Από» empty (typing closed): the ways to give the start, under the pair, not in it. -->
          <div class="sugg under" role="group" aria-label="Από πού ξεκινάς" transition:reveal>
            {#each fromChips as c, k (c.key)}
              <button type="button" class="sc" class:best={c.best} onclick={c.run} in:item={{ i: k, y: 6 }}><Icon name={c.icon} size={15} /><span>{c.label}</span></button>
            {/each}
          </div>
        {/if}
        {#if err}<p class="err" role="status" transition:reveal>{err}</p>{/if}

        {#if !wide && !app.savingPlace && !find && !ends.to.place && open === null}
          <!-- Compact mockup 2: the shortcuts in one row (home, work, the favourite lines, «Πρόσθεσε»), the map and the
               lines side by side, the last trips, the places most asked for. -->
          <div class="scuts" in:item={{ i: 4, y: 12 }}>
            {#each shortcuts as m (m.k)}
              <button type="button" class="scut" class:best={!!m.trip} class:here={m.trip === null} onclick={() => goMine(m.k, m.place)}>
                <Icon name={m.k} size={16} />
                {#if m.trip === null}<span class="sl">{m.label}</span>
                {:else}<b>{m.label}</b>{#if !m.place}<span class="sl">όρισέ {m.k === "home" ? "το" : "τη"}</span>{:else if m.trip}<span class="sm">{durText(m.trip.mins)}</span>{/if}{/if}
              </button>
            {/each}
            {#each favLines as l (l.id)}
              {@const c = app.lineColor(native(l.id))}
              <button type="button" class="scut ln" aria-label="Γραμμή {l.label}" onclick={() => openLine({ id: l.id, label: l.label } as V2Line)}>
                <LineChip label={l.label} bg={c.bg} fg={c.fg} mode={app.lineInfo.get(native(l.id))?.kind === "trolley" ? "trolley" : "bus"} city={app.cityId} />
              </button>
            {/each}
            {#each app.lineShortcuts as sc (sc.line + sc.variant + sc.stop)}
              {@const c = app.lineColor(sc.line)}
              {@const mn = scMin[`${sc.line}|${sc.variant}|${sc.stop}`]}
              <button type="button" class="scut ln sc" aria-label="Γραμμή {sc.line} προς {sc.to} από {sc.stopName}" onclick={() => app.push(busStopCard(sc.stop, sc.stopName))}>
                <LineChip label={sc.line} bg={c.bg} fg={c.fg} mode={app.lineInfo.get(sc.line)?.kind === "trolley" ? "trolley" : "bus"} city={app.cityId} />
                <span class="sct">{sc.to.length > 8 ? `${sc.to.slice(0, 6)}.` : sc.to}</span>{#if mn != null}<span class="scm"><i></i>{mn}′</span>{/if}
              </button>
            {/each}
            <button type="button" class="scut add" onclick={() => (addSheet = true)}><Icon name="plus" size={15} /><b>Πρόσθεσε</b></button>
          </div>
          <div class="ways2" in:item={{ i: 5, y: 12 }}>
            <button type="button" onclick={() => pick("to")}><span class="w2i"><Icon name="pin" size={16} /></span><b>Στον χάρτη</b></button>
            <button type="button" onclick={findLine}><span class="w2i"><Icon name="route" size={16} /></span><b>Βρες γραμμή</b></button>
          </div>
          {#if recent.length}
            <div class="sect" in:item={{ i: 6, y: 12 }}>
              <div class="sech"><span>Πρόσφατα</span><button type="button" onclick={clearRecent}>Καθαρισμός</button></div>
              {#each recent as x (x.at)}
                <div class="prow">
                  <button type="button" class="pmain" onclick={() => again(x)}>
                    <span class="pric"><Icon name="clock" size={16} /></span>
                    <span class="ptxt"><b>{titleCase(x.to.label)}</b><small>{x.from.label === ME ? "από εδώ" : `από ${titleCase(x.from.label)}`}</small></span>
                  </button>
                  <button type="button" class="pfill" aria-label="Βάλε «{titleCase(x.to.label)}» στο πεδίο" onclick={() => fillTo(titleCase(x.to.label))}><Icon name="fill" size={16} /></button>
                </div>
              {/each}
            </div>
          {/if}
          {#if popular.length}
            <div class="sect" in:item={{ i: 7, y: 12 }}>
              <div class="sech"><span>Δημοφιλή</span></div>
              {#each popular as d (d.label)}
                <button type="button" class="poprow" onclick={() => goDest(d)}>
                  <DestIcon kind={d.kind} size={30} />
                  <b>{d.label}</b><small>{d.hint}</small>
                </button>
              {/each}
            </div>
          {/if}
        {/if}

        {#if intro}
          <div class="ways" in:item={{ i: 4, y: 12 }}>
            <button type="button" class="primary" onclick={nearMe}><Icon name="locate" size={18} /><span>Τι έρχεται κοντά μου</span></button>
            <button type="button" class="ghost line" onclick={explore}><span>Άνοιξε τον χάρτη</span></button>
          </div>
          <!-- Home and work: the trip there now -->
          <div class="mine" data-peek="Σπίτι" data-peek-icon="home" in:item={{ i: 5, y: 12 }}>
            {#each mine as m (m.k)}
              <button type="button" class="mtile" class:unset={!m.place} onclick={() => goMine(m.k, m.place)}>
                <span class="mh"><span class="mic"><Icon name={m.k} size={17} /></span><span class="mtx"><b>{m.label}</b><small>{m.place ? m.place.hint ?? "Αποθηκευμένο" : "Δεν το έχεις ορίσει"}</small></span></span>
                <span class="mf">
                  {#if !m.place}<span class="mset">Όρισέ το μία φορά</span><b class="mbig plus"><Icon name="plus" size={18} /></b>
                  {:else if m.trip}<span class="mnow">{m.trip.line ? `${m.trip.line} σε ${m.trip.inMin}′ · ` : "Με τα πόδια · "}φτάνεις {clockHM(m.trip.arrive)}</span><b class="mbig">{durText(m.trip.mins)}</b>
                  {:else if m.trip === null}<span class="mnow">Είσαι εκεί</span>
                  {:else}<span class="mnow dim">Ψάχνω διαδρομή…</span>{/if}
                </span>
              </button>
            {/each}
          </div>

          {#if favCards.length || favLines.length}
            <div class="favs" data-peek="Αγαπημένα" data-peek-icon="star" in:item={{ i: 6, y: 12 }}>
              <div class="sh"><p class="ql">Τα αγαπημένα σου</p><button type="button" class="slink" onclick={() => { app.start = false; app.setTab("now"); app.toggleFavs(); }}>Όλα</button></div>
              {#each favCards as f (f.s.id)}
                <button type="button" class="fcard" onclick={() => openFav(f.s)}>
                  <span class="fst" aria-hidden="true"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
                  <span class="fmid"><b>{app.stopLabel(f.s.id, titleCase(f.s.name))}</b>
                    <span class="fdeps">{#each f.deps as d, k (k)}{@const c = app.lineColor(d.line)}<span class="fdep"><i style:background={c.bg} style:color={c.fg}>{d.line}</i>{d.to}{#if d.min != null && k > 0}<small>{d.min}′</small>{/if}</span>{/each}
                      {#if f.loading}<span class="fdep dim">Φόρτωση…</span>{:else if !f.deps.length}<span class="fdep dim">Κανένα τώρα</span>{/if}</span></span>
                  {#if f.first}
                    {@const m = minOf(f.first.t.at)}
                    <span class="fnow" class:late={f.late > 0}><b>{m === 0 ? "τώρα" : `${m}′`}</b><small><i></i>{f.late ? `αργεί ${f.late}′` : f.first.t.live ? "ζωντανά" : "πρόγραμμα"}</small></span>
                  {/if}
                </button>
              {/each}
              {#if favLines.length}
                <div class="flines">
                  {#each favLines as l (l.id)}
                    {@const c = app.lineColor(native(l.id))}
                    <button type="button" class="fline" style:--lb={c.bg} style:--lf={c.fg} onclick={() => openLine({ id: l.id, label: l.label } as V2Line)}>{l.label}</button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          {#if recent.length}
            <div class="recent" data-peek="Πρόσφατα" data-peek-icon="clock" in:item={{ i: 7, y: 12 }}>
              <p class="ql">Πρόσφατα</p>
              {#each recent as x (x.at)}
                <div class="rrow">
                  <span class="ric"><Icon name="clock" size={15} /></span>
                  <span class="rtx"><b>{x.from.label === ME ? "Από εδώ" : x.from.label} → {x.to.label}</b></span>
                  <button type="button" class="ragain" onclick={() => again(x)}>Ξανά</button>
                </div>
              {/each}
            </div>
          {/if}

          {#if QUICK.length}
          <div class="quick" data-peek="Προορισμοί" data-peek-icon="pin" in:item={{ i: 8, y: 12 }}>
            <p class="ql">Ή πήγαινε κατευθείαν</p>
            <div class="qrow">
              {#each QUICK as q, k (q.label)}
                <button type="button" class="qchip" onclick={() => choose("to", q)} in:item={{ i: 8 + k }}>
                  <span>{q.label}</span>{#if quickMin[q.label] != null}<small in:item={{ y: 4 }}>{durText(quickMin[q.label])}</small>{/if}
                </button>
              {/each}
            </div>
          </div>
          {/if}
        {:else if !app.savingPlace && wide && !find}
          <div class="pair one">
          <div class="pickf">
            <button type="button" class="field pick" class:open={menu === "when"} aria-haspopup="listbox" aria-expanded={menu === "when"} onclick={() => toggleMenu("when")} in:item={{ i: 5, y: 12 }}>
              <span class="col"><span class="fl">Πότε</span>
              {#key later}<span class="fv" in:item={{ y: 8 }}>{WHEN.find(w => w.value === later)?.label}</span>{/key}</span>
              <span class="fi"><Icon name="chevron" size={16} /></span>
            </button>
            {#if menu === "when"}
              <ul class="opts" role="listbox" aria-label="Πότε" transition:reveal>
                {#each WHEN as w, k (w.value)}
                  <li in:item={{ i: k }}><button type="button" class="opt" role="option" aria-selected={later === w.value} onclick={() => { later = w.value; menu = null; }}>
                    <span class="oi"><Icon name="clock" size={17} /></span><span class="ot"><b>{w.label}</b>{#if w.hint}<small>{w.hint}</small>{/if}</span>
                    {#if later === w.value}<span class="ok"><Icon name="check" size={14} /></span>{/if}
                  </button></li>
                {/each}
              </ul>
            {/if}
          </div>
          </div>
          <!-- The two chips: the means (their badges, overlapped) and what comes first; each opens its own list. -->
          <div class="chips" in:item={{ i: 6, y: 12 }}>
            <div class="pickf grow">
              <button type="button" class="chip" class:open={menu === "means"} aria-haspopup="true" aria-expanded={menu === "means"} onclick={() => toggleMenu("means")}>
                <span class="stackb" aria-hidden="true">
                  {#each meansOn as x, k (x.m)}<span class="sb" style:--mc={x.color} style:z-index={meansOn.length - k} in:pop><Icon name={x.icon} size={14} /></span>{/each}
                </span>
                <span class="cl">{meansLabel}</span>
                <span class="cv" aria-hidden="true"><Icon name="chevron" size={15} /></span>
              </button>
              {#if menu === "means"}
                <div class="opts pop" role="group" aria-label="Με ποια μέσα" transition:reveal>
                  {#each MEANS as x, k (x.m)}
                    {@const on = means.includes(x.m)}
                    <button type="button" class="opt mopt" class:on aria-pressed={on} style:--mc={x.color} onclick={() => toggleMean(x.m)} disabled={on && means.length === 1} in:item={{ i: k }}>
                      <span class="oi mi"><Icon name={x.icon} size={17} /></span><span class="ot"><b>{x.label}</b></span>
                      <span class="tickb" aria-hidden="true"><svg viewBox="0 0 20 20" width="12" height="12"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
                    </button>
                  {/each}
                  <div class="pfoot">
                    <button type="button" class="pf" onclick={() => (means = [...ALL])}>Όλα</button>
                    <button type="button" class="pf" onclick={() => (means = ["metro", "tram"])}>Μόνο σε ράγες</button>
                    <button type="button" class="pf done" onclick={() => (menu = null)}>Έτοιμο</button>
                  </div>
                </div>
              {/if}
            </div>
            <div class="pickf">
              <button type="button" class="chip sortc" class:open={menu === "sort"} aria-haspopup="listbox" aria-expanded={menu === "sort"} onclick={() => toggleMenu("sort")}>
                <span class="sg" aria-hidden="true"><Icon name={sort.icon} size={15} /></span>
                <span class="col"><span class="fl">Πρώτα</span>{#key sortId}<span class="sv" in:item={{ y: 6 }}>{sort.label}</span>{/key}</span>
                <span class="cv" aria-hidden="true"><Icon name="chevron" size={15} /></span>
              </button>
              {#if menu === "sort"}
                <ul class="opts pop right" role="listbox" aria-label="Πρώτα" transition:reveal>
                  {#each SORTS as o, k (o.id)}
                    <li in:item={{ i: k }}><button type="button" class="opt" role="option" aria-selected={sortId === o.id} onclick={() => { sortId = o.id; menu = null; }}>
                      <span class="oi"><Icon name={o.icon} size={17} /></span><span class="ot"><b>{o.label}</b><small>{o.hint}</small></span>
                      {#if sortId === o.id}<span class="ok"><Icon name="check" size={14} /></span>{/if}
                    </button></li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
        {/if}
      </div>
      {/if}

      {#if intro}
        {#if !favCards.length && !recent.length}
        <ul class="facts" in:item={{ i: 9 }}>
          <li><i class="g"></i>Θέσεις από τα ίδια τα οχήματα, κάθε λίγα δευτερόλεπτα</li>
          <li><i class="b"></i>{app.cityInfo.rail ? "Λεωφορεία, τρόλεϊ, μετρό, τραμ και προαστιακός" : "Όλα τα λεωφορεία της πόλης"}</li>
          <li><i></i>Χωρίς λογαριασμό: ανοίγεις και βλέπεις</li>
        </ul>
        {/if}
      {:else if !app.savingPlace && !find && (wide || answer)}
        {#if routes?.length && top && planR}
          {#each answer ? sourceNotes.filter(n => n !== railOldNote) : sourceNotes as n (n)}<p class="est"><Icon name="warn" size={15} /><span>{n}</span></p>{/each}
          {#if planR.estimate}<p class="est"><Icon name="warn" size={15} /><span>Ο server των διαδρομών δεν απαντά τώρα: αυτές τις βρήκε η εφαρμογή από τις στάσεις και τις ζωντανές αφίξεις. Οι ώρες είναι κατά προσέγγιση.</span></p>{/if}
          {#if top.ignored}<p class="pvn solo">Με {meansOn.length === 1 ? meansOn[0].label.toLowerCase() : "αυτά τα μέσα"} δεν βγαίνει τώρα: αυτές είναι οι καλύτερες με όλα.</p>{/if}
          <!-- Every route as a compact card: when to leave, how long, the means, where its bus is now; a tap opens it
               step by step and makes it the one «Ξεκίνα» follows. -->
          {#if answer}
            <!-- How many, the one fare when every option costs the same, and the order as a small button. -->
            <div class="rcount"><b>{routes.length} {routes.length === 1 ? "διαδρομή" : "διαδρομές"}</b>{#if sameFare}<span>· {routes.length === 1 ? "με" : "όλες με"} {sameFare}</span>{/if}
              <button type="button" class="rsort" aria-haspopup="dialog" onclick={() => (sheet = "opts")}>{SORT_LIST[sortId]}<Icon name="chevron" size={11} /></button></div>
            {#if routes.some(o => railOld(o.it))}<p class="oldnote"><i></i>Μετρό και τραμ από παλιό πρόγραμμα: οι ώρες με την κουκκίδα είναι κατά προσέγγιση.</p>{/if}
          {/if}
          {#if when.kind === "arrive" && top.fit?.tone === "late"}<p class="pvn solo">Δεν προλαβαίνεις ως τις {clockHM(when.at)}. Αυτές φτάνουν όσο πιο νωρίς γίνεται.</p>{/if}
          <div class="cards" class:list={answer} aria-live="polite" data-peek="Διαδρομές" data-peek-icon="route">
            {#each shownRoutes as o, k (o.key)}
              <RouteCard it={o.it} r={planR} {ix} legs={o.legs} {nowS} open={openKey === o.key}
                tag={answer && sortId === "time" ? (o.key === fastKey ? "Πιο γρήγορη" : "") : k === 0 ? bestTag : ""}
                row={answer} soon={k === 0} onleave={m => { if (leaveOf[o.key] !== m) leaveOf[o.key] = m; }} stale={answer ? railOld(o.it) : ""} city={app.cityId}
                sel={best?.key === o.key && (chosen != null || openKey != null)} live={k < 3 && when.kind === "now"} clock={when.kind !== "now"}
                target={when.kind === "arrive" && o.fit ? { at: when.at, margin: o.fit.margin, tone: o.fit.tone } : null}
                others={allIts} logos={app.cityId === "athens"} onpick={() => pickCard(o.key)} onmap={go} />
            {/each}
          </div>
          {#if routes.length > shownRoutes.length}
            <button type="button" class="morer" onclick={() => (allShown = true)}>{#if answer}Άλλες {routes.length - shownRoutes.length} {routes.length - shownRoutes.length === 1 ? "διαδρομή" : "διαδρομές"}<Icon name="chevron" size={12} />{:else}Δες κι άλλες {routes.length - shownRoutes.length} διαδρομές{/if}</button>
          {/if}
        {:else}
          <section class="pv" aria-live="polite" in:item={{ i: 7, y: 14 }}>
            {#if !pKey}
              <p class="pvh"><span class="pvi"><Icon name="route" size={17} /></span><span>{ends.to.place ? "Διάλεξε από πού ξεκινάς, και η καλύτερη διαδρομή εμφανίζεται εδώ αμέσως." : "Πες πού πας, και η καλύτερη διαδρομή εμφανίζεται εδώ αμέσως."}</span></p>
            {:else if waiting}
              <div class="sk" aria-label="Αναζήτηση διαδρομής"><i></i><i></i><i></i></div>
            {:else}
              <p class="pvh"><span class="pvi warn"><Icon name="warn" size={17} /></span>
                <span>{walkOnly ? `Δεν βρέθηκε μέσο ${later || when.kind !== "now" ? "για τότε" : "τώρα"}. Με τα πόδια: ${durText(walkOnly.duration_s / 60)}.` : `Δεν βρέθηκε διαδρομή ${later || when.kind !== "now" ? "για τότε" : "τώρα"}. Δοκίμασε άλλη ώρα.`}</span></p>
              {#each sourceNotes as note (note)}<p class="est"><Icon name="warn" size={15} /><span>{note}</span></p>{/each}
            {/if}
          </section>
        {/if}
      {/if}

      {#if intro}
        <div class="hintfoot"><MoreHint box={boxEl} /></div>
      {:else}
      <div class="acts" class:gone={typing}>
        {#if app.savingPlace}
          <button type="button" class="link" onclick={() => { app.savingPlace = null; app.start = false; }}><span>Άκυρο</span><kbd class="pc">Esc</kbd></button>
        {:else if find}
          <p class="findnote">Γράψε τον αριθμό μιας γραμμής (π.χ. 308), μια στάση ή μια περιοχή.</p>
        {:else if answer}
          <div class="duo">
            <button type="button" class="bell" class:on={!!armed} disabled={!best} aria-label={armed ? `Υπενθύμιση στις ${clockHM(Math.max(armed.leaveAt, nowS))}` : "Θύμισέ μου"}
              title={armed ? `Στις ${clockHM(Math.max(armed.leaveAt, nowS))}` : "Θύμισέ μου"} onclick={() => (sheet = "remind")}><Icon name="bell" size={20} />{#if armed}<i aria-hidden="true"></i>{/if}</button>
            <button type="button" class="primary big go" disabled={!best} onclick={startNow}><b>Ξεκίνα</b>{#if best}{@const m = leaveOf[best.key] ?? best.leaveIn}<span>{when.kind !== "now" ? `φύγε ${best.depart}` : m === 0 ? "φύγε τώρα" : m < 60 ? `φύγε σε ${m}′` : `φύγε ${clockHM(nowS + m * 60)}`} · φτάνεις {best.arrive}</span>{/if}</button>
          </div>
        {:else if !wide}
          {#if ready}<button type="button" class="primary big" onclick={() => (asking = false)}><span>Δες τις διαδρομές</span></button>{/if}
        {:else}
          <button type="button" class="primary big" class:ready disabled={!ready} onclick={go} in:item={{ i: 8 }}><span>Πάμε</span></button>
          <div class="actrow">
            <button type="button" class="link" onclick={explore} in:item={{ i: 9 }}><span>Μόνο ο χάρτης</span><kbd class="pc">Esc</kbd></button>
            <MoreHint box={boxEl} inline />
          </div>
        {/if}
      </div>
      {/if}
      {/if}
    </div>
    {#if addSheet}
      <ShortcutSheet {app} lines={allLines} onclose={() => (addSheet = false)} onplace={k => { addSheet = false; app.savingPlace = k; }} />
    {:else if sheet === "opts"}
      <Sheet title="Επιλογές" onclose={() => (sheet = null)}>
        <p class="sq">Με τι θέλεις να πας;</p>
        <div class="slist">
          {#each MEANS as x (x.m)}
            {@const on = means.includes(x.m)}
            <button type="button" class="srow" aria-pressed={on} disabled={on && means.length === 1} onclick={() => toggleMean(x.m)}>
              <span class="ic"><Icon name={x.icon} size={20} /></span><span class="tx">{x.label}</span>
              <span class="tick" class:on aria-hidden="true">{#if on}<svg viewBox="0 0 20 20" width="15" height="15"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}</span>
            </button>
          {/each}
        </div>
        <p class="sq">Τι σε νοιάζει πιο πολύ;</p>
        <div class="slist" role="radiogroup" aria-label="Τι σε νοιάζει πιο πολύ">
          {#each SORTS as o (o.id)}
            <button type="button" class="srow" role="radio" aria-checked={sortId === o.id} onclick={() => (sortId = o.id)}><span class="tx">{SORT_WORD[o.id]}</span><span class="radio" class:on={sortId === o.id} aria-hidden="true"></span></button>
          {/each}
        </div>
        <div class="sacts"><button type="button" class="sdone" onclick={() => (sheet = null)}>Έτοιμο</button></div>
      </Sheet>
    {:else if sheet === "remind" && best && planR && ends.to.place}
      <RemindSheet {app} it={best.it} r={planR} {ix} to={ends.to.place} onclose={() => (sheet = null)} />
    {/if}
  </div>
{/if}

{#snippet list(f: Field)}
  <ul class="opts" id="start-{f}-list" role="listbox" aria-label={f === "from" ? "Από" : "Πού"} transition:listIn use:aboveKeys>
    {#if ends[f].text.trim() && !ends[f].place && !opts.length && !lineHits.first.length && !lineHits.last.length && !asks.length && !muniLines.length && !muniStops.length}
      <li class="nothing" role="status">
        {#if busy}<span class="spin small" aria-hidden="true"></span>Αναζήτηση…
        {:else if ends[f].text.trim().length < 2}Γράψε λίγο ακόμα
        {:else}Δεν βρέθηκε. Δοκίμασε οδό και αριθμό, π.χ. «Πατησίων 76».{/if}
      </li>
    {/if}
    {#each rows as r, k (r.key)}
      {#if typing && r.line}
        {#if k === firstLine}
          <li class="oh" role="presentation">{lineHead(ends[f].text)}</li>
          <li class="lrow" role="presentation"><div class="lchips">
            {#each rows.map((x, j) => ({ x, j })).filter(y => y.x.line) as { x, j } (x.key)}
              {@const ln = x.line!}
              {@const bd = badge(ln)}
              <button type="button" id="start-opt-{j}" class="lpick" class:active={j === active} role="option" aria-selected={j === active} tabindex="-1"
                onpointerenter={() => (active = j)} onclick={() => run(f, x)}>
                <LineChip label={bd.text} bg={bd.bg} fg={bd.fg} mode={ln.mode} city={app.cityId} />
                <span>{otherEnd(ln.name, ends[f].text)}</span>{#if liveOf(ln.id)}<i aria-label="κυκλοφορεί τώρα"></i>{/if}
              </button>
            {/each}
          </div></li>
        {/if}
      {:else}
      {#if r.head && !(typing && r.head === "Μέρη")}<li class="oh" role="presentation">{r.head}</li>{/if}
      <li in:item={{ i: k }}>
        <button type="button" id="start-opt-{k}" class="opt" class:quiet={r.map && !!ends[f].text.trim() && !ends[f].place} class:active={k === active} role="option"
          class:top={typing && active < 0 && k === topRow && (!!ends[f].text.trim() || !!app.savingPlace)} aria-selected={k === active} tabindex="-1" onpointerenter={() => (active = k)} onclick={() => run(f, r)}>
          {#if r.ask}
            {#if r.ask.kind === "lineAt"}
              {@const bd = badge(r.ask.line)}
              <span class="lb" class:round={r.ask.line.mode === "metro"} style:--c={bd.bg} style:--t={bd.fg}>{bd.text}</span>
              <span class="ot"><b>{bd.text} στη στάση {titleCase(r.ask.stop[1])}</b><small>Οι αφίξεις του {bd.text} εκεί</small></span>
            {:else if r.ask.kind === "trip"}
              <span class="oi"><Icon name="route" size={17} /></span>
              <span class="ot"><b>{titleCase(r.ask.from[1])} → {titleCase(r.ask.to[1])}</b><small>Και τα δύο σημεία μαζί</small></span>
            {:else}
              {@const miss = r.ask.from.missing ?? r.ask.to.missing}
              <span class="oi"><Icon name="route" size={17} /></span>
              <span class="ot"><b>{r.ask.from.label} → {r.ask.to.label}</b>
                <small>{miss ? `Δεν έχεις ορίσει ${miss === "home" ? "Σπίτι" : "Δουλειά"}: θα το διαλέξεις μετά` : "Και τα δύο σημεία μαζί"}</small></span>
            {/if}
          {:else if r.line}
            {@const bd = badge(r.line)}
            {@const mn = MODE_NAME[r.line.mode] ?? ["Γραμμή", "route"]}
            {#if app.cityId === "athens"}<LineChip label={bd.text} bg={bd.bg} fg={bd.fg} mode={r.line.mode} city={app.cityId} size="lg" />
            {:else}<span class="lb" class:round={r.line.mode === "metro"} style:--c={bd.bg} style:--t={bd.fg}>{bd.text}</span>{/if}
            <span class="ot"><b>{#each hl(titleCase(r.line.name), ends[f].text) as [t, m], j (j)}{#if m}<mark>{t}</mark>{:else}{t}{/if}{/each}</b><small class="lm"><Icon name={mn[1]} size={13} />{mn[0]}</small></span>
            {@const n = liveOf(r.line.id)}
            {@const sched = r.line.mode === "metro" || r.line.mode === "tram"}
            {#if n}<span class="live" class:sched in:item={{ y: 0 }}><i></i>{sched ? "Πρόγραμμα" : "Ζωντανά"} · {n}</span>
            {:else if n === 0}<span class="live off" in:item={{ y: 0 }}>Δεν κυκλοφορεί τώρα</span>{/if}
          {:else if r.muniLine}
            <span class="lb muni">{r.muniLine.ref ?? "Δ"}</span>
            <span class="ot"><b>{r.muniLine.name}</b><small>{town(r.muniLine.municipality)} · πρόγραμμα, όχι live</small></span>
          {:else if r.muniStop}
            <span class="oi"><Icon name="stop" size={17} /></span>
            <span class="ot"><b>{r.muniStop.name}</b><small>Δημοτική στάση · {town(r.muniStop.municipality)}</small></span>
          {:else if r.me}
            <span class="oi meoi"><svg class="arr" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.8 10.6a.6.6 0 0 0 .05 1.12l6.6 2.03 2.03 6.6a.6.6 0 0 0 1.12.05z" fill="currentColor" /></svg></span><span class="ot"><b>{app.savingPlace ? "Εδώ που είσαι τώρα" : ME}</b><small>{app.savingPlace && hereText ? hereText : app.myFix ? "Ζωντανά, εδώ που είσαι τώρα" : "Εκεί που είσαι, από το κινητό σου"}</small></span>
          {:else if r.map}
            <span class="oi"><Icon name="map" size={17} /></span><span class="ot"><b>{typing && ends[f].text.trim() ? "Δεν είναι εδώ; Διάλεξε στον χάρτη" : "Διάλεξε στον χάρτη"}</b>{#if !ends[f].text.trim()}<small class="phone">{app.savingPlace ? "σύρε τον χάρτη ως την πόρτα σου" : "Μετακίνησε τον χάρτη και πάτα «Εδώ»"}</small><small class="pc">Κάνε κλικ στο σημείο</small>{/if}</span>
          {:else if r.place}
            {@const p = r.place}
            {#if typing && p.kind === "metro" && app.cityId === "athens"}<img class="oimg" src="{import.meta.env.BASE_URL}icons/metro-logo.svg" alt="" />
            {:else if iconOf(p) === "stop"}<span class="oi oasa"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
            {:else}<span class="oi"><Icon name={iconOf(p)} size={17} /></span>{/if}
            <span class="ot"><b>{#each hl(titleCase(p.label), ends[f].text) as [t, m], j (j)}{#if m}<mark>{t}</mark>{:else}{t}{/if}{/each}</b>
              {#if p.kind === "metro" && p.lines.length}
                <!-- A station: its lines in their colours, then what runs there (and how far, near the user). -->
                <small class="lm st">{#each p.lines as l (l)}<i class="lc" style:--c={LINE_TINT[l] ?? "#6b7280"}>{l}</i>{/each}<span>{p.hint}</span></small>
              {:else if p.hint}<small>{p.hint}</small>
              {:else if p.kind === "stop"}<small>{stopHint(p)}</small>{/if}</span>
          {/if}
        </button>
        {#if typing && r.place && !r.me}
          <button type="button" class="ofill" aria-label="Βάλε «{titleCase(r.place.label)}» στο πεδίο" onclick={() => { edit(f, titleCase(r.place!.label)); inputs[f]?.focus(); }}><Icon name="fill" size={16} /></button>
        {/if}
      </li>
      {/if}
    {/each}
    {#if typing && app.savingPlace && !ends[f].text.trim()}<li class="svnote" role="presentation">Μένει μόνο σε αυτή τη συσκευή. Το αλλάζεις όποτε θες: κράτα πατημένο το «{savingWord}» στην αρχική.</li>{/if}
  </ul>
{/snippet}

<style>
  .start { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 24px 16px;
    background: color-mix(in srgb, var(--bg) 70%, transparent); backdrop-filter: blur(6px); box-sizing: border-box; overflow-y: auto; }
  .box { width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 18px; padding: 22px 20px 18px; box-sizing: border-box;
    border-radius: 28px; background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  /* It still scrolls when the window is short, without a scrollbar: the «πιο κάτω» pill says there is more. */
  .box { scrollbar-width: none; -ms-overflow-style: none; }
  .box::-webkit-scrollbar { display: none; }
  /* The «πιο κάτω» pill and «Πάνω» (MoreHint) hang from this sticky foot when there is no «Πάμε» bar to hold them. */
  .hintfoot { position: sticky; bottom: 0; z-index: 30; height: 0; margin-top: -18px; }
  .brand { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; line-height: 1; color: var(--fg); }
  .logo { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: var(--accent); color: var(--on-accent); }
  h1 { margin: 2px 0 -4px; font-size: 34px; font-weight: 900; letter-spacing: -.035em; line-height: 1.08; }

  /* The sentence's fields: «Πού», «Από», «Πότε», «Πώς», each a tinted box with its label, its value and a round button. */
  .fields { display: flex; flex-direction: column; gap: 10px; }
  /* A list open under «Πότε» or a chip: the form over the routes and «Πάμε» (their cards are stacked with z-index). */
  .fields.raised { position: relative; z-index: 31; }
  .field { position: relative; width: 100%; min-height: 60px; display: flex; align-items: center; gap: 12px; padding: 0 10px 0 16px; box-sizing: border-box;
    border-radius: 16px; border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent); background: color-mix(in srgb, var(--accent) 9%, var(--glass-fill));
    color: var(--fg); font: inherit; text-align: left; transition: border-color .2s, background-color .2s, transform .12s; }
  .field.open { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, var(--glass-fill)); }
  .field.from { min-height: 54px; }
  button.field { cursor: pointer; }
  button.field:active { transform: scale(.99); }
  .fl { flex: none; width: 44px; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; line-height: 1; color: var(--muted); }
  input, .fv { flex: 1; min-width: 0; padding: 0; border: 0; background: none; font: inherit; font-size: 20px; font-weight: 800; letter-spacing: -.02em; line-height: 1.2;
    color: var(--accent); outline: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  input { height: 56px; }
  .field.from input { height: 50px; font-size: 17px; }
  input::placeholder { color: var(--muted); font-weight: 600; font-size: 17px; letter-spacing: 0; }
  .fi { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); cursor: pointer; transition: background-color .2s, color .2s, transform .12s; }
  .field.pick .fi { transition: transform .25s cubic-bezier(.34, 1.56, .64, 1), background-color .2s; }
  .field.pick.open .fi { transform: rotate(180deg); }
  .pop { display: flex; animation: pop .35s cubic-bezier(.34, 1.56, .64, 1); }
  @keyframes pop { from { transform: scale(.4); opacity: 0; } }
  .clear { flex: none; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: var(--control); color: var(--muted); cursor: pointer; }
  .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: spin .8s linear infinite; box-sizing: border-box; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .swap { position: absolute; right: 56px; top: -23px; z-index: 1; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0;
    border: 0; border-radius: 50%; background: var(--surface); color: var(--fg); cursor: pointer; box-shadow: var(--shadow-sm);
    transition: transform .35s cubic-bezier(.34, 1.56, .64, 1); }
  .swap.turned { transform: rotate(180deg); }
  .field.from.swapped input { animation: fromAbove .34s cubic-bezier(.2, .8, .2, 1); }
  .field.to.swapped input { animation: fromBelow .34s cubic-bezier(.2, .8, .2, 1); }
  @keyframes fromBelow { from { transform: translateY(24px); opacity: 0; } }
  @keyframes fromAbove { from { transform: translateY(-24px); opacity: 0; } }
  /* «Πότε» and «Πώς»: their lists float over what is under them (the route, «Πάμε»), as a dropdown. */
  .pickf { position: relative; min-width: 0; }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  /* «Πότε» alone on its row; under it the two chips. */
  .pair.one { grid-template-columns: minmax(0, 1fr); }
  /* One field alone in its row («Πότε»): its list as wide as it, not the two-field width set for the pair below. */
  .pair.one .pickf .opts, .pair.one .pickf:first-child .opts, .pair.one .pickf:last-child .opts { left: 0; right: 0; width: auto; }
  .chips { position: relative; z-index: 4; display: flex; gap: 10px; }
  .grow { flex: 1; }
  .chip { width: 100%; height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 12px 0 10px; box-sizing: border-box;
    border: 1.5px solid var(--glass-line); border-radius: 26px; background: var(--glass-fill); color: var(--fg); font: inherit; font-size: 14px;
    font-weight: 700; line-height: 1; cursor: pointer; transition: border-color .2s, background-color .2s, transform .15s; }
  .chip:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--glass-line)); }
  .chip:active { transform: scale(.98); }
  .chip.open { border-color: var(--accent); }
  .chip:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent); }
  .cl { flex: 1; min-width: 0; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cv { flex: none; display: flex; align-items: center; justify-content: center; color: var(--muted); transition: transform .2s; }
  .chip.open .cv { transform: rotate(180deg); }
  /* The means' badges, each over the next, as in a group of people. */
  .stackb { flex: none; display: flex; align-items: center; padding-left: 8px; }
  .sb { position: relative; width: 30px; height: 30px; margin-left: -8px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
    border-radius: 50%; background: var(--mc); color: #fff; border: 2.5px solid var(--surface); }
  .sortc { width: auto; gap: 10px; padding: 0 14px 0 10px; }
  .sg { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--accent-bg); color: var(--accent); }
  .sortc .col { gap: 4px; }
  .sortc .fl { font-size: 10px; letter-spacing: .05em; }
  .sv { font-size: 14px; font-weight: 700; line-height: 1; white-space: nowrap; }
  /* Their lists float over the routes, as «Πότε»'s does. */
  .opts.pop { position: absolute; z-index: 6; left: 0; top: calc(100% + 8px); width: max(100%, 300px); box-sizing: border-box; background: var(--surface);
    border-color: var(--border); box-shadow: 0 20px 50px rgba(0, 0, 0, .35); max-height: none; overflow: visible; }
  .opts.pop.right { left: auto; right: 0; width: 300px; }
  .opts.pop .ot small { white-space: normal; }
  .mopt .mi { background: var(--control); color: var(--muted); transition: background-color .2s, color .2s; }
  .mopt.on .mi { background: var(--mc); color: #fff; }
  .mopt:disabled { cursor: default; }
  .tickb { flex: none; width: 22px; height: 22px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border-radius: 7px;
    border: 2px solid var(--glass-line); color: #fff; transition: background-color .2s, border-color .2s; }
  .tickb svg { opacity: 0; transform: scale(.5); transition: opacity .15s, transform .25s cubic-bezier(.3, 1.6, .5, 1); }
  .mopt.on .tickb { background: var(--mc); border-color: var(--mc); }
  .mopt.on .tickb svg { opacity: 1; transform: none; }
  .pfoot { display: flex; gap: 6px; margin-top: 6px; padding: 8px 4px 2px; border-top: 1px solid var(--border); }
  .pf { height: 34px; display: flex; align-items: center; padding: 0 12px; border: 0; border-radius: 17px; background: var(--control); color: var(--fg);
    font: inherit; font-size: 12.5px; font-weight: 700; line-height: 1; cursor: pointer; }
  .pf.done { margin-left: auto; padding: 0 14px; background: var(--accent); color: #fff; }
  @media (prefers-reduced-motion: reduce) { .chip, .cv, .tickb, .tickb svg, .mopt .mi { transition: none; } }
  .pair .field.pick { min-height: 64px; padding: 0 8px 0 14px; gap: 8px; }
  .col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .pair .fv { font-size: 16px; }
  .pair .fl { width: auto; font-size: 11px; }
  .pair .fi { width: 22px; height: 22px; background: none; }
  .pair .pickf:first-child .opts { right: auto; width: calc(200% + 10px); }
  .pair .pickf:last-child .opts { left: auto; width: calc(200% + 10px); }

  /* Πού and Από as one route: a square at the end, a dot at the start, a dotted line between; the swap on the seam. */
  .ends { position: relative; display: flex; flex-direction: column; }
  .ends.group { border-radius: 18px; border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent); background: color-mix(in srgb, var(--accent) 9%, var(--glass-fill)); }
  .ends.group .field.end { border: 0; border-radius: 0; background: none; }
  /* Inside the group the rows have no frame of their own: the top one rounds only at the top, the bottom one only at
     the bottom (rounded all round, the line between them bent down at its ends, a box beside the group's edge). */
  .ends.group .field.end.to { border-radius: 17px 17px 0 0; }
  .ends.group .field.end.from { border-radius: 0 0 17px 17px; }
  .ends.group:not(:has(.field.from)) .field.end.to { border-radius: 17px; }
  .ends.group .field.end.open { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .ends.group .field.from { border-top: 1px solid color-mix(in srgb, var(--accent) 16%, transparent); }
  .ends.group .field.from::before { content: ""; position: absolute; left: 21px; top: -14px; height: 20px; border-left: 2px dotted color-mix(in srgb, var(--muted) 70%, transparent); }
  .mk { flex: none; width: 12px; height: 12px; margin-right: -2px; box-sizing: border-box; }
  .mk.to { border-radius: 3px; background: var(--late1); }
  .mk.from { border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-bg); }
  .ends.group .fl { width: 38px; }
  .ends .swap { top: 41px; right: 54px; }
  .sugg { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 12px 14px 54px; }
  .sc { height: 34px; display: flex; align-items: center; gap: 7px; padding: 0 12px 0 10px; border: 1px solid var(--glass-line); border-radius: 17px;
    background: var(--glass-fill); color: var(--fg); font: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer;
    transition: border-color .15s, background-color .15s, transform .12s; }
  .sc:hover { border-color: var(--accent); }
  .sc:active { transform: scale(.96); }
  .sc.best { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }
  .pickf .opts { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 6px); background: var(--surface); border-color: var(--border);
    box-shadow: 0 16px 40px rgba(0, 0, 0, .28); max-height: none; overflow: visible; }

  .ends > .opts { margin-top: 10px; }
  .acts.gone { display: none; }
  .typeback { align-self: flex-start; height: 36px; display: flex; align-items: center; gap: 8px; margin: 0 0 4px -4px; padding: 0 10px 0 4px; border: 0; border-radius: 18px;
    background: none; color: var(--fg); font: inherit; font-size: 16px; font-weight: 700; line-height: 1; cursor: pointer; }
  .tbi { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--control); }
  .opts { list-style: none; margin: 0; padding: 6px; border-radius: 18px; background: var(--glass-fill); border: 1px solid var(--glass-line);
    display: flex; flex-direction: column; max-height: 300px; overflow-y: auto; }
  .opt { width: 100%; min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 0; border-radius: 12px; background: none;
    color: var(--fg); font: inherit; text-align: left; cursor: pointer; transition: background-color .15s, transform .12s; }
  .opt:hover, .opt.active, .opt[aria-selected="true"] { background: var(--control); }
  .opt:active { transform: scale(.98); }
  .oi { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--accent-bg); color: var(--accent); }
  /* A bus stop: OASA's «α» on white. */
  .oi.oasa { background: #ffffff; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .06); }
  .oi.oasa img { width: 20px; height: 20px; display: block; }
  .opt.quiet .oi { background: var(--control); color: var(--muted); }
  .ot { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; text-align: left; }
  .ot b { font-size: 14px; font-weight: 600; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ot small { font-size: 12px; line-height: 1.2; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .oh { padding: 10px 10px 4px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; line-height: 1; color: var(--muted); }
  /* A line: its badge in its colours (a metro line round, as on the network's signs), its name, its kind. */
  .lb { flex: none; min-width: 44px; height: 32px; padding: 0 9px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
    border-radius: 9px; background: var(--c); color: var(--t); font-size: 14px; font-weight: 800; letter-spacing: -.01em; line-height: 1; }
  .lb.round { min-width: 36px; width: 36px; height: 36px; padding: 0; border-radius: 50%; }
  .lb.muni { background: #4f3d7a; color: #fff; }
  .lm.st { gap: 4px; min-width: 0; overflow: hidden; white-space: nowrap; }
  .lm.st span { min-width: 0; margin-left: 2px; overflow: hidden; text-overflow: ellipsis; }
  .lc { flex: none; height: 18px; min-width: 22px; padding: 0 5px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 5px; background: var(--c); color: #fff; font-size: 10.5px; font-style: normal; font-weight: 800; line-height: 1; }   /* a municipal line: the map's colour for them (MapView MUNI_FOCUS) */
  .lm { display: flex; align-items: center; gap: 5px; }
  .live { flex: none; display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; line-height: 1; color: var(--ontime); }
  .live i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .live.off { color: var(--muted); font-weight: 600; }
  /* The metro and the tram send no positions: their count is from the timetable, not live. */
  .live.sched { color: var(--muted); }
  .live.sched i { background: none; box-shadow: inset 0 0 0 1.5px currentColor; }
  .ok { flex: none; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--accent); color: var(--on-accent); }
  .nothing { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 10px; font-size: 13px; line-height: 1.35; color: var(--muted); }
  .spin.small { flex: none; width: 14px; height: 14px; }
  kbd { display: inline-flex; align-items: center; height: 20px; margin-left: 8px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--control); color: var(--muted); font: 600 11px/1 var(--font); }
  .pc { display: none; }
  @media (min-width: 720px) and (pointer: fine) {
    .pc { display: inline-flex; align-items: center; }
    small.pc { display: block; }
    .phone { display: none; }
  }
  .err { margin: 0; font-size: 13px; line-height: 1.35; color: var(--late3); }

  /* The best route, live: what «Πάμε» opens on. */
  .pv { min-height: 120px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; align-items: stretch; padding: 16px; border-radius: 20px;
    background: var(--glass-fill); border: 1px solid var(--glass-line); transition: border-color .3s; }
  .pvh { margin: 0; display: flex; align-items: center; gap: 12px; font-size: 14px; line-height: 1.4; color: var(--muted); }
  .pvi { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--control); color: var(--muted); }
  .pvi.warn { background: var(--warn-bg); color: var(--warn-fg); }
  @keyframes beat { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--ontime) 22%, transparent); } }
  .pvn { margin: 0; font-size: 12px; line-height: 1.4; color: var(--warn-fg); }
  /* The other options: a card each, stacked under the chosen one, each smaller and fainter than the one above.
     Where the browser has scroll-driven animations, a card still below sits tucked under the one above it and
     settles into place as it scrolls into view. */
  /* Picked: green, as the best one is while it is the one «Πάμε» opens. */
  /* The best one, as a button: plain while it is the pick; another picked, it steps back. */
  .pvn { display: block; }
  .pv { transition: opacity .2s, border-color .3s; }
  .sk { display: flex; flex-direction: column; gap: 12px; }
  .sk i { display: block; height: 14px; border-radius: 7px; background: linear-gradient(90deg, var(--control) 0%, var(--control-hover) 50%, var(--control) 100%);
    background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
  .sk i:nth-child(1) { width: 40%; }
  .sk i:nth-child(2) { width: 75%; height: 24px; }
  .sk i:nth-child(3) { width: 55%; }
  @keyframes shimmer { to { background-position: -200% 0; } }

  .acts { display: flex; flex-direction: column; gap: 4px; position: sticky; bottom: 0; z-index: 30; margin-bottom: -4px; padding: 14px 0 4px;
    background: linear-gradient(to bottom, transparent, var(--acts-bg, var(--surface)) 18px); box-shadow: 0 36px 0 var(--acts-bg, var(--surface)); }
  .primary { height: 48px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 20px; border: 0; border-radius: 18px;
    background: var(--accent); color: var(--on-accent); font: inherit; font-size: 15px; font-weight: 700; line-height: 1; cursor: pointer;
    transition: background-color .25s, color .25s, transform .12s, box-shadow .25s; }
  .primary.big { height: 52px; border-radius: 16px; font-size: 16px; font-weight: 700; }
  .primary:disabled { background: var(--glass-fill); color: var(--muted); cursor: default; box-shadow: none; }
  .primary:not(:disabled):active { transform: scale(.98); filter: brightness(.92); }
  .link { align-self: center; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px; border: 0; border-radius: 22px;
    background: none; color: var(--muted); font: inherit; font-size: 14px; font-weight: 600; line-height: 1; cursor: pointer; transition: background-color .15s, color .15s; }
  .link:hover { background: var(--control); color: var(--fg); }
  /* «Μόνο ο χάρτης» alone in the middle; with more below, the «πιο κάτω» pill (or «Πάνω») takes the right. */
  .actrow { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; }
  .actrow:has(:global(.pill), :global(.up)) { justify-content: space-between; }
  .actrow .link { align-self: auto; }
  .ghost { height: 48px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 18px; border-radius: 24px;
    color: var(--fg); font: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Picking on the map */
  .pickbar { position: fixed; z-index: 30; left: 50%; top: calc(16px + env(safe-area-inset-top)); transform: translateX(-50%); max-width: calc(100% - 32px);
    height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 16px; box-sizing: border-box; border-radius: 22px; background: var(--glass); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); font-size: 14px; font-weight: 600; line-height: 1; white-space: nowrap; }
  .pickbar span:last-child { overflow: hidden; text-overflow: ellipsis; }
  /* Checking an end: its name and a line under it, the bar as tall as they need. */
  .pickbar.check { width: calc(100% - 32px); max-width: 440px; height: auto; min-height: 56px; padding: 10px 16px; border-radius: 20px; white-space: normal; }
  .pickbar.check .dot { align-self: flex-start; margin-top: 3px; }
  .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
  .dot.to { border-radius: 2px; background: var(--late1); }
  .cross { position: fixed; z-index: 29; left: 50%; top: 50%; transform: translate(-50%, -100%); color: var(--accent); pointer-events: none;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, .35)); }
  .pickacts { position: fixed; z-index: 30; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 10px; }
  .pickacts .primary { min-width: 140px; }
  .pickacts .ghost { background: var(--glass); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); border: 0; }
  .drop { display: block; animation: pinDrop .45s cubic-bezier(.34, 1.56, .64, 1) both; }
  .shadow { position: absolute; left: 50%; bottom: -3px; width: 14px; height: 5px; margin-left: -7px; border-radius: 50%; background: rgba(0, 0, 0, .35);
    animation: pinShadow .45s ease-out both; }
  @keyframes pinDrop { from { transform: translateY(-28px); opacity: 0; } }
  @keyframes pinShadow { from { transform: scale(.3); opacity: 0; } }

  @media (prefers-reduced-motion: reduce) {
    .field, .fi, .swap, .opt, .primary, .link, .pv { transition: none; }
    .pop, .field.swapped input, .drop, .shadow, .sk i { animation: none; }
    .swap.turned, .field.pick.open .fi { transform: none; }
  }

  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .field.search { border-color: var(--glass-line); background: var(--control); }
  .field.search.open { border-color: var(--accent); }
  .field.search input { font-size: 17px; font-weight: 600; letter-spacing: 0; color: var(--fg); }
  .fs { flex: none; display: flex; color: var(--accent); }
  kbd.slash { margin: 0 6px 0 0; height: 26px; padding: 0 9px; font-size: 13px; }
  .ways { display: flex; gap: 10px; }
  .ways .primary { padding: 0 18px; border-radius: 14px; font-weight: 800; }
  .ghost.line { height: 48px; border: 1px solid var(--border); background: none; border-radius: 14px; }
  .ghost.line:hover { background: var(--control); }
  /* The intro's own (mockup 32): home and work, the favourites live, the last trips. */
  .mine { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 6px; }
  .mtile { min-width: 0; display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--glass-line); border-radius: 18px;
    background: var(--glass-fill); color: var(--fg); font: inherit; text-align: left; cursor: pointer; transition: border-color .15s, transform .12s; }
  .mtile:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--glass-line)); }
  .mtile:active { transform: scale(.98); }
  .mh { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .mic { flex: none; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--accent-bg); color: var(--accent); }
  .mtile.unset .mic { background: var(--control); color: var(--muted); }
  .mtx { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .mtx b { font-size: 15px; line-height: 1; }
  .mtx small { font-size: 12px; color: var(--muted); line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mf { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; min-height: 24px; }
  .mnow { min-width: 0; font-size: 12.5px; font-weight: 700; line-height: 1.25; color: var(--ontime); }
  .mnow.dim { color: var(--muted); font-weight: 600; }
  .mset { font-size: 12.5px; font-weight: 700; color: var(--accent); line-height: 1.2; }
  .mbig { flex: none; font-size: 22px; font-weight: 900; letter-spacing: -.02em; line-height: 1; }
  .mbig.plus { display: flex; color: var(--accent); }
  .sh { display: flex; align-items: center; justify-content: space-between; }
  .slink { height: 28px; padding: 0 4px; border: 0; background: none; color: var(--accent); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .favs, .recent { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
  .fcard { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--glass-line); border-radius: 18px; background: var(--glass-fill);
    color: var(--fg); font: inherit; text-align: left; cursor: pointer; transition: border-color .15s; }
  .fcard:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--glass-line)); }
  .fst { flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #fff; }
  .fst img { width: 22px; height: 22px; }
  .fmid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
  .fmid > b { font-size: 15px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fdeps { display: flex; flex-wrap: wrap; gap: 6px; }
  .fdep { height: 24px; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 3px; border-radius: 8px; background: var(--control); font-size: 12px; font-weight: 600; line-height: 1;
    max-width: 100%; overflow: hidden; white-space: nowrap; }
  .fdep.dim { padding: 0 8px; color: var(--muted); }
  .fdep i { font-style: normal; height: 18px; min-width: 30px; padding: 0 5px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border-radius: 6px; font-size: 11px; font-weight: 800; }
  .fdep small { font-size: 11.5px; font-weight: 800; color: var(--ontime); }
  .fnow { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 5px; color: var(--ontime); }
  .fnow.late { color: var(--late1); }
  .fnow b { font-size: 22px; font-weight: 900; letter-spacing: -.02em; line-height: 1; }
  .fnow small { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; line-height: 1; }
  .fnow small i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .flines { display: flex; flex-wrap: wrap; gap: 6px; }
  .fline { height: 30px; min-width: 48px; padding: 0 10px; border: 0; border-radius: 10px; background: var(--lb); color: var(--lf); font: inherit; font-size: 13px; font-weight: 800; line-height: 1; cursor: pointer; }
  .rrow { display: flex; align-items: center; gap: 12px; min-height: 44px; }
  .ric { flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--control); color: var(--muted); }
  .rtx { flex: 1; min-width: 0; }
  .rtx b { display: block; font-size: 14px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ragain { flex: none; height: 32px; padding: 0 14px; border: 0; border-radius: 16px; background: var(--accent-bg); color: var(--accent); font: inherit; font-size: 13px; font-weight: 800; line-height: 1; cursor: pointer; }
  .quick { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
  .ql { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; line-height: 1; color: var(--muted); }
  .qrow { display: flex; flex-wrap: wrap; gap: 8px; }
  .qchip { height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 14px; border: 1px solid var(--glass-line); border-radius: 19px;
    background: var(--glass-fill); color: var(--fg); font: inherit; font-size: 14px; font-weight: 600; line-height: 1; cursor: pointer; transition: border-color .15s, transform .12s; }
  .qchip:hover { border-color: var(--accent); }
  .qchip:active { transform: scale(.97); }
  .qchip small { font-size: 14px; font-weight: 500; color: var(--muted); }
  .facts { list-style: none; margin: auto 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 14px; line-height: 1.3; color: var(--muted); }
  .facts li { display: flex; align-items: center; gap: 10px; }
  .facts i { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
  .facts i.g { background: var(--ontime); }
  .facts i.b { background: var(--accent); }
  h1.hero { margin: 28px 0 8px; font-size: 52px; line-height: 1.02; letter-spacing: -.04em; }
  h1.hero span { color: var(--accent); }

  /* A wide window: the panel on the left, full height; the map beside it stays live and uncovered. */
  @media (min-width: 1024px) {
    .start { justify-content: flex-start; align-items: stretch; padding: 16px; background: none; -webkit-backdrop-filter: none; backdrop-filter: none; pointer-events: none; }
    .box { pointer-events: auto; max-width: 540px; max-height: none !important; height: 100%; padding: 36px 44px 32px; border-radius: 24px; gap: 22px; }
    .box > :global(*) { flex: none; }
    .acts { margin-top: auto; }
  }

  /* A computer: the box in the middle of the window, the map alive behind it (pan it, zoom it, click a point on it). */
  @media (min-width: 720px) {
    .start { padding: 24px; }
    .box { max-height: calc(100dvh - 48px); overflow-y: auto; }
    .opts { max-height: min(340px, calc(100dvh - 460px)); }
  }
  @media (max-width: 719px) {
    .start { align-items: stretch; padding: 0; background: var(--bg); backdrop-filter: none; }
    .box { max-width: none; min-height: 100%; padding: calc(28px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom)); border-radius: 0;
      box-shadow: none; background: var(--bg); -webkit-backdrop-filter: none; backdrop-filter: none; text-shadow: none; --acts-bg: var(--bg); }
    .acts { margin-top: auto; }
  }

  /* ---- A phone: the same screen in quieter colours. Neutral surfaces with a fine neutral edge instead of blue-tinted
     boxes, the values in the text colour, one flat blue for «Πάμε», the means and the best route without loud
     fills; colour stays where it means something: the lines, and «Φύγε…» in green. */
  @media (max-width: 719px) {
    .box { --pc-surf: color-mix(in srgb, var(--fg) 6%, var(--bg)); --pc-edge: color-mix(in srgb, var(--fg) 10%, var(--bg)); --pc-acc: #3d7bea; }
    .logo { background: var(--pc-acc, var(--accent)); color: #fff; }
    .field, .ends.group { border-color: var(--pc-edge, var(--glass-line)); background: var(--pc-surf, var(--glass-fill)); }
    .ends.group .field.end { background: none; }
    .field.open, .ends.group .field.end.open { border-color: color-mix(in srgb, var(--fg) 22%, var(--bg)); background: color-mix(in srgb, var(--fg) 8%, var(--bg)); }
    .ends.group .field.from { border-top-color: var(--pc-edge, var(--glass-line)); }
    input, .fv { color: var(--fg); }
    .mk.from { background: var(--pc-acc, var(--accent)); box-shadow: none; }
    .chip { border-color: var(--pc-edge, var(--glass-line)); background: var(--pc-surf, var(--glass-fill)); }
    .chip.open, .chip:hover { border-color: color-mix(in srgb, var(--fg) 22%, var(--bg)); }
    .sb { background: color-mix(in srgb, var(--fg) 14%, var(--bg)); color: var(--fg); border-color: var(--bg); }
    .sg, .sortc .sg { background: color-mix(in srgb, var(--fg) 10%, var(--bg)); color: var(--fg); }
    .pv { border-color: var(--pc-edge, var(--glass-line)); background: var(--pc-surf, var(--glass-fill)); }
    .primary { background: var(--pc-acc, var(--accent)); color: #fff; }
    .primary:disabled { background: var(--pc-surf, var(--glass-fill)); color: var(--muted); }
  }
  /* ---- Not wide (mockup 39): the two numbered questions, home and work as tiles, the last trips; the answer's card
     with its two «Αλλαγή», the route cards, «Θύμισέ μου» beside «Ξεκίνα». */
  .ends.asks { gap: 0; }
  .ends.asks .field.end { min-height: 60px; border-radius: 16px; }
  .ends.asks .field.end input { height: 56px; font-size: 18px; font-weight: 700; letter-spacing: 0; }
  .ends.asks .field.end input::placeholder { font-size: 17px; font-weight: 500; }
  .ends.asks .field.end.open { border-color: var(--pc-acc, var(--accent)); }
  .fs2 { flex: none; display: flex; color: var(--muted); }
  .mearr { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--pc-acc, var(--accent)) 18%, transparent); color: var(--pc-acc, var(--accent)); }
  .melive { flex: none; font-size: 12px; font-weight: 500; color: var(--muted); line-height: 1; white-space: nowrap; }
  .meoi { color: var(--pc-acc, var(--accent)); }
  .ends.asks .sugg { padding: 10px 0 0; }
  .ends.asks .sc { height: 40px; padding: 0 14px 0 12px; border-radius: 12px; font-size: 15px; }
  .chg { flex: none; height: 40px; padding: 0 14px; display: flex; align-items: center; border: 0; border-radius: 12px; font: inherit; font-size: 14px; font-weight: 600; line-height: 1;
    background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--fg); cursor: pointer; }
  .chg:hover { background: color-mix(in srgb, var(--fg) 16%, transparent); }

  .qh { margin: 22px 0 8px; font-size: 15px; font-weight: 600; color: var(--muted); line-height: 1; }
  .ric, .rch { flex: none; display: flex; color: var(--muted); }
  .rtx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; font-size: 17px; font-weight: 500; line-height: 1.2; }

  .srow { min-height: 56px; display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 16px; box-sizing: border-box; }
  .cards { display: flex; flex-direction: column; gap: 10px; }
  .est { margin: 0; display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 16px; font-size: 13px; line-height: 1.4; color: var(--muted);
    background: color-mix(in srgb, var(--warn-fg) 10%, transparent); }
  .est :global(svg) { flex: none; margin-top: 1px; color: var(--warn-fg); }
  .pvn.solo { margin: -4px 4px 0; }
  .morer { align-self: center; height: 44px; padding: 0 16px; border: 0; border-radius: 22px; background: none; color: var(--muted); font: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer; }
  .duo { display: flex; gap: 10px; }
  .duo .primary { flex: 1.5; }
  .ghost2 { flex: 1; min-width: 0; height: 52px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; border: 0; border-radius: 16px;
    background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--fg); font: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer; white-space: nowrap; }
  .ghost2.on { background: color-mix(in srgb, var(--pc-acc, var(--accent)) 18%, transparent); color: var(--fg); }
  .ghost2:disabled { opacity: .5; cursor: default; }
  .brandrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; margin: -8px 0; }
  .xclose { flex: none; width: 40px; height: 40px; padding: 0; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 50%;
    background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--fg); cursor: pointer; }
  .actrow .link :global(svg) { flex: none; }
  .findnote { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.4; text-align: center; }
  /* ---- The answer on a phone (mockups 42 B, 44): the trip asked in a card of its own floating at the top, lighter
     than the page and pinned while the routes scroll under it; «Από» and «Προς» as fields on a dotted route line, the swap
     between them; when and with what as two chips that open the options. */
  /* Mockup 14: the trip asked as a strip across the top, pinned while the list scrolls under it: «‹», one box with
     «Από» and «Προς» (44px rows, a marker, a small grey word, the place in bold), the swap; the choices as 32px chips. */
  .band { position: sticky; top: 0; z-index: 25; display: flex; flex-direction: column; gap: 10px;
    margin: calc(-28px - env(safe-area-inset-top)) -16px 0; padding: calc(14px + env(safe-area-inset-top)) 16px 12px;
    background: color-mix(in srgb, var(--fg) 4%, var(--bg)); box-shadow: 0 1px 0 var(--pc-edge, var(--glass-line));
    --tf-bg: color-mix(in srgb, var(--fg) 10%, var(--bg)); }
  .chk { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .chk b { font-size: 15px; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chk small { font-size: 12px; color: var(--muted); line-height: 1.3; white-space: normal; }
  .tends { display: flex; align-items: center; gap: 6px; }
  .tback { flex: none; width: 32px; height: 88px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    background: none; color: var(--fg); cursor: pointer; }
  .tfields { flex: 1; min-width: 0; display: flex; flex-direction: column; border-radius: 14px; background: var(--tf-bg); overflow: hidden; }
  .tfw { position: relative; }
  .tfw + .tfw { box-shadow: 0 -1px 0 color-mix(in srgb, var(--fg) 9%, var(--bg)); }
  .tview { position: absolute; right: 8px; top: 8px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; background: none; color: var(--muted); cursor: pointer; }
  .tview:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 10%, transparent); }
  .tfield { width: 100%; height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 40px 0 12px; border: 0; box-sizing: border-box;
    background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .tfield:hover { background: color-mix(in srgb, var(--fg) 4%, transparent); }
  .tmk { flex: none; display: block; width: 9px; height: 9px; border-radius: 50%; background: var(--pc-acc, var(--accent)); }
  .tmk.to { border-radius: 2px; background: var(--late1, #f0ae45); }
  .tk { flex: none; width: 30px; font-size: 12.5px; font-weight: 600; color: var(--muted); line-height: 1; }
  .tv { min-width: 0; font-size: 15px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tv.tvme { color: color-mix(in srgb, var(--pc-acc, var(--accent)) 55%, var(--fg)); }
  .tswap { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; background: var(--tf-bg); color: var(--fg); cursor: pointer; transition: transform .3s; }
  .tswap.turned { transform: rotate(180deg); }
  .tchips { height: 32px; display: flex; align-items: center; gap: 6px; margin-right: -16px; padding: 0 16px 0 38px; overflow-x: auto; overscroll-behavior-x: contain;
    scrollbar-width: none; }
  .tchips::-webkit-scrollbar { display: none; }
  .tchip { flex: none; height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 10px 0 9px; border: 0; border-radius: 16px;
    background: var(--tf-bg); color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; white-space: nowrap; cursor: pointer; }
  .tchip > :global(svg:first-child) { flex: none; display: block; color: var(--muted); }
  .tcv { display: flex; color: var(--muted); transition: transform .2s; }
  .tcv.up { transform: rotate(180deg); }
  .tchip.set { background: color-mix(in srgb, var(--accent) 18%, var(--tf-bg)); color: color-mix(in srgb, var(--accent) 55%, var(--fg));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 60%, transparent); }
  .tchip.set > :global(svg:first-child), .tchip.set .tcv { color: inherit; }
  /* «Πότε» under its chip (mockup 46 Γ): over the routes, inside the band's width. */
  .whenpop { position: absolute; z-index: 30; left: 38px; right: 14px; top: calc(100% - 8px); max-width: 330px; display: flex; flex-direction: column; gap: 12px;
    padding: 12px; border-radius: 20px; box-sizing: border-box; background: color-mix(in srgb, var(--fg) 12%, var(--bg));
    box-shadow: 0 18px 50px rgba(0, 0, 0, .45), inset 0 0 0 1px color-mix(in srgb, var(--fg) 10%, transparent); }
  .wseg { height: 40px; display: flex; gap: 4px; padding: 4px; border-radius: 12px; box-sizing: border-box; background: color-mix(in srgb, var(--fg) 6%, var(--bg)); }
  .wseg button { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; padding: 0 4px; border: 0; border-radius: 9px;
    background: none; color: var(--muted); font: inherit; font-size: 14px; font-weight: 600; line-height: 1; white-space: nowrap; cursor: pointer; }
  .wseg button.on { background: color-mix(in srgb, var(--fg) 16%, var(--bg)); color: var(--fg); font-weight: 700; box-shadow: 0 2px 6px rgba(0, 0, 0, .25); }
  .wseg.small button { font-size: 13px; }
  .wquick { display: flex; gap: 6px; }
  .wquick button { flex: 1; height: 34px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 17px;
    background: color-mix(in srgb, var(--fg) 8%, var(--bg)); color: var(--fg); font: inherit; font-size: 14px; font-weight: 600; line-height: 1;
    font-variant-numeric: tabular-nums; cursor: pointer; }
  .wquick button.on, .wlist button.on { background: color-mix(in srgb, var(--accent) 22%, var(--bg)); color: color-mix(in srgb, var(--accent) 55%, var(--fg)); }
  .wl { height: 16px; display: flex; align-items: center; padding-left: 2px; font-size: 12.5px; font-weight: 600; color: var(--muted); line-height: 1; }
  /* The times: three rows show, the picked one in the middle; a thin scrollbar of its own, inside the list. */
  .wlist { position: relative; height: 132px; list-style: none; margin: 0; padding: 0; border-radius: 12px; overflow-y: auto; overscroll-behavior: contain;
    background: color-mix(in srgb, var(--fg) 5%, var(--bg)); scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--fg) 25%, transparent) transparent; }
  .wlist::-webkit-scrollbar { width: 4px; }
  .wlist::-webkit-scrollbar-thumb { border-radius: 2px; background: color-mix(in srgb, var(--fg) 25%, transparent); }
  .wlist button { width: 100%; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; border: 0;
    background: none; color: var(--fg); font: inherit; font-size: 16px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; cursor: pointer; }
  .wlist button.on { font-weight: 800; font-size: 17px; }
  .wlist small { font-size: 12px; font-weight: 600; color: var(--muted); }
  .wnote { margin: -4px 2px 0; font-size: 12px; line-height: 1.35; color: var(--muted); }
  .wok { height: 44px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 12px; background: var(--accent); color: #fff;
    font: inherit; font-size: 15px; font-weight: 700; line-height: 1; cursor: pointer; }
  /* The list (mockup 14): its count, the one fare, the order; then one card, the options as rows in it. */
  .rcount { margin: -6px 0 -8px; height: 20px; display: flex; align-items: center; gap: 8px; padding: 0 2px; line-height: 1; color: var(--fg); }
  .rcount b { font-size: 14px; font-weight: 700; white-space: nowrap; }
  .rcount span { min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rsort { flex: none; margin-left: auto; height: 20px; display: flex; align-items: center; gap: 5px; padding: 0; border: 0; background: none;
    color: color-mix(in srgb, var(--pc-acc, var(--accent)) 55%, var(--fg)); font: inherit; font-size: 12.5px; font-weight: 700; line-height: 1; cursor: pointer; }
  .rsort :global(svg) { display: block; }
  .cards.list { gap: 0; padding: 2px; border-radius: 16px; background: var(--pc-surf, var(--card)); box-shadow: inset 0 0 0 1px var(--pc-edge, var(--card-border)); }
  .box.ans .morer { height: 36px; display: flex; align-items: center; gap: 6px; margin-top: -8px; font-size: 13.5px; font-weight: 700; }
  .box.ans .morer :global(svg) { display: block; }
  /* At the foot: the reminder as a square bell, «Ξεκίνα» with when to leave and when you arrive. */
  .box.ans .acts { margin: auto -16px -4px; padding: 12px 16px 4px; border-top: 0;
    background: linear-gradient(to bottom, transparent, var(--acts-bg, var(--surface)) 30%); box-shadow: 0 36px 0 var(--acts-bg, var(--surface)); }
  .box.ans .duo { gap: 8px; }
  .bell { position: relative; flex: none; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 16px;
    background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--fg); cursor: pointer; }
  .bell :global(svg) { display: block; }
  .bell.on { background: color-mix(in srgb, var(--pc-acc, var(--accent)) 22%, transparent); color: color-mix(in srgb, var(--pc-acc, var(--accent)) 55%, var(--fg)); }
  .bell i { position: absolute; top: 12px; right: 13px; width: 7px; height: 7px; border-radius: 50%; background: var(--pc-acc, var(--accent)); }
  .bell:disabled { opacity: .5; cursor: default; }
  .duo .primary.go { flex: 1; min-width: 0; gap: 10px; padding: 0 14px; }
  .go b { font-size: 16px; font-weight: 700; line-height: 1; }
  .go span { min-width: 0; font-size: 13.5px; font-weight: 600; line-height: 1; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (prefers-reduced-motion: reduce) { .tswap, .tcv { transition: none; } }

  /* ---- Compact mockup 2, a phone: «‹», «Από» and «Προς» as one block, the swap; shortcuts in one row; the map and
     the lines side by side; «Πρόσφατα» with «Καθαρισμός» and ↖; «Δημοφιλή» one under the other. */
  .ends.pair { display: grid; grid-template-columns: 36px minmax(0, 1fr) 36px; column-gap: 6px; }
  .ends.pair > :global(*) { grid-column: 2; }
  .pback, .pswap { grid-row: 1 / span 2; align-self: center; width: 36px; height: 44px; display: flex; align-items: center; justify-content: center;
    padding: 0; border: 0; background: none; color: var(--fg); cursor: pointer; }
  .pback { grid-column: 1 !important; }
  .pswap { grid-column: 3 !important; color: color-mix(in srgb, var(--fg) 80%, var(--muted)); transition: transform .3s; }
  .pswap.turned { transform: rotate(180deg); }
  .pswap[aria-disabled="true"] { opacity: .35; cursor: default; }
  .ends.pair .field.end { min-height: 44px; height: 44px; padding: 0 12px; gap: 10px; border: 0; border-radius: 0; background: var(--control); }
  .ends.pair .field.end.from { border-radius: 14px 14px 0 0; border-bottom: 1px solid color-mix(in srgb, var(--fg) 9%, var(--control)); }
  .ends.pair .field.end.to { border-radius: 0 0 14px 14px; }
  .ends.pair .field.end.to.open, .ends.pair .field.end.to:focus-within { box-shadow: inset 0 0 0 2px var(--accent); }
  .ends.pair .field.end input { height: 42px; font-size: 15.5px; font-weight: 600; }
  .ends.pair .field.end.from input { color: color-mix(in srgb, var(--accent) 75%, var(--fg)); }
  .ends.pair .fl { width: 32px; font-size: 12.5px; font-weight: 600; letter-spacing: 0; text-transform: none; }
  .ends.pair .mk.from { width: 11px; height: 11px; margin: 0 2px; border-radius: 50%; background: none; box-shadow: inset 0 0 0 2.5px var(--accent); }
  .ends.pair .mk.to { width: 11px; height: 11px; margin: 0 2px; border-radius: 50% 50% 50% 0; rotate: -45deg; background: #ff8a3d; }
  .ends.pair .chg, .ends.pair .melive, .ends.pair .mearr { display: none; }
  .ends.pair .sugg { padding: 8px 0 0; }
  .sugg.under { padding: 12px 0 0 42px; }
  .scuts { display: flex; gap: 8px; overflow-x: auto; margin: 2px -16px 0; padding: 0 16px; scrollbar-width: none; }
  .scuts::-webkit-scrollbar { display: none; }
  .scut { flex: none; height: 36px; display: flex; align-items: center; gap: 7px; padding: 0 12px 0 10px; border: 0; border-radius: 18px;
    background: var(--pc-surf, var(--card)); box-shadow: inset 0 0 0 1px var(--pc-edge, var(--card-border)); color: var(--fg); font: inherit; cursor: pointer; white-space: nowrap; }
  .scut b { font-size: 14px; font-weight: 700; line-height: 1; }
  .scut .sl { font-size: 14px; font-weight: 600; line-height: 1; color: var(--muted); }
  .scut .sm { font-size: 14px; font-weight: 600; line-height: 1; color: var(--ontime); }
  .scut.best { background: color-mix(in srgb, var(--accent) 16%, var(--bg)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent); }
  .scut.here { color: var(--muted); }
  .scut.ln { padding: 0 5px; }
  .scut.add { background: none; box-shadow: none; border: 1.5px dashed color-mix(in srgb, var(--fg) 28%, transparent); color: color-mix(in srgb, var(--fg) 82%, var(--muted)); }
  .ways2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ways2 button { height: 40px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 12px; background: var(--pc-surf, var(--card));
    color: var(--fg); font: inherit; cursor: pointer; }
  .ways2 b { font-size: 13.5px; font-weight: 700; line-height: 1; }
  .w2i { display: flex; color: var(--accent); }
  .sect { display: flex; flex-direction: column; }
  .sech { height: 22px; display: flex; align-items: center; justify-content: space-between; padding: 0 2px; margin-bottom: 2px; }
  .sech span { font-size: 13px; font-weight: 700; line-height: 1; color: var(--muted); }
  .sech button { height: 22px; padding: 0; border: 0; background: none; color: var(--muted); font: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; }
  .prow { height: 52px; display: flex; align-items: center; gap: 4px; }
  .pmain { flex: 1; min-width: 0; height: 52px; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .pric { flex: none; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--fg) 10%, var(--bg)); color: color-mix(in srgb, var(--fg) 80%, var(--muted)); }
  .ptxt { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .ptxt b { font-size: 15px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ptxt small { font-size: 12.5px; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pfill { flex: none; width: 40px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; background: none; color: var(--muted); cursor: pointer; }
  .poprow { height: 44px; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .poprow b { flex: none; font-size: 14.5px; line-height: 1; }
  .poprow small { margin-left: auto; min-width: 0; font-size: 12.5px; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 719px) {
    .box:has(.ends.pair) { gap: 12px; padding-top: calc(12px + env(safe-area-inset-top)); }
  }
  .opt mark { background: none; color: var(--fg); font-weight: 800; }
  .opt .ot b:has(mark) { font-weight: 600; color: color-mix(in srgb, var(--fg) 82%, var(--muted)); }

  /* ---- Typing on a phone (compact mockup 3): the field with «Άκυρο» beside it, the list flat under it: the row Enter
     takes lit, ↖ on each place to go on typing from it, the lines in one row of chips. */
  .box.typing { padding-top: calc(16px + env(safe-area-inset-top)); gap: 10px; }
  .ends.typing { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 10px; }
  .ends.typing .field.end { flex: 1; min-width: 0; height: 44px; min-height: 44px; gap: 10px; padding: 0 4px 0 12px; border: 0; border-radius: 14px;
    background: var(--control); box-shadow: inset 0 0 0 2px var(--accent); }
  .ends.typing .field.end input { height: 44px; padding: 0; font-size: 16px; font-weight: 400; line-height: 1; color: var(--fg); }
  .ends.typing .field.end input::placeholder { font-size: 16px; font-weight: 400; color: var(--muted); }
  .fs2.on { color: var(--accent); }
  .ends.typing .clear { width: 36px; height: 36px; background: none; color: var(--bg); }
  .cx { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--fg) 28%, var(--control)); }
  .cancel { flex: none; height: 44px; display: flex; align-items: center; padding: 0 4px; border: 0; background: none; color: var(--accent);
    font: inherit; font-size: 15px; font-weight: 700; line-height: 1; cursor: pointer; }
  .ends.typing .opts { flex: 0 0 100%; margin: 0; padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .ends.typing .opts > li { display: flex; align-items: center; flex-shrink: 0; }
  .lrow { min-height: 44px; }
  .lchips { height: 44px; align-items: center; }
  .ends.typing .opt { flex: 1; min-width: 0; min-height: 52px; gap: 12px; padding: 0 0 0 10px; border-radius: 14px; }
  .ends.typing .opt:hover, .ends.typing .opt.active { background: none; }
  .ends.typing li:has(.opt.top), .ends.typing li:has(.opt.active) { border-radius: 14px; background: color-mix(in srgb, var(--accent) 14%, var(--bg)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, var(--bg)); }
  .ends.typing .opt.top { min-height: 56px; }
  .ends.typing .oi { width: 32px; height: 32px; background: color-mix(in srgb, var(--fg) 10%, var(--bg)); color: color-mix(in srgb, var(--fg) 80%, var(--muted)); }
  .ends.typing .oi.oasa { background: #ffffff; }
  .ends.typing .oi.oasa img { width: 19px; height: 19px; }
  .ends.typing .oi.meoi { color: var(--accent); }
  .ends.typing .ot { gap: 5px; }
  .ends.typing .ot b { font-size: 15px; font-weight: 600; line-height: 1; color: color-mix(in srgb, var(--fg) 82%, var(--muted)); }
  .ends.typing .ot small { font-size: 12.5px; line-height: 1; }
  .ends.typing .oh { height: 20px; display: flex; align-items: center; padding: 10px 2px 6px; text-transform: none; letter-spacing: 0; font-size: 13px; }
  .oimg { flex: none; width: 32px; height: 32px; display: block; }
  .ofill { flex: none; width: 40px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; background: none; color: var(--muted); cursor: pointer; }
  .lrow { overflow: hidden; }
  .lchips { flex: 1; display: flex; gap: 8px; overflow-x: auto; margin-right: -16px; padding-right: 16px; scrollbar-width: none; }
  .lchips::-webkit-scrollbar { display: none; }
  .lpick { flex: none; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 6px; border: 0; border-radius: 12px;
    background: var(--card, var(--control)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 12%, var(--bg)); color: var(--fg);
    font: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; }
  .lpick.active { box-shadow: inset 0 0 0 2px var(--accent); }
  .lpick i { width: 6px; height: 6px; border-radius: 50%; background: var(--ontime); display: block; }

  /* The map pick's aim (compact mockups 8, 8β): a blue circle at the centre; over a stop it slides onto it and opens
     into a ring round the stop's own mark, with the dark label above. */
  .aim { position: fixed; z-index: 29; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none;
    transform: translate(var(--x), var(--y)); transition: transform .28s cubic-bezier(.34, 1.4, .64, 1); }
  .aim .ring, .aim .core { position: absolute; left: 0; top: 0; display: block; border-radius: 50%; translate: -50% -50%;
    transition: width .28s cubic-bezier(.34, 1.4, .64, 1), height .28s cubic-bezier(.34, 1.4, .64, 1), background-color .2s, box-shadow .2s; }
  .aim .ring { width: 44px; height: 44px; background: rgb(77 138 240 / .2); box-shadow: inset 0 0 0 2px rgb(77 138 240 / .55); animation: aimPulse 1.8s ease-out infinite; }
  .aim .core { width: 16px; height: 16px; background: #4d8af0; box-shadow: 0 0 0 3px #ffffff, 0 2px 8px rgb(0 0 0 / .4); }
  .aim.snap .ring { width: 60px; height: 60px; background: rgb(77 138 240 / .16); box-shadow: inset 0 0 0 4px #4d8af0; animation: none; }
  .aim.snap .core { width: 40px; height: 40px; background: #ffffff; box-shadow: 0 2px 8px rgb(0 0 0 / .4); }
  .aim .core { display: flex; align-items: center; justify-content: center; }
  .aim .core img { width: 22px; height: 22px; display: block; animation: aimIn .25s ease-out both; }
  @keyframes aimIn { from { opacity: 0; transform: scale(.4); } }
  @keyframes aimPulse { 0% { box-shadow: inset 0 0 0 2px rgb(77 138 240 / .55), 0 0 0 0 rgb(77 138 240 / .35); } 100% { box-shadow: inset 0 0 0 2px rgb(77 138 240 / .55), 0 0 0 14px rgb(77 138 240 / 0); } }
  .slabel { position: absolute; left: 0; bottom: 42px; translate: -50% 0; padding: 8px 10px 8px 12px; display: flex; align-items: center; gap: 10px; white-space: nowrap;
    border-radius: 14px; background: #262a32; color: #e8eaed; box-shadow: 0 8px 24px rgb(0 0 0 / .55), inset 0 0 0 1px #3a5a96; }
  .stip { position: absolute; left: 50%; bottom: -7px; width: 14px; height: 14px; margin-left: -7px; background: #262a32; box-shadow: 1px 1px 0 0 #3a5a96;
    transform: rotate(45deg); border-radius: 0 0 3px 0; display: block; }
  .st2 { display: flex; flex-direction: column; gap: 5px; }
  .st2 b { font-size: 14px; font-weight: 800; line-height: 1; }
  .st2 small { font-size: 11.5px; font-weight: 600; line-height: 1; color: #9aa2ae; }
  .schips { display: flex; gap: 4px; }
  .schips span { height: 22px; padding: 0 6px; border-radius: 6px; display: flex; align-items: center; font-size: 12px; font-weight: 800; line-height: 1; }
  @media (prefers-reduced-motion: reduce) { .aim, .aim .ring, .aim .core { transition: none; animation: none; } }

  /* ---- The map pick on a phone (compact mockups 8, 8β). */
  .ptop { position: fixed; z-index: 30; left: 16px; right: 16px; top: calc(16px + env(safe-area-inset-top)); display: flex; align-items: center; gap: 8px; }
  .pcirc { flex: none; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: inset 0 0 0 1px var(--card-border, var(--border)); color: var(--fg); cursor: pointer; }
  .pcirc.sm { width: 40px; height: 40px; background: var(--control); box-shadow: none; }
  .pfield { flex: 1; min-width: 0; height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 14px; border: 0; border-radius: 22px;
    background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: inset 0 0 0 1px var(--card-border, var(--border)); color: var(--muted);
    font: inherit; font-size: 15px; line-height: 1; text-align: left; cursor: text; }
  .phint { position: fixed; z-index: 30; left: 50%; top: calc(74px + env(safe-area-inset-top)); translate: -50% 0; height: 32px; padding: 0 14px; display: flex; align-items: center; gap: 8px;
    border-radius: 16px; background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: inset 0 0 0 1px var(--card-border, var(--border));
    white-space: nowrap; font-size: 13px; font-weight: 600; line-height: 1; color: color-mix(in srgb, var(--fg) 82%, var(--muted)); pointer-events: none; }
  .psheet { position: fixed; z-index: 30; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; gap: 12px; padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
    border-radius: 24px 24px 0 0; background: var(--surface); box-shadow: 0 -10px 30px rgb(0 0 0 / .45); box-sizing: border-box; }
  .pme { position: absolute; right: 16px; top: -60px; color: var(--accent); }
  .pgrip { width: 40px; height: 5px; border-radius: 3px; background: var(--border); align-self: center; display: block; }
  .phead { height: 44px; display: flex; align-items: center; gap: 12px; }
  .pmk { flex: none; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #ff7a2f; background: rgb(255 122 47 / .16); }
  .pmk.from { color: var(--accent); background: var(--accent-bg); }
  .ptx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .ptx b { font-size: 18px; font-weight: 800; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ptx small { font-size: 12.5px; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pnear { display: flex; gap: 8px; overflow-x: auto; margin-right: -16px; padding-right: 16px; scrollbar-width: none; }
  .pnear::-webkit-scrollbar { display: none; }
  .pn { flex: none; height: 36px; display: flex; align-items: center; gap: 6px; padding: 0 12px 0 4px; border: 0; border-radius: 18px; background: var(--card, var(--control));
    box-shadow: inset 0 0 0 1px var(--card-border, var(--border)); color: var(--fg); font: inherit; line-height: 1; cursor: pointer; }
  .pn b { font-size: 13px; font-weight: 700; white-space: nowrap; }
  .pn span { font-size: 13px; font-weight: 600; color: var(--muted); }
  .pnm { width: 28px; height: 28px; display: block; flex: none; }
  .pkeep { height: 36px; display: flex; align-items: center; gap: 8px; }
  .pkeep > span { flex: none; font-size: 13px; font-weight: 600; line-height: 1; color: var(--muted); }
  .pk { height: 36px; display: flex; align-items: center; gap: 6px; padding: 0 12px 0 10px; border: 0; border-radius: 18px; background: var(--card, var(--control));
    box-shadow: inset 0 0 0 1px var(--card-border, var(--border)); color: var(--fg); font: inherit; line-height: 1; cursor: pointer; }
  .pk b { font-size: 13.5px; font-weight: 700; }
  .pk.round { width: 36px; padding: 0; justify-content: center; }
  .pk.on { background: var(--accent-bg); color: var(--accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent); }
  .pgo { display: flex; gap: 8px; margin-top: 4px; }
  .pcancel, .pgomain { height: 52px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 16px; font: inherit; line-height: 1; cursor: pointer; }
  .pcancel { flex: none; padding: 0 18px; background: var(--control); color: var(--fg); font-size: 15px; font-weight: 700; }
  .pgomain { flex: 1; background: #4d8af0; color: #ffffff; font-size: 16px; font-weight: 800; }
  .pgomain:disabled { opacity: .5; cursor: default; }

  .scut.sc { gap: 7px; padding: 0 12px 0 4px; }
  .sct { font-size: 13px; font-weight: 600; line-height: 1; white-space: nowrap; }
  .scm { display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 800; line-height: 1; color: var(--ontime); }
  .scm i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: block; }
  .oldnote { margin: 4px 0 -6px; display: flex; align-items: center; gap: 7px; padding: 0 2px; font-size: 12px; font-weight: 600; line-height: 1.3; color: var(--muted); }
  .oldnote i { width: 7px; height: 7px; border-radius: 50%; background: #ffb26b; display: block; flex: none; }
  /* Over the map (the pick's back, field and hint): a soft gaussian blur of the map behind, the surface see-through. */
  .ptop .pcirc, .pfield, .phint { background: color-mix(in srgb, var(--surface) 62%, transparent); -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); }
  /* Setting «Σπίτι» / «Δουλειά» (compact mockups 16, 16β). */
  .svhead { flex: 0 0 100%; height: 44px; display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .svback { flex: none; width: 32px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; background: none; color: var(--fg); cursor: pointer; }
  .svic { flex: none; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--accent-bg); color: var(--accent); }
  .svt { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .svt b { font-size: 18px; font-weight: 800; line-height: 1; }
  .svt small { font-size: 12.5px; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .svnote { margin: 12px 2px 0; font-size: 12.5px; line-height: 1.4; color: var(--muted); }
  .psave { font-size: 12.5px; font-weight: 700; line-height: 1; color: var(--accent); margin-bottom: -6px; }
  .pnearest { height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 6px; border-radius: 12px; background: var(--card, var(--control));
    box-shadow: inset 0 0 0 1px var(--card-border, var(--border)); font-size: 13px; font-weight: 600; line-height: 1; color: color-mix(in srgb, var(--fg) 82%, var(--muted)); }
  .pnearest > span:nth-child(2) { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pnearest b { color: var(--fg); }
  .pnearest .oasa { flex: none; width: 28px; height: 28px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
  .pnearest .oasa img { width: 17px; height: 17px; display: block; }
  .pw { flex: none; display: flex; align-items: center; gap: 3px; font-weight: 700; color: var(--muted); }
  .aim .core.svc { width: 30px; height: 30px; color: #ffffff; display: flex; align-items: center; justify-content: center; }
</style>
