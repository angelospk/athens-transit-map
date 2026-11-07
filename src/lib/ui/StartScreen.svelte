<script lang="ts">
  // «Θέλω να πάω», the first screen of a visit, in a box in the middle: one sentence filled in as fields. «Πού» (with
  // «Από» under it, the user's location when the browser allows it), «Πότε», «Πώς»; under them the best route for what
  // is filled in, live, as it changes. «Πάμε» hands it all to the trip planner (the Ταξίδι tab), which opens on it. Each end is the user's
  // location, a point picked on the map, or what they type (a stop, an area, a street with its number: the stop index
  // and the geocoder). Shown at every plain visit (not a shared link), and again from «Πού πας;» on Τώρα. The same
  // box, one field only, sets «Σπίτι» and «Δουλειά» (app.savingPlace).
  import { untrack } from "svelte";
  import { centre, distM, geocode, loadTripIndex, places, savedPlaces, suggest, type Place, type TripIndex } from "../trip";
  import { titleCase } from "../nearby";
  import type { AppState, TripMode, TripPrefs } from "../state.svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import MoreHint from "./MoreHint.svelte";
  import { item, open as reveal, pop, rise, soft } from "../anim";
  import { fetchV2Lines, fetchV2Stop, fetchV2Stops, getJSON } from "../api";
  import { lineStopPoints, type StopEntry } from "../finder";
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
  let ix: TripIndex | null = null;
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
      if (!ends.to.place) setTimeout(() => inputs.to?.focus(), 60);
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
    return searchNamed(own, q, p => p.label, p => (p.kind === "metro" ? -0.4 : 0) - Math.min(0.3, p.lines.length / 40)
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
  type Row = { key: string; me?: true; map?: true; place?: Place; line?: V2Line; ask?: Ask; head?: string };
  const lineRow = (l: V2Line, head?: string): Row => ({ key: `line|${l.id}`, line: l, head });
  const rows = $derived.by((): Row[] => {
    if (!open) return [];
    if (!ends[open].text.trim())
      return [{ key: "me", me: true }, ...(app.savingPlace ? [] : savedPlaces(app.places).map(p => ({ key: p.kind!, place: p }))), { key: "map", map: true }];
    const { first, last } = lineHits;
    const places = opts.map((p, k): Row => ({ key: `${p.kind}|${p.label}|${p.pts[0].join()}`, place: p, head: k === 0 && (first.length || last.length) ? "Μέρη" : undefined }));
    const quick = asks.map((a, k): Row => ({ key: `ask|${a.kind}`, ask: a, head: k === 0 ? "Γρήγορα" : undefined }));
    if (quick.length && !first.length && places[0]) places[0].head = "Μέρη";
    return [...quick, ...first.map((l, k) => lineRow(l, k === 0 ? "Γραμμές" : undefined)), ...places,
      ...last.map((l, k) => lineRow(l, k === 0 && !first.length ? "Γραμμές" : undefined)), { key: "map", map: true }];
  });
  const MODE_NAME: Record<string, [string, IconName]> = { bus: ["Λεωφορείο", "bus"], trolley: ["Τρόλεϊ", "bus"], metro: ["Μετρό", "metro"],
    tram: ["Τραμ", "tram"], suburban: ["Προαστιακός", "suburban"] };
  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  function badge(l: V2Line) {
    const text = l.label ?? native(l.id);
    if (l.id.startsWith("oasa:")) { const c = app.lineColor(native(l.id)); return { text, bg: c.bg, fg: c.fg }; }
    return { text, bg: l.color ?? "#6b7280", fg: l.text_color ?? "#ffffff" };
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
    ends[f] = { text: titleCase(p.label), place: p };
    open = null;
    // The destination chosen: the start is asked right under it (the field appears; the cursor goes there), unless
    // the user's location is on its way there.
    const other: Field = f === "from" ? "to" : "from";
    // The start is not typed for the user: its field offers the likely ones (suggestions under it) to tap.
    if (other === "to" && !ends.to.place) setTimeout(() => inputs.to?.focus(), 80);
    else inputs[f]?.blur();
  }

  function locate(f: Field, quiet = false) {
    ends[f] = { text: ME, place: null };
    if (!quiet) open = null;
    locating = f;
    err = null;
    navigator.geolocation?.getCurrentPosition(
      p => {
        if (locating !== f) return;
        locating = null;
        choose(f, { label: ME, hint: `±${Math.round(p.coords.accuracy)} μ.`, pts: [[p.coords.latitude, p.coords.longitude]], lines: [], kind: "me" });
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
  const intro = $derived(wide && !app.savingPlace && !ends.to.place);
  const QUICK: Place[] = [
    { label: "Αεροδρόμιο", hint: "Ελ. Βενιζέλος", pts: [[37.9364, 23.9445]], lines: [], kind: "area" },
    { label: "Λιμάνι Πειραιά", hint: "Πύλες Ε1–Ε12", pts: [[37.9420, 23.6465]], lines: [], kind: "area" },
    { label: "Σύνταγμα", hint: "Κέντρο", pts: [[37.9755, 23.7348]], lines: [], kind: "area" },
    { label: "Κηφισιά", hint: "Πλατεία", pts: [[38.0740, 23.8110]], lines: [], kind: "area" },
  ];
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
    const from = intro && app.start ? (ends.from.place ? centre(ends.from.place.pts) : app.myPos) : null;
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
  const CITY: [number, number][] = [[23.63, 37.90], [23.86, 38.07]];
  const ll = (p: Place): [number, number] => { const [la, lo] = centre(p.pts); return [lo, la]; };
  let framed = "";
  $effect(() => {
    if (!wide || !app.start || app.pickFor || app.savingPlace) { framed = ""; return; }
    const a = ends.from.place, b = ends.to.place;
    const want = a && b ? JSON.stringify([centre(a.pts), centre(b.pts)]) : b ? "" : "city";
    if (!want || want === framed) return;
    framed = want;
    untrack(() => setTimeout(() => app.fitPoints(want === "city" ? CITY : [ll(a!), ll(b!)]), 80));
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
      res => {
        if (c.signal.aborted) return;
        const r = res.status === 200 ? parsePlan(res.body) : null;
        plan = { key: k, r };
        if (!r) return;
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
      () => { if (!c.signal.aborted) plan = { key: k, r: null }; }), 120);
    return () => { clearTimeout(t); c.abort(); };
  });
  const nowS = $derived(app.serverNow / 1000);
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
      key: `${it.depart_at}-${it.arrive_at}-${sortId}`, at: [it.depart_at, it.arrive_at] as [number, number],
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
    <div class="box" bind:this={boxEl} in:rise={{ y: 32, duration: 360 }}>
      <p class="brand" in:item={{ i: 1 }}><span class="logo" aria-hidden="true"><Icon name="bus" size={15} /></span>Στάσεις</p>
      {#if app.savingPlace}
        <h1 id="start-h" in:item={{ i: 2 }}>{app.savingPlace === "home" ? "Πού είναι το Σπίτι;" : "Πού είναι η Δουλειά;"}</h1>
      {:else if wide}
        <h1 id="start-h" class="hero" in:item={{ i: 2 }}>Κάθε λεωφορείο<br />της Αθήνας,<br /><span>εκεί που είναι.</span></h1>
      {:else}
        <h1 id="start-h" in:item={{ i: 2 }}>Θέλω να πάω</h1>
      {/if}

      <div class="fields" class:raised={menu !== null}>
        <div class="ends" class:group={!intro} in:item={{ i: 3, y: 12 }}>
        {#each (app.savingPlace || intro ? ["to"] : askFrom ? ["to", "from"] : ["to"]) as Field[] as f (f)}
          <div class="field end {f}" class:open={open === f} class:set={!!ends[f].place} class:swapped class:search={intro}>
            {#if intro}<label class="fs" for="start-{f}"><Icon name="search" size={20} /><span class="sr">Πού πας;</span></label>
            {:else}<span class="mk {f}" aria-hidden="true"></span><label class="fl" for="start-{f}">{f === "from" ? "Από" : "Πού"}</label>{/if}
            <input id="start-{f}" bind:this={inputs[f]} value={ends[f].text} autocomplete="off" spellcheck="false"
              placeholder={f === "from" ? "Από πού ξεκινάς;" : intro ? "Πού πας; Διεύθυνση, στάση ή γραμμή" : "Στάση, περιοχή, οδός"} role="combobox" aria-expanded={open === f} aria-controls="start-{f}-list"
              onfocus={() => { open = f; menu = null; }} oninput={e => edit(f, e.currentTarget.value)}
              aria-activedescendant={open === f && active >= 0 ? `start-opt-${active}` : undefined} onkeydown={e => key(f, e)} />
            {#if ends[f].text && locating !== f && !ends[f].place}
              <button type="button" class="clear" aria-label="Καθάρισμα" title="Καθάρισμα" onclick={() => { ends[f] = { text: "", place: null }; inputs[f]?.focus(); }}><Icon name="close" size={13} /></button>
            {/if}
            {#if ends[f].place}
              <button type="button" class="fi done" aria-label="Αλλαγή" title="Αλλαγή" onclick={() => { ends[f] = { text: "", place: null }; inputs[f]?.focus(); }}>
                {#key ends[f].place}<span class="pop"><Icon name="check" size={16} /></span>{/key}</button>
            {:else if intro && !ends[f].text}
              <kbd class="slash" aria-hidden="true">/</kbd>
            {:else if locating === f}
              <span class="fi"><span class="spin" aria-hidden="true"></span></span>
            {/if}
          </div>
          {#if f === "from" && !ends.from.place && !ends.from.text && open !== "from"}
            <div class="sugg" role="group" aria-label="Από πού ξεκινάς" transition:reveal>
              {#each fromChips as c, k (c.key)}
                <button type="button" class="sc" class:best={c.best} onclick={c.run} in:item={{ i: k, y: 6 }}><Icon name={c.icon} size={15} /><span>{c.label}</span></button>
              {/each}
            </div>
          {/if}
        {/each}
        {#if askFrom && !intro && !app.savingPlace && open === null}
          <button type="button" class="swap" class:turned aria-label="Αντιστροφή αφετηρίας και προορισμού" title="Αντιστροφή" onclick={swap} transition:soft><Icon name="swap" size={16} /></button>
        {/if}
        </div>
        {#if open}{@render list(open)}{/if}
        {#if err}<p class="err" role="status" transition:reveal>{err}</p>{/if}

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
                  <span class="fmid"><b>{titleCase(f.s.name)}</b>
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
        {:else if !app.savingPlace}
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

      {#if intro}
        {#if !favCards.length && !recent.length}
        <ul class="facts" in:item={{ i: 9 }}>
          <li><i class="g"></i>Θέσεις από τα ίδια τα οχήματα, κάθε λίγα δευτερόλεπτα</li>
          <li><i class="b"></i>Λεωφορεία, τρόλεϊ, μετρό, τραμ και προαστιακός</li>
          <li><i></i>Χωρίς λογαριασμό: ανοίγεις και βλέπεις</li>
        </ul>
        {/if}
      {:else if !app.savingPlace}
        <section class="pv" class:live={!!top && best === top} class:off={!!top && best !== top} aria-live="polite" in:item={{ i: 7, y: 14 }}>
          {#if !pKey}
            <p class="pvh"><span class="pvi"><Icon name="route" size={17} /></span><span>{ends.to.place ? "Διάλεξε από πού ξεκινάς, και η καλύτερη διαδρομή εμφανίζεται εδώ αμέσως." : "Πες πού πας, και η καλύτερη διαδρομή εμφανίζεται εδώ αμέσως."}</span></p>
          {:else if waiting}
            <div class="sk" aria-label="Αναζήτηση διαδρομής"><i></i><i></i><i></i></div>
          {:else if top}
            {#key top.key}
              <!-- The best by «Πώς»: green while it is the one «Πάμε» opens; another picked below, it steps back (a tap
                   picks it again). -->
              <button type="button" class="pvb" aria-pressed={best === top} onclick={() => (chosen = null)} in:item={{ y: 10 }}>
                <span class="pvt">
                  <span>{sortId === "price" ? `Η φθηνότερη · ${top.metric}` : sortId === "dist" ? `Η πιο σύντομη · ${top.metric}` : later ? `Η καλύτερη σε ${later}′` : "Η καλύτερη τώρα"}</span>
                  <span class="leave"><i></i>{top.leaveIn === 0 ? "Φύγε τώρα" : `Φύγε σε ${top.leaveIn}′`}</span>
                </span>
                <span class="pvm"><b>{top.depart} → {top.arrive}</b><b class="dur">{durText(top.mins)}</b></span>
                <span class="legs">
                  {#each top.legs as l, k (k)}
                    <span class="leg" class:walk={l.walk} style:--lb={l.color || undefined} style:--lt={l.text || undefined} in:item={{ i: k, y: 6 }}>{l.walk ? `Πόδια ${l.label}` : l.label}</span>
                  {/each}
                </span>
                {#if top.ignored}<span class="pvn">Με {meansOn.length === 1 ? meansOn[0].label.toLowerCase() : "αυτά τα μέσα"} δεν βγαίνει τώρα: αυτή είναι η καλύτερη με όλα.</span>{/if}
              </button>
            {/key}
          {:else}
            <p class="pvh"><span class="pvi warn"><Icon name="warn" size={17} /></span>
              <span>{walkOnly ? `Δεν βρέθηκε μέσο ${later ? "για τότε" : "τώρα"}. Με τα πόδια: ${durText(walkOnly.duration_s / 60)}.` : `Δεν βρέθηκε διαδρομή ${later ? "για τότε" : "τώρα"}. Δοκίμασε άλλη ώρα.`}</span></p>
          {/if}
        </section>
        {#if best && others.length}
          <!-- Every other option, each its own card, stacked under the chosen one: each a little smaller and fainter than
               the one above, they settle into place as the panel scrolls; a tap makes one the route «Πάμε» opens. -->
          <p class="alth" data-peek="Άλλες διαδρομές · {others.length}" data-peek-icon="route">Άλλες διαδρομές · {others.length}</p>
          <ul class="alts" use:stack>
            {#each others as o, k (o.key)}
              {@const sel = best?.key === o.key}
              <li style:z-index={others.length - k} class:sel>
                <button type="button" class="alt" class:sel aria-pressed={sel} onclick={() => (chosen = sel ? null : o.key)} aria-label="Διάλεξε τη διαδρομή {o.depart} – {o.arrive}">
                  {#if sel}<span class="seltag" in:item={{ y: 4 }}><Icon name="check" size={13} />Η επιλογή σου</span>{/if}
                  <span class="am"><b>{o.depart} → {o.arrive}</b><b class="dur">{durText(o.mins)}</b></span>
                  <span class="legs">{#each o.legs as l, j (j)}<span class="leg" class:walk={l.walk} style:--lb={l.color || undefined} style:--lt={l.text || undefined}>{l.walk ? `Πόδια ${l.label}` : l.label}</span>{/each}</span>
                  <span class="al">{o.leaveIn === 0 ? "Φύγε τώρα" : `Φύγε σε ${o.leaveIn}′`}{o.transfers ? ` · ${o.transfers} ${o.transfers === 1 ? "αλλαγή" : "αλλαγές"}` : " · χωρίς αλλαγή"}{o.metric ? ` · ${o.metric}` : ""}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      {#if intro}
        <div class="hintfoot"><MoreHint box={boxEl} /></div>
      {:else}
      <div class="acts">
        {#if app.savingPlace}
          <button type="button" class="link" onclick={() => { app.savingPlace = null; app.start = false; }}><span>Άκυρο</span><kbd class="pc">Esc</kbd></button>
        {:else}
          <button type="button" class="primary big" class:ready disabled={!ready} onclick={go} in:item={{ i: 8 }}><span>Πάμε</span><span class="fwd"><Icon name="chevron" size={18} /></span></button>
          <div class="actrow">
            <button type="button" class="link" onclick={explore} in:item={{ i: 9 }}><span>Μόνο ο χάρτης</span><kbd class="pc">Esc</kbd></button>
            <MoreHint box={boxEl} inline />
          </div>
        {/if}
      </div>
      {/if}
    </div>
  </div>
{/if}

{#snippet list(f: Field)}
  <ul class="opts" id="start-{f}-list" role="listbox" aria-label={f === "from" ? "Από" : "Πού"} transition:reveal>
    {#if ends[f].text.trim() && !opts.length && !lineHits.first.length && !lineHits.last.length && !asks.length}
      <li class="nothing" role="status">
        {#if busy}<span class="spin small" aria-hidden="true"></span>Αναζήτηση…
        {:else if ends[f].text.trim().length < 2}Γράψε λίγο ακόμα
        {:else}Δεν βρέθηκε. Δοκίμασε οδό και αριθμό, π.χ. «Πατησίων 76».{/if}
      </li>
    {/if}
    {#each rows as r, k (r.key)}
      {#if r.head}<li class="oh" role="presentation">{r.head}</li>{/if}
      <li in:item={{ i: k }}>
        <button type="button" id="start-opt-{k}" class="opt" class:quiet={r.map && !!ends[f].text.trim()} class:active={k === active} role="option"
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
          {:else if r.me}
            <span class="oi"><Icon name="locate" size={17} /></span><span class="ot"><b>{ME}</b><small>Από την τοποθεσία της συσκευής σου</small></span>
          {:else if r.map}
            <span class="oi"><Icon name="map" size={17} /></span><span class="ot"><b>Διάλεξε στον χάρτη</b>{#if !ends[f].text.trim()}<small class="phone">Μετακίνησε τον χάρτη και πάτα «Εδώ»</small><small class="pc">Κάνε κλικ στο σημείο</small>{/if}</span>
          {:else if r.place}
            {@const p = r.place}
            {#if iconOf(p) === "stop"}<span class="oi oasa"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
            {:else}<span class="oi"><Icon name={iconOf(p)} size={17} /></span>{/if}
            <span class="ot"><b>{titleCase(p.label)}</b>{#if p.hint}<small>{p.hint}</small>{/if}</span>
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
  .alts { position: relative; z-index: 0; }
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
  button.fi:hover { background: color-mix(in srgb, var(--accent) 26%, transparent); }
  button.fi:active { transform: scale(.92); }
  .fi.done { background: var(--accent); color: var(--on-accent); }
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
  .pv.live { border-color: color-mix(in srgb, var(--ontime) 35%, var(--glass-line)); }
  .pvh { margin: 0; display: flex; align-items: center; gap: 12px; font-size: 14px; line-height: 1.4; color: var(--muted); }
  .pvi { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--control); color: var(--muted); }
  .pvi.warn { background: var(--warn-bg); color: var(--warn-fg); }
  .pvb { display: flex; flex-direction: column; gap: 12px; }
  .pvt { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 700; line-height: 1; color: var(--muted); }
  .leave { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 800; color: var(--ontime); }
  .leave i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: beat 1.8s ease-in-out infinite; }
  @keyframes beat { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--ontime) 22%, transparent); } }
  .pvm { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .pvm b { font-size: 26px; font-weight: 900; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
  .pvm .dur { font-size: 22px; font-weight: 800; }
  .legs { display: flex; flex-wrap: wrap; gap: 6px; }
  .leg { height: 26px; display: inline-flex; align-items: center; padding: 0 8px; border-radius: 7px; background: var(--lb, var(--accent)); color: var(--lt, #fff);
    font-size: 12px; font-weight: 800; line-height: 1; }
  .leg.walk { background: var(--control); color: var(--muted); }
  .pvn { margin: 0; font-size: 12px; line-height: 1.4; color: var(--warn-fg); }
  /* The other options: a card each, stacked under the chosen one, each smaller and fainter than the one above.
     Where the browser has scroll-driven animations, a card still below sits tucked under the one above it and
     settles into place as it scrolls into view. */
  .alth { margin: 4px 0 -8px 4px; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); line-height: 1; }
  .alts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .alts li { --v: 0; position: relative; transform-origin: 50% 0; opacity: calc(.3 + var(--v) * .7);
    transform: translateY(calc((1 - var(--v)) * -26px)) scale(calc(.9 + var(--v) * .1)); transition: opacity .12s linear, transform .12s linear; will-change: transform; }
  .alts li.sel { opacity: 1; transform: none; }
  .alt { width: 100%; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; box-sizing: border-box; border: 1px solid var(--glass-line);
    border-radius: 18px; background: var(--glass-fill); color: var(--fg); font: inherit; text-align: left; cursor: pointer; opacity: .78;
    box-shadow: 0 6px 18px rgba(0, 0, 0, .08); transition: opacity .18s, border-color .18s, background-color .18s; }
  .alt:hover, .alt:focus-visible { opacity: 1; border-color: color-mix(in srgb, var(--accent) 40%, var(--glass-line)); outline: none; }
  /* Picked: green, as the best one is while it is the one «Πάμε» opens. */
  .alt.sel { opacity: 1; border-color: color-mix(in srgb, var(--ontime) 55%, transparent); background: color-mix(in srgb, var(--ontime) 9%, var(--glass-fill)); }
  .alt.sel .am b { color: var(--ontime); }
  .seltag { align-self: flex-start; height: 22px; display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; border-radius: 11px;
    background: var(--ontime); color: #fff; font-size: 11px; font-weight: 800; line-height: 1; }
  .am { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .am b { font-size: 18px; font-weight: 800; letter-spacing: -.02em; line-height: 1; font-variant-numeric: tabular-nums; }
  .am .dur { font-size: 16px; }
  .alt .leg { height: 22px; font-size: 11px; }
  .al { font-size: 12px; line-height: 1.2; color: var(--muted); }
  /* The best one, as a button: plain while it is the pick; another picked, it steps back. */
  .pvb { width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .pvb:focus-visible { outline: 2px solid var(--accent); outline-offset: 6px; border-radius: 12px; }
  .pvn { display: block; }
  .pv { transition: opacity .2s, border-color .3s; }
  .pv.off { opacity: .55; }
  .pv.off:hover { opacity: .85; }
  .pv.off .leave { color: var(--muted); }
  .pv.off .leave i { animation: none; }
  @media (prefers-reduced-motion: reduce) { .alt, .alts li { transition: none; } }
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
  .primary.big { height: 58px; font-size: 17px; font-weight: 800; }
  .primary.ready { box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 35%, transparent); animation: breathe 2.4s ease-in-out infinite; }
  @keyframes breathe { 50% { box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 55%, transparent); } }
  .primary:disabled { background: var(--glass-fill); color: var(--muted); cursor: default; box-shadow: none; }
  .primary:not(:disabled):active { transform: scale(.97); }
  .fwd { display: flex; rotate: -90deg; }
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
    .pop, .field.swapped input, .drop, .shadow, .primary.ready, .leave i, .sk i { animation: none; }
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
</style>
