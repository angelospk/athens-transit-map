<script lang="ts">
  // «Ξεκίνα»: the trip followed step by step (app.guide, guide.ts). A banner on top says what to do now, as a phone's
  // navigation does: the next turn on foot, «Περίμενε το 040», «Κατέβα σε 4 στάσεις», «Πάτα STOP τώρα». The sheet
  // under it says whether the bus can be caught, how far it is, and when the trip ends. It follows the location
  // (app.myFix) from leg to leg by itself; with no location the steps list moves it by hand. Spoken in Greek where
  // the device has a voice, with a vibration at the moments that matter.
  import { busId } from "../busNs";
  import { tick, untrack } from "svelte";
  import { fetchLineStatic, fetchV2Line, fetchV2LineVehicles, fetchV2Run, fetchV2Stop } from "../api";
  import { toThe, along, distSaid, fetchFoot, isMetro, lengthOf, metres, railSeq, ridePassed, stepArrow, stepText, walkNow, WALK_MPS,
    type ChangeStep, type GuideRide, type GuideWalk, type Pt, type WalkRoute } from "../guide";
  import { metroRide } from "../metroRide.svelte";
  import { titleCase } from "../nearby";
  import { changeLine, levelM, transferLook } from "../transfer";
  import TransferBox from "./TransferBox.svelte";
  import type { LineDetail, V2Run } from "../v2";
  import { fold } from "../search";
  import { placeNote, toward } from "../stops";
  import { clockHM } from "../trains";
  import { stopRows, type V2Arrival, type V2Vehicle } from "../v2";
  import type { AppState } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import { durText } from "../format";
  import { rise } from "../anim";
  import { sheetDrag, type SheetDrag } from "../sheetDrag";
  import { euro, fareOf, priceOf } from "../fares";

  let { app }: { app: AppState } = $props();

  const g = $derived(app.guide);
  const leg = $derived(g?.legs[app.guideStep] ?? null);
  const pos = $derived<Pt | null>(app.myFix?.at ?? null);
  const nowS = $derived(app.serverNow / 1000);
  // The ride the user walks to, or waits for, or is on.
  const ride = $derived.by<GuideRide | null>(() => {
    if (!g) return null;
    for (let k = app.guideStep; k < g.legs.length; k++) { const l = g.legs[k]; if (l.kind === "ride") return l; }
    return null;
  });
  const rideIsNow = $derived(leg?.kind === "ride");
  const RIDE_MPS = 4.2;   // a city bus with its stops, about 15 km/h
  // The metro, with its stops, about 32 km/h; the tram 18.
  const mps = (r: GuideRide) => (/^[MΜ]\d/.test(r.line) ? 9 : /^[TΤ]\d/.test(r.line) ? 5 : RIDE_MPS);
  let arrived = $state(false);

  $effect(() => { document.documentElement.toggleAttribute("data-guide", !!g); });
  // Minimised, its bar sits at the foot: a card opened on the map (a bus, a stop) rises above it (app.css).
  $effect(() => { document.documentElement.toggleAttribute("data-guidemini", !!g && mini); return () => document.documentElement.removeAttribute("data-guidemini"); });
  $effect(() => { void g?.key; arrived = false; });

  // ---- The voice and the vibration.
  let voice = $state(load("guideVoice", true));
  function load<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
  function keep(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
  function say(text: string, buzz?: number[]) {
    if (buzz) navigator.vibrate?.(buzz);
    if (!voice || typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "el-GR";
    const el = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith("el"));
    if (el) u.voice = el;
    speechSynthesis.speak(u);
  }
  function toggleVoice() {
    voice = !voice;
    keep("guideVoice", voice);
    if (!voice) speechSynthesis?.cancel();
  }

  // The screen stays on while guiding, where the browser allows it.
  $effect(() => {
    if (!g) return;
    let lock: { release(): Promise<void> } | null = null, dead = false;
    const ask = () => {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
      void wl?.request("screen").then(l => { if (dead) void l.release(); else lock = l; }, () => {});
    };
    ask();
    const again = () => { if (document.visibilityState === "visible") ask(); };
    document.addEventListener("visibilitychange", again);
    return () => { dead = true; void lock?.release(); document.removeEventListener("visibilitychange", again); };
  });

  // ---- On foot: the route from where the user is to the leg's end, again when they leave it by over 35 m.
  let route = $state.raw<{ step: number; r: WalkRoute } | null>(null);
  let routeAt = 0;
  let routeReq: { step: number; key: string | undefined } | null = null;
  $effect(() => {
    const l = leg, step = app.guideStep, p = pos;
    if (!l || l.kind !== "walk") { route = null; return; }
    const cur = untrack(() => route);
    const off = cur && cur.step === step && p ? along(cur.r.line, p).off : 0;
    if (cur && cur.step === step && off < 35) return;
    if (routeReq?.step === step && routeReq.key === g?.key) return;   // asked already: a new location fix does not ask again
    if (Date.now() - routeAt < 15_000 && cur?.step === step) return;
    routeAt = Date.now();
    // Never cancelled (starting a guide sets it again in the same moment, which cancelled it every time): an answer for
    // a step or a guide that is no longer the one shown is left unused.
    const from = p ?? l.from, req = { step, key: g?.key };
    routeReq = req;
    void fetchFoot(from, l.to).then(r => { if (r && app.guideStep === req.step && app.guide?.key === req.key) route = { step, r }; }, () => {})
      .finally(() => { if (routeReq === req) routeReq = null; });
  });
  const walk = $derived(leg?.kind === "walk" && route && route.step === app.guideStep && pos ? walkNow(route.r, pos) : null);
  const walkLeftM = $derived(leg?.kind === "walk" ? (walk ? walk.left : metres(pos ?? leg.from, leg.to) * 1.25) : 0);
  $effect(() => { app.guideWalk = leg?.kind === "walk" ? (route?.step === app.guideStep ? route.r.line : [leg.from, leg.to]) : null; });

  // ---- The bus: its next arrivals at the stop to board, every 20 s, and where it is now (stops before, the lane).
  let times = $state.raw<{ at: number; live: boolean; vehicle: string | null }[]>([]);
  let bus = $state.raw<{ at: Pt; away: number | null } | null>(null);
  const waitKey = $derived(ride && !(rideIsNow && app.guideOn) ? `${ride.line}|${ride.board.id}|${ride.headsign}` : "");
  $effect(() => {
    const key = waitKey, r = untrack(() => ride);
    times = []; bus = null; app.guideApproach = null; app.guideBus = null;
    // A metro train: no stop board for it here; its time in the plan.
    if (key && r && isMetro(r.line)) { times = r.dep ? [{ at: r.dep, live: false, vehicle: null }] : []; return; }
    if (!key || !r?.board.id) return;
    let dead = false;
    const tick = async () => {
      const res = await fetchV2Stop(busId(r.board.id!));
      if (dead) return;
      const arr = (res.body as { arrivals?: V2Arrival[] } | null)?.arrivals ?? [];
      const rows = stopRows(arr, app.serverNow / 1000).filter(x => x.line.replace(/^oasa:/, "") === r.line);
      const same = rows.filter(x => fold(placeNote(toward(x.headsign)).place) === fold(r.headsign));
      const row = (same.length ? same : rows)[0];
      times = row ? row.times.map(t => ({ at: t.at, live: t.live, vehicle: t.vehicle })) : [];
      const vid = times[0]?.vehicle;
      if (!vid) { bus = null; app.guideApproach = null; app.guideBus = null; return; }
      const vr = await fetchV2LineVehicles(busId(r.line));
      const v = ((vr.body as { vehicles?: V2Vehicle[] } | null)?.vehicles ?? []).find(x => x.id === vid);
      if (dead) return;
      if (!v) { bus = null; app.guideApproach = null; app.guideBus = null; return; }
      const at: Pt = [v.position.lat, v.position.lon];
      // How many stops before the board stop it is: the stop of the ones before nearest to it.
      const before = r.before.map(s => s.at);
      let k = -1, best = Infinity;
      before.forEach((b, i) => { const d = metres(b, at); if (d < best) { best = d; k = i; } });
      const toBoard = metres(at, r.board.at);
      const away = toBoard < best ? 0 : k >= 0 && best < 400 ? before.length - k : null;
      bus = { at, away };
      app.guideBus = { at, line: r.line, vehicle: vid.slice(vid.indexOf(":") + 1) };
      app.guideApproach = await laneOf(r, at);
    };
    void tick();
    const t = setInterval(() => void tick(), 20_000);
    return () => { dead = true; clearInterval(t); app.guideBus = null; };
  });
  // Where the bus is now, in words (the stops before the one to board), for the walk's card.
  const busWhere = $derived.by(() => {
    if (!ride || !bus) return null;
    const b = ride.before, a = bus.away;
    if (a === 0) return "Είναι τώρα στη στάση σου";
    if (a == null || a > b.length) {
      const m = metres(bus.at, ride.board.at);
      return `${m < 1000 ? `${Math.round(m / 50) * 50} μ` : `${(m / 1000).toFixed(1).replace(".", ",")} χλμ`} μακριά · πάνω από ${b.length} ${b.length === 1 ? "στάση" : "στάσεις"}`;
    }
    return `Τώρα: ${b[b.length - a].name} · ${a} ${a === 1 ? "στάση" : "στάσεις"} μακριά`;
  });
  // «Δες το»: the map off the user, on the bus, the stop and the user together; again: back on the user.
  let peeking = $state(false);
  $effect(() => { void app.guideStep; peeking = false; });
  function peek() {
    endLook(false);
    if (peeking || !bus || !ride) { peeking = false; app.followMe(); return; }
    const pts: [number, number][] = [[bus.at[1], bus.at[0]], [ride.board.at[1], ride.board.at[0]], ...(pos ? [[pos[1], pos[0]] as [number, number]] : [])];
    peeking = true;
    app.peekAt(pts);
  }
  // «Η στάση σε 3D»: the camera at the stop to board, tilted, looking the way the bus comes from (its lane, else the
  // stop before, else where the bus is); again, or another step: back to the user, 3D as it was.
  let looking = $state(false), was3d = false;
  const bearingOf = (a: Pt, b: Pt) => {
    const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
    const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return ((Math.atan2(y, x) / r) + 360) % 360;
  };
  function comesFrom(r: GuideRide): Pt | null {
    const lane = app.guideApproach;
    if (lane && lane.length > 1) {
      // 50 m back along the lane from the stop: the street's own direction there (further back, a bend turned the
      // camera across the street).
      let d = 0;
      for (let i = lane.length - 1; i > 0; i--) {
        const seg = metres(lane[i], lane[i - 1]);
        if (d + seg >= 50) { const t = (50 - d) / seg; return [lane[i][0] + (lane[i - 1][0] - lane[i][0]) * t, lane[i][1] + (lane[i - 1][1] - lane[i][1]) * t]; }
        d += seg;
      }
      return lane[0];
    }
    return r.before.at(-1)?.at ?? bus?.at ?? null;
  }
  function lookStop() {
    if (looking) { endLook(); return; }
    const r = ride;
    if (!r) return;
    const from = comesFrom(r), at = r.board.at;
    const bearing = from ? bearingOf(at, from) : 0;
    // The point a little that way from the stop: the stop low in the picture, the street it comes along above it.
    const k = 18 / 111_320, rad = (bearing * Math.PI) / 180;
    const c: [number, number] = [at[1] + (Math.sin(rad) * k) / Math.cos((at[0] * Math.PI) / 180), at[0] + Math.cos(rad) * k];
    was3d = app.threeD;
    peeking = false;
    looking = true;
    // 3D first, then the camera: turning 3D on loads its models and tilts the map its own way when ready, which cut
    // a move begun before it short (it only turned 3D). The look waits for it.
    if (!app.threeD) { lookPending = { c, bearing }; app.setThreeD(true); }
    else app.lookFrom(c, bearing);
  }
  let lookPending = $state.raw<{ c: [number, number]; bearing: number } | null>(null);
  $effect(() => {
    const p = lookPending;
    if (!p || !app.threeD || app.load3d) return;
    const t = setTimeout(() => { if (looking) app.lookFrom(p.c, p.bearing); lookPending = null; }, 350);
    return () => clearTimeout(t);
  });
  function endLook(back = true) {
    if (!looking) return;
    looking = false;
    lookPending = null;
    if (!was3d) app.setThreeD(false);
    if (back) app.followMe();
  }
  $effect(() => { void app.guideStep; void app.guideOn; untrack(() => endLook()); });
  // The bus's way to the stop: its line's shape between the two, else the stops before.
  async function laneOf(r: GuideRide, at: Pt): Promise<Pt[]> {
    try {
      const st = await fetchLineStatic(r.line), shape = r.variant ? st.variants[r.variant]?.shape as Pt[] | undefined : undefined;
      if (shape?.length) {
        const near = (p: Pt) => shape.reduce((b, q, i) => (metres(q, p) < metres(shape[b], p) ? i : b), 0);
        const i = near(at), j = near(r.board.at);
        if (i < j && j - i < 2000) {
          // The shape's point nearest the stop can lie just past it: the lane ends at the stop, not beyond and back.
          const mid = shape.slice(i + 1, j + 1);
          const toStop = metres(at, r.board.at);
          while (mid.length && metres(at, mid[mid.length - 1]) > toStop) mid.pop();
          return [at, ...mid, r.board.at];
        }
      }
    } catch { /* the stops below */ }
    return [at, ...r.before.filter(s => metres(s.at, r.board.at) < metres(at, r.board.at)).map(s => s.at), r.board.at];
  }
  const busMin = $derived(times[0] ? Math.max(0, Math.round((times[0].at - nowS) / 60)) : null);
  const nextMin = $derived(times[1] ? Math.max(0, Math.round((times[1].at - nowS) / 60)) : null);
  // On foot to the stop: the minutes the walk takes, and whether the bus is caught.
  const walkMin = $derived(Math.ceil(walkLeftM / WALK_MPS / 60));
  // Not in time on foot: running (about 10 km/h) may still make it; if not, the next bus is the one to take.
  const RUN_MPS = 2.8;
  const runMin = $derived(Math.ceil(walkLeftM / RUN_MPS / 60));
  const plan = $derived<"easy" | "hurry" | "run" | "next" | null>(busMin == null ? null : busMin - walkMin >= 3 ? "easy" : busMin >= walkMin ? "hurry"
    : busMin >= runMin ? "run" : "next");
  let saidRun = "";
  $effect(() => {
    const pl = plan, key = `${app.guideStep}:${times[0]?.at}`;
    if (leg?.kind !== "walk" || (pl !== "run" && pl !== "next")) return;
    untrack(() => {
      if (saidRun === key + pl) return;
      saidRun = key + pl;
      if (pl === "run") say(`Τρέξε. Το ${ride?.line} φτάνει σε ${busMin} λεπτά: αν τρέξεις, το προλαβαίνεις.`, [120, 80, 120]);
      else say(nextMin != null ? `Αυτό δεν το προλαβαίνεις. Πάρε το επόμενο, σε ${nextMin} λεπτά.` : "Αυτό δεν το προλαβαίνεις.");
    });
  });

  // ---- A metro ride (mockup 48): its stations and their times from the train's run, so it is followed under the
  // street, where GPS is not, by the train's stops (the phone's motion) and the timetable (metroRide).
  const tried = new Set<string>();
  $effect(() => {
    const gg = g;
    if (!gg) return;
    untrack(() => gg.legs.forEach((l, k) => {
      const id = `${gg.key}:${k}`;
      if (l.kind !== "ride" || !isMetro(l.line) || !l.run || !l.lineId || tried.has(id)) return;
      tried.add(id);
      void Promise.all([fetchV2Run(l.run), fetchV2Line(l.lineId)]).then(([rr, lr]) => {
        const run = (rr.body as { run?: V2Run } | null)?.run, stops = (lr.body as LineDetail | null)?.stops;
        const seq = run && stops && !Array.isArray(stops) ? railSeq(run, stops, l.board.id, l.alight.id) : null;
        const cur = app.guide;
        if (!seq || seq.length < 2 || !cur || cur.key !== gg.key) return;
        const legs = cur.legs.slice();
        legs[k] = { ...(legs[k] as GuideRide), seq };
        app.guide = { ...cur, legs };
      }, () => {});
    }));
  });
  // A line's colours: the metro's own (its lines are not in the bus list), else the app's.
  const METRO_C: Record<string, string> = { M1: "#098b4a", M2: "#d7171f", M3: "#1b388c" };
  const colorOf = (line: string) => { const m = METRO_C[line.replace(/^Μ/, "M")]; return m ? { bg: m, fg: "#fff" } : app.lineColor(line); };
  const railCard = $derived(g && leg?.kind === "ride" && isMetro(leg.line) ? `guide:${g.key}:${app.guideStep}` : null);
  function railStart() {
    const l = leg, card = railCard;
    if (!g || l?.kind !== "ride" || !card) return;
    const n = l.seq.length, t0 = l.dep ?? nowS, t1 = l.arr ?? t0 + (n - 1) * 120;
    const stops = l.seq.map((x, i) => ({ stop: x.id ?? `${i}`, name: x.name, at: x.t ?? t0 + ((t1 - t0) * i) / Math.max(1, n - 1), lat: x.at[0], lon: x.at[1] }));
    void metroRide.start({ card, label: l.line, stops, now: () => app.serverNow / 1000, pos: () => app.myPos, notify: t => say(t, [200, 100, 200]) });
    metroRide.setOff(n - 1);
  }
  // The stations passed so far, kept once seen (the ride ends itself a minute after the last station).
  let railPassed = $state(0), railFor = "";
  $effect(() => {
    const c = railCard, r = c && metroRide.card === c ? metroRide.ride : null, t = nowS;
    untrack(() => {
      if ((c ?? "") !== railFor) { railFor = c ?? ""; railPassed = 0; }
      // At a station, or past its time (the moment at it can fall between two looks): passed.
      if (r) railPassed = Math.max(railPassed, r.at || t >= r.stops[r.i].at + r.offset + 20 ? r.i : Math.max(0, r.i - 1));
    });
  });
  // Off the train (another step, or the guide ended): its following ends.
  $effect(() => { const c = railCard; if (metroRide.card?.startsWith("guide:") && metroRide.card !== c) untrack(() => metroRide.end()); });

  // ---- On the bus: the stops passed, from the location; on a metro train, from the ride above.
  const passed = $derived(leg?.kind === "ride" && app.guideOn ? (railCard ? Math.min(leg.seq.length - 1, railPassed) : pos ? ridePassed(leg, pos) : 0) : 0);
  const left = $derived(leg?.kind === "ride" ? leg.seq.length - 1 - passed : 0);

  // ---- The panel: is the bus about to come; on the bus, the minutes left to the stop to get off.
  const near = $derived(!app.guideOn && ((bus?.away != null && bus.away <= 1) || (busMin != null && busMin <= 2)));
  const rideLeftMin = $derived(leg?.kind === "ride" ? Math.max(1, Math.round(lengthOf(leg.seq.slice(passed).map(s => s.at)) / mps(leg) / 60)) : 0);

  // ---- The change: the ride after the next one, its next buses at its stop (every 30 s), to say whether it is caught.
  const ride2 = $derived.by<{ r: GuideRide; k: number } | null>(() => {
    if (!g || !ride) return null;
    const k0 = g.legs.indexOf(ride);
    for (let k = k0 + 1; k < g.legs.length; k++) { const l = g.legs[k]; if (l.kind === "ride") return { r: l, k }; }
    return null;
  });
  let times2 = $state.raw<{ at: number; live: boolean }[]>([]);
  const key2 = $derived(ride2 ? `${ride2.r.line}|${ride2.r.board.id}|${ride2.r.headsign}` : "");
  $effect(() => {
    const key = key2, r = untrack(() => ride2?.r);
    times2 = [];
    if (key && r && isMetro(r.line)) { times2 = r.dep ? [{ at: r.dep, live: false }] : []; return; }
    if (!key || !r?.board.id) return;
    let dead = false;
    const tick = async () => {
      const res = await fetchV2Stop(busId(r.board.id!));
      if (dead) return;
      const rows = stopRows((res.body as { arrivals?: V2Arrival[] } | null)?.arrivals ?? [], app.serverNow / 1000).filter(x => x.line.replace(/^oasa:/, "") === r.line);
      const same = rows.filter(x => fold(placeNote(toward(x.headsign)).place) === fold(r.headsign));
      const row = (same.length ? same : rows)[0];
      times2 = row ? row.times.map(t => ({ at: t.at, live: t.live })) : [];
    };
    void tick();
    const t = setInterval(() => void tick(), 30_000);
    return () => { dead = true; clearInterval(t); };
  });

  // ---- The trip from now: when each leg starts (a ride: when its bus leaves), and when it ends.
  const timeline = $derived.by(() => {
    if (!g) return null;
    const starts: number[] = [];
    let t = nowS;
    for (let k = 0; k < g.legs.length; k++) {
      const l = g.legs[k];
      if (k < app.guideStep) { starts.push(NaN); continue; }
      if (l.kind === "walk") {
        starts.push(t);
        t += (k === app.guideStep ? walkLeftM : metres(l.from, l.to) * 1.25) / WALK_MPS;
      } else {
        const riding = k === app.guideStep && app.guideOn;
        // A timed plan's train: its own times (a metro ride is not timed from the map's distances).
        if (isMetro(l.line) && l.dep && l.arr) {
          starts.push(riding ? t : Math.max(t, l.dep));
          t = riding ? Math.max(t, l.arr) : Math.max(t, l.dep) + (l.arr - l.dep);
          continue;
        }
        if (!riding) {
          if (ride === l && times[0]) t = Math.max(t, plan === "next" && times[1] ? times[1].at : times[0].at);
          else if (ride2?.r === l && times2.length) t = (times2.find(x => x.at >= t - 30) ?? { at: t + 240 }).at;
          else t += 240;
        }
        starts.push(t);
        const pts = l.seq.map(s => s.at), from = riding ? passed : 0;
        t += lengthOf(pts.slice(from)) / mps(l);
      }
    }
    return { starts, end: t };
  });
  const arriveAt = $derived(timeline?.end ?? null);
  // The change, in a line: the bus after it, and the minutes to spare at its stop.
  const change = $derived.by(() => {
    if (!g || !ride2 || !timeline) return null;
    const k = ride2.k, prev = g.legs[k - 1];
    const reach = prev?.kind === "walk" ? timeline.starts[k - 1] + (metres(prev.from, prev.to) * 1.25) / WALK_MPS : timeline.starts[k];
    if (!Number.isFinite(reach)) return null;
    const t = times2.find(x => x.at >= reach - 30), spare = t ? Math.round((t.at - reach) / 60) : null;
    return { line: ride2.r.line, at: t?.at ?? null, spare, after: t ? times2.find(x => x.at > t.at + 30)?.at ?? null : null, walkM: prev?.kind === "walk" ? Math.round(metres(prev.from, prev.to) * 1.25 / 10) * 10 : 0 };
  });

  // ---- The ticket: what the trip needs (fares.ts), and from the first ride on, until when it holds.
  const fare = $derived.by(() => {
    if (!g) return null;
    const rides = g.legs.filter((l): l is GuideRide => l.kind === "ride");
    return fareOf(rides.map((r, i) => ({ label: r.line, mode: /^[MΜ]\d/.test(r.line) ? "metro" : "bus", from: r.board.name, to: r.alight.name, at: i * 1800 })));
  });
  let boardedAt = $state<number | null>(null);
  $effect(() => { void g?.key; boardedAt = null; });
  $effect(() => { if (app.guideOn && untrack(() => boardedAt) == null) boardedAt = untrack(() => nowS); });
  const ticket = $derived.by(() => {
    const f = fare;
    if (!f) return null;
    const red = app.fareReduced, main = f.lines[0], rest = f.lines.slice(1);
    if (boardedAt != null && main && /90/.test(main.name))
      return { v: `Ισχύει ως τις ${clockHM(boardedAt + 90 * 60)}`, s: rest.length ? rest.map(x => `${x.name}: ${euro(priceOf(x.price, red))}`).join(" · ") : "Δεν το ξανακυρώνεις στις αλλαγές" };
    return { v: f.lines.length > 1 ? `${euro(f.total[red ? 1 : 0])} συνολικά` : `${main.name} · ${euro(priceOf(main.price, red))}`,
      s: f.lines.length > 1 ? f.lines.map(x => `${x.name} ${euro(priceOf(x.price, red))}`).join(" + ") : main.note };
  });

  // ---- On foot: the turns ahead, from where the user is (the route's steps), for the card.
  const turns = $derived.by(() => {
    const l = leg, w = walk, r = route?.r;
    if (l?.kind !== "walk" || !w?.next || !r) return [];
    const at = w.next.s - w.toNext, out: { icon: string; t: string; d: number }[] = [];
    for (const st of r.steps) {
      if (st.s < at - 1) continue;
      out.push({ icon: stepArrow(st), t: stepText(st, l.toName), d: st.s - at });
      if (out.length === 3) break;
    }
    return out;
  });

  // ---- All the steps (mockup 48 Δ): done ones struck through, the one now marked, the rest with the time each starts;
  // a change between two rides as a row of its own. A tap moves there (the location may be wrong, or not there).
  type StepRow = { key: string; k: number; kind: "walk" | "ride" | "change"; line?: string; t: string; s: string; at: string; done: boolean; now: boolean };
  const allSteps = $derived.by(() => {
    if (!g) return [] as StepRow[];
    const out: StepRow[] = [];
    g.legs.forEach((l, k) => {
      const st = l.kind === "ride" ? g.changes?.[rideOrd(k)] : null;
      if (st) {
        const lk = transferLook(levelM(st.prev.mode, st.prev.label, st.where, st.prev.line, st.stop), levelM(st.mode, st.label, st.to, st.line, st.next || st.stop));
        const xk = g.legs[k - 1]?.kind === "walk" ? k - 1 : k;
        const now = !arrived && xchg?.k === k;
        out.push({ key: `x${k}`, k: xk, kind: "change", t: `Αλλαγή · ${titleCase(placeNote(st.stop).place)}`, s: now ? "Τώρα" : changeLine(lk, st.label, st.mode, st.min, st.m),
          at: "", done: arrived || (app.guideStep >= k && !now), now });
      }
      if (st && g.legs[k - 1]?.kind === "walk" && out.length >= 2 && out[out.length - 2].kind === "walk" && out[out.length - 2].k === k - 1) out.splice(out.length - 2, 1);
      const done = arrived || k < app.guideStep;
      // Changing, the change's row is the one now (also while still on the train at its station).
      const now = !arrived && k === app.guideStep && !(xchg && (xchg.k === k || xchg.k === k + 1 || xchg.phase === "off"));
      const at = timeline && Number.isFinite(timeline.starts[k]) ? clockHM(timeline.starts[k]) : "";
      out.push(l.kind === "ride"
        ? { key: `l${k}`, k, kind: "ride", line: l.line, t: `${l.line} προς ${l.headsign}`, s: `${l.seq.length - 1} ${isMetro(l.line) ? "σταθμοί" : "στάσεις"} ως ${l.alight.name}`, at, done, now }
        : { key: `l${k}`, k, kind: "walk", t: l.final ? "Περπάτα ως τον προορισμό" : `Περπάτα ως ${toThe(l.toName)}`, s: `${Math.round(metres(l.from, l.to) * 1.25 / 10) * 10} μ`, at, done, now });
    });
    out.push({ key: "end", k: g.legs.length - 1, kind: "walk", t: "Έφτασες", s: g.dest, at: arriveAt ? clockHM(arriveAt) : "", done: arrived, now: arrived });
    return out;
  });

  // ---- «Μοίρασε άφιξη»: the arrival, to send.
  let shared = $state(false);
  async function share() {
    if (!g || arriveAt == null) return;
    const text = `Φτάνω ${g.dest} στις ${clockHM(arriveAt)}.`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); shared = true; setTimeout(() => (shared = false), 1800); }
    } catch { /* closed */ }
  }

  // ---- The bar: a part per leg, sized by its minutes, filled as far as it has gone, a mark where the user is.
  const bar = $derived.by(() => {
    if (!g) return { parts: [], at: null as number | null };
    const parts = g.legs.map((x, k) => {
      const past = arrived || k < app.guideStep, cur = !arrived && k === app.guideStep;
      let fill = past ? 1 : 0;
      if (cur && x.kind === "walk") {
        const total = route?.step === k ? route.r.length : metres(x.from, x.to) * 1.25;
        fill = Math.max(0, Math.min(1, 1 - walkLeftM / Math.max(total, 1)));
      } else if (cur && x.kind === "ride" && app.guideOn) fill = passed / Math.max(1, x.seq.length - 1);
      const min = legMin(x);
      return { flex: Math.max(min, 2), fill, cur, past, walk: x.kind === "walk", label: x.kind === "walk" ? (min >= 4 ? `${min}′` : "") : `${x.line} · ${min}′`,
        color: x.kind === "ride" ? colorOf(x.line) : null };
    });
    const total = parts.reduce((t, x) => t + x.flex, 0), k = parts.findIndex(x => x.cur);
    const at = k < 0 || !total ? null : ((parts.slice(0, k).reduce((t, x) => t + x.flex, 0) + parts[k].flex * parts[k].fill) / total) * 100;
    return { parts, at: at == null ? null : Math.max(1.5, Math.min(98.5, at)) };
  });

  // ---- Moving on by itself, and what is said.
  function next() {
    if (!g) return;
    if (app.guideStep >= g.legs.length - 1) { arrived = true; say(`Έφτασες. ${g.dest}.`, [200, 100, 200]); return; }
    app.guideStep++;
    app.guideOn = false;
  }
  function boarded() {
    app.guideOn = true;
    if (railCard) railStart();
    if (leg?.kind === "ride") say(`Κατεβαίνεις σε ${leg.seq.length - 1} ${railCard ? "σταθμούς, στον σταθμό" : "στάσεις, στη στάση"} ${leg.alight.name}.`);
  }
  $effect(() => {
    const l = leg, p = pos;
    if (!l || !p || arrived) return;
    untrack(() => {
      if (l.kind === "walk") {
        if (metres(p, l.to) < 25 || (walk && walk.left < 15)) next();
      } else if (railCard) {
        // A metro train: no GPS underground; the timetable and the train's stops lead (the effect below).
      } else if (!app.guideOn) {
        // On the bus once the user has left the stop along the route: over 120 m away and close to the line.
        const a = along(l.seq.map(s => s.at), p);
        if (metres(p, l.board.at) > 120 && a.off < 40 && a.s > 100) boarded();
      } else if (metres(p, l.alight.at) < 35 || ridePassed(l, p) >= l.seq.length - 1) next();
    });
  });
  // A metro train: on it half a minute after it leaves (no tap: the clock follows it, the motion sensors need one);
  // at the last station «Κατέβα τώρα», and on after a minute and a half there (or «Βγήκα από το τρένο»).
  $effect(() => {
    const l = leg, t = nowS;
    if (!railCard || l?.kind !== "ride" || arrived) return;
    untrack(() => { if (!app.guideOn && l.dep && t > l.dep + 30) boarded(); });
  });
  let offSince: number | null = null;
  $effect(() => {
    const t = nowS, on = !!railCard && app.guideOn && left <= 0;
    untrack(() => {
      if (!on) { offSince = null; return; }
      offSince ??= t;
      if (t - offSince > 90) { offSince = null; next(); }
    });
  });
  // What each leg says when it starts.
  $effect(() => {
    const l = leg, step = app.guideStep;
    if (!l || !g) return;
    untrack(() => {
      if (l.kind === "walk") say(l.final ? `Περπάτα ως τον προορισμό, ${distSaid(metres(l.from, l.to))}.` : `Περπάτα ως ${toThe(l.toName)}.`);
      else say(isMetro(l.line) ? `Πάρε το ${l.line} προς ${l.headsign}, στον σταθμό ${l.board.name}.` : `Περίμενε το ${l.line} προς ${l.headsign}, στη στάση ${l.board.name}.`, step ? [150] : undefined);
    });
  });
  // The turns: said when a new one is next, and again 30 m before it.
  let saidStep = "", saidNear = "";
  $effect(() => {
    const w = walk, l = leg;
    if (!w?.next || l?.kind !== "walk") return;
    const id = `${app.guideStep}:${w.next.s}`, text = stepText(w.next, l.toName);
    untrack(() => {
      if (saidStep !== id && w.toNext > 40) { saidStep = id; say(`Σε ${distSaid(w.toNext)}, ${text.charAt(0).toLocaleLowerCase("el")}${text.slice(1)}.`); }
      else if (saidNear !== id && w.toNext <= 30) { saidNear = saidStep = id; say(`${text}.`, [80]); }
    });
  });
  // The bus one stop away, while waiting; «Πάτα STOP» one stop before getting off.
  let saidBus = "", saidStop = "";
  $effect(() => {
    const l = leg;
    if (l?.kind !== "ride" || app.guideOn || !bus || bus.away == null || bus.away > 1) return;
    const id = `${app.guideStep}:${times[0]?.vehicle}`;
    untrack(() => { if (saidBus !== id) { saidBus = id; say(`Το ${l.line} είναι ${bus!.away === 0 ? "στη στάση" : "μία στάση πριν"}.`, [200, 100, 200]); } });
  });
  $effect(() => {
    const l = leg;
    if (l?.kind !== "ride" || !app.guideOn || left !== 1 || railCard) return;   // a train: metroRide says it
    const id = `${app.guideStep}`;
    untrack(() => { if (saidStop !== id) { saidStop = id; say(`Πάτα STOP. Κατεβαίνεις στην επόμενη, ${l.alight.name}.`, [300, 120, 300, 120, 300]); } });
  });

  // ---- The trip on the map: the walks in the accent colour (the current one along its route), the rides in their
  // line's colour along the line's shape; A at the start, B at the end, a pin where to get on and off.
  let shapes = $state.raw<Record<string, Pt[]>>({});
  $effect(() => {
    const gg = g;
    if (!gg) return;
    for (const l of gg.legs) {
      if (l.kind !== "ride" || !l.variant) continue;
      const r = l, k = `${r.line}|${r.variant}|${r.board.id}|${r.alight.id}`;
      void fetchLineStatic(r.line).then(st => {
        const shape = st.variants[r.variant!]?.shape as Pt[] | undefined;
        if (!shape?.length) return;
        const near = (p: Pt) => shape.reduce((b, q, i) => (metres(q, p) < metres(shape[b], p) ? i : b), 0);
        const i = near(r.board.at), j = near(r.alight.at);
        if (j > i) shapes = { ...shapes, [k]: [r.board.at, ...shape.slice(i + 1, j), r.alight.at] };
      }, () => {});
    }
  });
  $effect(() => {
    const gg = g;
    if (!gg) return;
    const cur = app.guideStep, wl = app.guideWalk;
    const features = gg.legs.map((l, k) => {
      const pts: Pt[] = l.kind === "walk" ? (k === cur && wl ? wl : [l.from, l.to])
        : shapes[`${l.line}|${l.variant}|${l.board.id}|${l.alight.id}`] ?? (l.shape && l.shape.length > 1 ? l.shape : l.seq.map(s => s.at));
      return { type: "Feature" as const, properties: { kind: l.kind, color: l.kind === "walk" ? "#5b9dff" : colorOf(l.line).bg },
        geometry: { type: "LineString" as const, coordinates: pts.map(p => [p[1], p[0]]) } };
    });
    app.tripPlan = { type: "FeatureCollection", features };
    app.tripStops = gg.legs.flatMap(l => (l.kind === "ride" ? [{ at: l.board.at, name: l.board.name }, { at: l.alight.at, name: l.alight.name }] : []));
    const first = gg.legs[0], last = gg.legs[gg.legs.length - 1];
    app.tripEnds = { from: first.kind === "walk" ? first.from : first.board.at, to: last.kind === "walk" ? last.to : last.alight.at };
  });

  function end() {
    endLook(false);
    speechSynthesis?.cancel();
    if (metroRide.card?.startsWith("guide:")) metroRide.end();
    app.endGuide();
    app.tripPlan = null;
    app.tripStops = [];
    app.tripEnds = null;
    app.setTab("now");
  }

  // ---- A change (mockup 48 B, Γ): the station from the side with the rider on it, the step being done, and the time
  // to the next ride. «off»: still on the train at the change's station; «walk»: on the way; «wait»: at its platform.
  const rideOrd = (k: number) => (g ? g.legs.slice(0, k + 1).filter(l => l.kind === "ride").length - 1 : -1);
  const nextRideK = $derived(g ? g.legs.findIndex((l, k) => k > app.guideStep && l.kind === "ride") : -1);
  const xchg = $derived.by<{ st: ChangeStep; phase: "off" | "walk" | "wait"; k: number } | null>(() => {
    const l = leg, k = app.guideStep, ch = g?.changes;
    if (!g || !ch || !l || arrived) return null;
    const at = (kk: number, phase: "off" | "walk" | "wait") => { const st = ch[rideOrd(kk)]; return st ? { st, phase, k: kk } : null; };
    const prev = g.legs[k - 1], prev2 = g.legs[k - 2];
    if (l.kind === "ride" && app.guideOn && railCard && left <= 0 && nextRideK > 0) return at(nextRideK, "off");
    if (l.kind === "walk" && !l.final && prev?.kind === "ride" && nextRideK > 0) return at(nextRideK, "walk");
    if (l.kind === "ride" && !app.guideOn && (prev?.kind === "ride" || (prev?.kind === "walk" && prev2?.kind === "ride"))) return at(k, "wait");
    return null;
  });
  // How far along the walk: the GPS on the street, else the minutes it takes since it began; «Είμαι …»: there.
  let xFrom = $state(0), xKey = "", xDone = $state(false);
  $effect(() => {
    const x = xchg, key = x ? `${g?.key}:${x.k}:${x.phase === "off" ? "off" : "on"}` : "";
    untrack(() => { if (key !== xKey) { xKey = key; xFrom = nowS; if (x?.phase !== "wait") xDone = false; } });
  });
  // Off a train with no walk step after it (the two platforms in one station): «on the way» until the minutes the
  // change takes have gone, or «Είμαι στην αποβάθρα».
  const xPhase = $derived(!xchg ? null : xchg.phase === "wait" && !xDone && g?.legs[app.guideStep - 1]?.kind === "ride"
    && nowS - xFrom < Math.max(60, xchg.st.min * 60) ? "walk" as const : xchg.phase);
  const xF = $derived.by(() => {
    const x = xchg;
    if (!x) return 0;
    if (xPhase === "off") return 0;
    if (xPhase === "wait" || xDone) return 1;
    const l = leg, fresh = !!app.myFix && Date.now() - app.myFix.t < 20_000;
    if (l?.kind === "walk" && fresh && route?.step === app.guideStep) return Math.max(0, Math.min(0.95, 1 - walkLeftM / Math.max(1, route.r.length)));
    return Math.max(0, Math.min(0.95, (nowS - xFrom) / Math.max(60, x.st.min * 60)));
  });
  const xLook = $derived(xchg ? transferLook(levelM(xchg.st.prev.mode, xchg.st.prev.label, xchg.st.where, xchg.st.prev.line, xchg.st.stop),
    levelM(xchg.st.mode, xchg.st.label, xchg.st.to, xchg.st.line, xchg.st.next || xchg.st.stop)) : null);
  const xCount = $derived.by(() => {
    const x = xchg;
    if (!x || !g) return null;
    const r = g.legs[x.k] as GuideRide;
    const at = (x.phase === "wait" ? times[0]?.at : ride2?.k === x.k ? change?.at : null) ?? r.dep ?? null;
    if (at == null) return null;
    const mins = Math.max(0, Math.round((at - nowS) / 60)), walkLeft = xPhase === "wait" ? 0 : Math.ceil(x.st.min * (1 - xF));
    const ok = mins >= walkLeft + 1;
    return { big: mins === 0 ? "τώρα" : `${mins}′`, small: `Το ${r.line} φεύγει ${clockHM(at)}${ok && xPhase !== "wait" ? ": προλαβαίνεις" : ""}`, tone: (ok ? "ok" : "tight") as "ok" | "tight" };
  });
  function atPlatform() {
    xDone = true;
    if (leg?.kind === "walk") next();
  }

  // ---- The steps, for the list and the bar.
  const legMin = (l: GuideWalk | GuideRide) => Math.max(1, Math.round(l.kind === "walk" ? metres(l.from, l.to) * 1.25 / WALK_MPS / 60 : lengthOf(l.seq.map(s => s.at)) / mps(l) / 60));
  const legText = (l: GuideWalk | GuideRide) => (l.kind === "walk" ? (l.final ? `Περπάτα ως τον προορισμό` : `Περπάτα ως ${toThe(l.toName)}`)
    : `${l.line} από ${l.board.name} ως ${l.alight.name} · ${l.seq.length - 1} στάσεις`);
  let list = $state(false);
  // Minimised to one bar at the foot (kept on the device).
  let mini = $state(load("guideMini", false));
  function setMini(v: boolean) { mini = v; keep("guideMini", v); }
  // The bar's two lines: what to do now, and the one thing to know with it.
  const miniText = $derived.by(() => {
    const l = leg;
    if (arrived || !l || !g) return { main: "Έφτασες", sub: g?.dest ?? "" };
    if (l.kind === "walk") {
      const main = walk?.next ? `${distSaid(walk.toNext)} · ${stepText(walk.next, l.toName)}` : l.final ? `Ως τον προορισμό · ${distSaid(walkLeftM)}` : `Ως ${toThe(l.toName)} · ${distSaid(walkLeftM)}`;
      const sub = !ride || l.final ? g.dest : plan === "run" ? `Τρέξε για το ${ride.line}: φτάνει σε ${busMin}′`
        : plan === "next" ? (nextMin != null ? `Πάρε το επόμενο ${ride.line}, σε ${nextMin}′` : `Δεν προλαβαίνεις το ${ride.line}`)
        : busMin != null ? `Το ${ride.line} σε ${busMin}′ · προλαβαίνεις` : `Το ${ride.line}`;
      return { main, sub };
    }
    if (!app.guideOn) return { main: busMin == null ? `Περίμενε το ${l.line}` : busMin === 0 ? `Το ${l.line} φτάνει τώρα` : `Το ${l.line} σε ${busMin}′`, sub: `στάση ${l.board.name}` };
    return { main: left === 1 ? "Πάτα STOP τώρα" : left <= 0 ? "Κατέβα εδώ" : `Κατέβα σε ${left} στάσεις`, sub: `στη στάση ${l.alight.name}` };
  });
  // ---- The map in view while walking or waiting: the stop with the user, and the bus too once it is close (5 stops or
  // 6′); on the bus, the user alone. «Δες το λεωφορείο» looks at the bus, the stop and the user together.
  $effect(() => {
    const l = leg, r = ride, b = bus;
    if (!g || !l || peeking) { app.guideFrame = null; return; }
    const ll = (p: Pt): [number, number] => [p[1], p[0]];
    if (l.kind === "ride" && app.guideOn) { app.guideFrame = null; return; }
    const pts: [number, number][] = [ll(l.kind === "walk" ? l.to : l.board.at)];
    const close = !!b && ((b.away != null && b.away <= 5) || (busMin != null && busMin <= 6));
    if (r && b && close && (l.kind === "ride" || (!l.final && g.legs[app.guideStep + 1] === r))) pts.push(ll(b.at));
    app.guideFrame = pts;
  });
  $effect(() => () => { app.guideFrame = null; });
  // «Γύρνα το κινητό»: the map turns with the phone (its compass), up is where the user faces. iOS asks first.
  async function headingUp() {
    if (app.headingUp) { app.headingUp = false; app.compass = null; return; }
    const D = (globalThis as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    try { if (D?.requestPermission && (await D.requestPermission()) !== "granted") { app.notify("Χωρίς πρόσβαση στην πυξίδα το κινητό δεν μπορεί να γυρίσει τον χάρτη."); return; } } catch { /* no compass */ }
    app.headingUp = true;
    app.followMe();
  }
  $effect(() => {
    if (!app.headingUp) return;
    let last = 0, seen = false;
    const on = (e: DeviceOrientationEvent) => {
      const w = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      const h = w != null ? w : e.absolute && e.alpha != null ? 360 - e.alpha : null;
      if (h == null) return;
      seen = true;
      const turn = (screen.orientation?.angle ?? 0);
      const deg = (h + turn + 360) % 360, t = performance.now();
      if (t - last < 120) return;
      last = t;
      app.compass = deg;
    };
    const abs = "ondeviceorientationabsolute" in window;
    const ev = (abs ? "deviceorientationabsolute" : "deviceorientation") as "deviceorientation";
    addEventListener(ev, on);
    const t = setTimeout(() => { if (!seen) { app.notify("Αυτή η συσκευή δεν δίνει πυξίδα στη σελίδα."); app.headingUp = false; } }, 4000);
    return () => { removeEventListener(ev, on); clearTimeout(t); app.compass = null; };
  });

  // ---- The sheet by its handle (a phone): half, all of it, or down to the bar.
  let nsnap = $state<"half" | "full">("half");
  let sheetEl = $state<HTMLElement>();
  let dragH = $state<number | null>(null);
  let freeH = $state<number | null>(null);   // let go after a drag: it stays that tall
  let sheetH = $state(0);
  let h0 = 0;
  const clampH = (h: number) => Math.max(80, Math.min(innerHeight * 0.9, h));
  const navDrag = $derived<SheetDrag>({
    ignore: "button",
    start: () => { h0 = sheetEl?.getBoundingClientRect().height ?? 0; },
    move: dy => { dragH = clampH(h0 - dy); },
    end: dy => {
      const h = clampH(h0 - dy);
      dragH = null;
      if (h > 140) {
        // It stays as tall as it was let go, however fast (the map above it, as much as the rider wants); only
        // dragged right down it folds to its bar.
        freeH = h;
        nsnap = h > innerHeight * 0.6 ? "full" : "half";
        return;
      }
      freeH = null;
      setMini(true);
    },
    tap: () => { freeH = null; nsnap = nsnap === "half" ? "full" : "half"; },
  });
  const miniDrag: SheetDrag = { ignore: "button", start: () => {}, move: () => {}, end: (dy, v) => { if (dy < -30 || v < -0.4) setMini(false); }, tap: () => setMini(false) };

  // The map keeps the user clear of the panel: again when it changes (a step, minimised or not).
  $effect(() => {
    void mini; void nsnap; void app.guideStep; void app.guideOn; void app.stack.length;
    if (g) void tick().then(() => app.followMe());
  });

  // The arrows of the turns.
  const ARROW: Record<string, string> = {
    left: "M17 20V11a3 3 0 0 0-3-3H5M9 4L5 8l4 4", right: "M7 20V11a3 3 0 0 1 3-3h9M15 4l4 4-4 4", "slight-left": "M15 20v-7L7 5M7 11V5h6",
    "slight-right": "M9 20v-7l8-8M17 11V5h-6", straight: "M12 20V4M7 9l5-5 5 5", uturn: "M8 20V9a4 4 0 0 1 8 0v3M12 8l4 4 4-4", arrive: "M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10z",
  };
  // ---- What the screen says (mockups 30, 31): the banner (what to do now, and what comes after it) and the card
  // (the leg now: its minutes, the margin, a line on it, its rows), and the two things good to know.
  type Tone = "go" | "hurry" | "late" | "wait" | "ride" | "stop" | "change" | "done";
  const nLegs = $derived(g?.legs.length ?? 0);
  const ban = $derived.by(() => {
    const l = leg;
    if (arrived || !l || !g) return { tone: "done" as Tone, arrow: "", icon: "check" as const, big: "Έφτασες", small: g?.dest ?? "", thenL: "", then: "" };
    if ((l.kind === "walk" || xPhase === "walk") && xchg && xLook?.under) {
      const st = xchg.st, way = xLook.way, to = st.label, place = (n: string) => titleCase(placeNote(n).place);
      const big = xLook.to === 0 ? "Βγες στον δρόμο" : way === "down" ? `Κατέβα στο ${to}` : way === "up" ? `Ανέβα στο ${to}` : `Πήγαινε στο ${to}`;
      const small = xLook.to === 0 ? `Στάση ${place(st.next || st.stop)} · το ${st.label}` : st.headsign ? `Αποβάθρα προς ${place(toward(st.headsign))}` : place(st.stop);
      return { tone: "change" as Tone, arrow: "", icon: (way === "up" ? "chevron-up" : "down") as "down", big, small, thenL: "", then: "" };
    }
    if (l.kind === "walk") {
      const tone: Tone = plan === "run" ? "hurry" : plan === "next" ? "late" : ride2 && g.legs[app.guideStep - 1]?.kind === "ride" && !l.final ? "change" : "go";
      const then = walk?.then ? stepText(walk.then, l.toName) : l.final ? g.dest : l.toName;
      if (walk?.next) return { tone, arrow: ARROW[stepArrow(walk.next)], icon: "walk" as const, big: distSaid(walk.toNext), small: stepText(walk.next, l.toName), thenL: "ΜΕΤΑ", then };
      return { tone, arrow: "", icon: "walk" as const, big: distSaid(walkLeftM), small: l.final ? `Ως τον προορισμό: ${g.dest}` : `Ως ${toThe(l.toName)}`, thenL: "ΜΕΤΑ", then: l.final ? "" : l.toName.startsWith("σταθμό") ? "κατέβα στο μετρό, στην αποβάθρα" : "η στάση" };
    }
    if (!app.guideOn) {
      const big = busMin == null ? `Περίμενε το ${l.line}` : busMin === 0 ? `Το ${l.line} φτάνει τώρα` : `Το ${l.line} σε ${busMin}′`;
      const where = bus?.away === 0 ? "στη στάση" : bus?.away === 1 ? "1 στάση πριν" : bus?.away != null ? `${bus.away} στάσεις πριν` : `${railCard ? "σταθμός" : "στάση"} ${l.board.name}`;
      return { tone: (near ? "hurry" : "wait") as Tone, arrow: "", icon: "clock" as const, big, small: `προς ${l.headsign} · ${where}`, thenL: "ΚΑΤΕΒΑΙΝΕΙΣ", then: l.alight.name };
    }
    const xNext = xchg?.phase === "off" ? ` · μετά, ${lineWordOf(xchg.st)}` : "";
    if (left === 1 && railCard) return { tone: "stop" as Tone, arrow: "", icon: "metro" as const, big: "Κατεβαίνεις στην επόμενη", small: `${l.alight.name}`, thenL: "", then: "" };
    if (left === 1) return { tone: "stop" as Tone, arrow: "", icon: "bus" as const, big: "Πάτα STOP τώρα", small: `Κατεβαίνεις στην επόμενη, ${l.alight.name}`, thenL: "", then: "" };
    if (left <= 0) return { tone: "stop" as Tone, arrow: "", icon: "down" as const, big: railCard ? "Κατέβα τώρα" : "Κατέβα εδώ", small: `${l.alight.name}${xNext}`, thenL: "", then: "" };
    return { tone: "ride" as Tone, arrow: "", icon: (railCard ? "metro" : "bus") as "bus", big: railCard ? `Κατέβα σε ${left} ${left === 1 ? "σταθμό" : "σταθμούς"}` : `Κατέβα σε ${left} στάσεις`, small: `${l.alight.name} · σε ${rideLeftMin}′, ${clockHM(nowS + rideLeftMin * 60)}`,
      thenL: "ΕΠΟΜΕΝΗ", then: l.seq[passed + 1]?.name ?? "" };
  });
  const lineWordOf = (st: ChangeStep) => (st.mode === "metro" ? `${st.label}` : `το ${st.label}`);
  type NowRow = { icon: string; arrow?: string; strong?: boolean; t: string; s: string; v: string; tone?: "ok" | "warn" | "bad" };
  const now = $derived.by(() => {
    const l = leg;
    if (!l || !g || arrived) return null;
    const step = `${app.guideStep + 1} ΑΠΟ ${nLegs}`;
    if (l.kind === "walk") {
      const rows: NowRow[] = turns.map((t, i) => ({ icon: "", arrow: ARROW[t.icon], t: t.t, s: i === 0 ? "Η επόμενη στροφή" : "", v: t.d > 5 ? distSaid(t.d) : "" }));
      if (!ride || l.final)
        return { tone: "go" as Tone, tag: `ΠΕΡΠΑΤΗΜΑ · ${step}`, chip: "", title: l.final ? `Ως τον προορισμό` : `Ως ${toThe(l.toName)}`, big: `${walkMin}′`, bar: null as number | null, note: l.final ? g.dest : distSaid(walkLeftM), rows };
      const spare = busMin != null ? busMin - walkMin : null;
      const note = busMin == null ? `Ψάχνω το ${ride.line}…`
        : plan === "easy" ? `Το ${ride.line} φτάνει σε ${busMin}′: έχεις ${spare}′ περιθώριο. Περπάτα κανονικά.`
        : plan === "hurry" ? `Το ${ride.line} φτάνει σε ${busMin}′: προλαβαίνεις, βιάσου λίγο.`
        : plan === "run" ? `Τρέξε: με τα πόδια ${walkMin}′, τρέχοντας ${runMin}′. Το ${ride.line} φτάνει σε ${busMin}′.`
        : nextMin != null ? `Το ${ride.line} σε ${busMin}′ δεν το προλαβαίνεις. Πάρε το επόμενο, σε ${nextMin}′.` : `Το ${ride.line} σε ${busMin}′ δεν το προλαβαίνεις.`;
      return { tone: (plan === "run" ? "hurry" : plan === "next" ? "late" : "go") as Tone, tag: `ΠΕΡΠΑΤΗΜΑ · ${step} · ${distSaid(walkLeftM)}`,
        chip: times[0] ? (times[0].live ? "Ζωντανά" : "Πρόγραμμα") : "", title: `Ως ${toThe(l.toName)}`, big: `${walkMin}′`,
        bar: busMin != null && busMin > 0 ? Math.min(1, walkMin / busMin) : null, note, rows };
    }
    if (!app.guideOn) {
      const rows: NowRow[] = [];
      if (busWhere) rows.push({ icon: "bus", strong: true, t: busWhere, s: times[0] ? `${clockHM(times[0].at)} · ${times[0].live ? "ζωντανά" : "από το πρόγραμμα"}` : "", v: "" });
      else if (railCard) rows.push({ icon: "clock", t: times[0] ? `Φεύγει ${clockHM(times[0].at)}` : "Από το πρόγραμμα", s: "Από το πρόγραμμα: το μετρό δεν δίνει ζωντανές θέσεις", v: "" });
      else rows.push({ icon: "bus", t: times[0] ? "Η θέση του δεν φαίνεται ακόμα" : "Ψάχνω το λεωφορείο…", s: times[0] ? `${clockHM(times[0].at)} · από το πρόγραμμα` : "", v: "" });
      if (nextMin != null) rows.push({ icon: "clock", t: `Μετά από αυτό: σε ${nextMin}′`, s: times[1] ? clockHM(times[1].at) : "", v: "" });
      const approach = bus?.away != null ? Math.max(0.08, Math.min(1, 1 - bus.away / (l.before.length + 1))) : busMin != null ? Math.max(0.08, 1 - busMin / 20) : null;
      return { tone: (near ? "hurry" : "wait") as Tone, tag: `ΑΝΑΜΟΝΗ · ${railCard ? "ΣΤΑΘΜΟΣ" : "ΣΤΑΣΗ"} ${l.board.name.toLocaleUpperCase("el")}`, chip: times[0] ? (times[0].live ? "Ζωντανά" : "Πρόγραμμα") : "",
        title: near ? `Ετοιμάσου: το ${l.line} έρχεται` : busMin == null ? `Περίμενε το ${l.line}` : `Το ${l.line} προς ${l.headsign}`,
        big: busMin == null ? "…" : busMin === 0 ? "τώρα" : `${busMin}′`, bar: approach, note: "", rows };
    }
    const rows: NowRow[] = [];
    const after = l.seq.slice(passed + 1);
    const minTo = (j: number) => Math.max(1, Math.round(lengthOf(l.seq.slice(passed, passed + 1 + j + 1).map(s => s.at)) / mps(l) / 60));
    after.slice(0, Math.min(2, after.length - 1)).forEach((s, j) => rows.push({ icon: "stop", t: s.name, s: j === 0 ? "Επόμενη" : "", v: `${minTo(j)}′` }));
    if (after.length) rows.push({ icon: "pin", strong: true, t: l.alight.name, s: "Εδώ κατεβαίνεις", v: `${rideLeftMin}′` });
    return { tone: (left === 1 ? "stop" : "ride") as Tone, tag: `ΣΤΟ ${l.line} · ${passed} ΑΠΟ ${l.seq.length - 1} ΣΤΑΣΕΙΣ`, chip: "",
      title: left <= 0 ? "Κατέβα εδώ" : `Κατεβαίνεις στην ${l.alight.name}`, big: `${rideLeftMin}′`, bar: passed / Math.max(1, l.seq.length - 1),
      note: left === 1 ? "Πάτα STOP: κατεβαίνεις στην επόμενη." : "Φωνή και δόνηση μία στάση πριν, για να πατήσεις STOP.", rows };
  });
  type Tip = { k: string; icon: "ticket" | "swap" | "clock"; tone: "amber" | "green" | "blue" | "red"; v: string; s: string };
  const tips = $derived.by(() => {
    const out: Tip[] = [];
    const l = leg;
    if (!l || arrived) return out;
    if (change && ride2 && (l.kind === "ride" || (l.kind === "walk" && !l.final && app.guideStep > 0))) {
      const sp = change.spare;
      out.push(change.at == null ? { k: "ΑΛΛΑΓΗ", icon: "swap", tone: "blue", v: `Στο ${change.line}`, s: "Ψάχνω τα δρομολόγιά του…" }
        : { k: "ΑΛΛΑΓΗ", icon: "swap", tone: sp != null && sp >= 4 ? "green" : sp != null && sp >= 1 ? "amber" : "red",
          v: `${change.line} στις ${clockHM(change.at)} · ${sp != null && sp > 0 ? `${sp}′ περιθώριο` : "πολύ σφιχτά"}`,
          s: sp != null && sp >= 4 ? "Η αλλαγή είναι σίγουρη" : sp != null && sp >= 1 ? "Λίγο σφιχτά: μην καθυστερήσεις"
            : change.after ? `Αν χαθεί, το επόμενο στις ${clockHM(change.after)}` : "Ίσως χρειαστεί το επόμενο" });
    }
    if (ticket) out.push({ k: "ΕΙΣΙΤΗΡΙΟ", icon: "ticket", tone: "amber", v: ticket.v, s: ticket.s });
    if (ride && !app.guideOn && times[1] && times[0]) {
      const plus = Math.round((times[1].at - times[0].at) / 60);
      out.push({ k: "ΑΝ ΤΟ ΧΑΣΕΙΣ", icon: "clock", tone: "blue", v: `Επόμενο ${ride.line} στις ${clockHM(times[1].at)}`, s: `Φτάνεις ${plus}′ αργότερα` });
    }
    return out.slice(0, 2);
  });
</script>

{#if g}
  {@const l = leg}
  <div class="guide" class:carded={app.stack.length > 0} role="region" aria-label="Πλοήγηση">
    {#if mini}
      <!-- Minimised: one bar at the foot, what to do now, the trip's progress, the arrival. -->
      <div class="minibar" class:alert={ban.tone === "stop"} role="status" aria-live="polite" use:sheetDrag={miniDrag} in:rise={{ y: 12 }}>
        <span class="mi">{#if arrived}<Icon name="check" size={18} />{:else if l?.kind === "ride"}<b class="chip sm" style:--lb={colorOf(l.line).bg} style:--lf={colorOf(l.line).fg}>{l.line}</b>{:else}<Icon name="walk" size={18} />{/if}</span>
        <span class="mt"><b>{miniText.main}</b><small>{miniText.sub}</small></span>
        <span class="mp">{@render legsBar(false)}</span>
        {#if !arrived}<span class="meta"><b>{arriveAt ? clockHM(arriveAt) : "–"}</b><small>άφιξη</small></span>{/if}
        <button type="button" class="round sm" aria-label="Άνοιγμα πλοήγησης" title="Άνοιγμα" onclick={() => setMini(false)}><Icon name="chevron-up" size={18} /></button>
        <button type="button" class="round sm end" aria-label="Τέλος πλοήγησης" title="Τέλος" onclick={end}><Icon name="close" size={16} /></button>
      </div>
    {:else}
    <!-- What to do now, and what comes after it -->
    {#key `${app.guideStep}:${app.guideOn}:${ban.tone}`}
      <div class="banner t-{ban.tone}" aria-live={ban.tone === "stop" ? "assertive" : "polite"} in:rise={{ y: -10 }}>
        <span class="bi">{#if ban.arrow}<svg class="arrow" width="32" height="32" viewBox="0 0 24 24" aria-hidden="true"><path d={ban.arrow} /></svg>{:else if ban.tone === "stop" && !railCard}<b class="stopkey">STOP</b>{:else}<Icon name={ban.icon} size={26} />{/if}</span>
        <span class="bt"><b>{ban.big}</b><span>{ban.small}</span></span>
        {#if ban.then}<span class="bthen"><small>{ban.thenL}</small><span>{ban.then}</span></span>{/if}
      </div>
    {/key}
    {#if ban.then}<div class="then"><span>{ban.thenL === "ΜΕΤΑ" ? "Μετά" : ban.thenL === "ΕΠΟΜΕΝΗ" ? "Επόμενη" : "Κατεβαίνεις"}</span>{ban.then}</div>{/if}

    <!-- On the map: the bus (and the stop) in view; the map turned with the phone. Just above the sheet. -->
    <div class="mapbtns" hidden={app.stack.length > 0} style:bottom="{(sheetH || 0) + 12}px">
      {#if bus && ride && !(rideIsNow && app.guideOn)}
        <button type="button" class="mb" class:on={peeking} onclick={peek} aria-pressed={peeking} aria-label={peeking ? "Πίσω σε εμένα" : `Πού είναι το ${ride.line}`} title={peeking ? "Πίσω σε εμένα" : `Πού είναι το ${ride.line}`}><Icon name={peeking ? "locate" : "bus"} size={20} /></button>
      {/if}
      {#if ride && !(rideIsNow && app.guideOn)}
        <button type="button" class="mb" class:on={looking} onclick={lookStop} aria-pressed={looking}
          aria-label={looking ? "Πίσω σε εμένα" : `Η στάση ${ride.board.name} σε 3D, από εκεί που έρχεται το ${ride.line}`} title={looking ? "Πίσω σε εμένα" : "Η στάση σε 3D"}><Icon name={looking ? "locate" : "cube"} size={20} /></button>
      {/if}
      <button type="button" class="mb round2" class:on={app.headingUp} aria-pressed={app.headingUp} onclick={headingUp}
        aria-label={app.headingUp ? "Ο χάρτης με τον βορρά πάνω" : "Γύρνα τον χάρτη με το κινητό"} title={app.headingUp ? "Βορράς πάνω" : "Γύρνα τον χάρτη με το κινητό"}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 5.5l2.6 6.5H9.4z" fill="currentColor" stroke="none" /><path d="M9.4 12h5.2L12 18.5z" opacity=".35" fill="currentColor" stroke="none" /></svg>
      </button>
    </div>

    <section class="sheet" class:full={nsnap === "full"} class:dragging={dragH != null} aria-label="Η διαδρομή" hidden={app.stack.length > 0} bind:this={sheetEl} bind:offsetHeight={sheetH}
      class:free={freeH != null} style:height={dragH != null ? `${dragH}px` : freeH != null ? `${freeH}px` : undefined}>
      <div class="grip" role="button" tabindex="0" aria-label={nsnap === "full" ? "Μικρότερο" : "Μεγαλύτερο"} use:sheetDrag={navDrag}
        onkeydown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nsnap = nsnap === "half" ? "full" : "half"; } }}>
        <button type="button" class="round sm minbtn" aria-label="Σμίκρυνση πλοήγησης" title="Σμίκρυνση" onclick={() => setMini(true)}><Icon name="chevron" size={18} /></button>
      </div>
      <!-- Where to, when, and the trip to scale with the user on it -->
      <header class="head">
        <span class="dest"><small>ΠΡΟΣ</small><b>{g.dest}</b></span>
        <span class="eta"><b>{arrived ? clockHM(nowS) : arriveAt ? clockHM(arriveAt) : "–"}</b><small>{arrived ? "έφτασες" : arriveAt ? `σε ${durText(Math.max(1, Math.round((arriveAt - nowS) / 60)))}` : "άφιξη"}</small></span>
      </header>
      {@render legsBar(true)}

      {#if arrived}
        <p class="muted">Καλό σου δρόμο.</p>
      {:else if xchg && l}
        <!-- A change (mockup 48): the station from the side, the rider on it, the step now, the time to the next ride -->
        <TransferBox st={xchg.st} live={{ f: xF, phase: xPhase ?? xchg.phase, count: xCount }} />
        {#if xPhase === "walk"}<button type="button" class="primary wide deskonly" onclick={atPlatform}><Icon name="check" size={18} /><span>{xLook && xLook.to > 0 ? "Είμαι στην αποβάθρα" : "Είμαι στη στάση"}</span></button>{/if}
      {:else if now && l}
        <!-- The leg now -->
        <article class="legnow t-{now.tone}">
          <div class="nt"><span class="tag">{now.tag}</span>{#if now.chip}<span class="live" class:sched={now.chip !== "Ζωντανά"}><i></i>{now.chip}</span>{/if}</div>
          <div class="nm"><b class="title">{now.title}</b><b class="num">{now.big}</b></div>
          {#if now.bar != null}<div class="margin" aria-hidden="true"><i style:width="{Math.round(now.bar * 100)}%"></i></div>{/if}
          {#if now.note}<p class="note">{now.note}</p>{/if}
          {#if now.rows.length}
            <ul class="nrows">
              {#each now.rows as r, k (k)}
                <li class:strong={r.strong}>
                  <span class="ri" class:hot={r.icon === "pin" || (r.icon === "bus" && r.strong)}>{#if r.arrow}<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d={r.arrow} /></svg>{:else}<Icon name={r.icon === "pin" ? "pin" : r.icon === "bus" ? "bus" : r.icon === "clock" ? "clock" : "stop"} size={15} />{/if}</span>
                  <span class="rt"><b>{r.t}</b>{#if r.s}<small>{r.s}</small>{/if}</span>
                  {#if r.v}<span class="rv">{r.v}</span>{/if}
                  {#if r.icon === "bus" && r.strong && bus}
                    <button type="button" class="peek" aria-pressed={peeking} onclick={peek}><Icon name={peeking ? "locate" : "map"} size={14} /><span>{peeking ? "Σε εμένα" : "Δες το"}</span></button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if l.kind === "ride" && !app.guideOn}
            <button type="button" class="primary wide" onclick={boarded}><Icon name="check" size={18} /><span>Μπήκα</span></button>
          {/if}
          {#if railCard && app.guideOn}<p class="note">Κάτω από τη γη χωρίς GPS: από τις στάσεις που κάνει το τρένο (κίνηση του κινητού) και το πρόγραμμα.</p>{/if}
        </article>

        <!-- Two things good to know: the change, the ticket, the next bus if this one is missed -->
        {#if tips.length}
          <div class="tips">
            {#each tips as t (t.k)}
              <div class="tip c-{t.tone}"><span class="tk"><Icon name={t.icon} size={14} />{t.k}</span><b>{t.v}</b><small>{t.s}</small></div>
            {/each}
          </div>
        {/if}

        <!-- All the steps (mockup 48 Δ): done, now, next; a tap moves there (the location may be wrong) -->
        <div class="later" hidden={!list}>
          <span class="lh">ΒΗΜΑΤΑ</span>
          {#each allSteps as x (x.key)}
            <button type="button" class="lrow" class:done={x.done} class:here={x.now} aria-current={x.now ? "step" : undefined}
              onclick={() => { if (x.key === "end") return; app.guideStep = x.k; app.guideOn = false; arrived = false; xDone = false; }}>
              {#if x.done}<span class="chip sm okchip"><Icon name="check" size={13} /></span>
              {:else if x.kind === "ride"}<b class="chip sm" style:--lb={colorOf(x.line ?? "").bg} style:--lf={colorOf(x.line ?? "").fg}>{x.line}</b>
              {:else if x.kind === "change"}<span class="chip sm xchip"><Icon name="swap" size={13} /></span>
              {:else}<span class="chip sm walkchip"><Icon name={x.key === "end" ? "pin" : "walk"} size={13} /></span>{/if}
              <span class="lt"><span>{x.t}</span><small>{x.s}</small></span>
              <span class="lat">{x.now ? "τώρα" : x.at}</span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="acts">
        {#if !arrived}
          <button type="button" class="round" aria-pressed={voice} aria-label={voice ? "Σίγαση φωνής" : "Φωνή"} title={voice ? "Σίγαση φωνής" : "Φωνή"} onclick={toggleVoice}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9z" />{#if voice}<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />{:else}<path d="M17 9l5 6M22 9l-5 6" />{/if}</svg>
          </button>
          <button type="button" class="round listbtn" aria-expanded={list} aria-label="Τα επόμενα βήματα" title="Τα επόμενα βήματα" onclick={() => { list = !list; if (list) { freeH = null; nsnap = "full"; } }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
          </button>
          <button type="button" class="sharebtn" onclick={share}><Icon name="share" size={16} /><span>{shared ? "Αντιγράφηκε" : "Μοίρασε άφιξη"}</span></button>
          {#if xchg?.phase === "off"}
            <button type="button" class="cta blue phoneonly" onclick={next}>Βγήκα από το τρένο</button>
          {:else if xPhase === "walk"}
            <button type="button" class="cta blue phoneonly" onclick={atPlatform}>{xLook && xLook.to > 0 ? "Είμαι στην αποβάθρα" : "Είμαι στη στάση"}</button>
          {:else if l?.kind === "ride" && app.guideOn}
            <button type="button" class="cta phoneonly" onclick={next}>Κατέβηκα</button>
          {:else if l?.kind === "ride"}
            <button type="button" class="cta blue phoneonly" onclick={boarded}>Μπήκα</button>
          {/if}
        {/if}
        <button type="button" class="endbtn" class:solo={arrived} onclick={end}>Τέλος</button>
      </div>
    </section>
    {/if}
  </div>
{/if}

{#snippet legsBar(big: boolean)}
  <!-- The trip to scale: one thin track, a part per leg in its line's colour (a walk grey), filled as far as it has
       gone, the user a dot on it; under it each part's line and minutes (a walk: its icon). -->
  <div class="legs" class:big aria-hidden="true">
    <div class="track">
      {#each bar.parts as x, k (k)}
        <span class="lg" class:walk={x.walk} class:cur={x.cur} class:past={x.past} style:flex-grow={x.flex} style:--lb={x.color?.bg}>
          <i class="fill" style:width="{Math.round(x.fill * 100)}%"></i>
        </span>
      {/each}
      {#if !arrived && bar.at != null}<span class="you" style:left="{bar.at}%"></span>{/if}
    </div>
    {#if big}
      <div class="lls">
        {#each bar.parts as x, k (k)}
          <span class="ll" class:cur={x.cur} class:walk={x.walk} style:flex-grow={x.flex}>{#if x.walk}<Icon name="walk" size={12} />{:else}{x.label}{/if}</span>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .guide { position: absolute; inset: 0; z-index: 9; pointer-events: none; --g-go: #0f5132; --g-hurry: #8a5a0b; --g-late: #8f1d1f; --g-wait: #1d4ed8; --g-ride: #1f4fb8; --g-change: #7a4a0c; }
  .guide > * { pointer-events: auto; }

  /* The banner: what to do now, big; what comes after it, at its right (a phone: a chip under it). */
  .banner { position: absolute; left: 12px; right: 12px; top: calc(12px + env(safe-area-inset-top)); box-sizing: border-box;
    display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 22px; color: #fff; background: var(--g-go);
    box-shadow: 0 16px 40px rgba(0, 0, 0, .4); }
  .banner.t-hurry, .banner.t-change { background: var(--g-hurry); }
  .banner.t-late { background: var(--g-late); }
  .banner.t-wait { background: var(--g-wait); }
  .banner.t-ride { background: var(--g-ride); }
  .banner.t-stop { background: #f0ae45; color: #1a1205; animation: pulse 1.4s ease-in-out infinite; }
  .bi { flex: none; display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: 16px; background: rgba(255, 255, 255, .14); }
  .t-stop .bi { background: #c2261f; color: #fff; }
  .stopkey { font-size: 13px; font-weight: 800; line-height: 1; }
  .arrow { fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
  .bt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .bt b { font-size: 24px; font-weight: 900; letter-spacing: -.02em; line-height: 1; }
  .bt span { font-size: 14.5px; font-weight: 600; line-height: 1.2; color: rgba(255, 255, 255, .86); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-stop .bt span { color: #3b2a08; }
  .bthen { display: none; flex: none; max-width: 190px; flex-direction: column; align-items: flex-end; gap: 5px; padding-left: 14px; border-left: 1px solid rgba(255, 255, 255, .2); }
  .bthen small { font-size: 10.5px; font-weight: 800; letter-spacing: .05em; color: rgba(255, 255, 255, .7); line-height: 1; }
  .bthen span { font-size: 13.5px; font-weight: 700; line-height: 1.2; text-align: right; }
  .then { position: absolute; left: 12px; top: calc(96px + env(safe-area-inset-top)); max-width: calc(100% - 24px); box-sizing: border-box; height: 32px;
    display: flex; align-items: center; gap: 7px; padding: 0 12px; border-radius: 16px; background: rgba(15, 18, 24, .9); color: #fff;
    font-size: 12.5px; font-weight: 700; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .then span { color: #a3aab6; }

  /* The sheet: a phone's, at the foot; a computer's, a column at the left (below). */
  .sheet[hidden] { display: none; }
  .sheet > * { flex-shrink: 0; }
  .sheet { position: absolute; left: 0; right: 0; bottom: 0; max-height: 72dvh; overflow-y: auto; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 12px; padding: 8px 14px max(16px, env(safe-area-inset-bottom)); border-radius: var(--sheet-r) var(--sheet-r) 0 0;
    background: var(--surface); border-top: 1px solid var(--border); box-shadow: 0 -18px 40px rgba(0, 0, 0, .35); scrollbar-width: none; }
  .sheet::-webkit-scrollbar { display: none; }
  /* The handle stays at the top while the sheet's content scrolls under it (it scrolled away with it). */
  .grip { position: sticky; top: -8px; z-index: 3; align-self: stretch; height: 30px; margin: -8px -14px -12px; display: flex; align-items: center; justify-content: center;
    cursor: grab; background: var(--surface); border-radius: var(--sheet-r) var(--sheet-r) 0 0; }
  .grip::after { content: ""; width: 40px; height: 5px; border-radius: 3px; background: var(--border); }
  /* Half: the leg now and a little more, the map above it; the rest scrolls, or a drag shows it. */
  .sheet { max-height: 46dvh; }
  .sheet.full { max-height: 88dvh; }
  .sheet.free { max-height: none; }
  .sheet.dragging { max-height: none; overflow: hidden; }
  .mapbtns { position: absolute; right: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; z-index: 2; pointer-events: none; }
  .mapbtns[hidden] { display: none; }
  .mb { pointer-events: auto; width: 48px; height: 48px; padding: 0; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 50%;
    background: var(--surface); color: var(--fg); cursor: pointer; box-shadow: 0 6px 18px rgba(0, 0, 0, .3); }
  .mb.on { background: var(--accent); color: var(--on-accent, #fff); border-color: transparent; }
  .minbtn { position: absolute; top: 4px; right: 8px; z-index: 1; }
  .muted { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
  .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding-right: 40px; }
  .dest { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .dest small, .eta small { font-size: 11px; font-weight: 700; color: var(--muted); line-height: 1; }
  .dest b { font-size: 18px; font-weight: 900; letter-spacing: -.02em; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .eta { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
  .eta b { font-size: 24px; font-weight: 900; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }

  /* The legs: one thin track to scale, the part now brighter and filling, the user a dot on it; labels under. */
  .legs { display: flex; flex-direction: column; gap: 7px; }
  .track { position: relative; display: flex; align-items: center; gap: 3px; height: 14px; }
  .lg { position: relative; flex: 1 1 0; min-width: 10px; height: 6px; overflow: hidden; border-radius: 3px;
    background: color-mix(in srgb, var(--lb, var(--accent)) 45%, transparent); }
  .lg.walk { background: var(--control); }
  .lg.cur { height: 8px; border-radius: 4px; }
  .lg.past { opacity: .45; }
  .lg .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--lb, var(--accent)); transition: width .6s ease; }
  .lg.walk .fill { background: var(--muted); }
  .lg.past .fill { width: 100% !important; }
  .you { position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; box-sizing: border-box; border-radius: 50%;
    background: var(--accent); border: 3px solid var(--surface); box-shadow: 0 0 0 1.5px var(--accent); transition: left .6s ease; }
  .lls { display: flex; gap: 3px; }
  .ll { flex: 1 1 0; min-width: 10px; display: flex; justify-content: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    font-size: 11px; font-weight: 700; line-height: 1; color: var(--muted); }
  .ll.walk { color: color-mix(in srgb, var(--muted) 70%, transparent); }
  .ll.cur { color: var(--fg); font-weight: 800; }

  /* The leg now. */
  .legnow { --tc: var(--ontime); display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 20px;
    background: color-mix(in srgb, var(--tc) 9%, var(--card, var(--control))); border: 1px solid color-mix(in srgb, var(--tc) 38%, transparent); }
  .legnow.t-hurry, .legnow.t-change { --tc: var(--late1); }
  .legnow.t-late { --tc: var(--late2); }
  .legnow.t-wait, .legnow.t-ride { --tc: var(--accent); }
  .legnow.t-stop { --tc: #f0ae45; }
  .nt { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 22px; }
  .tag { min-width: 0; font-size: 10.5px; font-weight: 800; letter-spacing: .06em; color: var(--tc); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .live { flex: none; height: 22px; padding: 0 9px; border-radius: 11px; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; line-height: 1;
    background: color-mix(in srgb, var(--ontime) 16%, transparent); color: var(--ontime); }
  .live i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .live.sched { background: var(--control); color: var(--muted); }
  .nm { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
  .title { min-width: 0; font-size: 17px; font-weight: 800; line-height: 1.2; }
  .num { flex: none; font-size: 40px; font-weight: 900; letter-spacing: -.04em; line-height: .9; color: var(--tc); font-variant-numeric: tabular-nums; }
  .legnow.t-go .num { color: var(--fg); }
  .margin { height: 7px; overflow: hidden; border-radius: 4px; background: var(--control); }
  .margin i { display: block; height: 100%; border-radius: 4px; background: var(--tc); transition: width .6s ease; }
  .note { margin: 0; font-size: 12.5px; font-weight: 600; line-height: 1.35; color: color-mix(in srgb, var(--tc) 70%, var(--fg)); }
  .nrows { list-style: none; margin: 0; padding: 0; border-top: 1px solid color-mix(in srgb, var(--fg) 8%, transparent); }
  .nrows li { display: flex; align-items: center; gap: 11px; min-height: 44px; padding-top: 6px; }
  .ri { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--control); color: var(--muted); }
  .ri svg { fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .ri.hot { background: var(--accent); color: var(--on-accent); }
  .rt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .rt b { font-size: 13.5px; font-weight: 600; line-height: 1.25; }
  .strong .rt b { font-weight: 800; }
  .rt small { font-size: 11.5px; color: var(--muted); line-height: 1.3; }
  .rv { flex: none; font-size: 12.5px; font-weight: 800; line-height: 1; }
  .peek { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 0; border-radius: 16px;
    background: var(--accent-bg); color: var(--accent); font: inherit; font-size: 12.5px; font-weight: 700; line-height: 1; cursor: pointer; }
  .peek[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
  .primary { display: flex; align-items: center; justify-content: center; gap: 8px; height: 46px; padding: 0 18px; border: 0; border-radius: 16px;
    background: var(--accent); color: var(--on-accent); font: inherit; font-size: 15px; font-weight: 800; line-height: 1; cursor: pointer; }
  .primary.wide { display: none; }

  /* Good to know. */
  .tips { display: flex; flex-direction: column; gap: 2px; }
  .tip { --tc: #f0ae45; display: grid; grid-template-columns: auto 1fr; column-gap: 11px; row-gap: 3px; align-items: center; padding: 6px 0; }
  .tip.c-green { --tc: var(--ontime); } .tip.c-blue { --tc: var(--accent); } .tip.c-red { --tc: var(--late2); }
  .tk { grid-row: span 2; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0;
    background: color-mix(in srgb, var(--tc) 16%, transparent); color: var(--tc); }
  .tip b { font-size: 13px; font-weight: 700; line-height: 1.25; }
  .tip small { font-size: 11.5px; color: var(--muted); line-height: 1.3; }

  /* After it. */
  .later[hidden] { display: none; }
  .later { display: flex; flex-direction: column; gap: 2px; }
  .lh { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; color: var(--muted); line-height: 1; padding: 4px 4px 8px; }
  .lrow { display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 0 4px; border: 0; border-radius: 12px; background: none; color: var(--fg);
    font: inherit; text-align: left; cursor: pointer; }
  .lrow:hover { background: var(--control); }
  .lt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 6px 0; font-size: 13.5px; font-weight: 600; line-height: 1.25; }
  .lt small { font-size: 12px; font-weight: 500; color: var(--muted); line-height: 1.2; }
  .lrow.done { opacity: .5; }
  .lrow.done .lt > span { text-decoration: line-through; }
  .lrow.here { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  @media (max-width: 719px) { .deskonly { display: none; } }
  .okchip { background: color-mix(in srgb, var(--ontime) 18%, transparent); color: var(--ontime); }
  .xchip { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
  .lat { flex: none; font-size: 12.5px; font-weight: 700; color: var(--muted); line-height: 1; font-variant-numeric: tabular-nums; }
  .chip { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 24px; padding: 0 7px; box-sizing: border-box;
    border-radius: 8px; background: var(--lb); color: var(--lf); font-size: 11.5px; font-weight: 800; line-height: 1; }
  .chip.sm { min-width: 40px; height: 22px; font-size: 11px; }
  .walkchip { background: var(--control); color: var(--muted); }

  /* The actions. */
  .acts { display: flex; align-items: center; gap: 8px; }
  /* A phone: the buttons stay at the sheet's foot however short it is, the rest scrolls above them. */
  @media (max-width: 719px) {
    .acts { position: sticky; bottom: calc(-1 * max(16px, env(safe-area-inset-bottom))); z-index: 2; margin: auto -14px calc(-1 * max(16px, env(safe-area-inset-bottom)));
      padding: 10px 14px max(16px, env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--border); }
  }
  .round { flex: none; width: 46px; height: 46px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 16px;
    background: var(--control); color: var(--fg); cursor: pointer; }
  .round[aria-pressed="false"] { color: var(--muted); }
  .round[aria-expanded="true"] { background: var(--accent-bg); color: var(--accent); }
  .round.sm { width: 34px; height: 34px; border-radius: 50%; }
  .sharebtn { display: none; flex: 1; height: 46px; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 16px; background: var(--control);
    color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .cta { flex: 1; height: 46px; border: 0; border-radius: 16px; background: var(--control); color: var(--fg); font: inherit; font-size: 15px; font-weight: 800; line-height: 1; cursor: pointer; }
  .cta.blue { background: var(--accent); color: var(--on-accent); }
  .endbtn { flex: none; height: 46px; padding: 0 18px; border: 0; border-radius: 16px; background: color-mix(in srgb, var(--late3) 18%, transparent); color: var(--late3);
    font: inherit; font-size: 14px; font-weight: 800; line-height: 1; cursor: pointer; margin-left: auto; }
  .acts .cta ~ .endbtn { margin-left: 0; }
  .endbtn.solo { flex: 1; background: var(--accent); color: var(--on-accent); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(240, 174, 69, .35), 0 16px 40px rgba(0, 0, 0, .4); } }
  @media (prefers-reduced-motion: reduce) { .banner.t-stop { animation: none; } .lg .fill, .you, .margin i { transition: none; } }

  /* Minimised: one bar at the foot. */
  .minibar { position: absolute; left: 50%; bottom: 16px; translate: -50% 0; width: 680px; max-width: calc(100% - 24px); box-sizing: border-box;
    display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 14px; border-radius: 22px; background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .minibar.alert { box-shadow: 0 0 0 2px var(--late1), var(--glass-rim); }
  .mi { flex: none; display: flex; align-items: center; justify-content: center; min-width: 36px; height: 36px; color: var(--accent); }
  .mt { flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .mt b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; line-height: 1.1; }
  .mt small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.1; color: var(--muted); }
  .minibar.alert .mt b { color: var(--late1); }
  .mp { flex: 0 1 200px; min-width: 120px; }
  .meta { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .meta b { font-size: 16px; font-weight: 800; line-height: 1; }
  .meta small { font-size: 11px; line-height: 1; color: var(--muted); }
  .round.end { background: none; color: var(--muted); }
  .round.end:hover { background: var(--control); color: var(--fg); }

  /* A computer: a column at the left with everything (the steps after this one too), the banner over the map's
     middle with what comes after it in it. */
  @media (min-width: 720px) {
    .mapbtns { bottom: 24px !important; right: 64px; }
    .guide.carded .sheet { display: none; }
    .sheet { left: 16px; right: auto; top: 16px; bottom: auto; width: 372px; max-height: calc(100dvh - 32px); padding: 14px 14px 12px; border-radius: 24px; border: 1px solid var(--border);
      box-shadow: 0 20px 50px rgba(0, 0, 0, .35); gap: 12px; }
    .grip { display: none; }
    .head { padding-right: 40px; }
    .dest b { font-size: 21px; }
    .eta b { font-size: 26px; }
    .banner { left: calc(404px + (100% - 404px) / 2); right: auto; translate: -50% 0; width: min(560px, calc(100% - 440px)); padding: 12px 16px; }
    .bthen { display: flex; }
    .then { display: none; }
    .bt b { font-size: 25px; }
    .bi { width: 56px; height: 56px; }
    .num { font-size: 40px; }
    .primary.wide { display: flex; }
    .phoneonly { display: none; }
    .later[hidden] { display: flex; }
    .listbtn { display: none; }
    .sharebtn { display: flex; }
    .tips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .tip { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px; border-radius: 16px; background: var(--control); }
    .tk { width: auto; height: auto; border-radius: 0; background: none; gap: 7px; font-size: 10.5px; font-weight: 800; letter-spacing: .05em; line-height: 1; }
    .acts { padding-top: 12px; border-top: 1px solid var(--border); }
    .acts .endbtn { margin-left: 0; }
  }
  @media (max-width: 719px) {
    .minibar { left: 12px; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); translate: none; width: auto; max-width: none; flex-wrap: wrap; gap: 10px 12px;
      padding: 12px; border-radius: 24px; }
    .mt { flex: 1 1 0; }
    .mp { order: 9; flex: 1 1 100%; }
    .nrows { display: none; }
    .sheet:has(.later:not([hidden])) .nrows { display: block; }
  }
</style>
