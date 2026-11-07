<script lang="ts">
  // One route of «Πού πας;», compact (mockup 39): when to leave, how long, the means, and where its first bus is now on
  // a thin line (the stops before yours, the bus, your stop); the metro and the tram, which have no live positions,
  // dashed with the timetable's time. A tap opens it in place, step by step in words.
  import { untrack } from "svelte";
  import { guideFromPlan, type GuideRide } from "../guide";
  import { busNow, isLiveMode, type BusNow } from "../liveRide";
  import { planSteps, type Itinerary, type PlanResponse, type ScaledLeg } from "../plan";
  import type { TripIndex } from "../trip";
  import { titleCase } from "../nearby";
  import { placeNote, toward } from "../stops";
  import { clockHM } from "../trains";
  import { durText } from "../format";
  import Icon from "./Icon.svelte";

  let { it, r, ix, legs, nowS, tag = "", open = false, sel = false, live = false, others = [], onpick, onmap }: {
    it: Itinerary; r: PlanResponse; ix: TripIndex | null; legs: ScaledLeg[]; nowS: number; tag?: string; open?: boolean; sel?: boolean;
    live?: boolean; others?: Itinerary[]; onpick: () => void; onmap?: () => void;
  } = $props();

  // A walk's next ride is the metro or the tram: «ως τον σταθμό».
  const stationAfter = (k: number) => { const n = steps.slice(k + 1).find(x => x.kind === "ride"); return !!n && n.kind === "ride" && ["metro", "tram"].includes(legMode(n.leg)); };
  const mins = (m: number) => `${m} ${m === 1 ? "λεπτό" : "λεπτά"}`;
  const rideLeg = $derived(it.legs.find(l => l.kind === "ride") ?? null);
  const mode = $derived(rideLeg ? rideLeg.mode ?? r.lines[rideLeg.line ?? ""]?.mode ?? "bus" : "");
  const rideLabel = $derived(rideLeg ? r.lines[rideLeg.line ?? ""]?.label || (rideLeg.line ?? "").slice((rideLeg.line ?? "").indexOf(":") + 1) : "");
  const rideColor = $derived(rideLeg ? r.lines[rideLeg.line ?? ""]?.color || "#1f5fc8" : "#1f5fc8");
  // The walk before the first ride (to its stop): the bus's time less this is when to leave.
  const walkS = $derived(rideLeg ? rideLeg.depart_at - it.depart_at : 0);
  const ride = $derived.by<GuideRide | null>(() => {
    if (!rideLeg || !isLiveMode(mode)) return null;
    const g = guideFromPlan(it, r, ix, "");
    return (g.legs.find(l => l.kind === "ride") as GuideRide | undefined) ?? null;
  });

  // Its bus, every 20 s while the card shows (the first few cards only: `live`), when it leaves within the hour.
  let bus = $state.raw<BusNow | null>(null);
  let asked = $state(false);
  // The last answer stays while the next is asked (the card keeps its height); a new ride clears it.
  let busFor = "";
  $effect(() => {
    const rd = ride, at = rideLeg?.depart_at ?? 0;
    const k = rd ? `${rd.line}|${rd.board.id}|${at}` : "";
    if (k !== busFor) { busFor = k; bus = null; asked = false; }
    if (!live || !rd || at - untrack(() => nowS) > 3600) return;
    let dead = false;
    const tick = async () => {
      const b = await busNow(rd, at, untrack(() => nowS)).catch(() => null);
      if (dead) return;
      bus = b; asked = true;
    };
    void tick();
    const t = setInterval(() => void tick(), 20_000);
    return () => { dead = true; clearInterval(t); };
  });

  const leaveIn = $derived(Math.max(0, Math.floor(((bus?.live ? bus.at - walkS : it.depart_at) - nowS) / 60)));
  const leaveText = $derived(leaveIn === 0 ? "Φύγε τώρα" : leaveIn < 60 ? `Φύγε σε ${mins(leaveIn)}` : `Φύγε στις ${clockHM(nowS + leaveIn * 60)}`);
  const busMin = $derived(bus ? Math.max(0, Math.round((bus.at - nowS) / 60)) : null);

  // The line: dots for the stops before yours, the bus among them, yours at the right end.
  const n = $derived(bus?.before ?? 0);
  const busPos = $derived(bus?.away != null && n ? Math.max(0, Math.min(100, ((n - Math.min(bus.away, n)) / n) * 100)) : 0);
  const busWhere = $derived(!bus ? "" : !bus.live ? "κατά πρόγραμμα, χωρίς ζωντανή θέση" : bus.away === 0 ? "είναι στη στάση σου"
    : bus.away === 1 ? "1 στάση πριν από τη δική σου" : bus.away != null ? `${bus.away} στάσεις πριν από τη δική σου`
    : n ? `πιο μακριά από ${n} στάσεις` : "ζωντανά");

  const steps = $derived(open ? planSteps(it, r, others) : []);
  const name = (s: string) => titleCase(placeNote(s).place) || s;
  const MODE_WORD: Record<string, string> = { bus: "το λεωφορείο", trolley: "το τρόλεϊ", metro: "το μετρό", tram: "το τραμ", suburban: "τον Προαστιακό" };
  const legMode = (k: number) => it.legs[k]?.mode ?? r.lines[it.legs[k]?.line ?? ""]?.mode ?? "bus";
