<script lang="ts">
  // «Θέλω να πάω», the first screen of a visit, in a box in the middle: one sentence filled in as fields. «Πού» (with
  // «Από» under it, the user's location when the browser allows it), «Πότε», «Πώς»; under them the best route for what
  // is filled in, live, as it changes. «Πάμε» hands it all to the trip planner (the Ταξίδι tab), which opens on it. Each end is the user's
  // location, a point picked on the map, or what they type (a stop, an area, a street with its number: the stop index
  // and the geocoder). Shown at every plain visit (not a shared link), and again from «Πού πας;» on Τώρα. The same
  // box, one field only, sets «Σπίτι» and «Δουλειά» (app.savingPlace).
  import { tick, untrack } from "svelte";
  import { centre, distM, geocode, loadTripIndex, places, savedPlaces, stationPlaces, suggest, type Place, type TripIndex } from "../trip";
  import { titleCase } from "../nearby";
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
  import { fetchV2Lines, fetchV2Stop, fetchV2Stops, getJSON } from "../api";
  import { findMuniLines, findMuniStops, lineStopPoints, type MuniStopHit, type StopEntry } from "../finder";
  import type { MuniCard } from "../muniLine";
  import { intents, lineAlias, modeWord, ownEnd, parseTrip, searchLines, searchNamed, type Ctx, type Intent } from "../searchEngine";
  import { fold } from "../search";
  import { checkLive, liveCount } from "../liveLines";
  import { stopRows, type V2Arrival, type V2Line } from "../v2";
  import { placeNote, toward } from "../stops";
  import { busStopCard } from "../legacy";
  import { clockHM } from "../trains";
  import { API_BASE } from "../config";
  import { durText } from "../format";
  import { withMetro } from "../metroBridge";
  import { euro, tripFare } from "../fares";
  import { parsePlan, planFC, planSummary, planUrl, scaledLegs, type Itinerary, type PlanResponse } from "../plan";

  let { app }: { app: AppState } = $props();

  type Field = "from" | "to";
  const ME = "Η θέση μου";
  const MAP = "Σημείο στον χάρτη";
  let ends = $state<Record<Field, { text: string; place: Place | null }>>({ from: { text: "", place: null }, to: { text: "", place: null } });
  let open = $state<Field | null>(null);
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
    const q = ends[open].text.trim();
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
    const q = ends.to.text;
    if (open !== "to" || app.savingPlace || ends.to.place || !q.trim().includes(" ")) return [];
    const t = parseTrip(q);
    if (t) {
      const a = endOf(t.from), b = endOf(t.to);
      return a && b && a.label !== b.label ? [{ kind: "go", from: a, to: b }] : [];
    }
    return allLines.length && allStops.length ? intents(allLines, allStops, q, ctx).filter(x => x.kind === "lineAt") : [];
  });
  const lineHits = $derived.by((): { first: V2Line[]; last: V2Line[] } => {
    const q = open === "to" && !app.savingPlace ? ends.to.text.trim() : "";
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
  const muniQ = $derived(open === "to" && !app.savingPlace && !ends.to.place && app.municipalOn && app.municipal ? ends.to.text.trim() : "");
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
    if (!at || app.savingPlace) return [];
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
      const near = [...nearStations, ...nearStops].map((p, k): Row => ({ key: `near|${p.kind}|${p.label}|${p.pts[0].join()}`, place: p, head: k === 0 ? (app.myPos ? "Κοντά σου" : "Κοντά") : undefined }));
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
    if (l.id.startsWith("oasa:")) { const c = app.lineColor(native(l.id)); return { text, bg: c.bg, fg: c.fg }; }
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
    if (!l.id.startsWith("oasa:")) app.fitPoints(lineStopPoints(allStops, l.id));
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
    const other = ends[f === "from" ? "to" : "from"].place;
    timer = setTimeout(() => {
      const c = (ctl = new AbortController());
      geocode(q, c.signal, other ? centre(other.pts) : undefined).then(
        r => { if (ctl === c) geo = { text: q, places: r }; },
        () => {},
      ).finally(() => { if (ctl === c) busy = false; });
    }, 350);
  }

  function choose(f: Field, p: Place) {
    // Setting «Σπίτι» or «Δουλειά» (the home screen's shortcuts): the place picked is saved, and the screen closes.
    const saving = app.savingPlace;
    if (saving) {
      const label = p.kind === "me" ? ME : titleCase(p.label);
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
  function takeAt(c: [number, number] | null) {
    const f = app.pickFor;
    app.pickFor = null;
    if (!f || !c) return;
    let near: string | null = null, best = 400;
    for (const s of ix?.s ?? []) {
      const d = distM([s[1], s[2]], c);
      if (d < best) { best = d; near = s[0]; }
    }
    choose(f, { label: near ? `Κοντά στη στάση ${titleCase(near)}` : MAP, hint: `${c[0].toFixed(5)}, ${c[1].toFixed(5)}`, pts: [c], lines: [], kind: "area" });
  }

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
  $effect(() => { if (!app.start) app.finding = false; });
  $effect(() => { if (find && app.start && !app.pickFor) untrack(() => setTimeout(() => inputs.to?.focus(), 80)); });
  function showFound(p: Place) {
    app.finding = false; app.start = false; app.pickFor = null;
    const at = centre(p.pts);
    app.setTab("map");
    if (p.kind === "stop" && ix) {
      // The stop's own card: the index's stop of that name nearest the place.
      let k = -1, d = 60;
      ix.s.forEach((s, i) => { if (s[3]) { const m = distM([s[1], s[2]], at); if (m < d) { d = m; k = i; } } });
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
  const OF_CITY: Record<CityId, string> = { athens: "της Αθήνας", thessaloniki: "της Θεσσαλονίκης" };
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
  $effect(() => {
    if (!(intro && app.start) || !favKey) return;
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
  const pKey = $derived(ends.from.place && ends.to.place && !app.savingPlace
    ? JSON.stringify([centre(ends.from.place.pts), centre(ends.to.place.pts), later]) : null);
  $effect(() => {
    const k = pKey;
    if (!k || !app.start) return;
    const [a, b, off] = JSON.parse(k) as [[number, number], [number, number], number];
    const c = new AbortController();
    const t = setTimeout(() => getJSON(planUrl(API_BASE, a, b, off ? untrack(() => app.serverNow) / 1000 + off * 60 : undefined, 5), c.signal).then(
      async res => {
        if (c.signal.aborted) return;
        const r0 = res.status === 200 ? parsePlan(res.body) : null;
        // No route from the server: the app finds some itself (fallbackPlan.ts), timed from the live boards.
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
        // A metro option, when the server gave none (metroBridge.ts).
        void withMetro(r, a, b, off ? untrack(() => app.serverNow) / 1000 + off * 60 : undefined, untrack(() => app.serverNow) / 1000, ask)
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
    return its.map(it => ({ it, k: key(it) })).sort((x, y) => x.k - y.k || x.it.arrive_at - y.it.arrive_at).map(({ it }) => ({
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
  const answer = $derived(!wide && ready && !asking && !app.savingPlace);
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
  const bestTag = $derived(!top ? "" : sortId === "price" ? `Η φθηνότερη · ${top.metric}` : sortId === "dist" ? `Η πιο σύντομη · ${top.metric}` : later ? `Η καλύτερη σε ${later}′` : "Η καλύτερη τώρα");
  const whenWord = $derived(later ? (later === 60 ? "σε 1 ώρα" : `σε ${later} λεπτά`) : "τώρα");
  const meansWord = $derived(meansOn.length === MEANS.length ? "όλα τα μέσα" : meansOn.map(x => x.label.toLowerCase()).join(" και "));
  const SORT_WORD: Record<Sort, string> = { time: "Να φτάσω γρήγορα", price: "Να πληρώσω λιγότερο", dist: "Να περπατήσω λιγότερο" };
  const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  // A tap on «Από» or «Προς» of the band: back to the two fields, that one focused (its text selected).
  function editEnd(f: Field) {
    asking = true;
    void tick().then(() => inputs[f]?.focus());
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
  if (open && t.isConnected && !t.closest?.(".field, .opts")) open = null;
}} onpointerdown={e => {
  const t = e.target as Element;
  if (menu && !t.closest?.(".pickf, .opts")) menu = null;
}} />
<!-- A computer: «/» or ⌘K opens «Πού πας;», the one search; Escape leaves the map pick, goes a step back, or leaves for the map. -->
<svelte:window onkeydown={e => {
  const typing = (e.target as Element | null)?.closest?.("input, textarea, [contenteditable]");
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); if (app.start) explore(); else app.start = true; }
  else if (e.key === "/" && !typing && !app.start) { e.preventDefault(); app.start = true; }
  else if (e.key === "Escape" && app.start && app.pickFor) app.pickFor = null;
  else if (e.key === "Escape" && app.start && menu) menu = null;
  else if (e.key === "Escape" && app.start && !open && !typing) explore();
  else if (e.key === "Enter" && app.start && !typing && !app.pickFor && !menu && ready) go();
}} />

{#if app.start && app.pickFor}
  <!-- Picking on the map: a crosshair at the centre and two buttons; the map stays free to move. -->
  <div class="pickbar" role="status" transition:rise={{ y: -16 }}>
    <span class="dot {app.pickFor}"></span>
    <span class="phone">{app.pickFor === "from" ? "Μετακίνησε τον χάρτη στην αφετηρία" : "Μετακίνησε τον χάρτη στον προορισμό"}</span>
    <span class="pc">{app.pickFor === "from" ? "Κάνε κλικ στην αφετηρία" : "Κάνε κλικ στον προορισμό"}<kbd>Esc</kbd></span>
  </div>
  <div class="cross" aria-hidden="true"><span class="drop"><Icon name="pin" size={34} /></span><i class="shadow"></i></div>
  <div class="pickacts" transition:rise>
    <button type="button" class="ghost" onclick={() => (app.pickFor = null)}>Άκυρο</button>
    <button type="button" class="primary" disabled={!app.mapCenter} onclick={takeCentre}>Εδώ</button>
  </div>
{:else if app.start}
  <div class="start" class:side={wide} role="dialog" aria-modal={!wide} aria-labelledby="start-h" transition:soft>
    <div class="box" class:ans={answer} bind:this={boxEl} in:rise={{ y: 32, duration: 360 }}>
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
          {@render brandRow()}
          <h1 id="start-h" class="sr">Οι διαδρομές</h1>
          <div class="tends">
            <span class="trail" aria-hidden="true"><i class="tf"></i><i class="tl"></i><i class="tt"></i></span>
            <div class="tfields">
              <button type="button" class="tfield" onclick={() => editEnd("from")}><span class="tk">Από</span><span class="tv">{capital(fromWord(ends.from.place))}</span></button>
              <button type="button" class="tfield" onclick={() => editEnd("to")}><span class="tk">Προς</span><span class="tv">{ends.to.place ? titleCase(ends.to.place.label) : ""}</span></button>
              <button type="button" class="tswap" class:turned aria-label="Αντιστροφή αφετηρίας και προορισμού" title="Αντιστροφή" onclick={swap}><Icon name="swap" size={18} /></button>
            </div>
          </div>
          <div class="tchips">
            <button type="button" class="tchip" aria-haspopup="dialog" onclick={() => (sheet = "opts")}><Icon name="clock" size={16} /><span>{capital(whenWord)}</span><span class="tcv" aria-hidden="true"><Icon name="chevron" size={14} /></span></button>
            <button type="button" class="tchip" aria-haspopup="dialog" onclick={() => (sheet = "opts")}><Icon name={meansOn.length === 1 ? meansOn[0].icon : "bus"} size={16} /><span>{capital(meansWord)}</span><span class="tcv" aria-hidden="true"><Icon name="chevron" size={14} /></span></button>
            {#if sortId !== "time"}<button type="button" class="tchip" aria-haspopup="dialog" onclick={() => (sheet = "opts")}><Icon name={sort.icon} size={16} /><span>{sort.label}</span><span class="tcv" aria-hidden="true"><Icon name="chevron" size={14} /></span></button>{/if}
          </div>
        </div>
      {:else}
        {@render brandRow()}
      {/if}
      {#if answer}
        <!-- its heading is in the band -->
      {:else if app.savingPlace}
        <h1 id="start-h" in:item={{ i: 2 }}>{app.savingPlace === "home" ? "Πού είναι το Σπίτι;" : "Πού είναι η Δουλειά;"}</h1>
      {:else if find}
        <h1 id="start-h" in:item={{ i: 2 }}>Βρες</h1>
      {:else if wide}
        <h1 id="start-h" class="hero" in:item={{ i: 2 }}>Κάθε λεωφορείο<br />{OF_CITY[app.cityId]},<br /><span>εκεί που είναι.</span></h1>
      {:else}
        <h1 id="start-h" in:item={{ i: 2 }}>Θέλω να πάω</h1>
      {/if}

      {#if answer}
        <!-- the band above holds the trip asked -->
      {:else}
      <div class="fields" class:raised={menu !== null}>
        <div class="ends" class:group={!intro && wide} class:asks={!wide && !app.savingPlace} in:item={{ i: 3, y: 12 }}>
        {#each (app.savingPlace || intro || find ? ["to"] : !wide ? ["from", "to"] : askFrom ? ["to", "from"] : ["to"]) as Field[] as f (f)}
          {#if !wide && !app.savingPlace && !find}
            {@const n = f === "from" ? 1 : 2}
            <p class="qq" class:on={f === "from" ? !ends.from.place : !!ends.from.place && !ends.to.place}><span class="qn" aria-hidden="true">{n}</span>{f === "from" ? "Από πού ξεκινάς;" : "Πού θέλεις να πας;"}</p>
          {/if}
          <div class="field end {f}" class:open={open === f} class:set={!!ends[f].place} class:swapped class:search={intro}>
            {#if intro}<label class="fs" for="start-{f}"><Icon name="search" size={20} /><span class="sr">Πού πας;</span></label>
            {:else if find}<label class="sr" for="start-{f}">Βρες γραμμή, στάση ή μέρος</label><span class="fs2" aria-hidden="true"><Icon name="search" size={19} /></span>
            {:else if wide || app.savingPlace}<span class="mk {f}" aria-hidden="true"></span><label class="fl" for="start-{f}">{f === "from" ? "Από" : "Πού"}</label>
            {:else}<label class="sr" for="start-{f}">{f === "from" ? "Από πού ξεκινάς" : "Πού θέλεις να πας"}</label>{#if ends[f].place?.kind === "me"}<span class="mearr" aria-hidden="true"><svg class="arr" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.8 10.6a.6.6 0 0 0 .05 1.12l6.6 2.03 2.03 6.6a.6.6 0 0 0 1.12.05z" fill="currentColor" /></svg></span>{:else if !ends[f].place}<span class="fs2" aria-hidden="true"><Icon name="search" size={19} /></span>{/if}{/if}
            <input id="start-{f}" bind:this={inputs[f]} value={ends[f].text} autocomplete="off" spellcheck="false"
              placeholder={find ? "Γραμμή, στάση ή μέρος" : f === "from" ? (wide ? "Από πού ξεκινάς;" : "Γράψε από πού ξεκινάς") : intro ? "Πού πας; Διεύθυνση, στάση ή γραμμή" : wide ? "Στάση, περιοχή, οδός" : "Γράψε μέρος, στάση ή γραμμή"} role="combobox" aria-expanded={open === f} aria-controls="start-{f}-list"
              onfocus={e => { open = f; menu = null; if (ends[f].place) e.currentTarget.select(); }} oninput={e => edit(f, e.currentTarget.value)}
              aria-activedescendant={open === f && active >= 0 ? `start-opt-${active}` : undefined} onkeydown={e => key(f, e)} />
            {#if ends[f].text && locating !== f && !ends[f].place}
              <button type="button" class="clear" aria-label="Καθάρισμα" title="Καθάρισμα" onclick={() => { ends[f] = { text: "", place: null }; inputs[f]?.focus(); }}><Icon name="close" size={13} /></button>
            {/if}
            {#if ends[f].place}
              {#if ends[f].place?.kind === "me" && !wide && app.myFix}<span class="melive">ζωντανά</span>{/if}
              <button type="button" class="chg" onclick={() => { ends[f] = { text: "", place: null }; inputs[f]?.focus(); }}>Αλλαγή</button>
            {:else if intro && !ends[f].text}
              <kbd class="slash" aria-hidden="true">/</kbd>
            {:else if locating === f}
              <span class="fi"><span class="spin" aria-hidden="true"></span></span>
            {/if}
          </div>
          {#if !wide && open === f}{@render list(f)}{/if}
          {#if f === "from" && !ends.from.place && !ends.from.text && open !== "from"}
            <div class="sugg" role="group" aria-label="Από πού ξεκινάς" transition:reveal>
              {#each fromChips as c, k (c.key)}
                <button type="button" class="sc" class:best={c.best} onclick={c.run} in:item={{ i: k, y: 6 }}><Icon name={c.icon} size={15} /><span>{c.label}</span></button>
              {/each}
            </div>
          {/if}
        {/each}
        {#if askFrom && !intro && !app.savingPlace && open === null && wide}
          <button type="button" class="swap" class:turned aria-label="Αντιστροφή αφετηρίας και προορισμού" title="Αντιστροφή" onclick={swap} transition:soft><Icon name="swap" size={16} /></button>
        {/if}
        </div>
        {#if open && wide}{@render list(open)}{/if}
        {#if err}<p class="err" role="status" transition:reveal>{err}</p>{/if}

        {#if !wide && !app.savingPlace && !find && !ends.to.place && open === null}
          <!-- Where most trips go: home and work as big tiles (with how long it takes now), and the last trips. -->
          <div class="mine two" data-peek="Σπίτι" data-peek-icon="home" in:item={{ i: 4, y: 12 }}>
            {#each mine as m (m.k)}
              <button type="button" class="ptile" onclick={() => goMine(m.k, m.place)}>
                <span class="pic"><Icon name={m.k} size={18} /></span>
                <span class="ptx"><b>{m.label}</b><small>{!m.place ? "Όρισέ το" : m.trip ? `${m.trip.mins} λεπτά` : m.trip === null ? "Είσαι εκεί" : m.place.label}</small></span>
              </button>
            {/each}
          </div>
          {#if recent.length}
            <p class="qh" data-peek="Πρόσφατα" data-peek-icon="clock">Πήγες πρόσφατα</p>
            <div class="rlist" in:item={{ i: 5, y: 12 }}>
              {#each recent as x (x.at)}
                <button type="button" class="rr" onclick={() => again(x)}>
                  <span class="ric"><Icon name="clock" size={17} /></span><span class="rtx">{x.to.label}{#if x.from.label !== ME}<small>από {x.from.label}</small>{/if}</span>
                  <span class="rch" aria-hidden="true"><Icon name="chevron" size={15} /></span>
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
          {#if planR.estimate}<p class="est"><Icon name="warn" size={15} /><span>Ο server των διαδρομών δεν απαντά τώρα: αυτές τις βρήκε η εφαρμογή από τις στάσεις και τις ζωντανές αφίξεις. Οι ώρες είναι κατά προσέγγιση.</span></p>{/if}
          {#if top.ignored}<p class="pvn solo">Με {meansOn.length === 1 ? meansOn[0].label.toLowerCase() : "αυτά τα μέσα"} δεν βγαίνει τώρα: αυτές είναι οι καλύτερες με όλα.</p>{/if}
          <!-- Every route as a compact card: when to leave, how long, the means, where its bus is now; a tap opens it
               step by step and makes it the one «Ξεκίνα» follows. -->
          {#if answer}<p class="rcount">{routes.length} {routes.length === 1 ? "διαδρομή" : "διαδρομές"}</p>{/if}
          <div class="cards" aria-live="polite" data-peek="Διαδρομές" data-peek-icon="route">
            {#each shownRoutes as o, k (o.key)}
              <RouteCard it={o.it} r={planR} {ix} legs={o.legs} {nowS} tag={k === 0 ? bestTag : ""} open={openKey === o.key}
                sel={best?.key === o.key && (chosen != null || openKey != null)} live={k < 3} others={allIts} logos={app.cityId === "athens"} onpick={() => pickCard(o.key)} onmap={go} />
            {/each}
          </div>
          {#if routes.length > shownRoutes.length}
            <button type="button" class="morer" onclick={() => (allShown = true)}>Δες κι άλλες {routes.length - shownRoutes.length} διαδρομές</button>
          {/if}
        {:else}
          <section class="pv" aria-live="polite" in:item={{ i: 7, y: 14 }}>
            {#if !pKey}
              <p class="pvh"><span class="pvi"><Icon name="route" size={17} /></span><span>{ends.to.place ? "Διάλεξε από πού ξεκινάς, και η καλύτερη διαδρομή εμφανίζεται εδώ αμέσως." : "Πες πού πας, και η καλύτερη διαδρομή εμφανίζεται εδώ αμέσως."}</span></p>
            {:else if waiting}
              <div class="sk" aria-label="Αναζήτηση διαδρομής"><i></i><i></i><i></i></div>
            {:else}
              <p class="pvh"><span class="pvi warn"><Icon name="warn" size={17} /></span>
                <span>{walkOnly ? `Δεν βρέθηκε μέσο ${later ? "για τότε" : "τώρα"}. Με τα πόδια: ${durText(walkOnly.duration_s / 60)}.` : `Δεν βρέθηκε διαδρομή ${later ? "για τότε" : "τώρα"}. Δοκίμασε άλλη ώρα.`}</span></p>
            {/if}
          </section>
        {/if}
      {/if}

      {#if intro}
        <div class="hintfoot"><MoreHint box={boxEl} /></div>
      {:else}
      <div class="acts">
        {#if app.savingPlace}
          <button type="button" class="link" onclick={() => { app.savingPlace = null; app.start = false; }}><span>Άκυρο</span><kbd class="pc">Esc</kbd></button>
        {:else if find}
          <p class="findnote">Γράψε τον αριθμό μιας γραμμής (π.χ. 308), μια στάση ή μια περιοχή.</p>
        {:else if answer}
          <div class="duo">
            <button type="button" class="ghost2" class:on={!!armed} disabled={!best} onclick={() => (sheet = "remind")}><Icon name="bell" size={17} /><span>{armed ? `Στις ${clockHM(Math.max(armed.leaveAt, nowS))}` : "Θύμισέ μου"}</span></button>
            <button type="button" class="primary big" disabled={!best} onclick={startNow}><span>{openKey ? "Ξεκίνα με αυτή" : "Ξεκίνα"}</span></button>
          </div>
        {:else if !wide}
          {#if ready}<button type="button" class="primary big" onclick={() => (asking = false)}><span>Δες τις διαδρομές</span></button>{/if}
          <div class="actrow">
            <button type="button" class="link" onclick={explore}><Icon name="map" size={17} /><span>Θέλω μόνο να δω τον χάρτη</span></button>
            <MoreHint box={boxEl} inline />
          </div>
        {:else}
          <button type="button" class="primary big" class:ready disabled={!ready} onclick={go} in:item={{ i: 8 }}><span>Πάμε</span></button>
          <div class="actrow">
            <button type="button" class="link" onclick={explore} in:item={{ i: 9 }}><span>Μόνο ο χάρτης</span><kbd class="pc">Esc</kbd></button>
            <MoreHint box={boxEl} inline />
          </div>
        {/if}
      </div>
      {/if}
    </div>
    {#if sheet === "opts"}
      <Sheet title="Επιλογές" onclose={() => (sheet = null)}>
        <p class="sq">Πότε φεύγεις;</p>
        <div class="seg" role="radiogroup" aria-label="Πότε φεύγεις">
          {#each WHEN as w (w.value)}<button type="button" role="radio" aria-checked={later === w.value} class:on={later === w.value} onclick={() => (later = w.value)}>{w.value === 0 ? "Τώρα" : w.value === 60 ? "Σε 1 ώρα" : `Σε ${w.value}′`}</button>{/each}
        </div>
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
  <ul class="opts" id="start-{f}-list" role="listbox" aria-label={f === "from" ? "Από" : "Πού"} transition:reveal>
    {#if ends[f].text.trim() && !ends[f].place && !opts.length && !lineHits.first.length && !lineHits.last.length && !asks.length && !muniLines.length && !muniStops.length}
      <li class="nothing" role="status">
        {#if busy}<span class="spin small" aria-hidden="true"></span>Αναζήτηση…
        {:else if ends[f].text.trim().length < 2}Γράψε λίγο ακόμα
        {:else}Δεν βρέθηκε. Δοκίμασε οδό και αριθμό, π.χ. «Πατησίων 76».{/if}
      </li>
    {/if}
    {#each rows as r, k (r.key)}
      {#if r.head}<li class="oh" role="presentation">{r.head}</li>{/if}
      <li in:item={{ i: k }}>
        <button type="button" id="start-opt-{k}" class="opt" class:quiet={r.map && !!ends[f].text.trim() && !ends[f].place} class:active={k === active} role="option"
          aria-selected={k === active} tabindex="-1" onpointerenter={() => (active = k)} onclick={() => run(f, r)}>
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
            <span class="lb" class:round={r.line.mode === "metro"} style:--c={bd.bg} style:--t={bd.fg}>{bd.text}</span>
            <span class="ot"><b>{titleCase(r.line.name)}</b><small class="lm"><Icon name={mn[1]} size={13} />{mn[0]}</small></span>
            {@const n = liveOf(r.line.id)}
            {#if n}<span class="live" in:item={{ y: 0 }}><i></i>Ζωντανά · {n}</span>
            {:else if n === 0}<span class="live off" in:item={{ y: 0 }}>Δεν κυκλοφορεί τώρα</span>{/if}
          {:else if r.muniLine}
            <span class="lb muni">{r.muniLine.ref ?? "Δ"}</span>
            <span class="ot"><b>{r.muniLine.name}</b><small>{town(r.muniLine.municipality)} · πρόγραμμα, όχι live</small></span>
          {:else if r.muniStop}
            <span class="oi"><Icon name="stop" size={17} /></span>
            <span class="ot"><b>{r.muniStop.name}</b><small>Δημοτική στάση · {town(r.muniStop.municipality)}</small></span>
          {:else if r.me}
            <span class="oi meoi"><svg class="arr" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.8 10.6a.6.6 0 0 0 .05 1.12l6.6 2.03 2.03 6.6a.6.6 0 0 0 1.12.05z" fill="currentColor" /></svg></span><span class="ot"><b>{ME}</b><small>{app.myFix ? "Ζωντανά, εδώ που είσαι τώρα" : "Εκεί που είσαι, από το κινητό σου"}</small></span>
          {:else if r.map}
            <span class="oi"><Icon name="map" size={17} /></span><span class="ot"><b>Διάλεξε στον χάρτη</b>{#if !ends[f].text.trim()}<small class="phone">Μετακίνησε τον χάρτη και πάτα «Εδώ»</small><small class="pc">Κάνε κλικ στο σημείο</small>{/if}</span>
          {:else if r.place}
            {@const p = r.place}
            {#if iconOf(p) === "stop"}<span class="oi oasa"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
            {:else}<span class="oi"><Icon name={iconOf(p)} size={17} /></span>{/if}
            <span class="ot"><b>{titleCase(p.label)}</b>
              {#if p.kind === "metro" && p.lines.length}
                <!-- A station: its lines in their colours, then what runs there (and how far, near the user). -->
                <small class="lm st">{#each p.lines as l (l)}<i class="lc" style:--c={LINE_TINT[l] ?? "#6b7280"}>{l}</i>{/each}<span>{p.hint}</span></small>
              {:else if p.hint}<small>{p.hint}</small>
              {:else if p.kind === "stop"}<small>{stopHint(p)}</small>{/if}</span>
          {/if}
        </button>
      </li>
    {/each}
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
  .qq { margin: 18px 0 8px; display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; line-height: 1; color: var(--muted); }
  .qq:first-child { margin-top: 4px; }
  .qq.on { color: var(--fg); }
  .qn { flex: none; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; line-height: 1;
    background: color-mix(in srgb, var(--fg) 12%, transparent); color: var(--fg); }
  .qq.on .qn { background: var(--pc-acc, var(--accent)); color: #fff; }
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

  .mine.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
  .ptile { min-width: 0; height: 72px; display: flex; align-items: center; gap: 12px; padding: 0 14px; border: 1px solid var(--pc-edge, var(--glass-line)); border-radius: 16px;
    background: var(--pc-surf, var(--glass-fill)); color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .ptile .pic { flex: none; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--fg) 10%, transparent); }
  .ptx { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .ptx b { font-size: 17px; font-weight: 700; line-height: 1; }
  .ptx small { font-size: 13px; color: var(--muted); line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qh { margin: 22px 0 8px; font-size: 15px; font-weight: 600; color: var(--muted); line-height: 1; }
  .rlist { border-radius: 16px; border: 1px solid var(--pc-edge, var(--glass-line)); background: var(--pc-surf, var(--glass-fill)); overflow: hidden; }
  .rr { width: 100%; min-height: 56px; display: flex; align-items: center; gap: 12px; padding: 8px 14px 8px 16px; box-sizing: border-box; border: 0; background: none; color: var(--fg);
    font: inherit; text-align: left; cursor: pointer; }
  .rr + .rr { border-top: 1px solid var(--pc-edge, var(--glass-line)); }
  .ric, .rch { flex: none; display: flex; color: var(--muted); }
  .rch { rotate: -90deg; }
  .rtx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; font-size: 17px; font-weight: 500; line-height: 1.2; }
  .rtx small { font-size: 13px; color: var(--muted); }

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
  .band { position: sticky; top: calc(10px + env(safe-area-inset-top)); z-index: 25; display: flex; flex-direction: column; gap: 16px;
    margin: -18px -6px 0; padding: 18px 14px 16px; border-radius: 30px;
    background: color-mix(in srgb, var(--fg) 9%, var(--bg)); box-shadow: 0 10px 30px rgba(0, 0, 0, .3);
    --tf-bg: color-mix(in srgb, var(--fg) 14%, var(--bg)); }
  .band .brandrow { margin: -8px 0 -4px; }
  .tends { display: flex; gap: 10px; }
  .trail { flex: none; width: 14px; display: flex; flex-direction: column; align-items: center; padding: 19px 0; box-sizing: border-box; }
  .trail i { display: block; }
  .tf { width: 12px; height: 12px; border-radius: 50%; border: 3px solid var(--pc-acc, var(--accent)); box-sizing: border-box; }
  .tl { flex: 1; width: 0; margin: 4px 0; border-left: 2px dotted color-mix(in srgb, var(--fg) 30%, transparent); }
  .tt { width: 12px; height: 12px; border-radius: 50%; background: var(--late1, #f0ae45); }
  .tfields { flex: 1; min-width: 0; position: relative; display: flex; flex-direction: column; gap: 8px; }
  .tfield { height: 50px; display: flex; align-items: center; gap: 10px; padding: 0 72px 0 14px; border: 0; border-radius: 14px; box-sizing: border-box;
    background: var(--tf-bg); color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .tfield:hover { background: color-mix(in srgb, var(--fg) 18%, var(--bg)); }
  .tk { flex: none; width: 40px; font-size: 14px; color: var(--muted); line-height: 1; }
  .tv { min-width: 0; font-size: 16px; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tswap { position: absolute; right: 18px; top: 32px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; background: color-mix(in srgb, var(--bg) 70%, #000); color: #fff; box-shadow: 0 6px 16px rgba(0, 0, 0, .35); cursor: pointer; transition: transform .3s; }
  .tswap.turned { transform: rotate(180deg); }
  .tchips { display: flex; flex-wrap: wrap; gap: 8px; padding-left: 24px; }
  .tchip { height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 0; border-radius: 12px;
    background: var(--tf-bg); color: var(--fg); font: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer; }
  .tchip > :global(svg:first-child) { color: var(--muted); }
  .tcv { display: flex; color: var(--muted); }
  .rcount { margin: 0 0 -6px; height: 20px; display: flex; align-items: center; font-size: 16px; font-weight: 700; line-height: 1; color: var(--fg); }
  .box.ans .acts { border-top: 1px solid var(--pc-edge, var(--glass-line)); margin: auto -16px -4px; padding: 12px 16px 4px; background: var(--acts-bg, var(--surface)); }
  @media (prefers-reduced-motion: reduce) { .tswap { transition: none; } }
</style>
