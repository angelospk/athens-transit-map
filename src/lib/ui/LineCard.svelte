<script lang="ts">
  // The card of a line, any mode, from /v2: its two directions, the vehicles now of the chosen one and,
  // for a bus line, today's runs. The vehicles are asked again every 20 s while it is open.
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { freeSheet } from "../sheetDrag";
  import { cardTitle } from "../legacy";
  import { alertLinesAt, stopIndex } from "../stops";
  import { metresBetween, walkTo } from "../now";
  import LineChip from "./LineChip.svelte";
  import type { DiagramItem } from "../linediagram";
  import { fetchV2Line, fetchV2LineVehicles, fetchV2Run, peekV2Line, peekV2LineVehicles } from "../api";
  import { glance, lineDiagram, lineSpeed, mainPattern, nextIndex, spread } from "../linediagram";
  import { titleCase } from "../nearby";
  import { LOADS, loadLabel } from "../crowd";
  import LoadIcon from "./LoadIcon.svelte";
  import { clockHM } from "../trains";
  import Icon from "./Icon.svelte";
  import { isBusId } from "../busNs";
  import { fmtDelay } from "../format";
  import { busVehicleCard } from "../legacy";
  import { directionGroups } from "../directions";
  import { dirLabels, headsignName, lineVehicleRows, vehicleDir, withDirections, type LineDetail, type V2Run, type V2Vehicle } from "../v2";
  import type { AppState } from "../state.svelte";
  import CardSheet from "./CardSheet.svelte";
  import DisruptionRows from "./DisruptionRows.svelte";
  import { forLine } from "../disruptions";
  import Timetable from "./Timetable.svelte";
  import { linesOfStop, nearby, railBadge, railPoints, stopsNear, type RailMode, type RailNear } from "../hubs";

  let { app }: { app: AppState } = $props();

  const top = $derived(app.stack.at(-1));
  const card = $derived(top?.kind === "line" && !top.id.startsWith("muni:") ? top : null);   // muni: MuniLineCard
  const native = (id: string) => id.slice(id.indexOf(":") + 1);

  let detail = $state.raw<LineDetail | null>(null);
  let vehicles = $state.raw<V2Vehicle[] | null>(null);
  let failed = $state(false);
  let missing = $state(false);   // the backend does not know the line (404, a bad link): no more asking
  let vFailed = $state(false);
  const FRESH_MS = 120_000;   // the age up to which the last vehicles still show
  const cardId = $derived(card?.id);

  // Back on a line seen a moment ago: its last data shows at once (vehicles up to 2 min old), then a new load.
  // The two loads are apart, so the patterns never wait for the vehicles; a failed load keeps what is shown.
  $effect(() => {
    const id = cardId;
    if (!id) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    untrack(() => {
      const d = peekV2Line(id), v = peekV2LineVehicles(id);
      detail = (d?.body as LineDetail | undefined) ?? null;
      vehicles = v?.at && Date.now() - v.at < FRESH_MS ? (v.body as { vehicles?: V2Vehicle[] }).vehicles ?? [] : null;
      failed = false; missing = false; vFailed = false;
    });
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        await Promise.all([
          fetchV2Line(id).then(r => {
            if (ac.signal.aborted) return;
            if (r.status === 200 && r.body) detail = r.body as LineDetail;
            failed = !detail;
            missing = !detail && r.status === 404;
          }),
          fetchV2LineVehicles(id).then(r => {
            if (ac.signal.aborted) return;
            if (r.status === 200 && r.body) vehicles = (r.body as { vehicles?: V2Vehicle[] }).vehicles ?? [];
            // A failed load keeps the last vehicles while they are young; older ones are not «now» any more.
            else if (Date.now() - (peekV2LineVehicles(id)?.at ?? 0) >= FRESH_MS) vehicles = null;
            vFailed = vehicles === null;
          }),
        ]);
        if (ac.signal.aborted) return;
      }
      if (!missing) timer = setTimeout(load, 20_000);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  const nativeLine = $derived(card ? native(card.id) : "");
  const isBus = $derived(!!card && isBusId(card.id));
  const pinId = $derived(isBus ? nativeLine : null);   // a bus or trolley line can be pinned on the map (PinSheet)
  // A bus line's directions come from its /v1 direction groups (withDirections), with their termini as labels.
  const groups = $derived(isBus && app.statics[nativeLine] ? directionGroups(app.statics[nativeLine]) : []);
  const patterns = $derived(withDirections(detail?.patterns ?? [], groups));
  // Each direction by its main pattern's last stop; with the /v1 groups, the group that holds that pattern (the
  // groups' order need not match /v2's direction numbers: 224's are the other way round).
  const ends = $derived(([0, 1] as const).map(d => {
    const p = detail ? mainPattern(patterns, d) : null;
    const last = p ? detail?.stops[p.stops[p.stops.length - 1]]?.name ?? null : null;
    return { label: last, group: p ? groups.find(g => g.variants.includes(native(p.id))) ?? null : null };
  }));
  const labels = $derived<(string | null)[]>(ends.every(e => e.label) ? ends.map(e => e.label)
    : groups.length === 2 ? groups.map(g => g.to) : dirLabels(patterns, detail?.stops));
  const dir = $derived<0 | 1>(card?.dir ?? (card?.pattern ? patterns.find(p => p.id === card.pattern)?.direction : undefined) ?? 0);
  const label = $derived(detail?.line.label ?? detail?.line.name ?? nativeLine);
  // With the /v1 directions, a vehicle's own (OASA: 0) direction is no better than its pattern's: its headsign decides.
  const own = $derived(patterns === detail?.patterns ? vehicles : vehicles?.map(v => ({ ...v, direction: null })));
  const rows = $derived(detail && own ? lineVehicleRows(own, patterns, detail.stops, dir) : null);

  // The raw headsign of the direction's most common pattern: what the day's timetable is matched on.
  const dirHeadsign = $derived.by(() => {
    const n = new Map<string, number>();
    for (const p of patterns) if (p.direction === dir) n.set(p.headsign, (n.get(p.headsign) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  });

  $effect(() => { if (detail) untrack(() => app.retitle(label)); });

  // The diagram: the direction's vehicles, their runs (each stop's times; asked again with the vehicles), and the
  // stops to mark: the stop this line was opened from, and the favourite stops.
  const dirVehicles = $derived(own && detail ? own.filter(v => vehicleDir(v, patterns) === dir) : []);
  let runs = $state.raw<Record<string, V2Run>>({});
  const runKey = $derived(dirVehicles.map(v => v.run ?? "").filter(Boolean).sort().join("|"));
  // Asked again with each vehicle poll (their passed stops and times move on); the API caches a run for 15 s.
  $effect(() => {
    void vehicles;
    if (!runKey) return;
    const ids = runKey.split("|").slice(0, 10);
    const ac = new AbortController();
    void Promise.all(ids.map(id => fetchV2Run(id).then(r => {
      const run = (r.body as { run?: V2Run } | null)?.run;
      if (!ac.signal.aborted && r.status === 200 && run) runs = { ...runs, [id]: run };
    }).catch(() => {})));
    return () => ac.abort();
  });
  const here = $derived.by(() => {
    const below = app.stack.length > 1 ? app.stack[app.stack.length - 2] : null;
    return new Set([...(below?.kind === "stop" ? [below.id] : []), ...app.favs.stops.map(s => s.id)]);
  });
  const nowS = $derived(app.serverNow / 1000);
  const pattern = $derived(detail ? mainPattern(patterns, dir, dirVehicles, runs) : null);
  const diagram = $derived(pattern && detail ? lineDiagram(pattern, detail.stops, dirVehicles, runs, nowS, here) : []);
  const stats = $derived(glance(dirVehicles, runs, nowS));
  const speed = $derived(pattern && detail ? lineSpeed(pattern, detail.stops, dirVehicles, runs) : null);
  const etaText = (at: number | null) => {
    if (at == null) return "";
    const m = Math.round((at - nowS) / 60);
    return m <= 0 ? "τώρα" : m < 60 ? `${m}′` : clockHM(at);
  };
  const delayTone = (d: number | null) => (d == null ? "none" : d >= 600 ? "late3" : d >= 300 ? "late2" : d >= 120 ? "late1" : "ontime");
  const delayText = (d: number | null) => (d == null ? "χωρίς δρομολόγιο" : d >= 120 ? `+${Math.round(d / 60)}′ καθυστέρηση` : "στην ώρα του");
  // «Ακολούθησε σε 3D»: the bus that reaches a marked stop first, else the first on the line.
  const chaseTarget = $derived.by(() => {
    const k = diagram.findIndex(i => i.kind === "stop" && i.here);
    const before = (k >= 0 ? diagram.slice(0, k) : diagram).filter(i => i.kind === "vehicle");
    const v = (before.at(-1) ?? diagram.find(i => i.kind === "vehicle")) as { vehicle: V2Vehicle } | undefined;
    return v?.vehicle ?? null;
  });
  function follow() {
    const v = chaseTarget;
    if (!v) return;
    open(v);
    if (isBus) app.setChase(`${nativeLine}/${native(v.id)}`);
  }

  // Opened, the diagram scrolls to the marked stop once (it can be 30 stops down).
  const MODES: Record<string, string> = { bus: "Λεωφορείο", trolley: "Τρόλεϊ", tram: "Τραμ", metro: "Μετρό", rail: "Προαστιακός", suburban: "Προαστιακός" };
  // The diagram's first and last stops (Αφετηρία, Τέρμα), and where the line goes.
  const firstStop = $derived(diagram.findIndex(i => i.kind === "stop"));
  // How its vehicles are spread along the way (linediagram.ts spread): a strip under the glance on a phone, a card over
  // the map's lower right on a computer (moved to <body>: the card's sheet would clip it).
  const sp = $derived(spread(diagram));
  let wide = $state(typeof matchMedia === "function" && matchMedia("(min-width: 1024px)").matches);
  $effect(() => {
    const q = matchMedia("(min-width: 1024px)"), on = () => (wide = q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  });
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
  const lastStopAt = $derived(diagram.reduce((at, i, k) => (i.kind === "stop" ? k : at), -1));
  const lastStop = $derived(lastStopAt >= 0 ? (diagram[lastStopAt] as { name: string }).name : "");
  const firstHere = $derived(diagram.findIndex(i => i.kind === "stop" && i.here));
  let scrolledFor = "";
  function scrollHere(el: HTMLElement) {
    const k = untrack(() => `${card?.id}|${dir}`);
    if (scrolledFor === k) return;
    scrolledFor = k;
    el.scrollIntoView({ block: "center" });
  }

  // ---- Changes along the line (hubs.ts): at each stop the stations a short walk away, and the bus lines that join here
  // (at the stop or next to it, and not at the two stops before: where lines cross, not every stop of a shared street).
  $effect(() => { if (card && !app.stopIx) void app.loadStops(); });
  const rail = $derived(railPoints(app.metro, app.suburban));
  const railColors = $derived(Object.fromEntries((app.metro?.lines ?? []).map(l => [l.id, l.color])));
  type Conn = { rail: RailNear[]; bus: string[] };
  const conns = $derived.by(() => {
    const out = new Map<string, Conn>();
    if (!pattern || !detail) return out;
    const ix = app.stopIx, own = nativeLine;
    const busAt = (id: string): Set<string> => {
      const st = detail!.stops[id];
      if (!ix || !st || !isBus) return new Set();
      return new Set(stopsNear(ix, [st.lat, st.lon], 120).flatMap(s => linesOfStop(ix, s.i)).filter(l => l !== own));
    };
    const seen: Set<string>[] = [];
    for (const id of pattern.stops) {
      const st = detail.stops[id];
      const here = busAt(id);
      const before = new Set([...(seen.at(-1) ?? []), ...(seen.at(-2) ?? [])]);
      seen.push(here);
      if (!st) continue;
      const r = nearby(null, rail, [st.lat, st.lon], { railM: 250 }).rail
        .map(x => ({ ...x, lines: x.lines.filter(l => l !== own) })).filter(x => x.lines.length);
      out.set(id, { rail: r, bus: [...here].filter(l => !before.has(l)) });
    }
    return out;
  });
  // «Μόνο αλλαγές»: the stops with a change of the kind picked; the rest in runs («6 στάσεις χωρίς αλλαγή»).
  let onlyChanges = $state(false);
  let changeMode = $state<"all" | RailMode | "bus">("all");
  $effect(() => { void card?.id; onlyChanges = false; changeMode = "all"; });
  const hasChange = (c: Conn | undefined) => !!c && (changeMode === "all" ? c.rail.length > 0 || c.bus.length > 0
    : changeMode === "bus" ? c.bus.length > 0 : c.rail.some(r => r.mode === changeMode));
  const modesHere = $derived(new Set([...conns.values()].flatMap(c => c.rail.map(r => r.mode))));
  type ViewItem = (typeof diagram)[number] | { kind: "gap"; id: string; n: number };
  const view = $derived.by<ViewItem[]>(() => {
    if (!onlyChanges) return diagram;
    const out: ViewItem[] = [];
    let gap = 0;
    diagram.forEach((it, k) => {
      if (it.kind !== "stop") return;
      const keep = k === firstStop || k === lastStopAt || it.here || hasChange(conns.get(it.id));
      if (!keep) { gap++; return; }
      if (gap) out.push({ kind: "gap", id: `gap-${it.id}`, n: gap });
      gap = 0;
      out.push(it);
    });
    return out;
  });

  // The map: the line's stops with a station near, as badges on it (MapView), while the card is open.
  $effect(() => {
    if (!detail || !pattern) { app.lineHubs = []; return; }
    app.lineHubs = pattern.stops.flatMap(id => {
      const c = conns.get(id), st = detail!.stops[id];
      if (!c?.rail.length || !st) return [];
      const badges = [...new Set(c.rail.flatMap(r => r.lines))].map(l => railBadge(l, railColors));
      return [{ id, name: titleCase(st.name), at: [st.lon, st.lat] as [number, number], badges, more: c.bus.length }];
    });
    return () => { app.lineHubs = []; };
  });

  let showTimes = $state(false);
  const color = $derived(isBus ? app.lineColor(nativeLine) : { bg: detail?.line.color ?? "#3b5bdb", fg: detail?.line.text_color ?? "#ffffff" });
  const starred = $derived(!!card && app.isFavLine(card.id));
  const disruptions = $derived(card ? forLine(app.disruptions, card.id, app.serverNow) : []);

  function open(v: V2Vehicle) {
    if (isBus) {
      app.push(busVehicleCard(nativeLine, native(v.id)));   // the map moves to the bus (MapView)
    } else {
      app.push({ kind: "vehicle", id: v.id, line: card!.id, title: `${label} → ${headsignName(v.headsign, detail?.stops)}` });
      app.flyTo([v.position.lon, v.position.lat]);
    }
  }
  // A bus line's map shows the chosen direction only (as a line opened from a stop does).
  function pick(d: 0 | 1) {
    const c = card!, g = ends[d].group ?? (ends.every(e => e.label) ? null : groups[d]);
    app.replaceTop({ ...c, dir: d, pattern: undefined });
    if (g && groups.length === 2) app.setFocus(nativeLine, g.variants);   // the segments are the two groups
  }

  // ---- A phone (compact mockup 13): a sheet to the screen's edges, the line's chip and where it goes, and the stop list
  // folded round the user's stop, which opens inside the list with its next arrivals; «Ξεκίνα» and the bell at the foot.
  // A computer keeps the card above (CardSheet).
  const narrow = new MediaQuery("(max-width: 719px)");
  const vName = $derived(detail?.line.mode === "trolley" ? "Τρόλεϊ" : isBus ? "Λεωφορείο" : "Όχημα");
  type StopItem = Extract<DiagramItem, { kind: "stop" }>;
  type VehItem = Extract<DiagramItem, { kind: "vehicle" }>;
  let chosen = $state<string | null>(null);   // a stop tapped in the list: it opens instead
  let openBefore = $state(false), openAfter = $state(false);
  let alertFor = $state.raw<{ name: string; lines: ReturnType<typeof alertLinesAt> } | null>(null);
  $effect(() => { void card?.id; void dir; chosen = null; openBefore = false; openAfter = false; alertFor = null; });

  // The user's stop on this direction: the one tapped, the stop the line was opened from, the nearest (up to 1.5 km),
  // a favourite stop, else the line's first stop (where the timetable's runs leave from).
  const nearestId = $derived.by(() => {
    const me = app.myPos;
    if (!me || !pattern || !detail) return null;
    let best: string | null = null, bm = 1500;
    for (const id of pattern.stops) {
      const s = detail.stops[id];
      const m = s ? metresBetween(me, [s.lat, s.lon]) : Infinity;
      if (m < bm) { bm = m; best = id; }
    }
    return best;
  });
  const focusId = $derived.by(() => {
    if (!pattern) return null;
    const has = (id: string | null | undefined): id is string => !!id && pattern.stops.includes(id);
    const below = app.stack.length > 1 ? app.stack[app.stack.length - 2] : null;
    if (has(chosen)) return chosen;
    if (below?.kind === "stop" && has(below.id)) return below.id;
    if (has(nearestId)) return nearestId;
    return pattern.stops.find(id => app.favs.stops.some(s => s.id === id)) ?? pattern.stops[0] ?? null;
  });
  const focusAt = $derived(focusId ? diagram.findIndex(i => i.kind === "stop" && i.id === focusId) : -1);
  const focusStop = $derived(focusAt >= 0 ? (diagram[focusAt] as StopItem) : null);
  const focusWhy = $derived.by(() => {
    const st = focusId ? detail?.stops[focusId] : undefined;
    const walk = st ? walkTo(app.myPos, st) : null;
    const why = focusId && focusId === nearestId ? "η πιο κοντινή" : focusId && app.favs.stops.some(s => s.id === focusId) ? "αγαπημένη στάση" : "";
    return [why, walk != null ? `${walk}′ με τα πόδια` : ""].filter(Boolean).join(" · ");
  });
  // At the user's stop: the coming arrivals (soonest first, from the runs of the direction's vehicles), the last one gone.
  const focusTimes = $derived.by(() => {
    const next: { at: number; live: boolean; v: V2Vehicle; run: V2Run }[] = [];
    let gone: number | null = null;
    if (!focusId) return { next, gone };
    for (const v of dirVehicles) {
      const run = v.run ? runs[v.run] : undefined;
      const s = run?.stops.find(x => x.stop === focusId);
      if (!run || !s) continue;
      if (s.passed || s.at < nowS - 60) gone = Math.max(gone ?? 0, s.at);
      else next.push({ at: s.at, live: s.source === "live", v, run });
    }
    next.sort((a, b) => a.at - b.at);
    return { next, gone };
  });
  const focusNote = $derived.by(() => {
    const n = focusTimes.next[0];
    const what = `το ${vName.toLocaleLowerCase("el")}`;
    if (n && pattern && focusId) {
      const k = nextIndex(n.v, pattern.stops, n.run), f = pattern.stops.indexOf(focusId);
      const away = k != null && f >= k ? f - k : null;
      const where = away == null ? "" : away === 0 ? `${what} πλησιάζει` : `${what} είναι ${away} ${away === 1 ? "στάση" : "στάσεις"} πριν`;
      return [`${n.live ? "Ζωντανά" : "Από το πρόγραμμα"}: ${where || what}`, delayText(n.v.delay_s)].join(" · ");
    }
    if (vehicles === null) return vFailed ? "Δεν φόρτωσαν τα οχήματα. Νέα προσπάθεια σε λίγο." : "";
    return `Κανένα ${label} με GPS τώρα${focusTimes.gone ? ` · πέρασε ${clockHM(focusTimes.gone)}` : ""}`;
  });
  // A stop after the user's: how much later the bus that comes to the user's stop gets there («+3′»).
  const later = (id: string) => {
    const n = focusTimes.next[0];
    const s = n?.run.stops.find(x => x.stop === id && !x.passed);
    if (!n || !s || s.at < n.at) return "";
    return `+${Math.round((s.at - n.at) / 60)}′`;
  };
  // «Ξεκίνα»: riding behind the bus that comes to the user's stop (3D), else the first on the line.
  const comingBus = $derived.by(() => {
    if (focusAt < 0) return chaseTarget;
    for (let k = focusAt - 1; k >= 0; k--) { const it = diagram[k]; if (it.kind === "vehicle") return it.vehicle; }
    return chaseTarget;
  });
  function start() {
    const v = comingBus;
    if (!v) return;
    open(v);
    if (isBus) app.setChase(`${nativeLine}/${native(v.id)}`);
  }

  // The bell at the user's stop: the alert sheet for this line's variants of the direction (where the city has alerts).
  const focusIx = $derived(isBus && focusId && app.stopIx ? stopIndex(app.stopIx, native(focusId)) : -1);
  const bellLines = $derived.by(() => {
    if (!app.cityInfo.alerts || !app.stopIx || focusIx < 0) return [];
    const want = ends[dir].group?.variants ?? (groups.length === 2 ? groups[dir]?.variants : null);
    return alertLinesAt(app.stopIx, focusIx, [nativeLine]).map(l => {
      const vs = want ? l.variants.filter(v => want.includes(v.id)) : [];
      return { ...l, variants: vs.length ? vs : l.variants };
    }).filter(l => l.variants.length);
  });
  const bellOn = $derived(!!app.alert?.lines.some(l => l.line === nativeLine));
  function bell() {
    if (!bellLines.length || !focusStop) return;
    alertFor = alertFor ? null : { name: titleCase(focusStop.name), lines: bellLines };
  }

  // The list's rows: the stops before the user's folded into one (the bus coming to it kept), the user's stop open,
  // two stops after it, the rest folded.
  type PRow =
    | { kind: "fold"; side: "before" | "after"; open: boolean; text: string }
    | { kind: "stop"; it: StopItem; past: boolean; first: boolean; last: boolean }
    | { kind: "vehicle"; it: VehItem; past: boolean }
    | { kind: "focus"; it: StopItem; first: boolean; last: boolean };
  const prows = $derived.by<PRow[]>(() => {
    const row = (it: DiagramItem, k: number, past: boolean): PRow =>
      it.kind === "vehicle" ? { kind: "vehicle", it, past } : { kind: "stop", it, past, first: k === firstStop, last: k === lastStopAt };
    if (focusAt < 0) return diagram.map((it, k) => row(it, k, false));
    const out: PRow[] = [];
    const before = diagram.slice(0, focusAt);
    const nBefore = before.filter(i => i.kind === "stop").length;
    if (nBefore > 1 && !openBefore) {
      out.push({ kind: "fold", side: "before", open: false, text: `από ${titleCase((diagram[firstStop] as StopItem).name)} · οι στάσεις πριν` });
      for (let k = before.length - 1; k >= 0; k--) if (before[k].kind === "vehicle") { out.push(row(before[k], k, true)); break; }
    } else {
      if (nBefore > 1) out.push({ kind: "fold", side: "before", open: true, text: "Λιγότερες στάσεις" });
      before.forEach((it, k) => out.push(row(it, k, true)));
    }
    out.push({ kind: "focus", it: diagram[focusAt] as StopItem, first: focusAt === firstStop, last: focusAt === lastStopAt });
    const after = diagram.slice(focusAt + 1);
    let cut = after.length;
    for (let j = 0, n = 0; j < after.length; j++) if (after[j].kind === "stop" && ++n === 2) { cut = j + 1; break; }
    const rest = after.slice(cut).filter(i => i.kind === "stop").length;
    (rest > 1 && !openAfter ? after.slice(0, cut) : after).forEach((it, j) => out.push(row(it, focusAt + 1 + j, false)));
    if (rest > 1) out.push({ kind: "fold", side: "after", open: openAfter, text: openAfter ? "Λιγότερες στάσεις" : `ως ${titleCase(lastStop)} · οι υπόλοιπες` });
    return out;
  });
  // The rail beside a row, its upper and lower half: grey up to the user's stop, the line's colour from it on, none
  // above the line's first stop and below its last.
  const OFF = "var(--rail-off)", ON = "var(--lc)", NONE = "transparent";
  function railOf(r: PRow): { t: string; b: string } {
    const past = r.kind !== "focus" && r.kind !== "fold" ? r.past : r.kind === "fold" && r.side === "before";
    const first = (r.kind === "stop" || r.kind === "focus") && r.first, last = (r.kind === "stop" || r.kind === "focus") && r.last;
    return { t: first ? NONE : past || r.kind === "focus" ? (focusAt >= 0 ? OFF : ON) : ON, b: last ? NONE : past ? OFF : ON };
  }
  const rowKey = (r: PRow) => (r.kind === "fold" ? `fold-${r.side}` : `${r.kind}-${r.it.id}`);
  const toLabel = $derived(titleCase(labels[dir] ?? lastStop));
  const below = $derived(app.stack.length > 1 ? app.stack[app.stack.length - 2] : null);
  async function share() {
    const text = `Γραμμή ${label} προς ${toLabel}`, url = location.href;
    try {
      if (navigator.share) { await navigator.share({ text, url }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); app.notify("Ο σύνδεσμος αντιγράφηκε"); }
    catch { app.notify("Δεν έγινε η αποστολή"); }
  }
</script>

{#snippet strip()}
  <div class="sph">
    <b>Πώς απλώνονται {isBus ? "τα λεωφορεία" : "τα οχήματα"}</b>
    {#if sp.bunch}<span class="bn">{sp.bunch.n} μαζί πριν από {titleCase(sp.bunch.before)}</span>{:else}<span class="ev">Ομοιόμορφα</span>{/if}
  </div>
  <div class="track" style:--lc={color.bg}>
    <i class="rail"></i>
    {#each sp.dots as d (d.id)}<span class="sd" class:bunched={d.bunched} style:left="{d.x * 100}%"></span>{/each}
  </div>
  <div class="spe"><span>{titleCase((diagram[firstStop] as { name: string } | undefined)?.name ?? "")}</span><span>{titleCase(lastStop)}</span></div>
{/snippet}

<svelte:window onkeydown={e => { if (e.key === "Escape" && card && narrow.current && !alertFor) app.closeCards(); }} />

{#if card && narrow.current}
  <!-- Over the map: back (to the card below, or closed) and share. -->
  <div class="ptop">
    <button type="button" class="pround" aria-label={below ? `Πίσω στο ${cardTitle(below)}` : "Πίσω"} title={below ? `Πίσω στο ${cardTitle(below)}` : "Πίσω"}
      onclick={() => (below ? app.back() : app.closeCards())}><Icon name="back" size={20} /></button>
    <button type="button" class="pround" aria-label="Μοιράσου τη γραμμή" title="Μοιράσου τη γραμμή" onclick={share}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v7h14v-7" /></svg>
    </button>
  </div>
  <section class="psheet" aria-label="Γραμμή {label}" use:freeSheet={{ handles: ".grip, .psheet > header", keep: 120, on: () => narrow.current }}>
    <div class="grip" aria-hidden="true"></div>
    <header>
      <LineChip {label} bg={color.bg} fg={color.fg} mode={detail?.line.mode ?? (isBus ? "bus" : "")} size="lg" city={app.cityId} />
      <span class="pt">
        <b>{detail ? `προς ${toLabel}` : label}</b>
        {#if pattern && detail?.stops[pattern.stops[0]]}<small>από {titleCase(detail.stops[pattern.stops[0]].name)}</small>{/if}
      </span>
      {#if detail && labels.filter(l => l !== null).length === 2}
        <button type="button" class="pcircle" aria-label="Άλλη κατεύθυνση: προς {titleCase(labels[1 - dir] ?? '')}" title="Άλλη κατεύθυνση: προς {titleCase(labels[1 - dir] ?? '')}"
          onclick={() => pick((1 - dir) as 0 | 1)}><Icon name="swap" size={18} /></button>
      {/if}
      <button type="button" class="pcircle star" class:on={starred} aria-pressed={starred} aria-label={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
        title={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"} onclick={() => app.toggleFavLine({ id: card.id, label })}><Icon name={starred ? "star-filled" : "star"} size={18} /></button>
    </header>
    <DisruptionRows alerts={disruptions} />
    {#if missing}
      <p class="muted">Η γραμμή δεν βρέθηκε.</p>
    {:else if failed}
      <p class="muted">Δεν φόρτωσε η γραμμή. Δοκίμασε ξανά.</p>
    {:else if !detail || !diagram.length}
      <p class="muted">Φόρτωση…</p>
    {:else}
      <div class="pscroll">
        <ol class="plist" aria-live="polite" aria-label="Οι στάσεις, προς {titleCase(lastStop)}" style:--lc={color.bg} style:--lt={color.fg}>
          {#each prows as r (rowKey(r))}
            {@const rl = railOf(r)}
            {#if r.kind === "fold"}
              <li><button type="button" class="prow fold" aria-expanded={r.open}
                onclick={() => (r.side === "before" ? (openBefore = !openBefore) : (openAfter = !openAfter))}>
                <span class="rl" style:--t={rl.t} style:--b={rl.b}></span>
                <span class="ft"><span>{r.text}</span><Icon name="chevron" size={12} /></span>
              </button></li>
            {:else if r.kind === "focus"}
              {@const nx = focusTimes.next}
              <li class="pfocus">
                <span class="rl" style:--t={rl.t} style:--b={rl.b}><i class="fdot"></i></span>
                <div class="fc">
                  <div class="fch">
                    <span class="fcl"><b>{titleCase(r.it.name)}</b>{#if focusWhy}<small>{focusWhy}</small>{/if}</span>
                    {#if nx.length}
                      <span class="fcr"><b>{etaText(nx[0].at)}</b><small>{(nx.length > 1 ? nx.slice(1, 3) : nx).map(n => clockHM(n.at)).join(" · ")}</small></span>
                    {/if}
                  </div>
                  {#if focusNote}<p class="fcn">{focusNote}</p>{/if}
                  {#if bellLines.length || isBus}
                    <div class="fca">
                      {#if bellLines.length}<button type="button" class="fbtn" class:on={bellOn} onclick={bell}><Icon name="bell" size={14} /><span>Πες μου</span></button>{/if}
                      {#if isBus}<button type="button" class="fbtn" aria-expanded={showTimes} aria-controls="card-times" onclick={() => (showTimes = !showTimes)}><Icon name="clock" size={14} /><span>Όλο το πρόγραμμα</span></button>{/if}
                    </div>
                  {/if}
                </div>
              </li>
            {:else if r.kind === "vehicle"}
              {@const it = r.it}
              <li><button type="button" class="prow veh" onclick={() => open(it.vehicle)} aria-label="{vName} {it.label ?? ''}, {delayText(it.delay_s)}">
                <span class="rl" style:--t={rl.t} style:--b={rl.b}><i class="pbus"><Icon name="bus" size={13} /></i></span>
                <span class="pn">{vName}{it.label ? ` #${it.label}` : ""}</span>
                {#if it.vehicle.occupancy}{@const o = it.vehicle.occupancy}
                  <span class="occ {o.level}" title="{loadLabel(o.level)}, από {o.reports} {o.reports === 1 ? 'επιβάτη' : 'επιβάτες'}"><LoadIcon level={LOADS.find(x => x.value === o.level)?.level ?? 0} size={11} /><span>{loadLabel(o.level)}</span></span>
                {/if}
                <span class="pv vt {delayTone(it.delay_s)}">{delayText(it.delay_s)}</span>
              </button></li>
            {:else}
              {@const it = r.it}
              {@const when = focusAt >= 0 && !r.past ? later(it.id) : etaText(it.at)}
              <li><button type="button" class="prow" class:past={r.past} onclick={() => { chosen = it.id; openBefore = false; openAfter = false; }} aria-label="{titleCase(it.name)}{when ? `, ${when}` : ''}">
                <span class="rl" style:--t={rl.t} style:--b={rl.b}><i class="pdot"></i></span>
                <span class="pn">{titleCase(it.name)}</span>
                {#if when}<span class="pv">{when}</span>{/if}
              </button></li>
            {/if}
          {/each}
        </ol>
        {#if isBus && showTimes}
          <div id="card-times" class="ptimes"><Timetable line={nativeLine} headsign={dirHeadsign} now={app.serverNow} /></div>
        {/if}
      </div>
      <div class="pfoot">
        <button type="button" class="pgo" disabled={!comingBus} title={isBus ? "Ακολούθησε σε 3D το λεωφορείο που έρχεται" : "Το επόμενο όχημα"} onclick={start}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg><span>Ξεκίνα</span>
        </button>
        {#if bellLines.length}
          <button type="button" class="pbell" class:on={bellOn} aria-label="Ειδοποίησέ με" title="Ειδοποίησέ με" onclick={bell}><Icon name="bell" size={20} /></button>
        {/if}
      </div>
    {/if}
  </section>
  {#if alertFor}
    {@const a = alertFor}
    {#await import("./AlertSheet.svelte") then m}
      <m.default {app} lines={a.lines} label={a.name} line={nativeLine} toward={toLabel} ticked={[nativeLine]} onclose={() => (alertFor = null)} />
    {/await}
  {/if}
{:else if card}
  <CardSheet {app} key={card.id} starred={starred} starLabel={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
    onstar={() => app.toggleFavLine({ id: card.id, label })}
    pinColor={pinId ? app.pinOf("line", pinId)?.color : null}
    onpin={pinId ? () => (app.pinEdit = app.pinOf("line", pinId) ?? { kind: "line", id: pinId, label, color: "#b58cff", width: 2, vehicles: true, top: true }) : undefined}>
    {#snippet header()}
      <span class="pill" style:--c={color.bg} style:--t={color.fg}>{label}</span>
      <div class="tt">
        <h2>{titleCase(detail?.line.name ?? "")}</h2>
        <small>{MODES[detail?.line.mode ?? ""] ?? "Γραμμή"}{stats.everyMin != null ? ` · κάθε ${stats.everyMin}′` : ""}</small>
      </div>
    {/snippet}
    <DisruptionRows alerts={disruptions} />
    {#if missing}
      <p class="muted">Η γραμμή δεν βρέθηκε.</p>
    {:else if failed}
      <p class="muted">Δεν φόρτωσε η γραμμή. Δοκίμασε ξανά.</p>
    {:else if !detail}
      <p class="muted">Φόρτωση…</p>
    {:else}
      <div class="dirs" role="group" aria-label="Κατεύθυνση">
        {#each labels as l, d (d)}
          {#if l !== null}
            <button type="button" aria-pressed={dir === d} onclick={() => pick(d as 0 | 1)} title="Προς {titleCase(l)}"><span class="dl">Προς {titleCase(l)}</span></button>
          {/if}
        {/each}
      </div>

      <!-- At a glance -->
      <div class="glance">
        <div><b>{rows ? stats.count : "–"}</b><span>εν κινήσει</span></div>
        <div><b class={stats.delayMin != null && stats.delayMin >= 2 ? "late" : ""}>{stats.delayMin == null ? "–" : stats.delayMin >= 1 ? `+${stats.delayMin}′` : "0′"}</b><span>μέση καθυστέρηση</span></div>
        <div><b>{speed == null ? "–" : `${speed} χλμ/ω`}</b><span>ταχύτητα γραμμής</span></div>
      </div>

      {#if sp.dots.length > 1}
        {#if wide}
          <section class="spread float" use:portal aria-label="Πώς απλώνονται τα οχήματα">{@render strip()}</section>
        {:else}
          <section class="spread" aria-label="Πώς απλώνονται τα οχήματα">{@render strip()}</section>
        {/if}
      {/if}

      <!-- The line, stop by stop, with its buses between the stops -->
      {#if diagram.length}
        <!-- Which way: the line runs down the rail, from the first stop to the last. -->
        <p class="way"><Icon name="down" size={14} /><span>Η γραμμή πάει από πάνω προς τα κάτω, <b>προς {titleCase(lastStop)}</b></span></p>
        <div class="chg" role="group" aria-label="Ποιες στάσεις">
          <button type="button" aria-pressed={!onlyChanges} onclick={() => (onlyChanges = false)}>Όλες οι στάσεις</button>
          <button type="button" aria-pressed={onlyChanges} onclick={() => (onlyChanges = true)}><Icon name="swap" size={15} /><span>Μόνο αλλαγές</span></button>
        </div>
        {#if onlyChanges}
          <div class="chmodes" role="group" aria-label="Αλλαγή με">
            {#each [["all", "Όλα"], ["metro", "Μετρό"], ["tram", "Τραμ"], ["suburban", "Προαστιακός"], ["bus", "Λεωφορείο"]] as [m, t] (m)}
              {#if m === "all" || (m === "bus" ? isBus : modesHere.has(m as RailMode))}
                <button type="button" aria-pressed={changeMode === m} onclick={() => (changeMode = m as typeof changeMode)}>{t}</button>
              {/if}
            {/each}
          </div>
        {/if}
        <ol class="diagram" aria-live="polite" aria-label="Οι στάσεις και τα λεωφορεία, προς {titleCase(lastStop)}" style:--lc={color.bg} style:--lt={color.fg}>
          {#each view as it, k (it.kind + it.id)}
            {#if it.kind === "gap"}
              <li class="gap"><button type="button" onclick={() => (onlyChanges = false)}>{it.n} {it.n === 1 ? "στάση" : "στάσεις"} χωρίς αλλαγή</button></li>
            {:else if it.kind === "vehicle"}
              {@const nextStop = view.slice(k + 1).find(x => x.kind === "stop") as { name: string } | undefined}
              <!-- A bus where it is now: on the rail, between the stop it left and the one it drives to. -->
              <li class="veh"><button type="button" onclick={() => open(it.vehicle)}
                aria-label="Λεωφορείο {it.label ?? ''}, {delayText(it.delay_s)}{nextStop ? `, πλησιάζει ${titleCase(nextStop.name)}` : ''}">
                <span class="vbus"><Icon name="bus" size={15} /><i class="vtone {delayTone(it.delay_s)}"></i></span>
                <span class="vtxt">
                  <b>Λεωφορείο εδώ <span class="vt {delayTone(it.delay_s)}">· {delayText(it.delay_s)}</span></b>
                  <small>{nextStop ? `επόμενη στάση ${titleCase(nextStop.name)}` : "στο τέλος της γραμμής"}{it.label ? ` · #${it.label}` : ""}{it.vehicle.position.kind === "crowd" ? ` · θέση από ${it.vehicle.position.riders ?? 2} επιβάτες` : ""}</small>
                </span>
                {#if it.vehicle.occupancy}{@const o = it.vehicle.occupancy}
                  <span class="occ {o.level}" title="{loadLabel(o.level)}, από {o.reports} {o.reports === 1 ? 'επιβάτη' : 'επιβάτες'}"><LoadIcon level={LOADS.find(x => x.value === o.level)?.level ?? 0} size={11} /><span>{loadLabel(o.level)}</span></span>
                {/if}
                <Icon name="chevron" size={14} />
              </button></li>
            {:else}
              {@const first = it.id === (diagram[firstStop] as { id: string } | undefined)?.id}
              {@const last = it.id === (diagram[lastStopAt] as { id: string } | undefined)?.id}
              {@const c = conns.get(it.id)}
              <li class="st" class:here={it.here} class:end={first || last} {@attach !onlyChanges && k === firstHere ? scrollHere : undefined}>
                <span class="sdot"></span>
                <span class="sname">
                  <span class="nm">{titleCase(it.name)}</span>
                  {#if first}<span class="tag">Αφετηρία</span>{:else if last}<span class="tag">Τέρμα</span>{/if}
                  {#if it.here}<span class="tag here">εδώ</span>{/if}
                  {#if c && (c.rail.length || (onlyChanges && c.bus.length))}
                    <span class="conn">
                      {#each c.rail as r (r.name + r.mode)}{#each r.lines as l (l)}{@const b = railBadge(l, railColors)}<b class="rb" class:round={b.round} style:--rb={b.color}>{b.label}</b>{/each}{/each}
                      {#if c.rail.length}<small>{c.rail[0].m < 60 ? "δίπλα" : `${c.rail[0].walk}′`}</small>{/if}
                      {#if onlyChanges && c.bus.length}<small class="more">+{c.bus.length} {c.bus.length === 1 ? "γραμμή" : "γραμμές"}</small>{/if}
                    </span>
                  {/if}
                </span>
                <span class="seta" class:sched={!it.live}>{etaText(it.at)}</span>
              </li>
            {/if}
          {/each}
        </ol>
      {:else}
        <p class="muted">{rows ? (rows.length ? "Φόρτωση στάσεων…" : "Κανένα όχημα σε αυτή την κατεύθυνση τώρα.") : vFailed ? "Δεν φόρτωσαν τα οχήματα. Νέα προσπάθεια σε λίγο." : "Φόρτωση…"}</p>
      {/if}

      <div class="acts">
        {#if chaseTarget}
          <button type="button" class="primary" onclick={follow}><Icon name="cube" size={18} /><span>{isBus ? "Ακολούθησε σε 3D" : "Το επόμενο όχημα"}</span></button>
        {/if}
        {#if isBus}
          <button type="button" class="ghost" aria-expanded={showTimes} aria-controls="card-times" onclick={() => (showTimes = !showTimes)}>Πρόγραμμα</button>
        {/if}
      </div>
      {#if isBus && showTimes}
        <div id="card-times"><Timetable line={nativeLine} headsign={dirHeadsign} now={app.serverNow} /></div>
      {:else if !isBus}
        <p class="muted">Το πρόγραμμα της ημέρας έρχεται σύντομα.</p>
      {/if}
    {/if}
  </CardSheet>
{/if}

<style>
  /* How full a bus is, from its riders: a small pill in the level's tone. */
  .occ { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 13px; font-size: 12px; font-weight: 700;
    line-height: 1; white-space: nowrap; background: color-mix(in srgb, var(--t) 14%, transparent); color: var(--t); }
  .occ.empty { --t: var(--ontime); } .occ.some { --t: var(--late1); } .occ.full { --t: var(--late3); }
  /* The line's name over two lines at most (cut with …), its kind and how often under it, never over it. */
  .tt { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
  .tt small { flex: none; font-size: 12px; line-height: 1.25; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tt :global(h2) { flex: none !important; white-space: normal !important; overflow: hidden !important; font-size: 15px !important; line-height: 1.25 !important;
    max-height: 2.5em; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .muted { margin: 4px 0; color: var(--muted); font-size: 13px; }
  .dirs { display: flex; height: 44px; padding: 4px; border-radius: 22px; background: var(--card); box-sizing: border-box; }
  .dirs button { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; padding: 0 10px; border: 0; border-radius: 18px;
    background: none; color: var(--muted); font: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dirs button[aria-pressed="true"] { background: var(--fg); color: var(--surface); font-weight: 700; }
  .dirs .dl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dirs button { transition: background-color .2s, color .2s; }
  .glance { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
  .glance div { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 14px; background: var(--card); }
  .glance b { font-size: 18px; font-weight: 800; line-height: 1; }
  .glance b.late { color: var(--late2); }
  .glance span { font-size: 11px; line-height: 1.1; color: var(--muted); }

  /* The diagram: a rail in the line's colour (--lc), the stops on it, the vehicles between them. */
  .diagram { position: relative; list-style: none; margin: 0; padding: 0; }
  /* The rail (the way it runs is said once above it, in .way). */
  .diagram::before { content: ""; position: absolute; left: 21px; top: 22px; bottom: 22px; width: 4px; border-radius: 2px; background: var(--lc); opacity: .85; }
  .way { display: flex; align-items: center; gap: 8px; margin: 12px 0 8px; padding: 10px 12px; border-radius: 12px; background: var(--card);
    font-size: 12px; line-height: 1.3; color: var(--muted); }
  .way b { color: var(--fg); font-weight: 700; }
  .way :global(svg) { flex: none; color: var(--lc, var(--accent)); }
  .st { position: relative; display: flex; align-items: center; gap: 14px; min-height: 44px; padding-left: 15px; }
  .sdot { flex: none; width: 16px; height: 16px; border-radius: 50%; background: var(--surface); border: 3px solid var(--lc); box-sizing: border-box; }
  .st.here .sdot { background: var(--accent); border-color: var(--surface); box-shadow: 0 0 0 3px var(--accent); }
  .sname { flex: 1; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; font-size: 14px; line-height: 1.2; padding: 6px 0; }
  .nm { min-width: 0; overflow-wrap: anywhere; }
  .tag { flex: none; display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 10px; background: var(--control);
    color: var(--muted); font-size: 11px; font-weight: 700; line-height: 1; }
  .tag.here { background: var(--accent-bg); color: var(--accent); }
  .st.end .sdot { width: 18px; height: 18px; background: var(--lc); border-color: var(--lc); }
  .st.end .nm { font-weight: 700; }
  .st.here .sname { font-weight: 800; }
  .mark { color: var(--accent); font-weight: 700; }
  .seta { flex: none; font-size: 14px; font-weight: 700; line-height: 1; color: var(--fg); opacity: .85; font-variant-numeric: tabular-nums; }
  .seta.sched { color: var(--muted); font-weight: 600; }
  .st.here .seta { color: var(--accent); opacity: 1; }
  /* A bus on the rail: its icon in the line's colour (a dot for how late), where it is heading, and its delay. */
  /* On the rail itself (no box over it): the bus between the stop it left and the next, what it is and where it goes. */
  .veh { margin: 2px 0; }
  .veh button { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; min-height: 50px; padding: 4px 10px 4px 7px; border: 0;
    border-radius: 14px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
    transition: background-color .15s, transform .12s; }
  .veh button:hover { background: color-mix(in srgb, var(--lc) 10%, transparent); }
  .veh button:active { transform: scale(.98); }
  .veh button > :global(svg:last-child) { flex: none; color: var(--muted); rotate: -90deg; }
  .vbus { position: relative; flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
    background: var(--lc); color: var(--lt, #fff); box-shadow: 0 0 0 3px var(--surface); animation: busPulse 2.4s ease-in-out infinite; }
  .vtone { position: absolute; right: -2px; bottom: -2px; width: 11px; height: 11px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface); }
  @keyframes busPulse { 50% { box-shadow: 0 0 0 3px var(--surface), 0 0 0 7px color-mix(in srgb, var(--lc) 28%, transparent); } }
  .vtxt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .vtxt b { font-size: 13px; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
  .vtxt small { font-size: 12px; line-height: 1.2; color: var(--muted); }
  .vt { font-weight: 700; background: none !important; }
  .vt.ontime { color: var(--ontime); } .vt.late1 { color: var(--late1); } .vt.late2 { color: var(--late2); } .vt.late3 { color: var(--late3); } .vt.none { color: var(--muted); }
  @media (prefers-reduced-motion: reduce) { .vbus { animation: none; } .veh button { transition: none; } }
  .ontime { background: var(--ontime); } .late1 { background: var(--late1); } .late2 { background: var(--late2); }
  .late3 { background: var(--late3); } .none { background: var(--none); }
  /* «Όλες οι στάσεις | Μόνο αλλαγές», and with the second, the kind of change. */
  .chg { display: flex; height: 40px; margin: 0 0 8px; padding: 4px; border-radius: 20px; background: var(--card); box-sizing: border-box; }
  .chg button { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; border: 0; border-radius: 16px;
    background: none; color: var(--muted); font: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; white-space: nowrap; }
  .chg button[aria-pressed="true"] { background: var(--control-hover); color: var(--fg); font-weight: 700; }
  .chmodes { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
  .chmodes button { height: 32px; display: flex; align-items: center; justify-content: center; padding: 0 12px; border: 1px solid var(--border); border-radius: 16px;
    background: none; color: var(--fg); font: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; }
  .chmodes button[aria-pressed="true"] { background: var(--fg); color: var(--surface); border-color: var(--fg); }
  /* A stop's changes: the stations' lines as badges, the walk to them, the bus lines that join. */
  .conn { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; }
  .conn small { color: var(--muted); font-size: 11px; font-weight: 600; line-height: 1; }
  .conn small.more { margin-left: 2px; }
  .rb { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 4px; box-sizing: border-box; border-radius: 5px;
    background: var(--rb); color: #fff; font-size: 11px; font-weight: 800; line-height: 1; }
  .rb.round { border-radius: 10px; }
  .gap { position: relative; display: flex; align-items: center; min-height: 40px; padding-left: 46px; }
  .gap button { height: 30px; display: flex; align-items: center; padding: 0 12px; border: 0; border-radius: 15px; background: var(--card); color: var(--muted);
    font: inherit; font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer; }
  .gap button:hover { color: var(--fg); }
  .acts { display: flex; gap: 8px; margin-top: 12px; }
  .primary { flex: 1; height: 48px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border: 0; border-radius: 24px;
    background: var(--accent); color: var(--on-accent); font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; }
  .ghost { flex: none; height: 48px; display: flex; align-items: center; justify-content: center; padding: 0 18px; border: 1px solid var(--border);
    border-radius: 24px; background: transparent; color: var(--fg); font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; }
  .ghost[aria-expanded="true"] { background: var(--card); }
  #card-times { margin-top: 10px; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* How the vehicles are spread: a rail from the first stop to the last, a dot per vehicle, the bunched ones amber. */
  .spread { display: flex; flex-direction: column; gap: 10px; padding: 14px 14px 12px; border-radius: 16px; background: var(--card); border: 1px solid var(--card-border); }
  .spread.float { position: fixed; z-index: 7; right: 84px; bottom: 64px; width: 480px; box-sizing: border-box; padding: 16px 18px 14px; border-radius: 18px;
    background: var(--glass-strong); border: 1px solid var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--shadow);
    color: var(--fg); font-family: var(--font); animation: spIn .3s cubic-bezier(.2, .8, .2, 1); }
  @keyframes spIn { from { transform: translateY(12px); opacity: 0; } }
  .sph { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 14px; line-height: 1.2; }
  .sph b { font-weight: 800; }
  .bn, .ev { font-size: 12px; font-weight: 700; white-space: nowrap; }
  .bn { color: var(--late1); } .ev { color: var(--ontime); }
  .track { position: relative; height: 22px; margin: 0 10px; }
  .rail { position: absolute; left: -10px; right: -10px; top: 9px; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--lc) 35%, var(--control)); }
  .sd { position: absolute; top: 3px; width: 16px; height: 16px; margin-left: -8px; box-sizing: border-box; border-radius: 50%; background: var(--lc);
    border: 3px solid var(--surface); transition: left .8s cubic-bezier(.2, .8, .2, 1); }
  .sd.bunched { background: var(--late1); }
  .spe { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; line-height: 1.2; color: var(--muted); }
  .spe span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 48%; }
  @media (prefers-reduced-motion: reduce) { .sd { transition: none; } .spread.float { animation: none; } }
  /* ---- A phone (compact mockup 13). The sheet as the stop card's: to the screen's edges, the handle on top. */
  .psheet { position: absolute; z-index: 6; left: 0; right: 0; bottom: 0; max-height: 78dvh; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 12px; padding: 10px 16px calc(16px + env(safe-area-inset-bottom));
    border-radius: 24px 24px 0 0; background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line);
    -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text);
    --rail-off: color-mix(in srgb, var(--muted) 28%, var(--surface)); animation: cardIn .32s cubic-bezier(.2, .8, .2, 1); }
  .psheet > * { flex-shrink: 0; }
  @keyframes cardIn { from { transform: translateY(28px); opacity: 0; } }
  .grip { display: flex; align-items: center; justify-content: center; align-self: stretch; height: 26px; margin: -10px -16px -6px; cursor: grab; }
  .grip::after { content: ""; width: 40px; height: 5px; border-radius: 3px; background: var(--rail-off); }
  .psheet > header { display: flex; align-items: center; gap: 10px; height: 44px; }
  .pt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .pt b { font-size: 16px; font-weight: 700; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pt small { font-size: 12.5px; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pcircle { flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; background: var(--control); color: var(--fg); cursor: pointer; }
  .pcircle:hover { background: var(--control-hover); }
  .pcircle.star.on { background: color-mix(in srgb, var(--star) 16%, var(--control)); color: var(--star); }
  /* Back and share over the map, where the home bar's search was (it gives way while the sheet is open). */
  .ptop { position: absolute; z-index: 6; top: calc(16px + env(safe-area-inset-top)); left: 16px; right: 16px; display: flex;
    justify-content: space-between; pointer-events: none; }
  .pround { pointer-events: auto; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; color: var(--fg); cursor: pointer; background: var(--glass); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx);
    box-shadow: var(--glass-rim); }
  :global(body:has(.psheet) .panel.home .homebar) { visibility: hidden; }
  /* The stop list: it alone scrolls (its bar inside the sheet), the header and the foot stay. */
  .pscroll { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .plist { list-style: none; margin: 0; padding: 0; }
  .prow { width: 100%; height: 44px; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: none; color: var(--fg);
    font: inherit; text-align: left; cursor: pointer; }
  .prow.fold { height: 40px; }
  /* The rail beside each row: its upper and lower half (--t, --b), and the stop's dot on it. */
  .rl { position: relative; flex: none; width: 20px; align-self: stretch; }
  .rl::before, .rl::after { content: ""; position: absolute; left: 8px; width: 4px; }
  .rl::before { top: 0; height: 50%; background: var(--t); }
  .rl::after { top: 50%; bottom: 0; background: var(--b); }
  .pdot { position: absolute; z-index: 1; left: 4px; top: calc(50% - 6px); width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%;
    background: var(--surface); border: 3px solid var(--lc); }
  .prow.past .pdot { border-color: var(--rail-off); }
  .prow.past .pn { color: var(--muted); }
  .pn { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 600; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pv { flex: none; font-size: 12.5px; font-weight: 600; line-height: 1; color: var(--muted); font-variant-numeric: tabular-nums; }
  .ft { min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; line-height: 1; color: var(--muted); }
  .ft > span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ft :global(svg) { flex: none; transition: transform .2s; }
  .fold[aria-expanded="true"] .ft :global(svg) { transform: rotate(180deg); }
  /* A bus on the rail: a disc in the line's colour, where it is now. */
  .pbus { position: absolute; z-index: 1; left: -3px; top: calc(50% - 13px); width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    border-radius: 50%; background: var(--lc); color: var(--lt); box-shadow: 0 0 0 3px var(--surface); }
  .pv.vt.ontime { color: var(--ontime); } .pv.vt.late1 { color: var(--late1); } .pv.vt.late2 { color: var(--late2); } .pv.vt.late3 { color: var(--late3); }
  .pv.vt { background: none; }
  /* The user's stop, open in the list. */
  .pfocus { display: flex; gap: 12px; }
  .pfocus .rl::before { height: 23px; }   /* the rail meets the dot's centre, not the row's middle */
  .pfocus .rl::after { top: 23px; }
  .fdot { position: absolute; z-index: 1; left: 1px; top: 14px; width: 18px; height: 18px; box-sizing: border-box; border-radius: 50%; background: #ffffff;
    border: 3px solid var(--lc); }
  .fc { flex: 1; min-width: 0; margin: 2px 0; padding: 12px; display: flex; flex-direction: column; gap: 10px; border-radius: 14px;
    background: color-mix(in srgb, var(--accent) 17%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 52%, var(--surface)); }
  .fch { display: flex; align-items: flex-start; gap: 10px; }
  .fcl, .fcr { display: flex; flex-direction: column; gap: 6px; }
  .fcl { flex: 1; min-width: 0; }
  .fcr { flex: none; align-items: flex-end; font-variant-numeric: tabular-nums; }
  .fcl b { font-size: 15.5px; font-weight: 700; line-height: 1; overflow-wrap: anywhere; }
  .fcr b { font-size: 20px; font-weight: 700; line-height: 1; }
  .fcl small, .fcr small { font-size: 12.5px; line-height: 1; color: color-mix(in srgb, var(--accent) 35%, var(--fg)); }
  .fcn { margin: 0; font-size: 12.5px; line-height: 1.3; color: color-mix(in srgb, var(--fg) 85%, var(--muted)); }
  .fca { display: flex; flex-wrap: wrap; gap: 6px; }
  .fbtn { flex: none; height: 34px; display: flex; align-items: center; gap: 6px; padding: 0 11px; border: 0; border-radius: 17px;
    background: color-mix(in srgb, var(--fg) 12%, var(--surface)); color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .fbtn[aria-expanded="true"], .fbtn.on { background: var(--accent-bg); color: var(--accent); }
  .ptimes { margin-top: 12px; }
  /* The foot: «Ξεκίνα» and the bell. */
  .pfoot { display: flex; gap: 8px; }
  .pgo { flex: 1; height: 52px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border: 0; border-radius: 16px;
    background: var(--accent); color: var(--on-accent); font: inherit; font-size: 16px; font-weight: 800; line-height: 1; cursor: pointer; }
  .pgo:disabled { opacity: .45; cursor: default; }
  .pbell { flex: none; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 16px;
    background: var(--control); color: var(--fg); cursor: pointer; }
  .pbell.on { background: var(--accent-bg); color: var(--accent); }
  @media (prefers-reduced-motion: reduce) { .psheet { animation: none; } .ft :global(svg) { transition: none; } }
</style>
