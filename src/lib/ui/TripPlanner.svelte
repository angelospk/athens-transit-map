<script lang="ts" module>
  import type { Place } from "../trip";

  // Kept across close and reopen.
  interface End { text: string; place: Place | null }
  const memo = { from: { text: "", place: null } as End, to: { text: "", place: null } as End, radius: 500, n: 3, applied: "" };
</script>

<script lang="ts">
  import { tick, untrack } from "svelte";
  import { fetchLines } from "../api";
  import { MAX_LINES } from "../selection";
  import { canPush, startPush, stopPush } from "../push";
  import { encodeAlert, type Rep } from "../tglink";
  import type { AppState } from "../state.svelte";
  import { alertTargets, anyMetro, boardings, centre, distM, findTransfers, findTrips, geocode, legTrip, loadTripIndex, metroDirect, metroPlaces, nearestStation, places, searchPlaces,
    suggest, termini, toggleTripLine, type Pt, type TripIndex, type TripLine, type TripTransfer } from "../trip";

  let { app, onclose }: { app: AppState; onclose: () => void } = $props();

  type Field = "from" | "to";
  const FIELDS = ["from", "to"] as const;
  const RADII = [300, 500, 800];
  const ME = "Η θέση μου";
  const ALERT_S = 2 * 3600;
  const phone = () => matchMedia("(max-width: 719px)").matches;

  let ends = $state.raw<Record<Field, End>>({ from: memo.from, to: memo.to });
  let radius = $state(memo.radius);
  let n = $state(memo.n);
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

  $effect(() => { memo.from = ends.from; memo.to = ends.to; memo.radius = radius; memo.n = n; });
  $effect(() => () => { ctl?.abort(); clearTimeout(timer); gen++; locGen.from++; locGen.to++; closed = true; });

  async function load() {
    failed = false;
    app.loadMetro();   // stations to start or end at (once; again after a failure)
    try {
      const [ix, lines] = await Promise.all([loadTripIndex(), fetchLines()]);
      data = { ix, places: places(ix), known: new Set(lines.lines.map(l => l.id)), stale: ix.v === lines.gtfs_version ? null : ix.v };
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
      return [{ key: "me", me: true }, ...(openField === "to" && anyM ? [{ key: keyOf(anyM), place: anyM }] : [])];
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
    geoBusy = true;
    timer = setTimeout(() => {
      ctl = new AbortController();
      geocode(q, ctl.signal).then(
        r => { if (g === gen) geo = { text: q, places: r }; },
        () => {},   // offline or busy: the stops still answer
      ).finally(() => { if (g === gen) geoBusy = false; });
    }, 350);
  }

  function choose(f: Field, o: Opt) {
    stopSearch();
    openField = null;
    if (o.me) return locate(f);
    ends = { ...ends, [f]: { text: o.place!.label, place: o.place! } };
    next(f);
  }

  // After a choice: on to the other field while it is empty, else close the keyboard.
  function next(f: Field) {
    const other: Field = f === "from" ? "to" : "from";
    if (!ends[other].place && !ends[other].text.trim()) inputs[other]?.focus();
    else inputs[f]?.blur();
  }

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

  function swap() {
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

  // Once per trip: reopening the planner must not undo picks changed since. On a phone, each new trip
  // folds the planner so the map shows. With no line without a change, the best change is shown.
  $effect(() => {
    if (!trips || !from || !to) return;
    const key = JSON.stringify([from.pts, to.pts, radius]);
    if (key === memo.applied) return;
    memo.applied = key;
    untrack(() => {
      picked = null;
      app.tripStops = [];
      if (trips.length) app.showTrip(trips.map(t => ({ id: t.line, variants: t.variants.map(v => v.id) })));
      else if (xfers.length) pickXfer(xfers[0]);
    });
    if ((trips.length || xfers.length) && phone()) {
      folded = true;
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  });

  function close() {
    stopSearch();
    app.tripEnds = null;
    app.tripStops = [];
    onclose();
  }

  // The lines of the trip that are on the map, for the folded summary and the alert: which, and where each goes.
  const onMap = $derived((trips ?? []).filter(t => app.selected.includes(t.line)));
  const xferLines = $derived(app.selected.filter(l => !onMap.some(t => t.line === l) && xfers.some(x => x.legs.some(g => g.line === l))));

  // Alert settings, folded until asked for: the stop to wait at (each line's own, or one of the stops
  // nearest the start), how early, and which of the trip's lines on the map. A new trip resets them.
  // A picked change: the alert watches its first line, up to the change stop.
  let alertOpen = $state(false);
  let boardName = $state("");
  let off = $state<string[]>([]);
  const xPicked = $derived(xfers.find(x => xkey(x) === picked) ?? null);
  const aTrips = $derived(xPicked ? [legTrip(xPicked.legs[0])] : trips);
  const aOnMap = $derived((aTrips ?? []).filter(t => app.selected.includes(t.line)));
  $effect(() => { void trips; void xPicked; boardName = ""; off = []; });
  // Another stop to wait at: not for a change, whose first line is boarded where the change was planned.
  const near = $derived(data && from && to && !xPicked && aOnMap.length ? boardings(data.ix, from.pts, to.pts, radius, aOnMap.map(t => t.line)) : []);
  const board = $derived(near.find(b => b.name === boardName) ?? null);
  const tickable = $derived((board ? board.lines.map(l => l.line) : aOnMap.map(t => t.line)).filter(l => app.selected.includes(l)));
  const targets = $derived(aTrips ? alertTargets(aTrips, app.selected, board, off) : []);
  const setTicked = (line: string, on: boolean) => { off = on ? off.filter(l => l !== line) : [...off, line]; };

  // The chosen alert as a link payload (src/lib/tglink.ts): for Telegram and for web push. A recurring
  // one (days, from what time, for how long) is for Telegram only.
  const payload = $derived(data && !data.stale ? encodeAlert(data.ix, n, targets) : null);
  // Athens time, as the bot reads it.
  const nextFive = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(Date.now() + 5 * 60_000).map(x => [x.type, x.value]));
    return `${p.hour}:${String(Math.floor(+p.minute / 5) * 5).padStart(2, "0")}`;
  };
  let repDays = $state(0);
  let repStart = $state(nextFive());
  let repLen = $state(60);
  const rep = $derived.by((): Rep | undefined => {
    const [h, m] = repStart.split(":").map(Number);
    return repDays && Number.isFinite(h) && Number.isFinite(m) ? { days: repDays, start: h * 60 + Math.floor(m / 5) * 5, len: repLen } : undefined;
  });
  const tgPayload = $derived(repDays ? (rep && data && !data.stale ? encodeAlert(data.ix, n, targets, rep) : null) : payload);

  // Stop alert for the chosen lines, at the chosen stop: in the page, and as web push where the browser
  // has it (then it comes with the page closed). The permission prompt comes first, from the tap itself
  // (browsers ignore it later).
  const canNotify = typeof Notification !== "undefined";
  // iPhones give web push only to a web app opened from the Home Screen.
  const iosTab = typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
    !matchMedia("(display-mode: standalone)").matches && !(navigator as { standalone?: boolean }).standalone;
  // One alert at a time: a second tap while the first waits (permission, server) does nothing.
  let pushing = $state(false);
  async function alertMe() {
    if (pushing) return;
    pushing = true;
    try { await startAlert(); } finally { pushing = false; }
  }
  async function startAlert() {
    const t = aTrips, d = data, f = from, p = payload;
    if (!t || !d || !f) return;
    if (canNotify && Notification.permission === "default") await Notification.requestPermission().catch(() => {});
    // Registered before the alert starts: phones show notifications only through it.
    const reg = await navigator.serviceWorker?.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => null);
    if (closed || t !== aTrips) return;   // the trip changed while the browser asked
    const ix = d.ix;
    const lines = targets.map(l => ({ line: l.line, variants: l.variants.map(v => ({ id: v.id, i: v.i, name: ix.s[v.from][0] })) }));
    if (!lines.length) {
      err = aOnMap.length ? "Διάλεξε τουλάχιστον μία γραμμή." : "Καμία γραμμή της διαδρομής δεν είναι στον χάρτη: πάτα μία για να τη δείξεις.";
      return;
    }
    err = null;
    let push: { id: string; until: number } | null = null;
    if (reg && p && canPush() && Notification.permission === "granted") {
      const ready = await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(r, 5000, null))]);
      push = ready && (await startPush(ready, p));
      if (closed || t !== aTrips || p !== payload) { if (push) void stopPush(push.id); return; }
      if (!push) err = "Η ειδοποίηση δουλεύει μόνο με τη σελίδα ανοιχτή: ο server ειδοποιήσεων δεν απάντησε.";
    }
    app.setAlert({ n, until: push?.until ?? Math.floor(app.serverMs() / 1000) + ALERT_S, label: board?.name ?? f.label, lines, ...(push ? { push: push.id } : {}) });
    alertOpen = false;
  }

  // The same alert in Telegram (src/lib/tglink.ts).
  const BOT = "oasa_bus_bot";
  const tgLink = $derived(tgPayload && `https://t.me/${BOT}?start=${tgPayload}`);

  const stop = (k: number) => data?.ix.s[k][0] ?? "";
  const metres = (m: number) => (m < 50 ? "δίπλα" : `≈ ${Math.round(m / 50) * 50} μ.`);
  const icon = (p: Place) => ({ area: "◎", stop: "🚏", me: "📍", street: "⌖", poi: "•", metro: "🚇", "metro-any": "🚇" })[p.kind ?? "street"];
  const mins = (m: number) => `≈ ${Math.max(1, Math.round(m))}′`;
  // Where a trip gets off: the stop, and for "any metro station" the station there.
  const offAt = (k: number) => { const st = anyEnd && data ? stationAt(ptOf(k)) : null; return st ? `${stop(k)} (🚇 ${st.name})` : stop(k); };
  const shown = $derived(aTrips ? Math.min(aTrips.length, MAX_LINES) : 0);
  // Where a result goes: the variants that make the trip. The summary follows the direction shown on the map.
  const going = (t: TripLine) => (data ? termini(data.ix, t.line, t.variants.map(v => v.id)).join(" · ") : "");
  const goingNow = (line: string, variants: string[] = []) => (data ? termini(data.ix, line, app.focus[line] ?? variants).join(" · ") : "");

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

