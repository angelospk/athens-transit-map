<script lang="ts" module>
  import type { Place } from "../trip";

  // Kept across close and reopen.
  interface End { text: string; place: Place | null }
  const memo = { from: { text: "", place: null } as End, to: { text: "", place: null } as End, radius: 500, applied: "", plan: null as { key: string; at: string } | null };
</script>

<script lang="ts">
  import { tick, untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { settleSnap, sheetDrag, type SheetDrag } from "../sheetDrag";
  import { slide } from "svelte/transition";
  import { fetchLines, fetchLineStatic, getJSON } from "../api";
  import { bestSlice, matchRoads, sensibleWalk, sliceShape, stationsAlong, stopsBetween, type Mid } from "../planShape";
  import { snapStop } from "../stopSnap";
  import { smoothLine } from "../map/layers";
  import { API_BASE } from "../config";
  import { PLAN_RETRY_MS, parsePlan, planFC, planLabels, planRetry, planSteps, planSummary, planUrl, RISK_MIN, scaledLegs, tightestChange, type Itinerary, type PlanResponse } from "../plan";
  import Dropdown from "./Dropdown.svelte";
  import { checkLive, liveCount } from "../liveLines";
  import { euro, tripFare } from "../fares";
  import { withMetro } from "../metroBridge";
  import { MAX_LINES } from "../selection";
  import type { AppState, TripMode } from "../state.svelte";
  import AlertForm from "./AlertForm.svelte";
  import Bell from "./Bell.svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import { item } from "../anim";
  import { distText, titleCase } from "../nearby";
  import { fetchFoot, guideFromPlan, guideFromTrip, guideFromXfer } from "../guide";
  import { savedPlaces } from "../trip";
  import { clockHM } from "../trains";
  import { durText } from "../format";
  import { placeNote, toward } from "../stops";
  import { alertTargets, anyMetro, boardings, centre, distM, findTransfers, findTrips, geocode, legTrip, loadTripIndex, metroDirect, metroPlaces, nearestStation, places, searchPlaces,
    staleIndex, suggest, termini, toggleTripLine, type Pt, type TripIndex, type TripLine, type TripTransfer } from "../trip";

  let { app, onclose }: { app: AppState; onclose: () => void } = $props();

  type Field = "from" | "to";
  const FIELDS = ["from", "to"] as const;
  const RADII = [300, 500, 800, 1000, 1200, 1500];
  const ME = "Η θέση μου";
  const phone = () => matchMedia("(max-width: 719px)").matches;

  let ends = $state.raw<Record<Field, End>>({ from: memo.from, to: memo.to });
  let radius = $state(memo.radius);
  let data = $state.raw<{ ix: TripIndex; places: Place[]; known: Set<string>; stale: string | null } | null>(null);
  let failed = $state(false);
  let folded = $state(false);
  let openField = $state<Field | null>(null);
  let activeKey = $state<string | null>(null);
  // Geocoder answers for the open field's text, and the request in flight (one per field).
  let geo = $state.raw<{ text: string; places: Place[] } | null>(null);
  let geoBusy = $state(false);
  let locating = $state<Field | null>(null);
  let err = $state<string | null>(null);
  const inputs: Record<Field, HTMLInputElement | undefined> = { from: undefined, to: undefined };
  let ctl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gen = 0;   // geocoder answers to an older edit are dropped
  const locGen = { from: 0, to: 0 };   // the same for each field's location request
  let closed = false;

  $effect(() => { memo.from = ends.from; memo.to = ends.to; memo.radius = radius; });
  $effect(() => () => { ctl?.abort(); clearTimeout(timer); gen++; locGen.from++; locGen.to++; closed = true; });

  async function load() {
    failed = false;
    app.loadMetro();   // stations to start or end at (once; again after a failure)
    try {
      const [ix, lines] = await Promise.all([loadTripIndex(), fetchLines()]);
      data = { ix, places: places(ix), known: new Set(lines.lines.map(l => l.id)), stale: staleIndex(ix.v, lines.gtfs_version) ? ix.v : null };
    } catch {
      failed = true;
    }
  }
  load();

  // Suggestions: my location for an empty field (and, for the end, the nearest metro station); else one
  // short list (areas, stations and stops, streets, shops).
  type Opt = { key: string; me?: true; place?: Place };
  const keyOf = (p: Place) => `${p.kind}|${p.label}|${p.pts[0].join()}`;
  const stations = $derived(app.metro ? metroPlaces(app.metro) : []);
  const anyM = $derived(app.metro ? anyMetro(app.metro) : null);
  const opts = $derived.by((): Opt[] => {
    if (!openField) return [];
    const text = ends[openField].text.trim();
    if (!text || text === ME || text === anyM?.label)
      return [{ key: "me", me: true }, ...savedPlaces(app.places).map(place => ({ key: keyOf(place), place })),
        ...(openField === "to" && anyM ? [{ key: keyOf(anyM), place: anyM }] : [])];
    const own = data ? searchPlaces([...stations, ...data.places], text, 6) : [];
    return suggest(own, geo?.text === text ? geo.places : []).map(place => ({ key: keyOf(place), place }));
  });
  const active = $derived(Math.max(0, opts.findIndex(o => o.key === activeKey)));

  function stopSearch() {
    gen++;
    ctl?.abort();
    clearTimeout(timer);
    geoBusy = false;
  }

  // Typing forgets the chosen place and asks the geocoder after a pause.
  function edit(f: Field, text: string) {
    stopSearch();
    locGen[f]++;
    if (locating === f) locating = null;
    ends = { ...ends, [f]: { text, place: null } };
    openField = f;
    activeKey = null;
    err = null;
    const q = text.trim();
    if (q.length < 3) return;
    const g = gen;
    const other = ends[f === "from" ? "to" : "from"].place;
    const near = other && other.kind !== "metro-any" ? centre(other.pts) : app.myPos ?? app.mapCenter ?? undefined;   // the nearest shop of a chain
    geoBusy = true;
    timer = setTimeout(() => {
      ctl = new AbortController();
      geocode(q, ctl.signal, near).then(
        r => { if (g === gen) geo = { text: q, places: r }; },
        () => {},   // offline or busy: the stops still answer
      ).finally(() => { if (g === gen) geoBusy = false; });
    }, 350);
  }

  function choose(f: Field, o: Opt) {
    stopSearch();
    openField = null;
    if (o.me) return locate(f);
    ends = { ...ends, [f]: { text: titleCase(o.place!.label), place: o.place! } };
    next(f);
  }

  // After a choice: on to the other field while it is empty, else close the keyboard.
  function next(f: Field) {
    const other: Field = f === "from" ? "to" : "from";
    if (!ends[other].place && !ends[other].text.trim()) inputs[other]?.focus();
    else inputs[f]?.blur();
  }

  // «Πού πας;» (StartScreen) hands over what the user asked for with the ends: which means, what matters most, when
  // they leave, how far they walk. The best option by those opens on its own (autoOpen) as soon as the options come.
  const MODE_OF: Record<string, TripMode> = { bus: "bus", trolley: "trolley", metro: "metro", tram: "tram" };
  let modes = $state.raw<TripMode[] | null>(null);
  let autoOpen = $state(false);
  let wantPick: [number, number] | null = null;   // the option «Πού πας;» showed chosen: opened first
  $effect(() => {
    const p = app.tripPrefs;
    if (!p) return;
    untrack(() => {
      app.tripPrefs = null;
      modes = p.modes.length === 4 ? null : p.modes;
      order = p.order;
      later = p.later;
      radius = RADII.includes(p.radius) ? p.radius : radius;
      autoOpen = true;
      wantPick = p.pick ?? null;
      folded = false;
    });
  });

  // A stop card's «Ταξίδι από εδώ» (app.tripFrom) is the start; the end is asked for next.
  $effect(() => {
    const p = app.tripFrom;
    if (!p) return;
    untrack(() => {
      app.tripFrom = null;
      stopSearch();
      openField = null;
      locGen.from++;
      if (locating === "from") locating = null;
      ends = { ...ends, from: { text: titleCase(p.label), place: p } };
      next("from");
    });
  });
  // A place from the search modal (app.tripTo) is the end; the start is asked for next.
  $effect(() => {
    const p = app.tripTo;
    if (!p) return;
    untrack(() => {
      app.tripTo = null;
      stopSearch();
      openField = null;
      locGen.to++;
      if (locating === "to") locating = null;
      ends = { ...ends, to: { text: titleCase(p.label), place: p } };
      next("to");
    });
  });

  function locate(f: Field) {
    const g = ++locGen[f];
    ends = { ...ends, [f]: { text: ME, place: null } };
    locating = f;
    navigator.geolocation.getCurrentPosition(
      p => {
        if (g !== locGen[f]) return;
        locating = null;
        const place: Place = { label: ME, hint: `±${Math.round(p.coords.accuracy)} μ.`, pts: [[p.coords.latitude, p.coords.longitude]], lines: [], kind: "me" };
        ends = { ...ends, [f]: { text: ME, place } };
        next(f);
      },
      e => {
        if (g !== locGen[f]) return;
        locating = null;
        ends = { ...ends, [f]: { text: "", place: null } };
        err = e.code === 1 ? "Ο browser δεν επιτρέπει πρόσβαση στην τοποθεσία." : "Δεν βρέθηκε η τοποθεσία σου. Δοκίμασε ξανά ή γράψε μια περιοχή.";
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  let turned = $state(false);
  function swap() {
    turned = !turned;
    stopSearch();
    locGen.from++; locGen.to++;
    locating = null;
    ends = { from: ends.to, to: ends.from };
  }

  // Both ends set: the lines, applied to the map at once (a new trip replaces the picks).
  const from = $derived(ends.from.place), to = $derived(ends.to.place);
  const tooClose = $derived(!!from && !!to && Math.min(...from.pts.flatMap(a => to.pts.map(b => distM(a, b)))) < radius);
  const trips = $derived(data && from && to && !tooClose ? findTrips(data.ix, from.pts, to.pts, radius, data.known) : null);
  // With one change: when no line goes without, or a change saves 10 minutes.
  const xfers = $derived.by((): TripTransfer[] => {
    if (!data || !from || !to || !trips) return [];
    const best = trips[0]?.min ?? Infinity;
    return findTransfers(data.ix, from.pts, to.pts, radius, data.known).filter(x => x.min + 10 < best);
  });

  // The metro station of a stop ("any metro station" as the end), and where it is.
  const ptOf = (k: number): Pt => [data!.ix.s[k][1], data!.ix.s[k][2]];
  const stationAt = (p: Pt) => {
    const st = app.metro && nearestStation(app.metro, p);
    const s = st && app.metro!.stations.find(x => x.name === st.name && x.lines.some(l => l.startsWith("M")));
    return s ? { name: s.name, d: st.d, pt: [s.lat, s.lon] as Pt } : null;
  };
  const anyEnd = $derived(to?.kind === "metro-any");
  const walkTo = $derived(anyEnd && from ? stationAt(centre(from.pts)) : null);
  // Both ends near one metro or tram line: said before the buses.
  const byMetro = $derived(app.metro && from && to && !anyEnd && !tooClose ? metroDirect(app.metro, from.pts, to.pts, radius) : null);

  // A and B on the map whenever both ends are set (again after a reopen); "any metro station" is the
  // station of the best trip.
  const toPt = $derived.by((): Pt | null => {
    if (!to) return null;
    if (!anyEnd) return centre(to.pts);
    const t = trips?.find(x => x.line === picked) ?? trips?.[0], x = xfers.find(y => xkey(y) === picked);
    const k = x ? x.legs[1].to : t?.variants[0].to ?? xfers[0]?.legs[1].to;
    return k == null || !data ? null : stationAt(ptOf(k))?.pt ?? null;
  });
  $effect(() => { app.tripEnds = from && toPt ? { from: centre(from.pts), to: toPt } : null; });

  // Timed trips from the backend (/v2/plan), above the lines: asked once per pair of ends, and again when every
  // option has left. When the backend fails or is busy, only the lines below show.
  let plan = $state.raw<{ key: string; r: PlanResponse } | null>(null);
  let planGen = $state(0);
  let planTry = { key: "", n: 0 };   // retries of a failed request for these ends (not reactive)
  // The timed trip on the map (its ends and departure), kept across close and reopen like the ends.
  let planSel = $state.raw(memo.plan);
  $effect(() => { memo.plan = planSel; });
  // «Φεύγω τώρα ▾»: the options from a later minute on (minutes from now), and how they are ordered.
  let later = $state(0);
  let order = $state<"time" | "walk" | "changes">("time");
  const LATER = [{ value: 0, label: "Φεύγω τώρα" }, { value: 15, label: "Φεύγω σε 15′" }, { value: 30, label: "Φεύγω σε 30′" }, { value: 60, label: "Φεύγω σε 1 ώρα" }] as const;
  const planKey = $derived(from && to && !anyEnd && !tooClose ? JSON.stringify([centre(from.pts), centre(to.pts), later]) : null);
  function dropPlan() {
    if (app.tripPlan) { app.tripPlan = null; app.tripStops = []; }
    app.planLabels = [];
    planSel = null;
    review = false;
  }
  // «Οδηγίες»: the picked option on its own, step by step (the mockup «Η διαδρομή στον χάρτη»); off: the list.
  let review = $state(false);
  // A phone, a trip's details open: a sheet at the foot with a handle (Panel.svelte draws it from the page's root):
  // «peek» shows the options and «Ξεκίνα» over a big map, «half» the details too, «full» all of it. Dragged by the
  // handle (or the header), it follows the finger and settles at the nearest; a tap on the handle steps it.
  const narrow = new MediaQuery("(max-width: 719px)");
  type Snap = "peek" | "half" | "full";
  let snap = $state<Snap>("half");
  let rvTopEl = $state<HTMLElement>(), rvFootEl = $state<HTMLElement>();
  let topH = $state(0), footH = $state(0);
  const sheetOn = $derived(narrow.current && review);
  $effect(() => {
    const root = document.documentElement;
    if (!sheetOn) return;
    root.dataset.tripsheet = snap;
    root.style.setProperty("--trip-peek", `${Math.round(topH + footH + 18)}px`);
    return () => { delete root.dataset.tripsheet; root.style.removeProperty("--trip-peek"); };
  });
  $effect(() => { if (!review) snap = "half"; });
  // Each new height frames the trip again, above the sheet, once it has settled.
  let snapped = "";
  $effect(() => {
    const k = sheetOn ? snap : "";
    if (!k || k === snapped) { snapped = k; return; }
    snapped = k;
    const t = setTimeout(() => untrack(() => { if (fitPts.length) app.fitPoints(fitPts); }), 280);
    return () => clearTimeout(t);
  });
  const sheetEl = () => rvTopEl?.closest<HTMLElement>(".popwrap");
  function snapsPx(): Record<Snap, number> {
    const cs = getComputedStyle(document.documentElement);
    const peek = parseFloat(cs.getPropertyValue("--trip-peek")) || 200;
    return { peek, half: innerHeight * 0.52, full: innerHeight - 24 };
  }
  // The handle and the header drag the sheet (sheetDrag.ts: touch events, so iOS does not scroll instead); their
  // buttons keep their taps. Off a phone nothing is dragged.
  let dragH0 = 0;
  const clampH = (h: number) => { const s = snapsPx(); return Math.max(s.peek * 0.8, Math.min(s.full, h)); };
  const stepSnap = () => { snap = snap === "peek" ? "half" : snap === "half" ? "full" : "peek"; };
  const tripDrag = $derived<SheetDrag>({
    ignore: sheetOn ? "button:not(.grip)" : "*",
    start: () => { dragH0 = sheetEl()?.offsetHeight ?? 0; },
    move: dy => {
      const root = document.documentElement;
      root.style.setProperty("--trip-drag", `${clampH(dragH0 - dy)}px`);
      root.dataset.tripdrag = "";
    },
    end: (dy, v) => {
      const root = document.documentElement;
      delete root.dataset.tripdrag;
      root.style.removeProperty("--trip-drag");
      snap = settleSnap<Snap>(["peek", "half", "full"], snap, clampH(dragH0 - dy), snapsPx(), v, "up", dy);
    },
    tap: stepSnap,
  });
  let fareOpen = $state(false), mapOpen = $state(false);   // the ticket and the map rows: closed until a change
  let bodyEl: HTMLElement | undefined = $state();
  $effect(() => { void review; bodyEl?.scrollTo({ top: 0 }); });
  $effect(() => {
    const key = planKey;
    void planGen;
    untrack(() => {
      if (planSel && planSel.key !== key) dropPlan();   // new ends: the old trip goes
      if (plan?.key !== key) plan = null;
    });
    if (!key) return;
    const [a, b, off] = JSON.parse(key) as [Pt, Pt, number];
    const ctl = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    if (planTry.key !== key) planTry = { key, n: 0 };
    const after = off ? untrack(() => app.serverNow) / 1000 + off * 60 : undefined;
    const ask = (f: Pt, t: Pt, at?: number) => getJSON(planUrl(API_BASE, f, t, at, 5), ctl.signal).then(x => (x.status === 200 ? parsePlan(x.body) : null), () => null);
    getJSON(planUrl(API_BASE, a, b, after, 5), ctl.signal).then(res => {
      if (ctl.signal.aborted) return;
      const r = res.status === 200 ? parsePlan(res.body) : null;
      if (!r) {
        // Opened offline, or the server was busy: asked again a little later (the lines below show meanwhile).
        if (planRetry(res.status, planTry.n)) retry = setTimeout(() => { planTry.n++; planGen++; }, PLAN_RETRY_MS);
        return;
      }
      plan = { key, r };
      // A metro option, when the server gave none (metroBridge.ts): added to the list once it is known.
      void withMetro(r, a, b, after, untrack(() => app.serverNow) / 1000, ask).then(m => {
        if (m !== r && !ctl.signal.aborted && plan?.key === key) plan = { key, r: m };
      }, () => {});
    }, () => {});
    return () => { ctl.abort(); clearTimeout(retry); };
  });
  const nowS = $derived(app.serverNow / 1000);
  // One option per departure, arrival and changes (CONTRACT §9 returns no two alike).
  const itKey = (it: Itinerary) => `${it.depart_at}-${it.arrive_at}-${it.transfers}`;
  // Options that left over a minute ago are dropped; with none left, a list asked for long ago is asked again.
  // An itinerary that rides a means the user left out (StartScreen) is kept back, unless that leaves nothing.
  const allowed = (it: Itinerary) => !modes || it.legs.every(l => l.kind !== "ride" || modes!.includes(MODE_OF[l.mode ?? plan?.r.lines[l.line ?? ""]?.mode ?? "bus"] ?? "bus"));
  // The lines of the options, running now or not (liveLines.ts): «Όλη η πόλη στον χάρτη» says how many are on the road.
  let liveTick = $state(0);
  $effect(() => {
    if (!review || !plan) return;
    const ids = [...new Set(planRows.slice(0, 4).flatMap(q => q.it.legs.flatMap(l => l.kind === "ride" && l.line ? [l.line] : [])))];
    if (ids.length) checkLive(ids, () => liveTick++);
  });
  function liveSum(ids: string[]): number | null {
    void liveTick;
    let n = 0;
    for (const id of ids) { const c = liveCount(id); if (c == null) return null; n += c; }
    return n;
  }
  const planRows = $derived.by(() => {
    if (!plan) return [];
    const all = plan.r.itineraries.filter(it => it.depart_at > nowS - 60), fit = all.filter(allowed);
    const its = fit.length ? fit : all;
    const rows = its.map(it => ({ at: itKey(it), it, legs: scaledLegs(it, plan!.r), tight: tightestChange(it, plan!.r), ...planSummary(it, plan!.r, nowS) }));
    const by = order === "walk" ? (a: typeof rows[0], b: typeof rows[0]) => a.walk_m - b.walk_m
      : order === "changes" ? (a: typeof rows[0], b: typeof rows[0]) => a.transfers - b.transfers || a.it.arrive_at - b.it.arrive_at
      : (a: typeof rows[0], b: typeof rows[0]) => a.it.arrive_at - b.it.arrive_at;
    return rows.sort(by);
  });
  // The line under an option: the change that is likely missed, else when to leave, else what is known about it.
  function planNote(p: (typeof planRows)[number]): { text: string; tone: "ok" | "bad" | "muted" } {
    if (p.tight != null && p.tight < RISK_MIN) {
      // To the metro: a train comes every few minutes, so a tight change costs little.
      const ch = planSteps(p.it, plan!.r).filter(x => x.kind === "change").sort((x, y) => x.spare - y.spare)[0];
      if (ch?.kind === "change" && ch.mode === "metro") return { text: `Στενή αλλαγή για το ${ch.label}: αν το χάσεις, παίρνεις το επόμενο`, tone: "muted" };
      if (p.tight < 0) return { text: "Η αλλαγή θέλει περισσότερο απ' όσο έχεις: μάλλον χάνεται", tone: "bad" };
    }
    if (p.tight != null && p.tight < RISK_MIN) return { text: `Μόνο ${Math.max(0, Math.round(p.tight))}′ για την αλλαγή: συχνά χάνεται`, tone: "bad" };
    const ride = p.rides[0], leg = p.it.legs.find(l => l.kind === "ride");
    if (ride && leg) return { text: `${ride.label} από ${titleCase(ride.from)} στις ${clockHM(leg.depart_at)}${p.tight != null ? ` · ${Math.round(p.tight)}′ περιθώριο στην αλλαγή` : ""}`, tone: p.leaveIn <= 60 ? "ok" : "muted" };
    return { text: `Με τα πόδια · ${metres(p.walk_m)}`, tone: "muted" };
  }
  $effect(() => {
    if (plan && !planRows.length && plan.r.itineraries.length && plan.r.after < nowS - 60) untrack(() => { plan = null; planGen++; });   // one request, not one a second
  });
  // The key of the timed trip on the map; null once a line replaced it (app.showTrip clears app.tripPlan).
  const planOn = $derived(app.tripPlan && planSel && planSel.key === planKey ? planSel.at : null);
  // Whether the options shown had to ignore the means asked for (none fits): said under them.
  const modesIgnored = $derived(!!modes && !!plan && plan.r.itineraries.some(it => it.depart_at > nowS - 60) && !plan.r.itineraries.some(it => it.depart_at > nowS - 60 && allowed(it)));
  // From «Πού πας;»: the first option by what matters most opens on its own, straight on its details.
  $effect(() => {
    if (!autoOpen || !planRows.length) return;
    const w = wantPick;
    const first = (w && planRows.find(r => r.it.depart_at === w[0] && r.it.arrive_at === w[1])) || planRows[0];
    wantPick = null;
    // Framed again once the details are open (on a phone they take the foot of the screen).
    untrack(() => { autoOpen = false; pickPlan(first.at); review = true; tick().then(() => setTimeout(() => app.fitPoints(fitPts), 60)); });
  });
  $effect(() => { if (autoOpen && plan && !plan.r.itineraries.length) untrack(() => (autoOpen = false)); });   // nothing timed: the lines below
  const planShown = $derived.by(() => {
    const it = planOn == null ? null : plan?.r.itineraries.find(x => itKey(x) === planOn);
    return it && plan ? planSummary(it, plan.r, nowS) : null;
  });
  // A tap on an option picks it: on the map alone, with its words (planLabels); the panel stays as it is.
  let fitPts: [number, number][] = [];
  function pickPlan(at: string) {
    const r = plan!.r, it = r.itineraries.find(x => itKey(x) === at)!, fc = planFC(it, r);
    app.showPlan(fc);
    app.tripStops = [];   // the labels name the stops
    app.planLabels = planLabels(it, r, titleCase(to?.label ?? "Προορισμός"));
    planSel = { key: plan!.key, at };
    picked = null;
    fitPts = fc.features.flatMap(f => f.geometry.coordinates as [number, number][]);
    app.fitPoints(fitPts);
    void onItsWay(it, r, at);
  }
  // The plan's shapes go stop to stop in straight lines (across parks and blocks): once picked, each leg is drawn on
  // its real way, as soon as it is known: a bus ride on its line's shape, a metro or tram ride on its track, a walk
  // along the streets (the foot router); its corners rounded. A leg with none of these keeps the plan's shape, rounded.
  // Then the bus rides again, put onto the streets themselves (OASA's shapes stray off them in places). On the way,
  // the stops each ride passes, for «Οδηγίες».
  async function onItsWay(it: Itinerary, r: PlanResponse, at: string) {
    const mids: (Mid[] | null)[] = it.legs.map(() => null);
    const bus: boolean[] = it.legs.map(() => false);
    const way = await Promise.all(it.legs.map(async (l, k): Promise<Pt[] | null> => {
      const from: Pt = [l.from.lat, l.from.lon], to: Pt = [l.to.lat, l.to.lon];
      try {
        if (l.kind === "walk") return (l.distance_m ?? 1) > 0 ? sensibleWalk((await fetchFoot(from, to, AbortSignal.timeout(8000)))?.line, from, to) : null;
        const id = l.line ?? "", native = id.slice(id.indexOf(":") + 1);
        const bare = (s: string | null) => (s ?? "").slice((s ?? "").indexOf(":") + 1);
        if (id.startsWith("oasa:")) {
          const st = await fetchLineStatic(native);
          const vs = Object.values(st.variants);
          mids[k] = stopsBetween(vs, st.stops, bare(l.from.stop), bare(l.to.stop));
          bus[k] = true;
          return bestSlice(vs.map(v => v.shape as Pt[]), from, to) ?? (l.shape as Pt[]);
        }
        const track = app.metro?.lines.find(m => m.id === native);
        // Both ways along each path (metro.json may draw a line's two paths the same way round).
        const paths = (track?.paths ?? []).map(p => p.map(([lon, lat]) => [lat, lon] as Pt));
        const slice = track ? bestSlice([...paths, ...paths.map(p => [...p].reverse())], from, to, 150) : null;
        if (slice && app.metro) mids[k] = stationsAlong(slice, app.metro.stations, native);
        return slice;
      } catch { return null; }
    }));
    if (planSel?.at !== at || !app.tripPlan) return;   // another option picked meanwhile
    rideStops = { at, legs: mids };
    // Every stop of the route on the map: the ones to get on and off at by name (the labels), the ones a ride passes
    // between them as small dots in the line's colour.
    app.tripStops = it.legs.flatMap((l, k) => {
      const m = mids[k];
      if (l.kind !== "ride" || !m) return [];
      const color = r.lines[l.line ?? ""]?.color || "#3b5bdb";
      return m.map(x => ({ at: x.pt, name: x.name, mid: true, color }));
    });
    draw(it, r, way);
    // Onto the streets: each bus ride, joined to its two stops, each stop at its street's kerb (stopSnap.ts: some
    // stand off their street, by a lane the walk would go down); the walks to and from them go there too.
    const ends = await Promise.all(it.legs.map(async (l, k): Promise<[Pt, Pt] | null> =>
      bus[k] ? [await snapStop([l.from.lat, l.from.lon]), await snapStop([l.to.lat, l.to.lon])] : null));
    const roads = await Promise.all(it.legs.map(async (l, k) => {
      const w = way[k];
      if (l.kind === "walk") {
        const from = ends[k - 1]?.[1], to = ends[k + 1]?.[0];
        const moved = (a: Pt | undefined, x: { lat: number; lon: number }) => !!a && (a[0] !== x.lat || a[1] !== x.lon);
        if (!moved(from, l.from) && !moved(to, l.to)) return w;
        const a: Pt = from ?? [l.from.lat, l.from.lon], b: Pt = to ?? [l.to.lat, l.to.lon];
        return sensibleWalk((await fetchFoot(a, b, AbortSignal.timeout(8000)).catch(() => null))?.line, a, b)
          ?? (w ? [...(from ? [a] : []), ...w, ...(to ? [b] : [])] : [a, b]);   // no foot route: the old one, on to the kerb
      }
      if (!bus[k] || !w) return w;
      const [a, b] = ends[k]!;
      const road = await matchRoads(w).catch(() => null);
      if (!road) return [a, ...w.slice(1, -1), b];
      return sliceShape(road, a, b, 60)?.pts ?? [a, ...road, b];
    }));
    if (planSel?.at !== at || !app.tripPlan) return;
    // The stops' names to where the stops now are.
    const moves = it.legs.flatMap((l, k) => (ends[k] ? [[[l.from.lon, l.from.lat], ends[k]![0]], [[l.to.lon, l.to.lat], ends[k]![1]]] as [[number, number], Pt][] : []));
    const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
    app.planLabels = app.planLabels.map(lb => {
      if (lb.kind === "leg") return lb;
      const mv = moves.find(([o]) => near(o, lb.at));
      return mv ? { ...lb, at: [mv[1][1], mv[1][0]] as [number, number] } : lb;
    });
    draw(it, r, roads);
  }
  function draw(it: Itinerary, r: PlanResponse, way: (Pt[] | null)[]) {
    const fc = planFC(it, r);
    let k = 0;
    fc.features = fc.features.map(f => {
      while (k < it.legs.length && it.legs[k].kind === "walk" && it.legs[k].distance_m === 0) k++;   // planFC drops those
      const w = way[k++], pts = w ? w.map(([lat, lon]) => [lon, lat] as [number, number]) : f.geometry.coordinates as [number, number][];
      return { ...f, geometry: { ...f.geometry, coordinates: smoothLine(pts, 12, 6) } };
    });
    app.tripPlan = fc;
    // The rides' labels to the middle of their new way.
    const mid = fc.features.filter(f => f.properties?.kind === "ride").map(f => { const c = f.geometry.coordinates; return c[Math.floor(c.length / 2)] as [number, number]; });
    let n = 0;
    app.planLabels = app.planLabels.map(lb => (lb.kind === "leg" && mid[n] ? { ...lb, at: mid[n++] } : lb));
  }
  // The stops the picked option's rides pass (by leg), and the one opened in «Οδηγίες» (its leg and place in it).
  let rideStops = $state<{ at: string; legs: (Mid[] | null)[] } | null>(null);
  let openRide = $state<number | null>(null);
  let openMid = $state<string | null>(null);
  // A stop on the way as the trip's end: plan again, to there.
  function endAt(m: Mid) {
    ends = { ...ends, to: { text: titleCase(m.name), place: { label: m.name, kind: "stop", pts: [m.pt], lines: [] } } };
    review = false; openMid = null; openRide = null;
  }
  // The parts of an option in proportion to their minutes: the walks, the rides, and the waits between.
  function parts(it: Itinerary, r: PlanResponse) {
    const out: { kind: "walk" | "ride" | "wait"; min: number; label: string; color: string }[] = [];
    let t = it.depart_at;
    for (const l of it.legs) {
      if (l.depart_at - t >= 60) out.push({ kind: "wait", min: Math.round((l.depart_at - t) / 60), label: "αναμονή", color: "" });
      const min = Math.max(1, Math.round((l.arrive_at - l.depart_at) / 60));
      if (l.kind === "walk") { if ((l.distance_m ?? 1) > 0) out.push({ kind: "walk", min, label: durText(min), color: "" }); }
      else { const k = r.lines[l.line ?? ""]; out.push({ kind: "ride", min, label: `${k?.label || (l.line ?? "").slice((l.line ?? "").indexOf(":") + 1)} · ${durText(min)}`, color: k?.color || "#3b5bdb" }); }
      t = l.arrive_at;
    }
    return out;
  }

  // «Ξεκίνα»: the trip followed step by step (NavGuide), from the start's point to the end's.
  const destName = () => titleCase(to?.label ?? "");
  function startPlan(at: string) {
    const r = plan?.r, it = r?.itineraries.find(x => itKey(x) === at);
    if (r && it) app.startGuide(guideFromPlan(it, r, data?.ix ?? null, destName()));
  }
  function startLine(t: TripLine) {
    if (data && from && to) app.startGuide(guideFromTrip(data.ix, t.line, t.variants[0], centre(from.pts), centre(to.pts), destName()));
  }
  function startXfer(x: TripTransfer) {
    if (data && from && to) app.startGuide(guideFromXfer(data.ix, x.legs, centre(from.pts), centre(to.pts), destName()));
  }

  // The result shown alone (a line, or "l1>l2" for a change), with its stops on the map.
  let picked = $state<string | null>(null);
  const stopAt = (k: number) => ({ at: ptOf(k), name: stop(k) });
  const xkey = (x: TripTransfer) => `${x.legs[0].line}>${x.legs[1].line}`;
  function solo(t: TripLine) {
    const v = t.variants[0];
    app.showTrip([{ id: t.line, variants: t.variants.map(x => x.id) }], true);
    app.tripStops = [stopAt(v.from), stopAt(v.to)];
    picked = t.line;
  }
  function pickXfer(x: TripTransfer) {   // another trip than the alert's: the alert ends
    const [a, b] = x.legs;
    app.showTrip([{ id: a.line, variants: [a.id] }, { id: b.line, variants: [b.id] }]);
    app.tripStops = [stopAt(a.from), stopAt(a.to), ...(stop(b.from) === stop(a.to) ? [] : [stopAt(b.from)]), stopAt(b.to)];
    picked = xkey(x);
  }
  // A picked result whose lines were closed meanwhile is no longer shown alone.
  $effect(() => {
    if (!picked) return;
    const lines = picked.split(">");
    if (lines.some(l => !app.selected.includes(l))) untrack(() => { picked = null; app.tripStops = []; });
  });
  function showAll() {
    if (trips?.length) app.showTrip(trips.map(t => ({ id: t.line, variants: t.variants.map(v => v.id) })), true);
    app.tripStops = [];
    picked = null;
  }

  // Once per trip: reopening the planner must not undo picks changed since. The planner stays open on the options
  // (picking one folds it on a phone, so its route shows). With no line without a change, the best change is shown.
  $effect(() => {
    if (!trips || !from || !to) return;
    const key = JSON.stringify([from.pts, to.pts, radius]);
    if (key === memo.applied) return;
    memo.applied = key;
    untrack(() => {
      if (app.tripPlan) return;   // a timed trip picked before the stops loaded stays
      picked = null;
      app.tripStops = [];
      if (trips.length) app.showTrip(trips.map(t => ({ id: t.line, variants: t.variants.map(v => v.id) })));
      else if (xfers.length) pickXfer(xfers[0]);
    });
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  function close() {
    stopSearch();
    app.tripEnds = null;
    app.tripStops = [];
    app.tripPlan = null;
    app.planLabels = [];
    onclose();
  }

  // The lines of the trip that are on the map, for the folded summary and the alert: which, and where each goes.
  const onMap = $derived((trips ?? []).filter(t => app.selected.includes(t.line)));
  const xferLines = $derived(app.selected.filter(l => !onMap.some(t => t.line === l) && xfers.some(x => x.legs.some(g => g.line === l))));

  // Alert settings, folded until asked for (AlertForm): the stop to wait at (each line's own, or one of the
  // stops nearest the start) and the trip's lines on the map. A new trip resets the stop.
  // A picked change: the alert watches its first line, up to the change stop.
  let alertOpen = $state(false);
  let boardName = $state("");
  const xPicked = $derived(xfers.find(x => xkey(x) === picked) ?? null);
  const aTrips = $derived(xPicked ? [legTrip(xPicked.legs[0])] : trips);
  const aOnMap = $derived((aTrips ?? []).filter(t => app.selected.includes(t.line)));
  $effect(() => { void trips; void xPicked; boardName = ""; });
  // Another stop to wait at: not for a change, whose first line is boarded where the change was planned.
  const near = $derived(data && from && to && !xPicked && aOnMap.length ? boardings(data.ix, from.pts, to.pts, radius, aOnMap.map(t => t.line)) : []);
  const board = $derived(near.find(b => b.name === boardName) ?? null);
  const targets = $derived(aTrips ? alertTargets(aTrips, app.selected, board, []) : []);

  const stop = (k: number) => titleCase(data?.ix.s[k][0] ?? "");
  const metres = (m: number) => (m < 50 ? "δίπλα" : `≈ ${Math.round(m / 50) * 50} μ.`);
  const icon = (p: Place): IconName => ({ area: "area", stop: "stop", me: "pin", street: "street", poi: "dot", metro: "metro", "metro-any": "metro", home: "home", work: "work" } as const)[p.kind ?? "street"];
  const mins = (m: number) => `≈ ${durText(Math.max(1, Math.round(m)))}`;
  // Where a trip gets off: the stop, and for "any metro station" the station there.
  const offAt = (k: number) => { const st = anyEnd && data ? stationAt(ptOf(k)) : null; return st ? `${stop(k)} (σταθμός ${st.name})` : stop(k); };
  const shown = $derived(aTrips ? Math.min(aTrips.length, MAX_LINES) : 0);
  // Where a result goes: the variants that make the trip. The summary follows the direction shown on the map.
  const going = (t: TripLine) => (data ? termini(data.ix, t.line, t.variants.map(v => v.id)).map(titleCase).join(" · ") : "");
  const goingNow = (line: string, variants: string[] = []) => (data ? termini(data.ix, line, app.focus[line] ?? variants).map(titleCase).join(" · ") : "");

  // New results, or the planner opened again: bring the list into view (not while a suggestion list is open).
  let resultsEl: HTMLElement | undefined = $state();
  $effect(() => {
    if (!trips?.length || folded || openField) return;
    void tick().then(() => resultsEl?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  });

  function onkeydown(f: Field, e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openField = f;
      const k = Math.max(0, Math.min(opts.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      activeKey = opts[k]?.key ?? null;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = openField === f ? opts[active] : undefined;
      if (o) choose(f, o);
    } else if (e.key === "Escape" && openField) {
      e.stopPropagation();
      openField = null;
    }
  }

  function focusIn(node: HTMLElement) {
    if (!phone() || !ends.from.place) node.querySelector("input")?.focus();   // a phone keeps the map until a tap
  }
</script>

<svelte:document onpointerdown={e => { if (openField && !(e.target as Element).closest?.(".ends")) openField = null; }} />

<div class="trip" class:split={!(folded && from && to && (trips || planRows.length)) || (review && planOn && plan && planRows.length)} role="dialog" tabindex="-1" aria-labelledby="trip-h" {@attach focusIn}
  onkeydown={e => { if (e.key === "Escape" && !openField) { e.stopPropagation(); close(); } }}>
  {#if review && planOn && plan && planRows.length}
    {@const p = planRows.find(x => x.at === planOn) ?? planRows[0]}
    {@const steps = planSteps(p.it, plan.r, plan.r.itineraries)}
    {@const ps = parts(p.it, plan.r)}
    {@const hops = p.it.legs.reduce((n, l) => n + (l.kind === "ride" ? l.hops ?? 0 : 0), 0)}
    {@const live = p.it.legs.filter(l => l.kind === "ride" && l.source === "live").length}
    {@const rides = p.it.legs.filter(l => l.kind === "ride").length}
    {@const rideIds = [...new Set(p.it.legs.flatMap(l => l.kind === "ride" && l.line ? [l.line] : []))]}
    {@const rideNames = rideIds.map(id => plan!.r.lines[id]?.label || id.slice(id.indexOf(":") + 1))}
    {@const rideLive = liveSum(rideIds)}
    {@const fare = tripFare(p.it, plan!.r)}
    <!-- The picked option on its own: the options as tabs, its times, its parts in proportion, its steps, «Ξεκίνα». -->
    <div class="rv" class:peek={sheetOn && snap === "peek"}>
      <div class="rvtop" bind:this={rvTopEl} bind:offsetHeight={topH} use:sheetDrag={tripDrag}>
      {#if sheetOn}
        <button type="button" class="grip" aria-label={snap === "full" ? "Μικρότερο" : "Μεγαλύτερο"}
          onclick={e => { if (e.detail === 0) stepSnap(); }}><span></span></button>
      {/if}
      <div class="row rvhead">
        <button type="button" class="icon back" aria-label="Πίσω στις επιλογές" title="Πίσω στις επιλογές" onclick={() => (review = false)}><Icon name="back" size={18} /></button>
        <h3 id="trip-h" class="rvends"><i class="rdot from" aria-hidden="true"></i>{titleCase(from?.label ?? "")}<span aria-hidden="true">→</span><i class="rdot to" aria-hidden="true"></i>{titleCase(to?.label ?? "")}</h3>
        <button type="button" class="icon" aria-label="Κλείσιμο διαδρομής" title="Κλείσιμο" onclick={close}><Icon name="close" size={16} /></button>
      </div>
      <div class="rvtabs" role="tablist" aria-label="Οι επιλογές">
        {#each planRows.slice(0, 4) as q (q.at)}
          <button type="button" role="tab" aria-selected={q.at === p.at} onclick={() => pickPlan(q.at)}>
            <b>{q.arrive}</b><small>{durText(q.mins)}{q.transfers ? ` · ${q.transfers} ${q.transfers === 1 ? "αλλαγή" : "αλλαγές"}` : ""}</small></button>
        {/each}
      </div>
      </div>
      <div class="tbody" bind:this={bodyEl}>
      <!-- The overview: when, then the numbers that decide (how long, how far on foot, the changes and the tightest,
           how many stops), then where the times come from. -->
      <div class="rvsum" in:item={{ i: 0 }}>
        <span class="rvt"><b>{p.depart} – {p.arrive}</b><small>Φτάνεις {p.arrive} · {durText(p.mins)} όλο κι όλο</small></span>
        <span class="oleave" class:soon={p.leaveIn <= 2}><small>Φύγε</small><b>{p.leaveIn ? `σε ${p.leaveIn}′` : "τώρα"}</b></span>
      </div>
      <dl class="facts" aria-label="Με μια ματιά">
        <div in:item={{ i: 1 }}><dt><Icon name="clock" size={12} />Διάρκεια</dt><dd>{durText(p.mins)}</dd></div>
        <div in:item={{ i: 2 }}><dt><Icon name="walk" size={12} />Περπάτημα</dt><dd>{p.walk_m >= 20 ? `${distText(p.walk_m)}` : "—"}{#if p.walk_m >= 20}<small>{Math.max(1, p.walk_min)}′</small>{/if}</dd></div>
        <div in:item={{ i: 3 }} class:tight={p.tight != null && p.tight < RISK_MIN}><dt><Icon name="swap" size={12} />Αλλαγές</dt><dd>{p.transfers || "καμία"}{#if p.tight != null}<small>{Math.max(0, Math.round(p.tight))}′ περιθώριο</small>{/if}</dd></div>
        <div in:item={{ i: 4 }}><dt><Icon name="stop" size={12} />Στάσεις</dt><dd>{hops || "—"}{#if rides > 1}<small>{rides} μέσα</small>{/if}</dd></div>
      </dl>
      <p class="rvsrc" class:live={live === rides && rides > 0} in:item={{ i: 5 }}><i></i>{live === rides && rides > 0 ? "Ώρες ζωντανά, από τα ίδια τα οχήματα" : live ? `Ζωντανά για ${live} από ${rides} μέσα, τα άλλα από το πρόγραμμα` : "Ώρες από το πρόγραμμα: δεν φαίνεται ακόμα όχημα"}</p>
      {#if modesIgnored}<p class="rvnote" in:item={{ i: 5 }}>Με τα μέσα που διάλεξες δεν βγαίνει διαδρομή τώρα· σου δείχνουμε την καλύτερη με όλα.</p>{/if}
      <div class="rvbar" aria-label="Τα σκέλη σε αναλογία με τον χρόνο τους" in:item={{ i: 6 }}>
        <span class="rvsegs">{#each ps as x, j (j)}<i class={x.kind} style:flex={Math.max(x.min, 2)} style:--lb={x.color || undefined}></i>{/each}</span>
        <span class="rvlabels">{#each ps as x, j (j)}<span class={x.kind} style:flex={Math.max(x.min, 2)}>{x.kind === "wait" ? "" : x.label}</span>{/each}</span>
      </div>
      {#if fare}
        <!-- The ticket the trip needs (fares.ts) (mockup 37): one line with the price; it opens only to change who pays
             or to see all the tickets, and closes again on a pick. -->
        {@const kind = app.fareReduced ? "Μειωμένο" : "Κανονικό"}
        {@const fnote = [fare.lines.length === 1 ? fare.lines[0].note : fare.lines.length ? "Χωριστό εισιτήριο για κάθε μέσο" : "", fare.x80 ? "Το X80 θέλει δικό του εισιτήριο" : ""].filter(Boolean).join(" · ")}
        <div class="fold fare" class:open={fareOpen} in:item={{ i: 6 }}>
          <button type="button" class="frow" aria-expanded={fareOpen} aria-controls="fare-more" onclick={() => (fareOpen = !fareOpen)}>
            <span class="ficon" aria-hidden="true"><Icon name="ticket" size={16} /></span>
            <span class="ftext"><b>{fare.lines.map(l => (l.n > 1 ? `${l.n} × ` : "") + l.name).join(" + ") || "Εισιτήριο X80"}</b>
              <small>{fare.lines.length ? kind : ""}{fare.lines.length && fnote ? " · " : ""}{fnote}</small></span>
            {#if fare.lines.length}<b class="fprice">{euro(fare.total[app.fareReduced ? 1 : 0])}</b>{/if}
            <span class="fchev" aria-hidden="true"><Icon name="chevron" size={14} /></span>
          </button>
          {#if fareOpen}
            <div class="fmore" id="fare-more" transition:slide={{ duration: 180 }}>
              {#if fare.lines.length}
                <div class="fseg" role="radiogroup" aria-label="Κόμιστρο">
                  {#each [false, true] as r (r)}
                    <button type="button" role="radio" aria-checked={app.fareReduced === r} onclick={() => { app.setFareReduced(r); fareOpen = false; }}>
                      {r ? "Μειωμένο" : "Κανονικό"}<small>{euro(fare.total[r ? 1 : 0])}</small></button>
                  {/each}
                </div>
              {/if}
              <button type="button" class="flink" onclick={() => (app.faresOpen = true)}>Όλα τα εισιτήρια<Icon name="chevron" size={14} /></button>
            </div>
          {/if}
        </div>
      {/if}
      <!-- What the map shows (mockup 37): one line with its switch; it opens for the vehicles on each line. -->
      <div class="fold showall" class:open={mapOpen} class:on={app.planShowAll} in:item={{ i: 6 }}>
        <div class="frow">
          <button type="button" class="sabtn" aria-expanded={mapOpen} aria-controls="map-more" onclick={() => (mapOpen = !mapOpen)}>
            <span class="saicon" aria-hidden="true"><Icon name="layers" size={16} /></span>
            <span class="satext"><b>{app.planShowAll ? "Στον χάρτη: όλη η πόλη" : "Στον χάρτη: μόνο η διαδρομή σου"}</b>
              <span class="sachips">
                {#if app.planShowAll}<span class="sachip live">Όλες οι γραμμές και τα οχήματα</span>
                {:else}
                  {#each ps.filter(x => x.kind === "ride") as x, j (j)}<span class="sachip line" style:--lb={x.color}>{x.label.split(" · ")[0]}</span>{/each}
                  {#if rideLive != null}<span class="sachip" class:live={!!rideLive}>{rideLive ? `${rideLive} στον δρόμο` : "κανένα στον δρόμο"}</span>{/if}
                {/if}
              </span></span>
            <span class="fchev" aria-hidden="true"><Icon name="chevron" size={14} /></span>
          </button>
          <button type="button" class="satrack" role="switch" aria-checked={app.planShowAll} aria-label="Όλη η πόλη στον χάρτη"
            onclick={() => (app.planShowAll = !app.planShowAll)}><i></i></button>
        </div>
        {#if mapOpen}
          <ul class="fmore savs" id="map-more" transition:slide={{ duration: 180 }}>
            {#each rideIds as id, j (id)}
              {@const n = (void liveTick, liveCount(id))}
              <li><span class="sachip line" style:--lb={ps.find(x => x.kind === "ride" && x.label.split(" · ")[0] === rideNames[j])?.color}>{rideNames[j]}</span>
                <span>{n == null ? "Φόρτωση…" : n ? (n === 1 ? "όχημα στον δρόμο" : "οχήματα στον δρόμο") : "κανένα στον δρόμο τώρα"}</span><b>{n || ""}</b></li>
            {/each}
          </ul>
        {/if}
      </div>
              <ol class="steps" aria-label="Η διαδρομή βήμα βήμα">
                {#each steps as st, j (j)}
                  {@const after = steps[j + 1]}
                  <li class="step {st.kind}" class:dotted={st.kind === "walk" || st.kind === "change"} style:--lb={st.kind === "ride" ? st.color : st.kind === "change" ? st.prev.color : undefined}
                    style:--nb={after?.kind === "ride" ? after.color : undefined} in:item={{ i: 7 + j }}>
                    <span class="sat">{clockHM(st.at)}</span>
                    <span class="srail" aria-hidden="true"><i></i><b></b></span>
                    <span class="sbody">
                      {#if st.kind === "walk"}
                        <b class="sname">Περπάτα</b>
                        <span class="sline"><Icon name="walk" size={14} /><span>{distText(st.m)} · {st.min}′ {st.to === "στον προορισμό" ? "ως τον προορισμό" : `ως ${titleCase(st.to)}`}</span></span>
                      {:else if st.kind === "ride"}
                        <b class="sname">{titleCase(st.from)}</b>
                        <span class="sline"><b class="schip" class:round={/^M/.test(st.label)} style:--lf={st.text}>{st.label}</b><span>{st.headsign ? `προς ${titleCase(placeNote(toward(st.headsign)).place)} · ` : ""}{st.hops ? `${st.hops} στάσεις · ` : ""}{durText(st.min)}</span></span>
                        {@const mids = rideStops?.at === p.at ? rideStops.legs[st.leg] : null}
                        {#if mids?.length}
                          <!-- The stops on the way: a tap on one offers it as the trip's end. -->
                          <button type="button" class="midtoggle" aria-expanded={openRide === st.leg} onclick={() => { openRide = openRide === st.leg ? null : st.leg; openMid = null; }}>
                            <span>{mids.length} {mids.length === 1 ? "στάση" : "στάσεις"} στο ενδιάμεσο</span>
                            <svg viewBox="0 0 12 8" width="11" height="8" aria-hidden="true" class:up={openRide === st.leg}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                          </button>
                          {#if openRide === st.leg}
                            <ol class="mids">
                              {#each mids as m, q (q)}
                                {@const key = `${st.leg}:${q}`}
                                <li class:open={openMid === key}>
                                  <button type="button" class="mid" aria-expanded={openMid === key} onclick={() => { openMid = openMid === key ? null : key; if (openMid) app.flyTo([m.pt[1], m.pt[0]]); }}>
                                    <i aria-hidden="true"></i><span>{titleCase(m.name)}</span></button>
                                  {#if openMid === key}
                                    <span class="midacts">
                                      <button type="button" class="midgo" onclick={() => endAt(m)}><Icon name="pin" size={15} /><span>Πήγαινε μέχρι εδώ</span></button>
                                    </span>
                                  {/if}
                                </li>
                              {/each}
                            </ol>
                          {/if}
                        {/if}
                      {:else if st.kind === "change"}
                        {@const rail = st.mode === "metro" || st.mode === "rail" || st.mode === "tram" || st.mode === "suburban"}
                        <b class="sname">Κατέβα: {titleCase(st.stop)}</b>
                        <section class="xbox" aria-label="Η αλλαγή">
                          <span class="xtop"><span class="xt"><Icon name="swap" size={16} />Αλλαγή</span>
                            <span class="xspare" class:tight={st.spare < RISK_MIN} class:ok={st.spare >= 3}><i></i>Περιθώριο {Math.max(0, st.spare)}′</span></span>
                          <svg class="xmap" viewBox="0 0 300 70" role="img" aria-label={st.m ? `${distText(st.m)} με τα πόδια, από το ${st.prev.label} στο ${st.label}` : `Το ${st.label} από την ίδια στάση`}>
                            <rect width="300" height="70" rx="10" class="xbg"></rect>
                            <path d="M0 46 H300" class="xroad"></path>
                            {#if st.m}<path d="M40 46 C90 46 110 22 170 22 L248 22" class="xwalk"></path>{/if}
                            <g transform={st.m ? "translate(40 46)" : "translate(120 46)"}><circle r="12" fill={st.prev.color} stroke="#fff" stroke-width="2"></circle>
                              <text y="4" text-anchor="middle" class="xlbl">{st.prev.label.length > 3 ? st.prev.label.slice(0, 3) : st.prev.label}</text></g>
                            <g transform={st.m ? "translate(260 22)" : "translate(180 46)"}><circle r="12" fill={st.color} stroke="#fff" stroke-width="2"></circle>
                              <text y="4" text-anchor="middle" class="xlbl">{st.label.length > 3 ? st.label.slice(0, 3) : st.label}</text></g>
                            <text x="150" y="64" text-anchor="middle" class="xm">{st.m ? `${distText(st.m)} · ${st.min}′` : "ίδια στάση"}</text>
                          </svg>
                          {#if st.gate}<span class="xgate"><Icon name="metro" size={14} />Μαζί {st.gate}′ για τον σταθμό: σκάλες, ακυρωτικά, αποβάθρα</span>{/if}
                          <ol class="xsteps">
                            <li><b>1</b><span>{st.m ? `Περπάτα ${distText(st.m)} ως ${rail ? "την είσοδο του σταθμού" : "τη στάση"}${st.next && !rail ? ` ${titleCase(st.next)}` : ""}` : "Μείνε στην ίδια στάση"}</span></li>
                            <li><b>2</b><span>{rail ? "Αποβάθρα" : `Πάρε το ${st.label}`}{st.headsign ? " " : ""}{#if st.headsign}<b class="xto">προς {titleCase(placeNote(toward(st.headsign)).place)}</b>{/if}</span></li>
                          </ol>
                          {#if st.missed}<span class="xmiss"><Icon name="clock" size={14} />Αν το χάσεις, το επόμενο σε {st.missed.in_min}′: φτάνεις {clockHM(st.missed.arrive_at)}</span>{/if}
                        </section>
                      {:else}
                        <b class="sname">{titleCase(to?.label ?? st.name)}</b>
                      {/if}
                    </span>
                  </li>
                {/each}
              </ol>
      </div>
      <div class="rvfoot" bind:this={rvFootEl} bind:offsetHeight={footH}><button type="button" class="startbtn" onclick={() => startPlan(p.at)}><Icon name="route" size={18} /><span>Ξεκίνα</span></button></div>
    </div>
  {:else if folded && from && to && (trips || planRows.length)}
    <span id="trip-h" class="sr">Διαδρομή</span>
    <div class="row">
      <button type="button" class="summary" aria-expanded="false" onclick={() => (folded = false)}>
        <b>{titleCase(from.label)} → {titleCase(to.label)}</b>
        {#if planShown}
          {@const p = planShown}
          <small>{p.depart} → {p.arrive} · {durText(p.mins)} · {p.rides.map(r => r.label).join(" › ")}</small>
        {:else if trips}
        <small>{#if trips.length}{trips.length} {trips.length === 1 ? "γραμμή" : "γραμμές"}{#if trips.length > MAX_LINES} · {MAX_LINES} στον χάρτη{/if}{:else if xfers.length}με μία αλλαγή{/if}{#if app.alert} · <Bell label="ειδοποίηση" />{/if}</small>
        {/if}
        {#if onMap.length || xferLines.length}
          <span class="lines">
            {#each onMap as t (t.line)}
              <span class="ln" style:--c={app.lineColor(t.line).bg}><b>{t.line}</b>{#if goingNow(t.line, t.variants.map(v => v.id))}<i>→ {goingNow(t.line, t.variants.map(v => v.id))}</i>{/if}</span>
            {/each}
            {#each xferLines as l (l)}
              <span class="ln" style:--c={app.lineColor(l).bg}><b>{l}</b>{#if goingNow(l)}<i>→ {goingNow(l)}</i>{/if}</span>
            {/each}
          </span>
        {/if}
      </button>
      <button type="button" class="icon" aria-label="Κλείσιμο διαδρομής" title="Κλείσιμο" onclick={close}><Icon name="close" size={16} /></button>
    </div>
  {:else}
    <!-- The ends and the choices stay at the top; the options scroll under them. -->
    <div class="thead">
    <div class="row">
      <h3 id="trip-h">Διαδρομή</h3>
      {#if trips?.length || xfers.length || planRows.length}
        <button type="button" class="icon" aria-label="Σύμπτυξη" title="Σύμπτυξη" onclick={() => (folded = true)}>
          <svg viewBox="0 0 12 8" width="14" height="10" aria-hidden="true"><path d="M1 6.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      {/if}
      <button type="button" class="icon" aria-label="Κλείσιμο διαδρομής" title="Κλείσιμο" onclick={close}><Icon name="close" size={16} /></button>
    </div>

    <div class="ends">
      <div class="pair">
        {#each FIELDS as f (f)}
          {@const e = ends[f]}
          <div class="field {f}" class:open={openField === f}>
            <i class="dot {f}" aria-hidden="true"></i>
            <input id="trip-{f}" bind:this={inputs[f]} type="search" autocomplete="off" spellcheck="false" enterkeyhint="search"
              aria-label={f === "from" ? "Από" : "Προς"} placeholder={f === "from" ? "Από: η θέση μου, στάση, μετρό, διεύθυνση" : "Προς: στάση, μετρό, διεύθυνση, μαγαζί"}
              value={e.text} class:set={!!e.place}
              role="combobox" aria-expanded={openField === f} aria-controls="trip-{f}-list" aria-autocomplete="list"
              aria-activedescendant={openField === f && opts[active] ? `trip-${f}-${active}` : undefined}
              onfocus={() => { openField = f; }} onclick={() => { openField = f; }}
              oninput={ev => edit(f, ev.currentTarget.value)} onkeydown={ev => onkeydown(f, ev)} />
          </div>
        {/each}
        <button type="button" class="swap" class:turned aria-label="Αντιστροφή αφετηρίας και προορισμού" title="Αντιστροφή" onclick={swap}><Icon name="swap" size={17} /></button>
      </div>
      <!-- Under the pair, in the flow (a floating list would be cut off by the planner's own scroll box). -->
      {#if openField}
        {@const f = openField}
        <ul id="trip-{f}-list" class="list" role="listbox" aria-label={f === "from" ? "Αφετηρία" : "Προορισμός"}>
          {#each opts as o, k (o.key)}
            <!-- svelte-ignore a11y_click_events_have_key_events (keyboard goes through the combobox input) -->
            <li id="trip-{f}-{k}" role="option" aria-selected={k === active} class:active={k === active}
              onpointerdown={ev => ev.preventDefault()} onclick={() => choose(f, o)}>
              {#if o.me}
                <span class="li"><Icon name="pin" size={16} /></span><span class="lt"><b>{ME}</b><small>Από την τοποθεσία της συσκευής σου</small></span>
              {:else if o.place}
                <span class="li"><Icon name={icon(o.place)} size={16} /></span>
                <span class="lt"><b>{titleCase(o.place.label)}</b>
                  <small>{o.place.kind === "metro-any" ? "η γραμμή που σε πάει πιο γρήγορα σε σταθμό" : o.place.lines.length ? `Γραμμές ${o.place.lines.slice(0, 6).join(" · ")}${o.place.lines.length > 6 ? " …" : ""}` : o.place.hint ?? ""}</small></span>
              {/if}
            </li>
          {:else}
            <li class="empty">{geoBusy ? "Αναζήτηση…" : "Δεν βρέθηκε. Δοκίμασε στάση, περιοχή ή οδό με αριθμό."}</li>
          {/each}
          {#if geoBusy && opts.length}<li class="empty" aria-hidden="true">Αναζήτηση περιοχών…</li>{/if}
        </ul>
      {/if}
    </div>
    {#if locating}<p class="note">Εντοπισμός…</p>{/if}

    {#if err}<p class="warn" role="status">{err}</p>{/if}
    {#if byMetro}<p class="metro"><Icon name="metro" /> <span>Με {byMetro.line}: {titleCase(byMetro.from)} → {titleCase(byMetro.to)}{#if byMetro.walk >= 50} · περπάτημα {metres(byMetro.walk)}{:else}.{/if} Συνήθως πιο γρήγορα από το λεωφορείο.</span></p>{/if}
    {#if from && to && !anyEnd && !tooClose}
      <!-- When, and what matters most -->
      <div class="prefs">
        <Dropdown variant="solid" value={later} options={LATER} label="Πότε φεύγω" onpick={v => (later = v)} />
        <button type="button" class="pref" aria-pressed={order === "walk"} onclick={() => (order = order === "walk" ? "time" : "walk")}>Λιγότερο περπάτημα</button>
        <button type="button" class="pref" aria-pressed={order === "changes"} onclick={() => (order = order === "changes" ? "time" : "changes")}>Λιγότερες αλλαγές</button>
      </div>
    {/if}
    </div>
    <div class="tbody" bind:this={bodyEl}>
    {#if planRows.length}
      <ol class="results opts" aria-label="Επόμενες διαδρομές">
        {#each planRows as p, k (p.at)}
          {@const n = planNote(p)}
          {@const of = tripFare(p.it, plan!.r)}
          <li in:item={{ i: k }}>
            <button type="button" class="opt" class:picked={planOn === p.at} aria-pressed={planOn === p.at}
              title="Η διαδρομή στον χάρτη" onclick={() => pickPlan(p.at)}>
              <!-- From when you leave to when you arrive (not from now), and how long that is. -->
              <span class="ohead">
                <span class="otime"><b>{p.depart} – {p.arrive}</b>
                  <small>{durText(p.mins)} διαδρομή · {p.transfers ? `${p.transfers} ${p.transfers === 1 ? "αλλαγή" : "αλλαγές"}` : "χωρίς αλλαγή"}</small></span>
                <span class="oleave" class:soon={p.leaveIn <= 2}><small>Φύγε</small><b>{p.leaveIn ? `σε ${p.leaveIn}′` : "τώρα"}</b></span>
              </span>
              <span class="osub"><span class="owalk"><Icon name="walk" size={14} />{p.walk_m >= 20 ? `${distText(p.walk_m)} · ${Math.max(1, p.walk_min)}′ περπάτημα` : "Χωρίς περπάτημα"}</span>
                {#if of?.lines.length}<span class="ofare" title="Εισιτήριο"><Icon name="ticket" size={14} />{euro(of.total[app.fareReduced ? 1 : 0])}</span>{/if}</span>
              <span class="legs" aria-label={p.legs.map(l => (l.walk ? `περπάτημα ${l.label}` : `${l.label}${l.hops ? `, ${l.hops} στάσεις` : ""}`)).join(", ")}>
                {#each p.legs as l, j (j)}
                  {@const rides = p.legs.filter(x => !x.walk).length}
                  <!-- A ride shows its line whole; with one ride, its stops too. A walk gives way: its minutes go first. -->
                  <span class="leg" class:walk={l.walk} class:tight={l.walk && (rides > 1 || l.min < 3)} style:flex={Math.max(l.min, 3)} style:--lb={l.color} style:--lf={l.text}
                    title={l.walk ? `Περπάτημα ${l.label}` : `${l.label}${l.hops ? ` · ${l.hops} στάσεις` : ""}`}>
                    {#if l.walk}<Icon name="walk" size={14} />{/if}<span>{l.label}{#if !l.walk && l.hops && rides === 1}{` · ${l.hops} στάσεις`}{/if}</span>
                  </span>
                {/each}
              </span>
              <span class="onote {n.tone}"><i></i>{n.text}</span>
            </button>
            {#if planOn === p.at}
              <div class="pickacts">
                <button type="button" class="detbtn" onclick={() => (review = true)}><Icon name="route" size={17} /><span>Οδηγίες</span></button>
                <button type="button" class="startbtn" onclick={() => startPlan(p.at)}><Icon name="route" size={18} /><span>Ξεκίνα</span></button>
              </div>
            {/if}
          </li>
        {/each}
      </ol>
      <h4 class="sub">Γραμμές κοντά, χωρίς ώρες</h4>
    {/if}
    {#if failed}
      <p class="warn">Δεν φόρτωσαν οι στάσεις. <button type="button" class="link" onclick={load}>Ξανά</button></p>
    {:else if !data}
      <p class="note">Φόρτωση στάσεων…</p>
    {:else if tooClose}
      <p class="note">{#if anyEnd && walkTo}Ο σταθμός {walkTo.name} είναι {metres(walkTo.d)}: καλύτερα με τα πόδια.{:else}Είναι πολύ κοντά: καλύτερα με τα πόδια.{/if}</p>
    {:else if trips && !trips.length && !xfers.length}
      <p class="note">Καμία γραμμή δεν πάει, ούτε με μία αλλαγή. Δοκίμασε περισσότερο περπάτημα ή κοντινή περιοχή.</p>
    {:else if trips}
      {#if !trips.length}<p class="note">Καμία γραμμή λεωφορείου δεν πάει χωρίς αλλαγή.</p>{/if}
      <ol class="results untimed" bind:this={resultsEl}>
        {#each trips as t, k (t.line)}
          {@const info = app.lineInfo.get(t.line)}
          {@const v = t.variants[0]}
          <li class:out={k >= MAX_LINES} class:picked={picked === t.line}>
            <button type="button" class="chip" style:--c={app.lineColor(t.line).bg} style:--t={app.lineColor(t.line).fg}
              aria-pressed={app.selected.includes(t.line)} title={info?.name}
              onclick={() => { dropPlan(); toggleTripLine(app, t); }}>{t.line}</button>
            <button type="button" class="pick" aria-pressed={picked === t.line} title="Μόνο αυτή στον χάρτη, με τις στάσεις της" onclick={() => solo(t)}>
              <span><b>{mins(t.min)}</b> {stop(v.from)} → {offAt(v.to)}</span>
              <small>{#if going(t)}προς {going(t)} · {/if}{t.stops} {t.stops === 1 ? "στάση" : "στάσεις"} · περπάτημα {metres(t.walk)}{#if k >= MAX_LINES} · εκτός χάρτη (έως {MAX_LINES}){/if}</small>
            </button>
            <button type="button" class="go" title="Ξεκίνα με το {t.line}" aria-label="Ξεκίνα με το {t.line}, από τη στάση {stop(v.from)}" onclick={() => startLine(t)}>Ξεκίνα</button>
          </li>
        {/each}
      </ol>
      {#if xfers.length}
        <h4 class="sub">Με μία αλλαγή</h4>
        <ol class="results untimed">
          {#each xfers as x (xkey(x))}
            {@const [a, b] = x.legs}
            <li class:picked={picked === xkey(x)}>
              <span class="lpair">
                <b class="chip on" style:--c={app.lineColor(a.line).bg} style:--t={app.lineColor(a.line).fg}>{a.line}</b>
                <b class="chip on" style:--c={app.lineColor(b.line).bg} style:--t={app.lineColor(b.line).fg}>{b.line}</b>
              </span>
              <button type="button" class="pick" aria-pressed={picked === xkey(x)} title="Αυτές οι δύο στον χάρτη, με τις στάσεις" onclick={() => pickXfer(x)}>
                <span><b>{mins(x.min)}</b> · {a.line} {stop(a.from)} → {stop(a.to)}</span>
                <span>Αλλαγή: {b.line}{stop(b.from) !== stop(a.to) ? ` από ${stop(b.from)}` : ""} → {offAt(b.to)}</span>
                <small>{a.stops + b.stops} στάσεις · περπάτημα {metres(x.walk)}{#if x.xfer >= 50} και {metres(x.xfer)} στην αλλαγή{/if} · με ~5′ αναμονή</small>
              </button>
              <button type="button" class="go" title="Ξεκίνα με {a.line} και {b.line}" aria-label="Ξεκίνα με {a.line} και αλλαγή στο {b.line}" onclick={() => startXfer(x)}>Ξεκίνα</button>
            </li>
          {/each}
        </ol>
      {/if}
      {#if picked && trips.length}<button type="button" class="link all" onclick={showAll}>Όλες οι γραμμές στον χάρτη</button>{/if}
      {#if shown && app.cityInfo.alerts}
        <div class="alert">
          {#if app.alert}
            {@const a = app.alert}
            <span><Bell /> {a.lines.map(l => l.line).join(", ")}: έως {a.n} {a.n === 1 ? "στάση" : "στάσεις"} πριν από {a.label}{a.push ? ", και με κλειστή σελίδα" : ""}.</span>
            <button type="button" class="link" onclick={() => app.setAlert(null)}>Ακύρωση</button>
          {:else}
            <button type="button" class="lead" aria-expanded={alertOpen} aria-controls="trip-alert" onclick={() => (alertOpen = !alertOpen)}>
              <Bell /> Ειδοποίηση
              <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true" class:up={alertOpen}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
          {/if}
        </div>
        {#if alertOpen && !app.alert && from}
          <div id="trip-alert">
            {#if !targets.length}
              <p class="note">{aOnMap.length ? "Διάλεξε τουλάχιστον μία γραμμή." : "Καμία γραμμή της διαδρομής δεν είναι στον χάρτη: πάτα μία για να τη δείξεις."}</p>
            {/if}
            <AlertForm {app} lines={targets} label={board?.name ?? from.label} onstarted={() => (alertOpen = false)}>
              {#snippet extra()}
                {#if xPicked}<p class="note">Για την πρώτη γραμμή, {xPicked.legs[0].line}, ως την αλλαγή στη στάση {stop(xPicked.legs[0].to)}.</p>{/if}
                {#if near.length > 1}
                  <span class="board">Στάση
                    <Dropdown variant="field" value={boardName} label="Στάση"
                      options={[{ value: "", label: "η κοντινότερη κάθε γραμμής" },
                        ...near.map(b => ({ value: b.name, label: b.name, hint: `${metres(b.walk)} · ${b.lines.map(l => l.line).join(", ")}` }))]}
                      onpick={v => (boardName = v)} />
                  </span>
                {/if}
              {/snippet}
            </AlertForm>
          </div>
        {/if}
      {/if}
    {:else}
      <p class="note">Διάλεξε από πού και προς τα πού: οι γραμμές που τα συνδέουν φαίνονται στον χάρτη.</p>
    {/if}

    <div class="foot">
      <span class="radius">Περπάτημα έως
        <Dropdown value={radius} options={RADII.map(r => ({ value: r, label: `${r} μ.` }))} label="Περπάτημα έως" onpick={v => (radius = v)} />
      </span>
      {#if planRows.length}<small>Ώρες από το πρόγραμμα, όχι live.</small>{/if}
      {#if trips?.length || xfers.length}<small>Χρόνοι κατά προσέγγιση, χωρίς την αναμονή στη στάση.</small>{/if}
      {#if data?.stale}<small>Στάσεις από {data.stale}· μπορεί να έχουν αλλάξει.</small>{/if}
      {#if geo?.places.length}<small>Περιοχές: © OpenStreetMap</small>{/if}
    </div>
    </div>
  {/if}
</div>

<style>
  .trip { min-height: 0; padding: 12px 14px 14px; font-size: 13px;
    border: 0; border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text);
    box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; }
  /* Open, the panel is a head that stays (the ends and the choices; in «Οδηγίες» the options as tabs), a body that
     scrolls under it with its scrollbar beside the body only, and in «Οδηγίες» a foot that stays («Ξεκίνα»). */
  .trip.split { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
  .tbody { flex: 1 1 auto; min-height: 0; padding: 12px 14px 14px; overflow-y: auto; overscroll-behavior: contain; }
  .thead { flex: none; padding: 12px 14px 10px; box-shadow: 0 1px 0 var(--border); }
  /* «Οδηγίες»: the picked option on its own. */
  .rv { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .rv > .tbody { display: flex; flex-direction: column; gap: 14px; }
  .rvtop { flex: none; display: flex; flex-direction: column; gap: 12px; padding: 12px 14px 12px; box-shadow: 0 1px 0 var(--border); }
  .rvhead { gap: 8px; }
  .rvends { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; margin: 0; overflow: hidden; white-space: nowrap; font-size: 15px; font-weight: 700; line-height: 1; }
  .rvends > span { color: var(--muted); }
  .rdot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
  .rdot.to { border-radius: 2px; background: #f0a24b; }
  .rvtabs { display: flex; gap: 4px; padding: 4px; border-radius: 16px; background: var(--card); }
  .rvtabs button { flex: 1; min-width: 0; height: 50px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 0 4px;
    border: 0; border-radius: 12px; background: none; color: var(--muted); font: inherit; line-height: 1; cursor: pointer; }
  .rvtabs button b { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .rvtabs button small { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .rvtabs button[aria-selected="true"] { background: var(--control-hover); color: var(--fg); }
  .rvtabs button[aria-selected="true"] b { font-weight: 800; }
  .rvsum { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
  .rvt { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .rvt b { font-size: 26px; font-weight: 800; letter-spacing: -.02em; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rvt small { color: var(--muted); font-size: 12px; font-weight: 500; line-height: 1.3; }
  .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0; }
  .facts > div { min-width: 0; height: 50px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 0 11px; border-radius: 14px; background: var(--card); border: 1px solid var(--card-border); }
  .facts dt { display: flex; align-items: center; gap: 5px; margin: 0; font-size: 11px; font-weight: 600; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; }
  .facts dd { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 15px; font-weight: 800; line-height: 1; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .facts dd small { height: 18px; display: flex; align-items: center; padding: 0 6px; border-radius: 5px; background: color-mix(in srgb, var(--fg) 9%, transparent);
    font-size: 11px; font-weight: 700; line-height: 1; letter-spacing: 0; color: var(--muted); }
  .facts > div.tight { border-color: color-mix(in srgb, var(--late1) 50%, transparent); }
  .facts > div.tight dd { color: var(--late1); }
  .facts > div.tight dd small { background: color-mix(in srgb, var(--late1) 16%, transparent); color: var(--late1); }
  .rvnote { margin: 0; padding: 8px 10px; border-radius: 10px; font-size: 12px; font-weight: 600; line-height: 1.35; color: var(--warn, #f5b942); background: color-mix(in srgb, var(--warn, #f5b942) 12%, transparent); }
  .rvsrc { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12px; font-weight: 600; line-height: 1.3; color: var(--muted); }
  .rvsrc i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .rvsrc.live { color: var(--ontime); }
  .rvsrc.live i { background: var(--ontime); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ontime) 25%, transparent); animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--ontime) 10%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .rvsrc.live i { animation: none; } }
  .rvbar { display: flex; flex-direction: column; gap: 7px; }
  .rvsegs { display: flex; gap: 3px; height: 10px; }
  .rvsegs i { min-width: 6px; border-radius: 5px; background: var(--lb, var(--control)); }
  .rvsegs i.walk { background: repeating-linear-gradient(90deg, var(--accent) 0 3px, transparent 3px 6px); }
  .rvsegs i.wait { background: var(--control); }
  .rvlabels { display: flex; gap: 3px; color: var(--muted); font-size: 11px; font-weight: 700; line-height: 1; }
  .rvlabels span { min-width: 6px; overflow: hidden; white-space: nowrap; text-overflow: clip; }
  .rvlabels span.ride { color: var(--fg); }
  /* The ticket and what the map shows (mockup 37): each one line, opened only to change something. */
  .fold { flex: none; border-radius: 18px; background: var(--card); border: 1px solid transparent; overflow: hidden; transition: border-color .2s; }
  .fold.open { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  .frow { width: 100%; min-height: 58px; display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 12px; border: 0; background: none;
    color: var(--fg); font: inherit; text-align: left; cursor: pointer; box-sizing: border-box; }
  .showall .frow { cursor: default; padding-right: 10px; }
  .sabtn { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .fchev { flex: none; display: flex; color: var(--muted); transition: transform .2s; }
  .fold.open .fchev { transform: rotate(180deg); }
  .ficon, .saicon { flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 10px; }
  .ficon { background: color-mix(in srgb, #f0ae45 16%, transparent); color: #f0ae45; }
  .saicon { background: var(--control); color: var(--muted); transition: background-color .2s, color .2s; }
  .showall.on .saicon { background: var(--accent-bg); color: var(--accent); }
  .ftext, .satext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .ftext b, .satext b { font-size: 14px; font-weight: 700; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ftext small { font-size: 12px; font-weight: 500; line-height: 1.1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fprice { flex: none; font-size: 18px; font-weight: 900; letter-spacing: -.02em; line-height: 1; font-variant-numeric: tabular-nums; }
  .fmore { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0 12px 12px; }
  .fseg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding: 3px; border-radius: 12px; background: var(--surface); }
  .fseg button { height: 34px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; border: 0; border-radius: 9px; background: none; color: var(--muted);
    font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .fseg button small { font-size: 12px; font-weight: 600; color: var(--muted); }
  .fseg button[aria-checked="true"] { background: var(--control); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .18); }
  .flink { height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border: 1px solid var(--border); border-radius: 12px; background: none;
    color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .flink :global(svg) { transform: rotate(-90deg); color: var(--muted); }
  .flink:hover { background: var(--control); }
  /* One chip height for every chip here: the lines, the vehicles, the facts' notes. */
  .sachips { display: flex; flex-wrap: wrap; gap: 4px; }
  .sachip { height: 20px; display: flex; align-items: center; padding: 0 6px; border-radius: 6px; background: var(--control); color: var(--muted);
    font-size: 11px; font-weight: 800; line-height: 1; white-space: nowrap; }
  .sachip.line { background: var(--lb); color: #fff; }
  .sachip.live { background: color-mix(in srgb, var(--ontime) 16%, transparent); color: var(--ontime); font-weight: 700; }
  .savs { list-style: none; gap: 0; }
  .savs li { height: 36px; display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; line-height: 1; color: var(--muted); }
  .savs li .sachip { min-width: 38px; justify-content: center; box-sizing: border-box; }
  .savs li span:nth-child(2) { flex: 1; }
  .savs li b { color: var(--fg); font-variant-numeric: tabular-nums; }
  .satrack { position: relative; width: 44px; height: 26px; flex: none; padding: 0; border: 0; border-radius: 13px; background: color-mix(in srgb, var(--muted) 38%, transparent); transition: background .2s; cursor: pointer; }
  .satrack i { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.3); transition: transform .2s; }
  .satrack[aria-checked="true"] { background: var(--accent); }
  .satrack[aria-checked="true"] i { transform: translateX(18px); }
  .satrack:focus-visible, .sabtn:focus-visible, .frow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ofare { display: inline-flex; align-items: center; gap: 5px; color: var(--fg); font-weight: 700; font-variant-numeric: tabular-nums; }
  .rv .steps { margin-top: 0; }
  /* The stops on a ride's way, under its line: on its rail, small; one opened offers it as the trip's end. */
  .midtoggle { display: inline-flex; align-items: center; gap: 6px; height: 28px; margin-top: 6px; padding: 0 10px; border: 1px solid var(--border); border-radius: 14px;
    background: none; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer; }
  .midtoggle svg { transition: rotate .2s; }
  .midtoggle svg.up { rotate: 180deg; }
  .mids { display: flex; flex-direction: column; gap: 2px; margin: 6px 0 0; padding: 0; list-style: none; }
  .mid { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 32px; padding: 0 8px; border: 0; border-radius: 10px; background: none;
    color: var(--fg); font: inherit; font-size: 13px; line-height: 1; text-align: left; cursor: pointer; }
  .mid:hover, .mids li.open .mid { background: var(--card); }
  .mid i { flex: none; width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--lb, var(--accent)); background: var(--surface); box-sizing: border-box; }
  .mid span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .midacts { display: flex; gap: 6px; padding: 4px 8px 6px 25px; }
  .midgo { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 0; border-radius: 16px; background: var(--accent); color: #fff;
    font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .xgate { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; line-height: 1.3; }
  .rvfoot { flex: none; padding: 12px 14px 14px; box-shadow: 0 -1px 0 var(--border); }
  /* The sheet's handle (a phone): the header drags it too; at «peek» only the options and «Ξεκίνα» show. */
  .grip { display: block; width: 100%; height: 18px; margin: -8px 0 -4px; padding: 0; border: 0; background: none; cursor: grab; touch-action: none; }
  .grip span { display: block; width: 40px; height: 5px; margin: 0 auto; border-radius: 3px; background: var(--border); }
  .grip:focus-visible { outline: 2px solid var(--accent); border-radius: 6px; }
  @media (max-width: 719px) { .rvtop { touch-action: none; } }
  .rv.peek > .tbody { display: none; }
  .rvfoot .startbtn { margin-top: 0; }
  /* The picked option: «Οδηγίες» and «Ξεκίνα». */
  .pickacts { display: flex; gap: 8px; margin-top: 8px; }
  .pickacts .startbtn { flex: 1; margin-top: 0; }
  .detbtn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; height: 50px; border: 0; border-radius: 25px; background: var(--card);
    color: var(--fg); font: inherit; font-size: 15px; font-weight: 700; line-height: 1; cursor: pointer; }
  .detbtn:hover { background: var(--control-hover); }
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .row { display: flex; align-items: center; gap: 4px; }
  h3 { flex: 1; margin: 0; font-size: 18px; font-weight: 800; }
  .icon { display: flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%;
    background: var(--card); color: var(--fg); font-size: 20px; line-height: 1; cursor: pointer; }
  .icon:hover { background: var(--control); color: var(--fg); }
  .summary { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; padding: 4px 8px; border: 0;
    border-radius: 8px; background: none; color: var(--fg); text-align: left; cursor: pointer; }
  .summary b { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .summary small { color: var(--muted); }
  .summary:hover { background: var(--control); }
  .lines { display: flex; flex-wrap: wrap; gap: 4px; max-width: 100%; margin-top: 4px; }
  .ln { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 0 8px; border: 2px solid var(--c);
    border-radius: 12px; font-size: 12px; line-height: 20px; }
  .ln i { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: normal; color: var(--muted); }
  /* The two ends: one rounded field pair (a blue dot for the start, an amber square for the end), the swap beside it. */
  .ends { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
  /* The swap button sits inside the pair, on the seam at its right, so the two fields take the whole width. */
  .pair { position: relative; display: flex; flex-direction: column; }
  .pair .field { padding-right: 50px; }
  .field { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 14px; background: var(--card);
    border: 1px solid var(--card-border); transition: background-color .2s; }
  .field.from { border-radius: 18px 18px 0 0; border-bottom: 0; }
  .field.to { border-radius: 0 0 18px 18px; border-top: 1px solid var(--border); }
  .field.open { background: color-mix(in srgb, var(--accent) 7%, var(--card)); }
  .dot { flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent); }
  .dot.to { border-radius: 3px; background: var(--late1); box-shadow: none; }
  /* 16px: iOS zooms into smaller inputs on focus. */
  .field input { flex: 1; min-width: 0; height: 46px; padding: 0; border: 0; background: none; color: var(--fg); font-size: 16px; outline: none; }
  .field input.set { font-weight: 600; }
  .swap { position: absolute; z-index: 1; right: 8px; top: calc(50% - 18px); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
    padding: 0; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); color: var(--fg); cursor: pointer; box-shadow: var(--shadow-sm); }
  .swap:hover { background: var(--control-hover); }
  .prefs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .pref { height: 36px; display: flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid var(--border); border-radius: 18px;
    background: transparent; color: var(--fg); font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; white-space: nowrap; }
  .pref[aria-pressed="true"] { background: var(--accent-bg); border-color: color-mix(in srgb, var(--accent) 45%, transparent); color: var(--accent); }
  /* The timed options: a card each, its legs to scale. */
  .opts { display: flex; flex-direction: column; gap: 10px; }
  .results.opts > li { display: block; padding: 0; }   /* the option, then «Ξεκίνα» under it at full width */
  .opt { width: 100%; display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 20px; border: 1px solid var(--card-border);
    background: var(--card); color: var(--fg); text-align: left; cursor: pointer; }
  .opt.picked { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  /* When: the arrival big on the left, when to leave on the right (green, amber when it is now), the rest under. */
  .ohead { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
  .otime, .oleave { display: flex; flex-direction: column; gap: 7px; }
  .otime { min-width: 0; }
  .oleave { flex: none; align-items: flex-end; }
  .otime small, .oleave small { font-size: 12px; font-weight: 600; line-height: 1; color: var(--muted); }
  .otime b { font-size: 24px; font-weight: 800; letter-spacing: -.02em; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .owalk { display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .oleave b { font-size: 20px; font-weight: 800; line-height: 1; color: var(--ontime); font-variant-numeric: tabular-nums; }
  .oleave.soon b { color: var(--late1); }
  .osub { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; font-size: 12px; line-height: 1; color: var(--muted); }
  .legs { display: flex; align-items: center; gap: 4px; }
  .leg { min-width: 0; height: 30px; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 8px; border-radius: 15px;
    background: var(--lb); color: var(--lf); font-size: 12px; font-weight: 800; line-height: 1; overflow: hidden; white-space: nowrap; }
  .leg span { overflow: hidden; text-overflow: ellipsis; }
  /* A walk keeps its few characters whole («6′»); the rides share what is left, their label cut if it must be. */
  .leg.walk { flex: none !important; min-width: max-content; padding: 0 9px; background: var(--control); color: var(--muted); }
  .leg:not(.walk) { flex-shrink: 1 !important; min-width: 56px; padding: 0 12px; box-sizing: border-box; }   /* «Χ95» whole, not «Χ» */
  .leg:not(.walk) span { white-space: nowrap; }
  .leg.walk.tight { min-width: 30px; padding: 0; }
  .leg.walk.tight span { display: none; }
  .legs { overflow: hidden; }
  .onote { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 1.25; }
  .onote i { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .onote.ok { color: var(--ontime); } .onote.bad { color: var(--late3); } .onote.muted { color: var(--muted); }
  .list { margin: 0; max-height: min(320px, 45dvh); overflow-y: auto; padding: 6px; list-style: none; border-radius: 16px;
    background: var(--card); border: 1px solid var(--card-border); }
  .list li { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 10px; border-radius: 11px; cursor: pointer; }
  .li { flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
    background: var(--accent-bg); color: var(--accent); }
  .lt { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .lt b { font-size: 14px; font-weight: 600; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lt small { font-size: 12px; line-height: 1.2; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list li.active, .list li:hover { background: var(--control); }
  .list li.empty { cursor: default; color: var(--muted); font-size: 13px; background: none; }
  .results { margin: 8px 0 0; padding: 0; list-style: none; }
  .results > li { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; }
  .results > li.out { opacity: .6; }
  /* The lines without times (when the timed planner has none): a card each, «Ξεκίνα» at its foot, not beside the text. */
  .results.untimed > li { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; margin-bottom: 8px; padding: 12px;
    border-radius: 16px; background: var(--card); border: 1px solid var(--card-border); }
  .results.untimed .pick { flex: 1 1 0; }
  .results.untimed > li.picked { border-color: var(--accent); }
  .results.untimed .lpair { align-items: flex-start; }
  .results.untimed .pick { gap: 5px; padding: 0; margin: 0; font-size: 14px; line-height: 1.3; }
  .results.untimed .pick:hover, .results.untimed .picked .pick { background: none; }
  .results.untimed .go { flex: 1 0 100%; height: 40px; border-radius: 20px; font-size: 14px; }
  .results small { color: var(--muted); }
  .chip { flex: none; min-width: 46px; min-height: 28px; padding: 0 8px; border: 2px solid var(--c); border-radius: 14px;
    background: none; color: var(--fg); font-weight: 700; cursor: pointer; }
  .chip[aria-pressed="true"], .chip.on { background: var(--c); color: var(--t); }
  .chip.on { display: inline-grid; place-items: center; min-width: 0; cursor: default; }
  .rides { display: flex; flex-wrap: wrap; gap: 3px; margin: 2px 0; }
  .lpair { flex: none; display: flex; flex-direction: column; gap: 4px; }   /* not .pair: the two ends' fields are */
  .pick { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 2px 6px; margin: -2px 0;
    border: 0; border-radius: 8px; background: none; color: var(--fg); font-size: 13px; text-align: left; cursor: pointer; }
  .pick:hover, .picked .pick { background: var(--control); }
  .pick b { font-variant-numeric: tabular-nums; }
  /* «Ξεκίνα»: the trip followed step by step. */
  .go { flex: none; display: flex; align-items: center; justify-content: center; height: 34px; padding: 0 12px; border: 0; border-radius: 17px;
    background: var(--accent); color: var(--on-accent); font: inherit; font-size: 13px; font-weight: 800; line-height: 1; cursor: pointer; }
  /* The picked option, step by step (the mockup): the time, a rail (thick in the line's colour for a ride, dotted for a
     walk or a change), a ring at each step, the step. */
  .steps { list-style: none; margin: 12px 0 0; padding: 4px 2px 0; }
  .step { display: flex; gap: 10px; }
  .sat { flex: none; width: 42px; padding-top: 3px; color: var(--muted); font-size: 13px; font-weight: 700; line-height: 1; text-align: right; font-variant-numeric: tabular-nums; }
  .srail { flex: none; position: relative; width: 22px; display: flex; justify-content: center; }
  .srail i { position: absolute; top: 16px; bottom: 0; width: 6px; border-radius: 3px; background: var(--lb, var(--border)); }
  .step.dotted .srail i { width: 0; border-left: 4px dotted var(--accent); border-radius: 0; background: none; }
  .srail b { position: relative; z-index: 1; width: 20px; height: 20px; box-sizing: border-box; border-radius: 50%; background: var(--surface);
    border: 4px solid var(--lb, var(--accent)); }
  .step.walk .srail b { border-color: var(--muted); }
  .step.end .srail i { display: none; }
  .step.end .srail b { background: var(--nb, var(--fg)); border-color: var(--surface); box-shadow: 0 0 0 3px var(--fg); }
  .step.end .sat { color: var(--fg); font-weight: 800; }
  .sbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 9px; padding-bottom: 22px; }
  .sname { font-size: 15px; font-weight: 700; line-height: 1.15; padding-top: 2px; }
  .step.end .sname { font-weight: 800; }
  .sline { display: flex; align-items: flex-start; gap: 8px; color: var(--muted); font-size: 13px; font-weight: 500; line-height: 1.25; }
  .sline > span { flex: 1 1 auto; min-width: 0; padding-top: 3px; }
  .sline > :global(svg) { flex: none; margin-top: 2px; }
  .schip { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 7px; box-sizing: border-box; border-radius: 6px;
    background: var(--lb); color: var(--lf); font-size: 11px; font-weight: 800; line-height: 1; }
  .schip.round { border-radius: 11px; }
  .xbox { display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 16px; background: var(--card); border: 1px solid var(--card-border); }
  .xtop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .xt { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; line-height: 1; }
  .xt :global(svg) { color: var(--accent); }
  .xspare { display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 13px; background: color-mix(in srgb, var(--late1) 16%, transparent);
    color: var(--late1); font-size: 12px; font-weight: 700; line-height: 1; }
  .xspare i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .xspare.ok { background: color-mix(in srgb, var(--ontime) 14%, transparent); color: var(--ontime); }
  .xspare.tight { background: var(--bad-bg); color: var(--late3); }
  .xmap { display: block; width: 100%; height: 70px; }
  .xbg { fill: var(--surface); }
  .xroad { stroke: var(--border); stroke-width: 12; fill: none; }
  .xwalk { stroke: var(--accent); stroke-width: 3; stroke-dasharray: 2 6; stroke-linecap: round; fill: none; }
  .xlbl { fill: #fff; font: 800 10px/1 var(--font); }
  .xm { fill: var(--muted); font: 600 11px/1 var(--font); }
  .xsteps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 13px; line-height: 1.3; }
  .xsteps li { display: flex; align-items: flex-start; gap: 10px; }
  .xsteps li > b { flex: none; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: var(--control);
    font-size: 11px; font-weight: 800; line-height: 1; }
  .xsteps li > span { padding-top: 2px; }
  .xto { font-weight: 800; }
  .xmiss { display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; line-height: 1.3; }
  .startbtn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; height: 50px; margin-top: 8px; border: 0; border-radius: 25px;
    background: var(--accent); color: var(--on-accent); font: inherit; font-size: 16px; font-weight: 800; line-height: 1; cursor: pointer; }
  .go:focus-visible, .startbtn:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
  .metro { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--control); font-size: 13px; line-height: 1.4; }
  .metro :global(svg) { flex: none; margin-top: 2px; }
  .sub { margin: 14px 0 8px; font-size: 12px; color: var(--muted); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .all { margin-top: 6px; font-size: 12px; padding: 0; }
  .alert { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
  .alert span { flex: 1; }
  .alert .lead { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 8px; margin-left: -8px; border: 0;
    border-radius: 8px; background: none; color: var(--fg); font-weight: 600; font-size: 13px; cursor: pointer; }
  .alert .lead:hover { background: var(--control); }
  .alert .lead svg.up { transform: rotate(180deg); }
  .board { display: flex; align-items: center; gap: 8px; color: var(--muted); }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 8px; color: var(--muted); font-size: 12px; }
  .radius { display: flex; align-items: center; gap: 8px; }
  .note { display: block; margin: 8px 0 0; color: var(--muted); font-size: 12px; }
  .warn { margin: 8px 0 0; color: var(--late2); }
  .link { border: 0; background: none; color: var(--accent); text-decoration: underline; cursor: pointer; font-size: inherit; }
  .swap { transition: transform .35s cubic-bezier(.34, 1.56, .64, 1), background-color .15s; }
  .swap.turned { transform: rotate(180deg); }
  input:focus, input:focus-visible { outline: none; }
  .opt { transition: border-color .2s, background-color .2s, transform .12s; }
  .opt:active { transform: scale(.98); }
  @media (prefers-reduced-motion: reduce) { .swap, .opt { transition: none; } .swap.turned { transform: none; } }
</style>