</script>

<div class="rc" class:open class:sel>
  <button type="button" class="rh" aria-expanded={open} onclick={onpick}>
    {#if tag}<span class="tag">{tag}</span>{/if}
    <span class="r1"><b class="lv" class:now={tag !== ""}>{leaveText}</b><span class="du">{Math.round(it.duration_s / 60) < 60 ? mins(Math.round(it.duration_s / 60)) : durText(Math.round(it.duration_s / 60))}</span></span>
    <span class="legs">
      {#each legs as l, j (j)}
        <span class="leg" class:walk={l.walk} style:--lb={l.color || undefined} style:--lt={l.text || undefined}>{#if l.walk}<span class="lwi" aria-label="Πόδια"><Icon name="walk" size={12} /></span>{/if}{l.label}</span>
      {/each}
    </span>
    {#if rideLeg && (bus || (!isLiveMode(mode) && live))}
      <span class="where">
        <span class="wt">
          {#if bus?.live}<i class="dot"></i>{:else}<span class="clk"><Icon name="clock" size={12} /></span>{/if}
          <b>{rideLabel}</b><span class="ws">· {bus ? busWhere : "κατά πρόγραμμα, χωρίς ζωντανή θέση"}</span>
        </span>
        <span class="eta" class:on={bus?.live}>{bus ? (busMin! < 60 ? (busMin === 0 ? "τώρα" : `σε ${busMin}′`) : clockHM(bus.at)) : clockHM(rideLeg.depart_at)}</span>
      </span>
      <span class="track" class:sched={!bus?.live} aria-hidden="true">
        <i class="base"></i>
        {#if bus?.live}
          <i class="run" style:left="{busPos}%" style:background={rideColor}></i>
          {#each Array.from({ length: n }, (_, i) => i) as i (i)}<i class="st" style:left="{(i / n) * 100}%"></i>{/each}
          <span class="veh" style:left="{busPos}%" style:background={rideColor}><Icon name={mode === "trolley" ? "trolley" : "bus"} size={11} /></span>
        {:else}
          <span class="veh ghost" style:left="12%" style:border-color={rideColor} style:color={rideColor}><Icon name={mode === "metro" ? "metro" : mode === "tram" ? "tram" : "bus"} size={11} /></span>
        {/if}
        <i class="me"></i>
      </span>
    {/if}
    <span class="r3"><span>{clockHM(it.depart_at)} → {clockHM(it.arrive_at)} · {it.transfers ? `${it.transfers} ${it.transfers === 1 ? "αλλαγή" : "αλλαγές"}` : "χωρίς αλλαγή"}</span>
      <span class="more">{open ? "Κλείσε" : "Βήματα"}<span class="chev" class:up={open}><Icon name="chevron" size={14} /></span></span></span>
  </button>

  {#if open}
    <ol class="steps">
      {#each steps as st, k (k)}
        <li>
          {#if st.kind === "walk"}
            <span class="si"><Icon name="walk" size={16} /></span>
            <span class="sx"><b>Περπάτα {mins(st.min)}</b><small>ως {st.to === "στον προορισμό" ? "τον προορισμό" : `${stationAfter(k) ? "τον σταθμό" : "τη στάση"}${st.to === "στη στάση" ? "" : ` ${name(st.to)}`}`}{stationAfter(k) ? ", και κατέβα στο μετρό" : ""}</small></span>
          {:else if st.kind === "change"}
            <span class="si"><Icon name="walk" size={16} /></span>
            <span class="sx"><b>{st.m < 20 && !st.gate ? `Κατέβα και περίμενε ${mins(Math.max(1, st.spare))}` : `Άλλαξε: περπάτα ${mins(st.min)}`}</b><small>{st.m < 20 && !st.gate ? `στη στάση ${name(st.stop)}` : `ως ${st.mode === "metro" || st.mode === "tram" ? "τον σταθμό" : "τη στάση"} ${st.next ? name(st.next) : ""}${st.mode === "metro" ? ", και κατέβα στο μετρό (σκάλες, ακυρωτικά)" : ""}`}</small></span>
          {:else if st.kind === "ride"}
            {@const md = legMode(st.leg)}
            <span class="si badge" style:background={st.color} style:color={st.text}>{st.label.length > 4 ? "" : st.label}{#if st.label.length > 4}<Icon name={md === "metro" ? "metro" : md === "tram" ? "tram" : "bus"} size={15} />{/if}</span>
            <span class="sx"><b>Πάρε {MODE_WORD[md] ?? "το λεωφορείο"} {st.label}</b>
              <small>{st.headsign ? `προς ${name(toward(st.headsign))} · ` : ""}{clockHM(st.at)} από {name(st.from)} · κατέβα {st.hops ? `σε ${st.hops} ${st.hops === 1 ? "στάση" : "στάσεις"}, ` : "στη στάση "}{name(st.to)}</small></span>
          {:else}
            <span class="si"><Icon name="pin" size={16} /></span>
            <span class="sx"><b>Έφτασες, {clockHM(st.at)}</b><small>Ο προορισμός σου</small></span>
          {/if}
        </li>
      {/each}
    </ol>
    {#if onmap}<button type="button" class="onmap" onclick={onmap}><Icon name="map" size={15} /><span>Δες τη στον χάρτη</span></button>{/if}
  {/if}
</div>

<style>
  .rc { border-radius: 18px; border: 1px solid var(--pc-edge, var(--card-border, transparent)); background: var(--pc-surf, var(--card)); overflow: hidden; transition: border-color .2s; }
  .rc.sel { border-color: color-mix(in srgb, var(--pc-acc, var(--accent)) 70%, transparent); }
  .rh { width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 10px; padding: 14px 16px; border: 0; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .tag { height: 14px; display: flex; align-items: center; font-size: 13px; font-weight: 600; color: var(--muted); line-height: 1; }
  .r1 { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .lv { font-size: 18px; font-weight: 700; line-height: 1; }
  .lv.now { color: var(--ontime); }
  .du { font-size: 15px; font-weight: 600; line-height: 1; white-space: nowrap; }
  .legs { display: flex; flex-wrap: wrap; gap: 6px; }
  .leg { height: 28px; display: inline-flex; align-items: center; gap: 3px; padding: 0 9px; border-radius: 8px; box-sizing: border-box;
    background: var(--lb, #1f5fc8); color: var(--lt, #fff); font-size: 14px; font-weight: 700; line-height: 1; }
  .leg.walk { background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--muted); }
  .lwi { display: flex; }
  .where { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 16px; font-size: 13px; line-height: 1; }
  .wt { min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--muted); }
  .wt b { color: var(--fg); font-weight: 600; }
  .ws { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ontime); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ontime) 20%, transparent); }
  .clk { display: flex; color: var(--muted); }
  .eta { flex: none; font-weight: 600; color: var(--muted); }
  .eta.on { color: var(--ontime); }
  .track { position: relative; display: block; height: 22px; margin: -2px 6px 0 11px; }
  .track i { position: absolute; display: block; }
  .base { left: 0; right: 0; top: 10px; height: 2px; border-radius: 1px; background: color-mix(in srgb, var(--fg) 14%, transparent); }
  .track.sched .base { background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--fg) 26%, transparent) 0 6px, transparent 6px 11px); }
  .run { right: 0; top: 10px; height: 2px; border-radius: 1px; }
  .st { top: 8px; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: color-mix(in srgb, var(--fg) 30%, transparent); }
  .me { right: -6px; top: 5px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--fg); background: var(--pc-surf, var(--card)); box-sizing: border-box; }
  .veh { position: absolute; top: 0; width: 22px; height: 22px; margin-left: -11px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 0 3px var(--pc-surf, var(--card)); transition: left .6s ease; }
  .veh.ghost { background: var(--pc-surf, var(--card)); border: 2px dashed; box-sizing: border-box; box-shadow: none; }
  .r3 { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 20px; font-size: 14px; color: var(--muted); line-height: 1; }
  .more { flex: none; display: flex; align-items: center; gap: 4px; font-weight: 600; color: var(--fg); opacity: .8; }
  .chev { display: flex; transition: transform .2s; }
  .chev.up { transform: rotate(180deg); }

  .steps { list-style: none; margin: 0; padding: 4px 16px 6px; border-top: 1px solid var(--pc-edge, var(--card-border, transparent)); position: relative; }
  .steps li { position: relative; display: flex; gap: 12px; padding: 10px 0; }
  .steps li:not(:last-child)::before { content: ""; position: absolute; left: 17px; top: 46px; bottom: -10px; width: 2px; background: var(--pc-edge, color-mix(in srgb, var(--fg) 12%, transparent)); }
  .si { flex: none; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--fg); font-size: 12px; font-weight: 800; line-height: 1; }
  .sx { flex: 1; min-width: 0; min-height: 36px; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
  .sx b { font-size: 16px; font-weight: 600; line-height: 1.25; }
  .sx small { font-size: 13px; color: var(--muted); line-height: 1.3; }
  .onmap { margin: 0 16px 14px; height: 40px; padding: 0 14px; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 12px;
    background: color-mix(in srgb, var(--fg) 8%, transparent); color: var(--fg); font: inherit; font-size: 14px; font-weight: 600; line-height: 1; cursor: pointer; }
  @media (prefers-reduced-motion: reduce) { .veh, .chev { transition: none; } }
</style>