<div class="trip" role="dialog" tabindex="-1" aria-labelledby="trip-h" {@attach focusIn}
  onkeydown={e => { if (e.key === "Escape" && !openField) { e.stopPropagation(); close(); } }}>
  {#if folded && from && to && trips}
    <span id="trip-h" class="sr">Διαδρομή</span>
    <div class="row">
      <button type="button" class="summary" aria-expanded="false" onclick={() => (folded = false)}>
        <b>{from.label} → {to.label}</b>
        <small>{#if trips.length}{trips.length} {trips.length === 1 ? "γραμμή" : "γραμμές"}{#if trips.length > MAX_LINES} · {MAX_LINES} στον χάρτη{/if}{:else if xfers.length}με μία αλλαγή{/if}{#if app.alert} · 🔔{/if}</small>
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
      <button type="button" class="icon" aria-label="Κλείσιμο διαδρομής" title="Κλείσιμο" onclick={close}>×</button>
    </div>
  {:else}
    <div class="row">
      <h3 id="trip-h">Διαδρομή</h3>
      {#if trips?.length || xfers.length}
        <button type="button" class="icon" aria-label="Σύμπτυξη" title="Σύμπτυξη" onclick={() => (folded = true)}>
          <svg viewBox="0 0 12 8" width="14" height="10" aria-hidden="true"><path d="M1 6.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      {/if}
      <button type="button" class="icon" aria-label="Κλείσιμο διαδρομής" title="Κλείσιμο" onclick={close}>×</button>
    </div>

    <div class="ends">
      {#each FIELDS as f (f)}
        {@const e = ends[f]}
        <div class="field">
          <i class="dot {f}" aria-hidden="true">{f === "from" ? "A" : "B"}</i>
          <input id="trip-{f}" bind:this={inputs[f]} type="search" autocomplete="off" spellcheck="false" enterkeyhint="search"
            aria-label={f === "from" ? "Από" : "Προς"} placeholder={f === "from" ? "Από: η θέση μου, στάση, μετρό, διεύθυνση" : "Προς: στάση, μετρό, διεύθυνση, μαγαζί"}
            value={e.text} class:set={!!e.place}
            role="combobox" aria-expanded={openField === f} aria-controls="trip-{f}-list" aria-autocomplete="list"
            aria-activedescendant={openField === f && opts[active] ? `trip-${f}-${active}` : undefined}
            onfocus={() => { openField = f; }} oninput={ev => edit(f, ev.currentTarget.value)} onkeydown={ev => onkeydown(f, ev)} />
        </div>
        <!-- In the flow, not floating: a floating list is cut off by the planner's own scroll box. -->
        {#if openField === f}
            <ul id="trip-{f}-list" class="list" role="listbox" aria-label={f === "from" ? "Αφετηρία" : "Προορισμός"}>
              {#each opts as o, k (o.key)}
                <!-- svelte-ignore a11y_click_events_have_key_events (keyboard goes through the combobox input) -->
                <li id="trip-{f}-{k}" role="option" aria-selected={k === active} class:active={k === active}
                  onpointerdown={ev => ev.preventDefault()} onclick={() => choose(f, o)}>
                  {#if o.me}<span><i aria-hidden="true">📍</i> {ME}</span>
                  {:else if o.place}
                    <span><i aria-hidden="true">{icon(o.place)}</i> {o.place.label}</span>
                    <small>{o.place.kind === "metro-any" ? "η γραμμή που σε πάει πιο γρήγορα σε σταθμό" : o.place.lines.length ? o.place.lines.slice(0, 6).join(" · ") + (o.place.lines.length > 6 ? " …" : "") : o.place.hint ?? ""}</small>
                  {/if}
                </li>
              {:else}
                <li class="empty">{geoBusy ? "Αναζήτηση…" : "Δεν βρέθηκε στάση ή περιοχή με αυτό το όνομα."}</li>
              {/each}
              {#if geoBusy && opts.length}<li class="empty" aria-hidden="true">Αναζήτηση περιοχών…</li>{/if}
            </ul>
          {/if}
      {/each}
      <button type="button" class="swap" hidden={!!openField} aria-label="Αντιστροφή αφετηρίας και προορισμού" title="Αντιστροφή" onclick={swap}>⇅</button>
    </div>
    {#if locating}<p class="note">Εντοπισμός…</p>{/if}

    {#if err}<p class="warn" role="status">{err}</p>{/if}
    {#if byMetro}<p class="metro">🚇 Με {byMetro.line}: {byMetro.from} → {byMetro.to}{#if byMetro.walk >= 50} · περπάτημα {metres(byMetro.walk)}{/if}. Συνήθως πιο γρήγορα από το λεωφορείο.</p>{/if}
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
      <ol class="results" bind:this={resultsEl}>
        {#each trips as t, k (t.line)}
          {@const info = app.lineInfo.get(t.line)}
          {@const v = t.variants[0]}
          <li class:out={k >= MAX_LINES} class:picked={picked === t.line}>
            <button type="button" class="chip" style:--c={app.lineColor(t.line).bg} style:--t={app.lineColor(t.line).fg}
              aria-pressed={app.selected.includes(t.line)} title={info?.name}
              onclick={() => toggleTripLine(app, t)}>{t.line}</button>
            <button type="button" class="pick" aria-pressed={picked === t.line} title="Μόνο αυτή στον χάρτη, με τις στάσεις της" onclick={() => solo(t)}>
              <span><b>{mins(t.min)}</b> {stop(v.from)} → {offAt(v.to)}</span>
              <small>{#if going(t)}προς {going(t)} · {/if}{t.stops} {t.stops === 1 ? "στάση" : "στάσεις"} · περπάτημα {metres(t.walk)}{#if k >= MAX_LINES} · εκτός χάρτη (έως {MAX_LINES}){/if}</small>
            </button>
          </li>
        {/each}
      </ol>
      {#if xfers.length}
        <h4 class="sub">Με μία αλλαγή</h4>
        <ol class="results">
          {#each xfers as x (xkey(x))}
            {@const [a, b] = x.legs}
            <li class:picked={picked === xkey(x)}>
              <span class="pair">
                <b class="chip on" style:--c={app.lineColor(a.line).bg} style:--t={app.lineColor(a.line).fg}>{a.line}</b>
                <b class="chip on" style:--c={app.lineColor(b.line).bg} style:--t={app.lineColor(b.line).fg}>{b.line}</b>
              </span>
              <button type="button" class="pick" aria-pressed={picked === xkey(x)} title="Αυτές οι δύο στον χάρτη, με τις στάσεις" onclick={() => pickXfer(x)}>
                <span><b>{mins(x.min)}</b> {stop(a.from)} → {stop(a.to)}, αλλαγή: {stop(b.from)} → {offAt(b.to)}</span>
                <small>{a.stops + b.stops} στάσεις · περπάτημα {metres(x.walk)}{#if x.xfer >= 50} και {metres(x.xfer)} στην αλλαγή{/if} · με ~5′ αναμονή</small>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
      {#if picked && trips.length}<button type="button" class="link all" onclick={showAll}>Όλες οι γραμμές στον χάρτη</button>{/if}
      {#if shown}
        <div class="alert">
          {#if app.alert}
            {@const a = app.alert}
            <span>🔔 {a.lines.map(l => l.line).join(", ")}: έως {a.n} {a.n === 1 ? "στάση" : "στάσεις"} πριν από {a.label}{a.push ? ", και με κλειστή σελίδα" : ""}.</span>
            <button type="button" class="link" onclick={() => app.setAlert(null)}>Ακύρωση</button>
            {#if tgLink}<a class="bell tg" href={tgLink} target="_blank" rel="noopener">Στο Telegram</a>{/if}
          {:else if data.stale}
            <small>Ειδοποίηση: όχι με παλιά δεδομένα στάσεων.</small>
          {:else}
            <button type="button" class="lead" aria-expanded={alertOpen} aria-controls="trip-alert" onclick={() => (alertOpen = !alertOpen)}>
              🔔 Ειδοποίηση
              <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true" class:up={alertOpen}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
          {/if}
        </div>
        {#if alertOpen && !app.alert && !data.stale}
          <div id="trip-alert" class="form">
            {#if xPicked}<p class="note">Για την πρώτη γραμμή, {xPicked.legs[0].line}, ως την αλλαγή στη στάση {stop(xPicked.legs[0].to)}.</p>{/if}
            {#if near.length > 1}
              <label>Στάση
                <select bind:value={boardName}>
                  <option value="">η κοντινότερη κάθε γραμμής</option>
                  {#each near as b (b.name)}<option value={b.name}>{b.name} · {metres(b.walk)} · {b.lines.map(l => l.line).join(", ")}</option>{/each}
                </select>
              </label>
            {/if}
            <label>Πότε
              <select bind:value={n}>
                {#each [1, 2, 3, 4, 5] as k (k)}<option value={k}>{k === 1 ? "στην προηγούμενη στάση" : `${k} στάσεις πριν`}</option>{/each}
              </select>
            </label>
            <label>Επανάληψη
              <select bind:value={repDays}>
                <option value={0}>όχι, μόνο τώρα</option>
                <option value={31}>τις καθημερινές</option>
                <option value={127}>κάθε μέρα</option>
                <option value={96}>τα Σαββατοκύριακα</option>
              </select>
            </label>
            {#if repDays}
              <label>Από <input type="time" step="300" bind:value={repStart} />
                για <select bind:value={repLen}>{#each [[30, "½ ώρα"], [60, "1 ώρα"], [90, "1½ ώρα"], [120, "2 ώρες"]] as const as [m, t] (m)}<option value={m}>{t}</option>{/each}</select>
              </label>
            {/if}
            <fieldset>
              <legend>Γραμμές</legend>
              {#each tickable as l (l)}
                {@const info = app.lineInfo.get(l)}
                <label class="ln" style:--c={app.lineColor(l).bg}>
                  <input type="checkbox" checked={!off.includes(l)} onchange={e => setTicked(l, e.currentTarget.checked)} /><b>{l}</b>
                </label>
              {/each}
            </fieldset>
            <div class="go">
              {#if !repDays}<button type="button" class="bell" disabled={!targets.length || pushing} onclick={alertMe}>{pushing ? "…" : "Εδώ"}</button>{/if}
              {#if tgLink}<a class="bell tg" href={tgLink} target="_blank" rel="noopener">Στο Telegram</a>
              {:else if repDays}<small class="warn">Διάλεξε ώρα έναρξης, ώστε να τελειώνει ως τα μεσάνυχτα.</small>{/if}
            </div>
            {#if repDays}
              <p class="note">Η επανάληψη γίνεται στο Telegram (@{BOT}): σου γράφει κάθε φορά που ένα λεωφορείο πλησιάζει, μόνο σε αυτές τις ώρες.
                Εκεί, /list δείχνει τις ειδοποιήσεις σου και τις σταματάει.</p>
            {:else}
            <p class="note">Για 2 ώρες.
              {#if canPush()}Εδώ: και με κλειστή σελίδα ή κλειδωμένη οθόνη.
              {:else}Εδώ: όσο η σελίδα είναι ανοιχτή{canNotify ? "" : ", μόνο μέσα στη σελίδα"}.{/if}
              Telegram: και με κλειδωμένη οθόνη, από το @{BOT}.</p>
            {/if}
            {#if iosTab && !repDays}
              <p class="note">iPhone, για ειδοποίηση εδώ με κλειδωμένη οθόνη: Κοινοποίηση → «Προσθήκη στην οθόνη Αφετηρίας», και άνοιξε τον χάρτη από το εικονίδιο.</p>
            {/if}
          </div>
        {/if}
      {/if}
    {:else}
      <p class="note">Διάλεξε από πού και προς τα πού: οι γραμμές που τα συνδέουν φαίνονται στον χάρτη.</p>
    {/if}

    <div class="foot">
      <label>Περπάτημα έως
        <select bind:value={radius}>{#each RADII as r (r)}<option value={r}>{r} μ.</option>{/each}</select>
      </label>
      {#if trips?.length || xfers.length}<small>Χρόνοι κατά προσέγγιση, χωρίς την αναμονή στη στάση.</small>{/if}
      {#if data?.stale}<small>Στάσεις από {data.stale}· μπορεί να έχουν αλλάξει.</small>{/if}
      {#if geo?.places.length}<small>Περιοχές: © OpenStreetMap</small>{/if}
    </div>
  {/if}
</div>

<style>
  .trip { min-height: 0; padding: 8px 12px 10px; font-size: 13px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; }
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .row { display: flex; align-items: center; gap: 4px; }
  h3 { flex: 1; margin: 0; font-size: 14px; }
  .icon { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border: 0; border-radius: 8px; background: none;
    color: var(--muted); font-size: 20px; cursor: pointer; }
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
  .ends { position: relative; display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding-right: 38px; }
  .field { display: flex; align-items: center; gap: 6px; }
  .dot { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #222; color: #fff;
    font: normal 700 11px system-ui, sans-serif; }
  /* 16px: iOS zooms into smaller inputs on focus. */
  .field input { flex: 1; min-width: 0; height: 38px; padding: 0 10px; border: 1px solid var(--border); border-radius: 9px;
    background: var(--control); color: var(--fg); font-size: 16px; }
  .field input.set { border-color: var(--accent); }
  .swap { position: absolute; right: 0; top: calc(50% - 20px); width: 34px; height: 40px; border: 0; border-radius: 8px; background: none;
    color: var(--muted); font-size: 18px; cursor: pointer; }
  .swap[hidden] { display: none; }
  .swap:hover { background: var(--control); color: var(--fg); }
  .list { margin: 0 -38px 0 26px; max-height: min(320px, 45dvh); overflow-y: auto; padding: 4px; list-style: none;
    background: var(--control); border-radius: 10px; }
  .list li { display: flex; flex-direction: column; padding: 8px; border-radius: 7px; cursor: pointer; }
  .list li i { font-style: normal; display: inline-block; width: 1.3em; text-align: center; }
  .list li small { padding-left: 1.6em; color: var(--muted); font-size: 11px; }
  .list li.active, .list li:hover { background: var(--panel); }
  .list li.empty { cursor: default; color: var(--muted); font-size: 12px; background: none; }
  .results { margin: 8px 0 0; padding: 0; list-style: none; }
  .results li { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; }
  .results li.out { opacity: .6; }
  .results small { color: var(--muted); }
  .chip { flex: none; min-width: 46px; min-height: 28px; padding: 0 8px; border: 2px solid var(--c); border-radius: 14px;
    background: none; color: var(--fg); font-weight: 700; cursor: pointer; }
  .chip[aria-pressed="true"], .chip.on { background: var(--c); color: var(--t); }
  .chip.on { display: inline-grid; place-items: center; min-width: 0; cursor: default; }
  .pair { flex: none; display: flex; flex-direction: column; gap: 2px; }
  .pick { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 2px 6px; margin: -2px 0;
    border: 0; border-radius: 8px; background: none; color: var(--fg); font-size: 13px; text-align: left; cursor: pointer; }
  .pick:hover, .picked .pick { background: var(--control); }
  .pick b { font-variant-numeric: tabular-nums; }
  .metro { margin: 8px 0 0; padding: 6px 8px; border-radius: 8px; background: var(--control); font-size: 13px; }
  .sub { margin: 10px 0 0; font-size: 12px; color: var(--muted); font-weight: 600; }
  .all { margin-top: 6px; font-size: 12px; padding: 0; }
  .form input[type="time"] { min-height: 34px; padding: 0 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--control);
    color: var(--fg); font-size: 16px; }
  .alert { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
  .alert span { flex: 1; }
  .alert .lead { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 8px; margin-left: -8px; border: 0;
    border-radius: 8px; background: none; color: var(--fg); font-weight: 600; font-size: 13px; cursor: pointer; }
  .alert .lead:hover { background: var(--control); }
  .alert .lead svg.up { transform: rotate(180deg); }
  .form { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .form > label { display: flex; align-items: center; gap: 8px; color: var(--muted); }
  .form > label select { flex: 1; min-width: 0; }
  .form fieldset { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; padding: 0; border: 0; }
  .form legend { float: left; margin-right: 2px; color: var(--muted); }
  .form .ln { min-height: 30px; cursor: pointer; }
  .form .ln input { margin: 0; accent-color: var(--c); }
  .go { display: flex; gap: 6px; }
  .bell:disabled { opacity: .5; cursor: default; }
  .bell.tg { display: inline-grid; place-items: center; background: #229ed9; text-decoration: none; }
  .bell { min-height: 34px; padding: 0 12px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 600;
    font-size: 14px; cursor: pointer; }
  select { min-height: 34px; padding: 0 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--control);
    color: var(--fg); font-size: 16px; }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 8px; color: var(--muted); font-size: 12px; }
  .foot label { display: flex; align-items: center; gap: 6px; }
  .note { display: block; margin: 8px 0 0; color: var(--muted); font-size: 12px; }
  .warn { margin: 8px 0 0; color: var(--late2); }
  .link { border: 0; background: none; color: var(--accent); text-decoration: underline; cursor: pointer; font-size: inherit; }
</style>
