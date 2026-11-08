<script lang="ts">
  // «Αρχική», the home of the app: «Πού πας;», the user's home and work one tap away, the next buses at the nearest
  // stop (or a routine's), the favourite stops' next buses as tiles, and the notices about the favourite lines (on
  // the map). The routine reminders run from here too. Live data from /v2, asked again every 30 s while it shows (at most 4 requests at a time).
  // On a phone a sheet over the map, above the tab bar; on a desktop a card in the map's left column.
  import { busId } from "../busNs";
  import { flushSync, untrack } from "svelte";
  import StatusBanner from "./StatusBanner.svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { pickDetent, rubber, safeInsets, sheetDrag, springTo, type SheetDrag } from "../sheetDrag";
  import { fetchV2Stop } from "../api";
  import { forLine, strikes } from "../disruptions";
  import { busStopCard } from "../legacy";
  import { titleCase } from "../nearby";
  import { leaveNow, metresBetween, planStops, walkTo, type LeaveNow, type NowStop } from "../now";
  import { clock } from "../format";
  import { placeNote, toward, twins } from "../stops";
  import { destGroups, type Dest } from "../destinations";
  import LineChip from "./LineChip.svelte";
  import DestIcon from "./DestIcon.svelte";
  import { activeRoutine, athensNow, BEFORE_MIN, LATE_S, remindIn } from "../routines";
  import { stopRows, type StopRow, type V2Arrival } from "../v2";
  import type { AppState } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import { rise } from "../anim";
  import RemindSheet from "./RemindSheet.svelte";
  import { linesToward, pickWay, type Way } from "../ways";
  import { getJSON } from "../api";
  import { parsePlan, planUrl, type PlanResponse } from "../plan";
  import { API_BASE } from "../config";
  import { fallbackPlan } from "../fallbackPlan";

  let { app }: { app: AppState } = $props();

  const POLL_MS = 30_000, PARALLEL = 4, TILES = 4;
  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  const narrow = new MediaQuery("(max-width: 719px)");
  // A phone shows one sheet at the foot: the 3D route of a vehicle tapped on the map (Route3D) takes its place.
  const shown = $derived(app.tab === "now" && !app.stack.length && !app.favsOpen && !app.nearShown && !(app.bus3d && narrow.current));

  $effect(() => { if (shown) void app.loadStops(); });

  // The nearest stop (from the stop index and the location), as a place to plan from.
  const nearest = $derived.by<NowStop | null>(() => {
    const g = app.nearGroups[0], ix = app.stopIx;
    const s = g && ix ? ix.s[g.idx[0]] : undefined;
    return s && s[3] ? { id: busId(s[3]), name: titleCase(s[0]), lat: s[1], lon: s[2], fav: false } : null;
  });
  const favStops = $derived(app.favs.stops.map(s => ({ ...s, fav: true })));
  // A «Κάθε μέρα» routine in force: its stop is planned from first, and only its line counts there.
  const routine = $derived(activeRoutine(app.routines, app.serverNow));
  const plan = $derived.by(() => {
    const p = planStops(favStops, nearest, app.myPos);
    const r = routine?.stop;
    return (r ? [{ ...r, fav: true }, ...p.filter(s => s.id !== r.id)] : p).slice(0, 3);
  });
  // «Κι άλλες κοντά»: the next two nearest stops (not already planned from), each with its first bus.
  const nearOthers = $derived.by<NowStop[]>(() => {
    const ix = app.stopIx;
    return app.nearGroups.slice(1, 3).flatMap(g => {
      const s = ix?.s[g.idx[0]];
      return s && s[3] ? [{ id: busId(s[3]), name: titleCase(s[0]), lat: s[1], lon: s[2], fav: false }] : [];
    }).filter(s => !plan.some(p => p.id === s.id));
  });
  // The nearest stop's twin across the street (stops.ts twins): the board's other way, one tap on «Προς …».
  const across = $derived.by<NowStop | null>(() => {
    const g = app.nearGroups[0], ix = app.stopIx;
    if (!g || !ix || !plan[0] || plan[0].id !== nearest?.id) return null;
    const t = twins(ix, g.idx[0])[0], s = t ? ix.s[t.i] : undefined;
    return s && s[3] ? { id: busId(s[3]), name: titleCase(s[0]), lat: s[1], lon: s[2], fav: false } : null;
  });
  let side = $state<0 | 1>(0);
  $effect(() => { void plan[0]?.id; side = 0; });
  const shownStop = $derived(side === 1 && across ? across : plan[0] ?? null);
  // Every stop this panel shows: the ones planned from, the one across, the others near, and the favourites.
  const want = $derived([...new Set([...plan.map(s => s.id), ...(across ? [across.id] : []), ...nearOthers.map(s => s.id), ...favStops.slice(0, TILES).map(s => s.id)])]);
  const wantKey = $derived([...want].sort().join("|"));

  let boards = $state.raw<Record<string, V2Arrival[]>>({});
  let loaded = $state(false);
  $effect(() => {
    if (!shown || !wantKey) return;
    const ids = untrack(() => want);
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        let next = 0;
        const worker = async () => {
          while (next < ids.length && !ac.signal.aborted) {
            const id = ids[next++], r = await fetchV2Stop(id);
            if (ac.signal.aborted) return;
            const b = r.body as { arrivals?: V2Arrival[] } | null;
            if (r.status === 200 && b) boards = { ...boards, [id]: b.arrivals ?? [] };
          }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL, ids.length) }, worker));
        loaded = true;
      }
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  const nowS = $derived(app.serverNow / 1000);
  const rowsOf = (id: string): StopRow[] => (boards[id] ? stopRows(boards[id], nowS) : []);
  // The boards only hold what is still to come: each time seen is kept, and the last one gone by is «πέρασε».
  const seenTimes = new Map<string, Set<number>>();
  const passKey = (stop: string, r: StopRow) => `${stop}|${r.line}|${r.headsign}`;
  $effect(() => {
    for (const [id, arr] of Object.entries(boards)) for (const r of stopRows(arr, untrack(() => nowS) - 3600)) {
      const k = passKey(id, r), set = seenTimes.get(k) ?? new Set<number>();
      for (const t of r.times) set.add(t.at);
      seenTimes.set(k, set);
    }
  });
  const passedAt = (stop: string, r: StopRow): number | null => {
    let last: number | null = null;
    for (const t of seenTimes.get(passKey(stop, r)) ?? []) if (t < nowS - 30 && (last == null || t > last)) last = t;
    return last;
  };
  const favLineIds = $derived(app.favs.lines.map(l => l.id));

  // The bus to leave for: the first planned stop with a bus the walk can still reach.
  const leave = $derived.by<{ stop: NowStop; l: LeaveNow } | null>(() => {
    for (const s of plan) {
      const rows = routine && s.id === routine.stop.id ? rowsOf(s.id).filter(r => r.line === routine.line) : rowsOf(s.id);
      const l = leaveNow(rows, walkTo(app.myPos, s) ?? 0, nowS, favLineIds);
      if (l) return { stop: s, l };
    }
    return null;
  });

  const modeOf = (line: string) => (app.lineInfo.get(native(line))?.kind === "trolley" ? "trolley" : "bus");
  const minText = (at: number) => { const m = Math.max(0, Math.round((at - nowS) / 60)); return m === 0 ? "τώρα" : m < 60 ? `${m}′` : clock(at).slice(0, 5); };
  function badge(line: string) {
    const c = app.lineColor(native(line));
    return { label: native(line), bg: c.bg, fg: c.fg };
  }
  const openStop = (s: { id: string; name: string }) => app.push(busStopCard(native(s.id), s.name));

  // The favourites' tiles: each stop's next bus (a favourite line's first), and the one after it on that row.
  const tiles = $derived(favStops.slice(0, TILES).map(s => {
    const rows = rowsOf(s.id);
    const r = rows.find(x => favLineIds.includes(x.line)) ?? rows[0];
    const t = r?.times[0];
    return { s, r, min: t ? Math.max(0, Math.round((t.at - nowS) / 60)) : null, live: !!t?.live,
      next: r?.times[1] ? Math.max(0, Math.round((r.times[1].at - nowS) / 60)) : null };
  }));


  // A strike today (the top bar's banner moves here on «Τώρα»), closed the same way.
  const strike = $derived(app.notifyPrefs.strikes ? strikes(app.disruptions, app.serverNow, app.closedStrikes)[0] : undefined);
  // Notices about the favourite lines (route changes, works): one row each, newest first.
  const notices = $derived(!app.notifyPrefs.changes ? [] : app.favs.lines.flatMap(l => forLine(app.disruptions, l.id, app.serverNow).map(d => ({ line: l, d }))).slice(0, 2));
  // A notice closed with ✕ stays closed for this visit; the next one (if any) shows.
  let closedNotes = $state<string[]>([]);
  const noteKey = (n: (typeof notices)[number]) => `${n.line.id}|${n.d.title}`;
  const note = $derived(notices.find(n => !closedNotes.includes(noteKey(n))) ?? null);

  // ---- The user's way now (mockup 40, B1): to work in the morning at home, home in the evening (ways.ts), or the one
  // they flip to; the best route there from where they are, as a compact card (where its bus is now), «Ξεκίνα» and
  // «Θύμισέ μου». At a stop they named for that way, only the lines that go there.
  let wayPick = $state<Way | null>(null);
  const auto = $derived(pickWay(app.places, app.myPos, athensNow(app.serverNow).hour));
  const way = $derived<Way | null>(wayPick && app.places[wayPick] ? wayPick : auto?.way ?? null);
  const target = $derived(way ? app.places[way] ?? null : null);
  let wayPlan = $state.raw<{ key: string; r: PlanResponse } | null>(null);
  const wayKey = $derived(shown && target && app.myPos && metresBetween(app.myPos, target.at) > 300
    ? JSON.stringify([app.myPos.map(x => +x.toFixed(4)), target.at]) : "");
  $effect(() => {
    const k = wayKey;
    if (!k) return;
    const [a, b] = JSON.parse(k) as [[number, number], [number, number]];
    const c = new AbortController();
    let t: ReturnType<typeof setTimeout> | undefined;
    const load = () => getJSON(planUrl(API_BASE, a, b, undefined, 3), c.signal).then(async res => {
      let r = res.status === 200 ? parsePlan(res.body) : null;
      // No route from the server: the app's own, from the stop index and the live boards (fallbackPlan.ts).
      if ((!r || !r.itineraries.length) && app.stopIx) r = (await fallbackPlan(app.stopIx, a, b, app.serverNow / 1000, line => {
        const co = app.lineColor(line);
        return { label: line, color: co.bg, text: co.fg, mode: app.lineInfo.get(line)?.kind === "trolley" ? "trolley" : "bus" };
      }, c.signal).catch(() => null)) ?? r;
      if (!c.signal.aborted && r) wayPlan = { key: k, r };
      if (!c.signal.aborted) t = setTimeout(load, 60_000);
    }, () => {});
    void load();
    return () => { c.abort(); clearTimeout(t); };
  });
  const wayR = $derived(wayPlan && wayPlan.key === wayKey ? wayPlan.r : null);
  const wayIt = $derived(wayR?.itineraries.find(x => x.depart_at > nowS - 60) ?? null);
  let wayRemind = $state(false);
  // A stop named for this way: only the lines from it that go there (the rest behind «Δείξε»).
  let showAll = $state(false);
  const wayLines = (id: string): Set<string> | null => {
    const sid = native(id), n = app.stopNames[sid];
    if (!way || !target || !app.stopIx || !n?.ways?.includes(way)) return null;
    return linesToward(app.stopIx, sid, target.at);
  };
  const WAY_TO: Record<Way, string> = { home: "στο σπίτι", work: "στη δουλειά" };

  // The stop's board: its next departures in time order (a line twice when its next two come soon), three on a phone,
  // five on a computer; each live, late or from the timetable, in its colour.
  let wide = $state(typeof matchMedia === "function" && matchMedia("(min-width: 720px)").matches);
  $effect(() => {
    const q = matchMedia("(min-width: 720px)"), on = () => (wide = q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  });
  // One card per line and way (mockup 33), soonest first, with its next three times: not the same line twice.
  const keep = $derived(shownStop ? wayLines(shownStop.id) : null);
  const allDeps = $derived(shownStop ? rowsOf(shownStop.id).filter(r => r.times.length).map(r => ({ r, t: r.times[0] })).sort((a, b) => a.t.at - b.t.at) : []);
  const sideName = (st: NowStop | null) => {
    const r = st ? rowsOf(st.id).find(x => x.times.length) : undefined;
    return r ? titleCase(placeNote(toward(r.headsign)).place) : st ? app.stopLabel(st.id, st.name) : "";
  };
  const wayDeps = $derived(keep && !showAll ? allDeps.filter(d => keep.has(native(d.r.line))) : allDeps);
  const hidden = $derived(keep && !showAll ? new Set(allDeps.filter(d => !keep.has(native(d.r.line))).map(d => d.r.line)).size : 0);
  const deps = $derived(wayDeps.slice(0, wide ? 5 : 4));
  // Lowered (compact mockup 18): the next bus of the first two lines (a line once, whichever way it goes).
  const peekLines = $derived([...new Map(wayDeps.map(d => [d.r.line, d] as const)).values()]);
  const peekDeps = $derived(peekLines.slice(0, 2));
  const peekMore = $derived(peekLines.length - peekDeps.length);
  const tone = (t: StopRow["times"][number]) => (!t.live ? "sched" : (t.delay_s ?? 0) >= 120 ? "late" : "ok");
  const rowNote = (t: StopRow["times"][number]) => (!t.live ? `Πρόγραμμα · ${clock(t.at).slice(0, 5)}` : (t.delay_s ?? 0) >= 120 ? `Ζωντανά · αργεί ${Math.round((t.delay_s ?? 0) / 60)}′` : "Ζωντανά · στην ώρα του");
  const others = $derived(nearOthers.map(s => {
    const first = rowsOf(s.id).flatMap(r => r.times.slice(0, 1).map(t => ({ r, t }))).sort((a, b) => a.t.at - b.t.at)[0];
    return { s, first, min: first ? Math.max(0, Math.round((first.t.at - nowS) / 60)) : null, walk: walkTo(app.myPos, s) };
  }));

  // «Σπίτι» and «Δουλειά»: a trip there from where the user is; not set yet, the «Πού πας;» screen asks for it.
  const SAVED = [{ k: "home", label: "Σπίτι" }, { k: "work", label: "Δουλειά" }] as const;
  const chips = $derived([...SAVED].sort((a, b) => (a.k === way ? -1 : b.k === way ? 1 : a.k === "work" ? 1 : -1)));
  const hereAt = (k: "home" | "work") => !!app.myPos && !!app.places[k] && metresBetween(app.myPos, app.places[k]!.at) < 300;
  // A long press (or the context menu) on a chip changes that place.
  let pressT: ReturnType<typeof setTimeout> | undefined, pressed = false;
  const pressStart = (k: "home" | "work") => { pressed = false; clearTimeout(pressT); pressT = setTimeout(() => { pressed = true; setPlace(k); }, 600); };
  const pressEnd = () => clearTimeout(pressT);
  // «Χρήσιμοι προορισμοί»: a trip there from where the user is.
  const dests = $derived(destGroups(app.cityId));
  // «Πού πας;»: the search opens on «Προς» with the keyboard up. The field is focused inside the tap itself (the screen
  // drawn at once with flushSync): a focus a moment later does not bring the keyboard up on iOS.
  function openWhere(e: MouseEvent) {
    e.stopPropagation();   // this tap is not «a tap outside the field» for the screen that opens under it
    flushSync(() => { app.start = true; app.startDirect = true; });
    const f = document.getElementById("start-to") as HTMLInputElement | null;
    f?.focus();
    f?.click();
  }
  function goDest(d: Dest) {
    if (app.myPos) app.tripFrom = { label: "Η θέση μου", pts: [app.myPos], lines: [], kind: "me" };
    app.tripTo = { label: d.label, pts: [d.at], lines: [], kind: "area" };
    app.setTab("trip");
  }
  let waitingFor = $state<"home" | "work" | null>(null);
  function setPlace(k: "home" | "work") {
    app.savingPlace = k;
    app.start = true;
  }
  function goPlace(k: "home" | "work") {
    if (!app.places[k]) { setPlace(k); return; }
    // Already there («εδώ είσαι»): no way to plan; the map on the place, the sheet lowered.
    if (hereAt(k)) { const at = app.places[k]!.at; app.flyTo([at[1], at[0]]); app.homePeek++; return; }
    if (!app.myPos) { waitingFor = k; app.locate(); return; }
    tripTo(k);
  }
  function tripTo(k: "home" | "work") {
    const p = app.places[k], me = app.myPos;
    if (!p || !me) return;
    app.tripFrom = { label: "Η θέση μου", pts: [me], lines: [], kind: "me" };
    // As «Πού πας;» shows it: «Σπίτι» or «Δουλειά» (the address as the hint), not the address itself.
    app.tripTo = { label: k === "home" ? "Σπίτι" : "Δουλειά", hint: p.label, pts: [p.at], lines: [], kind: k };
    app.setTab("trip");
  }
  $effect(() => {
    const k = waitingFor, me = app.myPos;
    if (k && me) untrack(() => { waitingFor = null; tripTo(k); });
    if (k && app.locState === "denied") untrack(() => { waitingFor = null; });
  });

  // «Ειδοποίησέ με»: a reminder when it is time to leave, while the page is open (a vibration where the phone has
  // it, a system notification where the user allowed them, and the app's notice line).
  // The target is fixed when set (its own text and time, on the phone's clock), so a later bus never takes it over.
  let reminder = $state.raw<{ ms: number; atS: number; text: string } | null>(null);
  $effect(() => {
    const r = reminder;
    if (!r) return;
    const fire = () => {
      reminder = null;
      app.notify(r.text);
      navigator.vibrate?.([200, 120, 200]);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Στάσεις", { body: r.text });
    };
    const t = setTimeout(fire, Math.max(0, r.ms - Date.now()));
    return () => clearTimeout(t);
  });
  // The routine reminds by itself, once a day: at leave time or a few minutes before the bus; «only if something
  // changes» says so when its bus is over 10′ late. The «Καθυστέρηση πάνω από 10′» switch does the same for any bus here.
  let routineDone = "";
  let lateSaid = "";
  $effect(() => {
    const l = leave, r = routine;
    if (!l) return;
    untrack(() => {
      const day = athensNow(app.serverNow).day;
      if (r && l.stop.id === r.stop.id && routineDone !== `${r.id}|${day}`) {
        const inS = remindIn(r.when, l.l.inMin, l.l.walk);
        if (inS != null && !reminder) {
          routineDone = `${r.id}|${day}`;
          const text = r.when === "leave" ? `Φύγε τώρα για το ${badge(l.l.line).label}: έρχεται στη στάση ${l.stop.name} σε ${l.l.walk}′.`
            : `Το ${badge(l.l.line).label} φτάνει στη στάση ${l.stop.name} σε ${BEFORE_MIN}′.`;
          reminder = { ms: Date.now() + inS * 1000, atS: nowS + inS, text };
        }
      }
      const late = (l.l.delay_s ?? 0) >= LATE_S && (app.notifyPrefs.delay || (r?.when === "change" && l.stop.id === r.stop.id));
      const key = `${l.l.line}|${l.l.at}`;
      if (late && lateSaid !== key) {
        lateSaid = key;
        app.notify(`Το ${badge(l.l.line).label} έχει +${Math.round((l.l.delay_s ?? 0) / 60)}′ καθυστέρηση.`);
      }
    });
  });

  // A phone: the panel is a sheet with a handle. «peek» shows the search and home and work over a big map, «half»
  // where it opens, «full» all of it; dragged by the handle (sheetDrag.ts), it follows the finger and, let go, springs
  // to the place it was heading for (a flick can go past one); a tap on the handle steps it.
  type NSnap = "peek" | "half" | "full";
  let nsnap = $state<NSnap>("half");
  let nowEl = $state<HTMLElement>(), savedEl = $state<HTMLElement>();
  let nowTop = $state<number | null>(null), dragging = $state(false), vh = $state(typeof innerHeight === "number" ? innerHeight : 800);
  let top0 = 0;
  // A phone: the sheet is as tall as at the top and slides down by sheetY (a transform, run by the compositor): moving
  // its top edge instead laid out and blurred the whole sheet again on every frame, and it lagged on an iPhone.
  const sheetY = $derived.by(() => { void vh; const t = tops(); return Math.max(0, (nowTop ?? t.half) - t.full); });
  // As much room again at its foot as is slid off the screen (by the place it rests at, not each frame of a drag), so
  // what is under the screen's edge can still be scrolled to (and a scroll raises the sheet).
  const sheetPadB = $derived.by(() => { void vh; if (nsnap === "full") return 0; const t = tops(); return Math.max(0, t[nsnap] - t.full); });
  const PEEK_PX = 120;
  function tops(): Record<NSnap, number> {
    const { top: st, bottom: sb } = safeInsets();
    const foot = vh - Math.max(12, sb) - (narrow.current ? 0 : 88);   // a phone: no tab bar under it
    const peekH = nowEl && savedEl ? savedEl.getBoundingClientRect().bottom - nowEl.getBoundingClientRect().top + 16 : 190;
    // A phone, lowered (compact mockup 18): its handle, the nearest stop and its next buses; the search and the places
    // are on the map. PEEK_PX: as --peek in app.css (the map's buttons stand on it).
    // The middle at about half the screen (as a native sheet): the map above it has the room for its own buttons.
    return { full: st + 8, half: Math.max(220, vh * 0.47), peek: narrow.current ? foot - PEEK_PX : Math.max(st + 72, foot - peekH) };
  }
  // Let go, it springs from where it was (freeAt) to its place.
  let freeAt: number | null = null;
  let stopSpring = () => {};
  $effect(() => {
    void vh;
    const k = nsnap;
    if (!narrow.current) { nowTop = null; return; }
    untrack(() => { nowTop = freeAt ?? (k === "half" ? null : tops()[k]); freeAt = null; });
  });
  const armed = $derived(!!app.alert || !!app.railAlert);
  // «Χάρτης» (and «Θέλω μόνο να δω τον χάρτη»): the sheet down to its handle.
  let seenPeek = 0;
  $effect(() => { const n = app.homePeek; if (n !== seenPeek) { seenPeek = n; untrack(() => { nsnap = "peek"; }); } });
  // Lowered to its handle on a phone, the map's own buttons come back over the map (app.css).
  $effect(() => { const on = shown && narrow.current && nsnap === "peek"; document.documentElement.toggleAttribute("data-homepeek", on); return () => document.documentElement.removeAttribute("data-homepeek"); });
  const peeked = $derived(shown && narrow.current && nsnap === "peek");
  // The map's «Σπίτι» / «Δουλειά» tapped: the way there.
  let seenTap = 0;
  $effect(() => { const t = app.mineTap; if (t && t.n !== seenTap) { seenTap = t.n; untrack(() => goPlace(t.k)); } });
  function openLines() { flushSync(() => { app.startLines = true; app.start = true; }); }
  // To a place with the spring, from where the sheet is now (`v`: the finger's speed, px per ms, down +).
  function glide(to: NSnap, from: number, v = 0) {
    stopSpring();
    const t = tops();
    dragging = true;   // the spring moves it, not the CSS transition
    if (to !== nsnap) freeAt = from;   // the place changes: its effect starts from here, not from the place itself
    nowTop = from;
    nsnap = to;
    stopSpring = springTo(from, t[to], v, x => (nowTop = x), () => { dragging = false; nowTop = to === "half" ? null : tops()[to]; });
  }
  const here = () => nowEl?.getBoundingClientRect().top ?? tops()[nsnap];
  const stepN = () => glide(nsnap === "peek" ? "half" : nsnap === "half" ? "full" : "peek", here());
  const nowDrag = $derived<SheetDrag>({
    ignore: narrow.current ? undefined : "*",
    start: () => { stopSpring(); top0 = here(); dragging = true; },
    move: dy => { const t = tops(); nowTop = rubber(top0 + dy, t.full, t.peek); },
    end: (dy, v) => {
      const t = tops(), at = rubber(top0 + dy, t.full, t.peek);
      glide(pickDetent(t, at, v), at, v);
    },
    tap: stepN,
  });
</script>

<svelte:window bind:innerHeight={vh} />

{#snippet mapNote()}
  {#if strike}
    <div class="mapnote strike" transition:rise={{ y: -10, duration: 260 }}>
      <a href={strike.url} target="_blank" rel="noopener" aria-label="{strike.title}. Ανοίγει σε νέα καρτέλα"><Icon name="warn" size={15} /><span>{strike.title}</span></a>
      <button type="button" aria-label="Κλείσιμο ειδοποίησης απεργίας" onclick={() => app.closeStrike(strike.id)}><Icon name="close" size={13} /></button>
    </div>
  {:else if note}
    <div class="mapnote" transition:rise={{ y: -10, duration: 260 }}>
      <a href={note.d.url} target="_blank" rel="noopener"><Icon name="warn" size={15} /><span>{badge(note.line.id).label}: {note.d.title}</span></a>
      <button type="button" aria-label="Κλείσιμο ειδοποίησης" onclick={() => (closedNotes = [...closedNotes, noteKey(note)])}><Icon name="close" size={13} /></button>
    </div>
  {/if}
{/snippet}

{#snippet placeChips()}
      {#each chips as p (p.k)}
        {@const at = app.places[p.k]}
        {@const here = hereAt(p.k)}
        {@const best = p.k === way && !here && wayIt}
        <button type="button" class="chip" class:best class:here class:glass={peeked}
          onpointerdown={() => pressStart(p.k)} onpointerup={pressEnd} onpointerleave={pressEnd}
          oncontextmenu={e => { e.preventDefault(); setPlace(p.k); }}
          onclick={() => { if (pressed) { pressed = false; return; } goPlace(p.k); }}
          aria-label={at ? `${p.label}: διαδρομή ως ${at.label}. Κράτα πατημένο για αλλαγή` : `Όρισε ${p.label.toLowerCase()}`}>
          <Icon name={p.k} size={16} />
          {#if here}<span class="cl">εδώ είσαι</span>
          {:else}
            <b>{p.label}</b>
            {#if !at}<span class="cl">όρισέ {p.k === "home" ? "το" : "τη"}</span>
            {:else if waitingFor === p.k}<span class="cl">σε ψάχνω…</span>
            {:else if best && wayIt}<span class="cm">{Math.max(1, Math.round((wayIt.arrive_at - nowS) / 60))}′</span><span class="cf">φύγε {clock(wayIt.depart_at).slice(0, 5)}</span>{/if}
          {/if}
        </button>
      {/each}
{/snippet}

{#if wayRemind && wayIt && wayR && target}
  <RemindSheet {app} it={wayIt} r={wayR} ix={app.stopIx} to={{ label: way === "home" ? "Σπίτι" : "Δουλειά", pts: [target.at], lines: [], kind: way ?? "home" }} onclose={() => (wayRemind = false)} />
{/if}

{#if shown}
  <!-- One notice on the map, under the search: a strike first, else the newest about a favourite line. A phone:
       under the search and the chips. -->
  {#if !narrow.current}{@render mapNote()}{/if}
  <!-- Kept under «Πού πας;» while it opens and closes (it covers the screen): hidden then, the map showed bare for a
       moment between the two. Not while picking on the map (the pick has its own field), nor with the sheet at the top. -->
  <!-- Not during the guide either: its own instruction card is at the top (the chips showed under it). -->
  {#if shown && narrow.current && nsnap !== "full" && !app.pickFor && !app.guide}
    <!-- A phone (compact mockup 15Γ): the search on top of the map, your places and the lists as chips under it. -->
    <div class="mtop" transition:rise={{ y: -10, duration: 220 }}>
      <button type="button" class="mwhere" aria-haspopup="dialog" onclick={openWhere}><Icon name="search" size={19} /><span>Πού πας;</span></button>
      <div class="mchips">
        {@render placeChips()}
        <button type="button" class="chip glass" onclick={() => app.toggleFavs()}><Icon name="star" size={16} /><b>Αγαπημένα</b></button>
        <button type="button" class="chip glass" onclick={openLines}><Icon name="route" size={16} /><b>Γραμμές</b></button>
        <button type="button" class="chip glass round" aria-label={armed ? "Ειδοποιήσεις, μία ενεργή" : "Ειδοποιήσεις"} onclick={() => app.setTab("alerts")}><Icon name="bell" size={16} />{#if armed}<i class="bdot" aria-hidden="true"></i>{/if}</button>
      </div>
      {@render mapNote()}
      <StatusBanner {app} />
    </div>
  {/if}
  <section class="now" class:dragging class:peeked aria-label="Αρχική" in:rise bind:this={nowEl} style:translate={narrow.current ? `0 ${sheetY}px` : undefined} style:clip-path={narrow.current ? `inset(0 0 ${sheetY}px 0 round 28px)` : undefined} style:--padb={narrow.current ? `${sheetPadB}px` : undefined}
    onscroll={e => { if (narrow.current && nsnap !== "full" && (e.currentTarget as HTMLElement).scrollTop > 6) nsnap = "full"; }}>
    <div class="grip" role="button" tabindex="0" aria-label={nsnap === "full" ? "Μικρότερο" : "Μεγαλύτερο"} use:sheetDrag={nowDrag}
      onkeydown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); stepN(); } }}></div>
    {#if peeked}
      <!-- Lowered (compact mockup 18): still what the app is opened for, the nearest stop's next buses, live; a tap
           raises the sheet. -->
      {#if shownStop}
        {@const pw = walkTo(app.myPos, shownStop)}
        <div class="peekl">
          <button type="button" class="pk1" onclick={() => (nsnap = "half")}>
            <span class="stile" aria-hidden="true"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
            <span class="pkt"><b>{app.stopLabel(shownStop.id, shownStop.name)}</b><small>{#if pw != null}<Icon name="walk" size={12} />{pw}′ με τα πόδια{:else}η πιο κοντινή στάση{/if}</small></span>
            <span class="pkc" aria-hidden="true"><Icon name="chevron" size={15} /></span>
          </button>
          <div class="pk2">
            {#each peekDeps as d (d.r.line + d.r.headsign)}
              {@const b = badge(d.r.line)}
              <button type="button" class="pkd" onclick={() => openStop(shownStop)}>
                <LineChip label={b.label} bg={b.bg} fg={b.fg} mode={modeOf(d.r.line)} city={app.cityId} />
                {#if d.t.live}<i class="pkl" aria-label="ζωντανά"></i>{/if}<b class:live={d.t.live}>{minText(d.t.at)}</b>
              </button>
            {/each}
            {#if peekMore > 0}<span class="pkm">+{peekMore} {peekMore === 1 ? "γραμμή" : "γραμμές"}</span>{/if}
            {#if !deps.length}<span class="pkm">{loaded ? "Κανένα λεωφορείο τώρα" : "Φόρτωση…"}</span>{/if}
          </div>
        </div>
      {:else}
        <button type="button" class="peekl pkx" onclick={() => (nsnap = "half")}><Icon name="chevron" size={13} /><span>Κοντά σου · αναχωρήσεις</span></button>
      {/if}
    {/if}

    <!-- A computer (desktop mockup Υ1): the app's name and its two ways out at the top of the column: the alerts and
         the settings. A phone has these on the map and in the chips. -->
    {#if !narrow.current}
      <div class="brand">
        <span class="logo" aria-hidden="true"><Icon name="bus" size={17} /></span>
        <b>Στάσεις</b>
        <button type="button" class="bb" aria-label={armed ? "Ειδοποιήσεις, μία ενεργή" : "Ειδοποιήσεις"} title="Ειδοποιήσεις" onclick={() => app.setTab("alerts")}>
          <Icon name="bell" size={18} />{#if armed}<i class="bdot" aria-hidden="true"></i>{/if}
        </button>
        <button type="button" class="bb" aria-label="Ρυθμίσεις" title="Ρυθμίσεις" onclick={() => dispatchEvent(new Event("opensettings"))}><Icon name="gear" size={18} /></button>
      </div>
    {/if}

    <!-- The one search: «Πού πας;» (StartScreen), for places, stops and lines, with our engine. -->
    <button type="button" class="where" aria-haspopup="dialog" onclick={openWhere}>
      <Icon name="search" size={18} /><span>Πού πας;</span><kbd class="pc" aria-hidden="true">/</kbd>
    </button>

    <!-- Home and work as chips (compact mockup 1): the way now first, with its time and when to leave; «εδώ είσαι»
         where the user is. A long press changes the place. The bell (alerts) at the end. -->
    <div class="chips" bind:this={savedEl}>
      {@render placeChips()}
      {#if !narrow.current}
        <button type="button" class="chip" onclick={() => app.toggleFavs()}><Icon name="star" size={16} /><b>Αγαπημένα</b></button>
        <button type="button" class="chip" onclick={openLines}><Icon name="route" size={16} /><b>Γραμμές</b></button>
      {/if}
      <!-- A phone has no tab bar: the alerts are this bell (a dot while one is set). A computer has it at the top. -->
      <button type="button" class="bell" hidden={!narrow.current} aria-label={armed ? "Ειδοποιήσεις, μία ενεργή" : "Ειδοποιήσεις"} title="Ειδοποιήσεις" onclick={() => app.setTab("alerts")}>
        <Icon name="bell" size={16} />{#if armed}<i class="bdot" aria-hidden="true"></i>{/if}
      </button>
    </div>

    <!-- The stop to plan from (the nearest, a routine's or a favourite) and its board: one row per line, its next
         times on the right, the one gone by under its name. «Προς …» flips to the stop across the street. -->
    {#if !plan.length}
      <div class="empty">
        <p>Δείξε πού είσαι και θα βλέπεις εδώ τα επόμενα λεωφορεία της πιο κοντινής στάσης.</p>
        {#if app.locState === "denied"}
          <p class="hint">Η τοποθεσία είναι κλειστή για αυτή τη σελίδα, από τις ρυθμίσεις του browser.</p>
        {:else}
          <button type="button" class="go" onclick={() => app.locate()}><Icon name="locate" size={18} /><span>{app.locState === "searching" ? "Σε ψάχνω…" : "Βρες με"}</span></button>
        {/if}
      </div>
    {:else if shownStop}
      {@const st = shownStop}
      {@const w = walkTo(app.myPos, st)}
      <div class="board">
        <div class="bh">
          <button type="button" class="sh" onclick={() => openStop(st)}>
            <span class="stile" aria-hidden="true"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
            <span class="st"><b>{app.stopLabel(st.id, st.name)}</b><small>{routine && st.id === routine.stop.id ? "η στάση της διαδρομής σου" : w != null ? `${w}′ με τα πόδια` : st.id === nearest?.id || st.id === across?.id ? "η πιο κοντινή" : "αγαπημένη"}</small></span>
          </button>
          {#if across}
            <span class="sides" role="radiogroup" aria-label="Κατεύθυνση">
              <button type="button" role="radio" aria-checked={side === 0} class:on={side === 0} onclick={() => (side = 0)} title="Προς {sideName(plan[0])}"><span>{sideName(plan[0])}</span></button>
              <button type="button" role="radio" aria-checked={side === 1} class:on={side === 1} onclick={() => (side = 1)} title="Προς {sideName(across)}"><span>{sideName(across)}</span></button>
            </span>
          {/if}
        </div>
        {#if deps.length}
          {#each deps as d (d.r.line + d.r.headsign)}
            {@const b = badge(d.r.line)}
            {@const gone = passedAt(st.id, d.r)}
            {@const live = d.t.live}
            <button type="button" class="dep" onclick={() => openStop(st)}>
              <LineChip label={b.label} bg={b.bg} fg={b.fg} mode={modeOf(d.r.line)} city={app.cityId} />
              <span class="dt"><b>{titleCase(placeNote(toward(d.r.headsign)).place)}</b><small>{gone ? `πέρασε ${clock(gone).slice(0, 5)}` : live ? ((d.t.delay_s ?? 0) >= 120 ? `ζωντανά · αργεί ${Math.round((d.t.delay_s ?? 0) / 60)}′` : "ζωντανά") : "από το πρόγραμμα"}</small></span>
              <span class="dr">
                <span class="dm {tone(d.t)}">{#if live}<i></i>{/if}{minText(d.t.at)}</span>
                {#if d.r.times.length > 1}<small>{d.r.times.slice(1, 3).map(t => clock(t.at).slice(0, 5)).join(" · ")}</small>{/if}
              </span>
            </button>
          {/each}
          {#if hidden && way}<button type="button" class="hid" onclick={() => (showAll = true)}><span>{hidden === 1 ? "Άλλη 1 γραμμή δεν πάει" : `Άλλες ${hidden} γραμμές δεν πάνε`} {WAY_TO[way]}</span><b>Δείξε</b></button>{/if}
        {:else}
          <p class="muted bm">{loaded ? "Κανένα λεωφορείο τώρα σε αυτή τη στάση." : "Φόρτωση…"}</p>
        {/if}
      </div>
    {/if}

    <!-- Favourite stops, then the others near: one row each, the first buses on the right. -->
    {#if tiles.length}
      <div class="head"><h2>Αγαπημένα</h2><button type="button" class="link" onclick={() => app.toggleFavs()}>Όλα</button></div>
      <div class="rows">
        {#each tiles as t (t.s.id)}
          {@const rs = rowsOf(t.s.id).filter(r => r.times.length).slice(0, 2)}
          <button type="button" class="srow" onclick={() => openStop(t.s)}>
            <span class="stile sm" aria-hidden="true"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
            <b>{app.stopLabel(t.s.id, t.s.name)}</b>
            <span class="sr">{#if rs.length}{rs.map(r => `${badge(r.line).label} ${minText(r.times[0].at)}`).join(" · ")}{:else}{boards[t.s.id] ? "κανένα τώρα" : "…"}{/if}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if others.length}
      <div class="head"><h2>Κι άλλες κοντά</h2><button type="button" class="hlink" onclick={() => (app.nearOpen = true)}>Όλες</button></div>
      <div class="rows">
        {#each others as o (o.s.id)}
          <button type="button" class="srow" onclick={() => openStop(o.s)}>
            <span class="stile sm" aria-hidden="true"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
            <b>{app.stopLabel(o.s.id, o.s.name)}</b>
            <span class="sr">{#if o.first}{badge(o.first.r.line).label} {minText(o.first.t.at)}{:else}–{/if}{#if o.walk != null} · <Icon name="walk" size={12} />{o.walk}′{/if}</span>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Pinned on the map (PinSheet): its colour opens the sheet, a tap its card, × takes it off. -->
    {#if app.pins.length}
      <div class="head"><h2>Καρφιτσωμένα</h2><span class="cnt">{app.pins.length} στον χάρτη</span></div>
      <ul class="pins">
        {#each app.pins as pin (pin.kind + pin.id)}
          <li>
            <button type="button" class="pc-dot" style:--pc={pin.color} aria-label="Χρώμα και ρυθμίσεις: {pin.label}" onclick={() => (app.pinEdit = pin)}><i></i></button>
            <button type="button" class="pin-open" onclick={() => app.open({ kind: pin.kind, id: busId(pin.id), title: pin.label })}>
              {#if pin.kind === "line"}{@const b = badge(busId(pin.id))}<LineChip label={b.label} bg={b.bg} fg={b.fg} mode={modeOf(pin.id)} city={app.cityId} />
              {:else}<span class="stile" aria-hidden="true"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>{/if}
              <span class="dt"><b>{pin.kind === "line" ? (app.lineInfo.get(pin.id)?.name ? titleCase(app.lineInfo.get(pin.id)!.name) : `Γραμμή ${pin.label}`) : pin.label}</b>
                <small>{pin.kind === "line" ? (pin.vehicles ? "Με τα οχήματά της" : "Μόνο η διαδρομή") : "Στάση"}{pin.top ? " · πάνω από όλα" : ""}</small></span>
            </button>
            <button type="button" class="unpin" aria-label="Ξεκαρφίτσωμα: {pin.label}" onclick={() => app.unpin(pin.kind, pin.id)}><Icon name="close" size={14} /></button>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- «Χρήσιμοι προορισμοί» (mockup 1β): the airport, the ports, the coaches and trains, a few places in town. -->
    {#if dests.length}
      <div class="head dh"><h2>Χρήσιμοι προορισμοί</h2></div>
      {#each dests as g (g.group)}
        <div class="dg">
          <span class="gl">{g.title}</span>
          <div class="dgrid">
            {#each g.items as d (d.label)}
              <button type="button" class="dest" onclick={() => goDest(d)}>
                <DestIcon kind={d.kind} />
                <span class="dt"><b>{d.label}</b><small>{d.hint}</small></span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </section>
{/if}

<style>
  /* Compact mockup 1: a search, a row of chips, the stop's board (one row per line), favourites, destinations. */
  .now { position: absolute; z-index: 6; left: 16px; bottom: 100px; width: 380px; max-height: calc(100dvh - 200px - env(safe-area-inset-top));
    overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 16px; box-sizing: border-box;
    border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .grip { display: none; }
  h2 { margin: 0; font-size: 14px; font-weight: 700; line-height: 1; }
  .muted { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
  .hint { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.3; }
  button { font: inherit; color: inherit; }

  /* «Πού πας;» */
  .where { flex: none; height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 14px; border: 0; border-radius: 14px;
    background: var(--control); color: var(--muted); font-size: 16px; font-weight: 600; line-height: 1; cursor: pointer; text-align: left; }
  .where :global(svg) { color: var(--accent); stroke-width: 2.4; flex: none; }
  .where:hover { background: var(--control-hover); color: var(--fg); }

  /* Home, work and the bell */
  .chips { flex: none; display: flex; align-items: center; gap: 8px; }
  .chip { flex: none; height: 36px; display: flex; align-items: center; gap: 7px; padding: 0 12px 0 10px; border: 0; border-radius: 18px;
    background: var(--card); box-shadow: inset 0 0 0 1px var(--card-border); cursor: pointer; white-space: nowrap; }
  .chip b { font-size: 14px; font-weight: 700; line-height: 1; }
  .chip .cl { font-size: 13px; font-weight: 600; line-height: 1; color: var(--muted); }
  .chip .cm { font-size: 14px; font-weight: 600; line-height: 1; color: var(--ontime); font-variant-numeric: tabular-nums; }
  .chip .cf { font-size: 12.5px; font-weight: 600; line-height: 1; color: color-mix(in srgb, var(--accent) 45%, var(--fg)); font-variant-numeric: tabular-nums; }
  .chip.best { background: color-mix(in srgb, var(--accent) 16%, var(--card)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent); }
  .chip.here { color: var(--muted); }
  .bell { position: relative; margin-left: auto; flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: var(--card); box-shadow: inset 0 0 0 1px var(--card-border); cursor: pointer; }
  .bdot { position: absolute; top: 7px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--late2); box-shadow: 0 0 0 2px var(--card); }
  .hid { width: 100%; height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 12px; border: 0; border-top: 1px solid var(--card-border);
    background: none; color: var(--muted); font-size: 13px; line-height: 1; cursor: pointer; }
  .hid b { color: var(--fg); font-weight: 600; }

  /* The stop's board */
  .board { flex: none; display: flex; flex-direction: column; border-radius: 16px; background: var(--card); box-shadow: inset 0 0 0 1px var(--card-border); overflow: hidden; }
  .bh { height: 48px; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 12px; border-bottom: 1px solid var(--card-border); }
  .sh { flex: 1; min-width: 0; height: 48px; display: flex; align-items: center; gap: 10px; padding: 0; border: 0; background: none; cursor: pointer; text-align: left; }
  .stile { flex: none; width: 28px; height: 28px; border-radius: 8px; background: #fff; display: flex; align-items: center; justify-content: center; }
  .stile img { width: 17px; height: 17px; display: block; }
  .stile.sm { width: 24px; height: 24px; border-radius: 7px; }
  .stile.sm img { width: 15px; height: 15px; }
  .st, .dt { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; }
  .st b, .dt b { font-size: 15px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dt b { font-size: 14.5px; }
  .st small, .dt small { font-size: 12.5px; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* The two ways of the stop: two equal halves, the one shown in the accent; a long name ends in «…» inside its half. */
  .sides { flex: 0 1 212px; min-width: 0; height: 32px; display: flex; gap: 2px; padding: 2px; box-sizing: border-box; border-radius: 16px;
    background: none; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 14%, transparent); }
  .sides button { flex: 1 1 0; min-width: 0; height: 28px; display: flex; align-items: center; justify-content: center; padding: 0 8px; border: 0; border-radius: 14px;
    background: none; font: inherit; font-size: 12.5px; font-weight: 600; line-height: 1; color: var(--muted); cursor: pointer; }
  .sides button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sides button.on { flex-grow: 1.7; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
  .dep { width: 100%; height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 0; background: none; cursor: pointer; text-align: left; }
  .dep + .dep { border-top: 1px solid var(--card-border); }
  .dep:hover { background: var(--control); }
  .dr { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
  .dr small { font-size: 12.5px; line-height: 1; color: var(--muted); font-variant-numeric: tabular-nums; }
  .dm { height: 16px; display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .dm i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .dm.ok { color: var(--ontime); } .dm.late { color: var(--late1); } .dm.sched { color: var(--fg); }
  .bm { padding: 14px 12px; }

  .empty { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 14px; border-radius: 16px; background: var(--card); }
  .empty p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
  .go { height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border: 0; border-radius: 22px;
    background: var(--accent); color: var(--on-accent); font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; }

  /* Section heads and the rows under them */
  .head { flex: none; height: 20px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 2px; }
  .head.dh { margin-top: 4px; }
  .link { height: 20px; display: flex; align-items: center; padding: 0; border: 0; background: none; color: var(--accent); font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .cnt { font-size: 12px; color: var(--muted); line-height: 1; }
  .rows { flex: none; display: flex; flex-direction: column; gap: 6px; }
  .srow { width: 100%; height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 0; border-radius: 14px; background: var(--card); cursor: pointer; text-align: left; }
  .srow b { flex: 1; min-width: 0; font-size: 14.5px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sr { flex: none; display: flex; align-items: center; gap: 3px; font-size: 13px; font-weight: 600; line-height: 1; color: color-mix(in srgb, var(--fg) 80%, var(--muted)); font-variant-numeric: tabular-nums; }
  .srow:hover { background: var(--control-hover); }

  /* Destinations */
  .dg { flex: none; display: flex; flex-direction: column; gap: 8px; }
  .gl { height: 20px; display: flex; align-items: center; padding: 0 2px; font-size: 13px; font-weight: 700; line-height: 1; color: var(--muted); }
  .dgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .dest { min-width: 0; height: 60px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border: 0; border-radius: 14px; background: var(--card); cursor: pointer; text-align: left; }
  .dest .dt b { font-size: 14px; }
  .dest .dt small { font-size: 12px; }
  .dest:hover { background: var(--control-hover); }

  kbd { margin-left: auto; height: 24px; display: inline-flex; align-items: center; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border);
    color: var(--muted); font: 600 12px/1 var(--font); }
  .pc { display: none; }
  @media (min-width: 720px) and (pointer: fine) { .pc { display: inline-flex; } }
  @media (min-width: 1024px) { .now { width: 400px; } }
  .bell[hidden] { display: none; }
  /* A computer (desktop mockup Υ1): the home column runs the window's height, the map beside it; the name and the
     map, alerts and settings buttons at its top, the chips wrap. */
  @media (min-width: 720px) {
    .now { top: calc(16px + env(safe-area-inset-top)); bottom: 16px; max-height: none; width: var(--col-w, 440px); padding-top: 6px; }
    .chips { flex-wrap: wrap; }
  }
  .brand { flex: none; height: 52px; display: flex; align-items: center; gap: 4px; margin: 0 -6px 0 0; }
  .brand b { flex: 1; min-width: 0; margin-left: 6px; font-size: 17px; font-weight: 800; line-height: 1; }
  .logo { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 9px;
    background: var(--accent); color: var(--on-accent); }
  .bb { position: relative; flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; padding: 0;
    border: 0; border-radius: 50%; background: none; color: var(--fg); cursor: pointer; }
  .bb:hover { background: var(--control); }
  .bb:focus-visible, .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .bb .bdot { top: 8px; right: 9px; box-shadow: 0 0 0 2px var(--glass-strong); }

  /* The notice on the map: an amber pill under the search field. */
  .mapnote { position: absolute; z-index: 5; left: 12px; top: calc(72px + env(safe-area-inset-top)); max-width: min(380px, calc(100% - 32px));
    height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 8px; box-sizing: border-box; border-radius: 15px;
    background: color-mix(in srgb, var(--late1) 16%, var(--surface)); border: 1px solid color-mix(in srgb, var(--late1) 35%, transparent);
    color: var(--warn-fg); font-size: 12px; font-weight: 600; line-height: 1; text-decoration: none; box-shadow: var(--shadow-sm); }
  .mapnote span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mapnote { padding: 0 2px 0 0; }
  .mapnote a { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; gap: 8px; padding-left: 8px; color: inherit; text-decoration: none; }
  .mapnote button { flex: none; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: none; color: inherit; cursor: pointer; }
  .mapnote.strike { padding: 0 2px 0 0; background: color-mix(in srgb, var(--late3) 16%, var(--surface)); border-color: color-mix(in srgb, var(--late3) 35%, transparent); color: var(--late3); }
  .mapnote.strike a { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; gap: 8px; padding-left: 8px; color: inherit; text-decoration: none; }
  .mapnote.strike button { flex: none; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; background: none; color: inherit; cursor: pointer; }

  /* Pinned */
  .pins { flex: none; list-style: none; margin: 0; padding: 0; border-radius: 16px; background: var(--card); box-shadow: inset 0 0 0 1px var(--card-border); overflow: hidden; }
  .pins li { display: flex; align-items: center; gap: 4px; min-height: 52px; padding: 0 6px 0 8px; }
  .pins li + li { border-top: 1px solid var(--card-border); }
  .pc-dot { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; }
  .pc-dot i { width: 20px; height: 20px; border-radius: 50%; background: var(--pc); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .15); }
  .pin-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 6px; border: 0; border-radius: 12px; background: none; cursor: pointer; text-align: left; }
  .unpin { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--muted); cursor: pointer; }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  @media (max-width: 719px) {
    /* Under the search and the chips, in their column; ✕ at the right. */
    .mtop .mapnote { position: static; max-width: none; height: 40px; padding: 0 4px 0 6px; border-radius: 14px; font-size: 13px;
      -webkit-backdrop-filter: blur(16px) saturate(160%); backdrop-filter: blur(16px) saturate(160%); }
    .mtop .mapnote button { width: 32px; height: 32px; }
    /* A sheet from edge to edge, rounded at the top (mockup 1). */
    .now { left: 0; right: 0; width: auto; top: calc(8px + env(safe-area-inset-top)); bottom: 0; max-height: none;
      padding: 8px 16px calc(16px + env(safe-area-inset-bottom) + var(--padb, 0px)); border-radius: 24px 24px 0 0; background: var(--surface); box-shadow: 0 -10px 30px rgba(0, 0, 0, .45);
      -webkit-backdrop-filter: none; backdrop-filter: none; }
    /* The handle: a band across the top (an easy target), its bar in the middle. */
    /* It stays at the top while the sheet scrolls under it. */
    .grip { display: block; position: sticky; top: -8px; z-index: 2; flex: none; height: 22px; margin: -8px -16px -6px; cursor: grab; background: none; border-radius: 24px 24px 0 0; }
    .grip::after { content: ""; position: absolute; left: 50%; top: 8px; width: 40px; height: 5px; margin-left: -20px; border-radius: 3px; background: var(--grip); }
    .grip:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 12px; }
    /* Its part slid under the screen's foot is cut off (clip-path, with the sheet), so it floats 8 px above the foot,
       rounded, at every height. */
    .now { overscroll-behavior: none; transition: translate .26s cubic-bezier(.2, .8, .2, 1), clip-path .26s cubic-bezier(.2, .8, .2, 1); }
    .now.dragging { transition: none; }
    .now.dragging { transition: none; }
  }
  /* Under a press, the big buttons and rows give a little. */
  .where, .chip, .dep, .srow, .dest, .go { transition: transform .12s, background-color .15s; }
  .where:active, .chip:active, .srow:active, .dest:active, .go:active { transform: scale(.98); }
  @media (prefers-reduced-motion: reduce) { .where, .chip, .dep, .srow, .dest, .go { transition: none; } }
  .hlink { height: 28px; display: flex; align-items: center; padding: 0 4px; border: 0; background: none; color: var(--accent); font: inherit; font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; }
  /* Lowered on a phone (compact mockup 15Γ): the sheet is its handle and one line; the search and chips on the map. */
  .now.peeked > :not(.grip):not(.peekl) { visibility: hidden; }
  .peekl.pkx { width: 100%; height: 28px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0; border: 0; background: none;
    color: color-mix(in srgb, var(--fg) 82%, var(--muted)); font: inherit; font-size: 13.5px; font-weight: 700; line-height: 1; cursor: pointer; }
  .peekl.pkx :global(svg) { transform: rotate(180deg); color: var(--muted); }
  .peekl:not(.pkx) { display: flex; flex-direction: column; gap: 8px; }
  .pk1 { width: 100%; height: 44px; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .pk1 .stile { flex: none; width: 40px; height: 40px; border-radius: 50%; }
  .pk1 .stile img { width: 24px; height: 24px; }
  .pkt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .pkt b { font-size: 15.5px; font-weight: 800; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pkt small { height: 13px; display: flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; line-height: 1; color: var(--muted); }
  .pkc { flex: none; display: flex; color: var(--muted); transform: rotate(-90deg); }
  .pk2 { height: 30px; display: flex; align-items: center; gap: 6px; padding-left: 52px; min-width: 0; overflow: hidden; }
  .pkd { flex: none; height: 30px; display: flex; align-items: center; gap: 7px; padding: 0 10px 0 3px; border: 0; border-radius: 15px; cursor: pointer;
    background: var(--tile); box-shadow: inset 0 0 0 1px var(--tile-line); color: var(--fg); font: inherit; }
  .pkd b { font-size: 14px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .pkd b.live { color: var(--ontime); }
  .pkl { width: 6px; height: 6px; border-radius: 50%; background: var(--ontime); display: block; flex: none; }
  .pkm { flex: none; font-size: 12.5px; font-weight: 700; line-height: 1; color: var(--muted); padding-left: 4px; white-space: nowrap; }
  .mtop { position: fixed; z-index: 6; left: 16px; right: 16px; top: calc(16px + env(safe-area-inset-top)); display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
  .mtop > :global(*) { pointer-events: auto; }   /* :global: the status note is another component's */
  .mwhere { height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 18px; border: 0; border-radius: 26px; text-align: left; cursor: pointer;
    background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: 0 4px 14px rgb(0 0 0 / .4), inset 0 0 0 1px var(--card-border, var(--border));
    color: color-mix(in srgb, var(--fg) 82%, var(--muted)); font: inherit; font-size: 16px; font-weight: 600; line-height: 1; }
  .mwhere :global(svg) { color: var(--accent); }
  /* A scrolling row clips what spills out of it: room around the chips (taken back by the margins) for their shadows,
     and to the screen's edges on both sides. */
  .mchips { display: flex; gap: 8px; overflow-x: auto; margin: -6px -16px -14px; padding: 6px 16px 14px; scrollbar-width: none; pointer-events: auto; }   /* auto: iOS scrolls the row only so */
  .mchips::-webkit-scrollbar { display: none; }
  .mchips .chip { height: 34px; }
  .chip.glass { background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: var(--float), inset 0 0 0 1px var(--card-border, var(--border)); color: var(--fg); }
  .mwhere, .chip.glass { background: color-mix(in srgb, var(--surface) 62%, transparent); -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); }
  /* A phone: the search and the chips are on the map (compact mockup 15Γ), not in the sheet. */
  @media (max-width: 719px) { .now > .where, .now > .chips { display: none; } }
  .chip.glass.round { width: 34px; padding: 0; justify-content: center; position: relative; }
  .chip.glass.round .bdot { position: absolute; right: 6px; top: 6px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  /* On the see-through sheet the cards stand out without turning grey: a darker glass than the sheet, a fine light
     edge and a shadow under them. */
  .board, .srow, .dest { background: var(--tile); box-shadow: inset 0 0 0 1px var(--tile-line), var(--tile-lift); }
  .srow:hover, .dest:hover { background: var(--tile-hover); }
</style>
