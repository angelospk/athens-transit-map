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

  let { it, r, ix, legs, nowS, tag = "", open = false, sel = false, live = false, others = [], logos = false, onpick, onmap }: {
    it: Itinerary; r: PlanResponse; ix: TripIndex | null; legs: ScaledLeg[]; nowS: number; tag?: string; open?: boolean; sel?: boolean;
    live?: boolean; others?: Itinerary[]; logos?: boolean; onpick: () => void; onmap?: () => void;
  } = $props();

  // Mockup 44: closed, two lines; a tap opens where its bus is and three figures; «Βήματα» opens the steps.
  let stepsOpen = $state(false);
  $effect(() => { if (!open) stepsOpen = false; });
  // The operators' marks on the line chips (Athens: ΟΑΣΑ for buses and trolleys, the metro's and the tram's own).
  const LOGO: Record<string, string> = { bus: "icons/oasa.png", trolley: "icons/oasa.png", metro: "icons/metro-logo.svg", tram: "icons/tram-logo.svg" };
  const logoOf = (m: string) => (logos && LOGO[m] ? `${import.meta.env.BASE_URL}${LOGO[m]}` : "");
  const tagShort = $derived(tag.replace(/^Η\s+/, "").replace(/\s+τώρα$/, ""));
  const walkMin = $derived(Math.round(it.legs.filter(l => l.kind === "walk").reduce((s, l) => s + (l.arrive_at - l.depart_at), 0) / 60));

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
  const leaveShort = $derived(leaveIn === 0 ? "Φύγε τώρα" : leaveIn < 60 ? `Φύγε σε ${leaveIn}′` : `Φύγε στις ${clockHM(nowS + leaveIn * 60)}`);
  const busMin = $derived(bus ? Math.max(0, Math.round((bus.at - nowS) / 60)) : null);

  // The line: dots for the stops before yours, the bus among them, yours at the right end.
  const n = $derived(bus?.before ?? 0);
  const busPos = $derived(bus?.away != null && n ? Math.max(0, Math.min(100, ((n - Math.min(bus.away, n)) / n) * 100)) : 0);
  const busWhere = $derived(!bus ? "" : !bus.live ? "κατά πρόγραμμα, χωρίς ζωντανή θέση" : bus.away === 0 ? "είναι στη στάση σου"
    : bus.away === 1 ? "1 στάση πριν από τη δική σου" : bus.away != null ? `${bus.away} στάσεις πριν από τη δική σου`
    : n ? `πιο μακριά από ${n} στάσεις` : "ζωντανά");

  const steps = $derived(open && stepsOpen ? planSteps(it, r, others) : []);
  const etaText = $derived(!bus ? "" : busMin! < 60 ? (busMin === 0 ? "τώρα" : `σε ${busMin}′`) : clockHM(bus.at));
  const name = (s: string) => titleCase(placeNote(s).place) || s;
  const MODE_WORD: Record<string, string> = { bus: "το λεωφορείο", trolley: "το τρόλεϊ", metro: "το μετρό", tram: "το τραμ", suburban: "τον Προαστιακό" };
  const legMode = (k: number) => it.legs[k]?.mode ?? r.lines[it.legs[k]?.line ?? ""]?.mode ?? "bus";
</script>

<div class="rc" class:open class:sel>
  <button type="button" class="rh" aria-expanded={open} onclick={onpick}>
    <span class="r1">
      <span class="lvw"><b class="lv" class:now={tag !== ""}>{leaveShort}</b>{#if tag}<span class="tag">{tagShort}</span>{/if}</span>
      <span class="du">{Math.round(it.duration_s / 60) < 60 ? mins(Math.round(it.duration_s / 60)) : durText(Math.round(it.duration_s / 60))}</span>
    </span>
    <span class="r2">
      <span class="legs">
        {#each legs as l, j (j)}
          {@const lg = l.walk ? "" : logoOf(l.mode)}
          <span class="leg" class:walk={l.walk} class:lg={!!lg} style:--lb={l.color || undefined} style:--lt={l.text || undefined}>{#if l.walk}<span class="lwi" aria-label="Πόδια"><Icon name="walk" size={12} /></span>{:else if lg}<span class="lgo m-{l.mode}" aria-hidden="true"><img src={lg} alt="" /></span>{/if}{l.label}</span>
        {/each}
        {#if bus?.live}<span class="eta1"><i class="dot"></i>{etaText}</span>{/if}
      </span>
      <span class="tms">{clockHM(it.depart_at)} → {clockHM(it.arrive_at)}</span>
    </span>
  </button>

  {#if open}
    <div class="body">
      {#if rideLeg && (bus || (!isLiveMode(mode) && live))}
        <span class="where">
          <span class="wt">
            {#if bus?.live}<i class="dot"></i>{:else}<span class="clk"><Icon name="clock" size={12} /></span>{/if}
            <b>{rideLabel}</b><span class="ws">· {bus ? busWhere : "κατά πρόγραμμα, χωρίς ζωντανή θέση"}</span>
          </span>
          <span class="eta" class:on={bus?.live}>{bus ? etaText : clockHM(rideLeg.depart_at)}</span>
        </span>
        <span class="track" class:sched={!bus?.live} aria-hidden="true">
          <i class="base"></i>
          {#if bus?.live}
            <i class="run" style:left="{busPos}%" style:background={rideColor}></i>
            {#each Array.from({ length: n }, (_, i) => i) as i (i)}<i class="st" style:left="{(i / n) * 100}%"></i>{/each}
            <span class="veh" style:left="{busPos}%" style:background={rideColor}><Icon name={mode === "trolley" ? "trolley" : "bus"} size={13} /></span>
          {:else}
            <span class="veh ghost" style:left="12%" style:border-color={rideColor} style:color={rideColor}><Icon name={mode === "metro" ? "metro" : mode === "tram" ? "tram" : "bus"} size={13} /></span>
          {/if}
          <i class="me"></i>
        </span>
      {/if}
      <div class="facts">
        <span class="fact"><b>{it.transfers}</b><small>{it.transfers === 1 ? "αλλαγή" : "αλλαγές"}</small></span>
        <span class="fact"><b>{walkMin}′</b><small>με τα πόδια</small></span>
        <span class="fact"><b>{clockHM(it.arrive_at)}</b><small>φτάνεις</small></span>
      </div>
      <div class="bacts">
        <button type="button" class="stepsb" aria-expanded={stepsOpen} onclick={() => (stepsOpen = !stepsOpen)}><span>{stepsOpen ? "Λιγότερα" : "Βήματα"}</span><span class="chev" class:up={stepsOpen}><Icon name="chevron" size={15} /></span></button>
        {#if onmap}<button type="button" class="mapb" aria-label="Δες τη στον χάρτη" title="Δες τη στον χάρτη" onclick={onmap}><Icon name="map" size={18} /></button>{/if}
      </div>

      {#if stepsOpen}
        <ol class="steps">
          <li>
            <span class="si here"><Icon name="locate" size={14} /></span>
            <span class="sx"><span class="s1"><b>Ξεκίνα</b><span class="tm">{clockHM(it.depart_at)}</span></span><small>{leaveText}</small></span>
          </li>
          {#each steps as st, k (k)}
            <li class:ride={st.kind === "ride"} style:--lc={st.kind === "ride" ? st.color : undefined}>
              {#if st.kind === "walk"}
                <span class="si"><Icon name="walk" size={14} /></span>
                <span class="sx"><span class="s1"><b>Περπάτα {mins(st.min)}</b></span><small>ως {st.to === "στον προορισμό" ? "τον προορισμό" : `${stationAfter(k) ? "τον σταθμό" : "τη στάση"}${st.to === "στη στάση" ? "" : ` ${name(st.to)}`}`}{stationAfter(k) ? ", και κατέβα στο μετρό" : ""}</small></span>
              {:else if st.kind === "change"}
                <span class="si"><Icon name="walk" size={14} /></span>
                <span class="sx"><span class="s1"><b>{st.m < 20 && !st.gate ? `Κατέβα και περίμενε ${mins(Math.max(1, st.spare))}` : `Άλλαξε: περπάτα ${mins(st.min)}`}</b></span><small>{st.m < 20 && !st.gate ? `στη στάση ${name(st.stop)}` : `ως ${st.mode === "metro" || st.mode === "tram" ? "τον σταθμό" : "τη στάση"} ${st.next ? name(st.next) : ""}${st.mode === "metro" ? ", και κατέβα στο μετρό (σκάλες, ακυρωτικά)" : ""}`}</small></span>
              {:else if st.kind === "ride"}
                {@const md = legMode(st.leg)}
                <span class="si badge" style:background={st.color} style:color={st.text}>{st.label.length > 4 ? "" : st.label}{#if st.label.length > 4}<Icon name={md === "metro" ? "metro" : md === "tram" ? "tram" : "bus"} size={14} />{/if}</span>
                <span class="sx"><span class="s1"><b>Πάρε {MODE_WORD[md] ?? "το λεωφορείο"} {st.label}</b><span class="tm">{clockHM(st.at)}</span></span>
                  <small>{st.headsign ? `προς ${name(toward(st.headsign))} · ` : ""}από {name(st.from)} · κατέβα {st.hops ? `σε ${st.hops} ${st.hops === 1 ? "στάση" : "στάσεις"}, ` : "στη στάση "}{name(st.to)}</small></span>
              {:else}
                <span class="si end"><Icon name="pin" size={14} /></span>
                <span class="sx"><span class="s1"><b>Έφτασες</b><span class="tm">{clockHM(st.at)}</span></span><small>Ο προορισμός σου</small></span>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
</div>

<style>
  .rc { border-radius: 18px; border: 1px solid var(--pc-edge, var(--card-border, transparent)); background: var(--pc-surf, var(--card)); overflow: hidden; transition: border-color .2s; }
  .rc.open, .rc.sel { border-color: color-mix(in srgb, var(--pc-acc, var(--accent)) 55%, transparent); }
  .rh { width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 10px; padding: 12px 14px; border: 0; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .r1 { height: 20px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .lvw { min-width: 0; display: flex; align-items: center; gap: 8px; }
  .lv { font-size: 17px; font-weight: 700; line-height: 1; white-space: nowrap; }
  .lv.now { color: var(--ontime); }
  .tag { min-width: 0; height: 20px; display: flex; align-items: center; padding: 0 7px; border-radius: 6px; box-sizing: border-box;
    background: color-mix(in srgb, var(--pc-acc, var(--accent)) 20%, transparent); color: color-mix(in srgb, var(--pc-acc, var(--accent)) 60%, var(--fg));
    font-size: 12px; font-weight: 600; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .du { flex: none; font-size: 15px; font-weight: 600; line-height: 1; white-space: nowrap; }
  .r2 { min-height: 24px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .legs { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
  .leg { height: 24px; display: inline-flex; align-items: center; gap: 3px; padding: 0 7px; border-radius: 7px; box-sizing: border-box;
    background: var(--lb, #1f5fc8); color: var(--lt, #fff); font-size: 13px; font-weight: 700; line-height: 1; }
  .leg.lg { gap: 4px; padding-left: 4px; }
  .leg.walk { background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--muted); }
  .lwi { display: flex; }
  .lgo { flex: none; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
  .lgo img { display: block; width: 16px; height: 16px; }
  .lgo.m-bus, .lgo.m-trolley { background: #fff; }
  .lgo.m-bus img, .lgo.m-trolley img { width: 10px; height: 10px; }
  .lgo.m-tram img { width: 12px; height: 16px; object-fit: contain; }
  .eta1 { margin-left: 3px; display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 700; color: var(--ontime); line-height: 1; white-space: nowrap; }
  .tms { flex: none; font-size: 13px; color: var(--muted); line-height: 1; white-space: nowrap; }

  .body { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px 14px; border-top: 1px solid var(--pc-edge, var(--card-border, transparent)); }
  .where { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 16px; font-size: 14px; line-height: 1; }
  .wt { min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--muted); }
  .wt b { color: var(--fg); font-weight: 600; }
  .ws { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ontime); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ontime) 20%, transparent); }
  .clk { display: flex; color: var(--muted); }
  .eta { flex: none; font-weight: 700; color: var(--muted); }
  .eta.on { color: var(--ontime); }
  .track { position: relative; display: block; height: 28px; margin: -2px 9px 0 14px; }
  .track i { position: absolute; display: block; }
  .base { left: 0; right: 0; top: 13px; height: 2px; border-radius: 1px; background: color-mix(in srgb, var(--fg) 14%, transparent); }
  .track.sched .base { background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--fg) 26%, transparent) 0 6px, transparent 6px 11px); }
  .run { right: 0; top: 13px; height: 2px; border-radius: 1px; }
  .st { top: 11px; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: color-mix(in srgb, var(--fg) 30%, transparent); }
  .me { right: -9px; top: 5px; width: 18px; height: 18px; border-radius: 50%; border: 3px solid var(--fg); background: var(--pc-surf, var(--card)); box-sizing: border-box; }
  .veh { position: absolute; top: 0; width: 28px; height: 28px; margin-left: -14px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 0 3px var(--pc-surf, var(--card)); transition: left .6s ease; }
  .veh.ghost { background: var(--pc-surf, var(--card)); border: 2px dashed; box-sizing: border-box; box-shadow: none; }
  .facts { display: flex; gap: 6px; }
  .fact { flex: 1; min-width: 0; height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border-radius: 12px;
    background: color-mix(in srgb, var(--fg) 6%, transparent); }
  .fact b { font-size: 15px; font-weight: 700; line-height: 1; }
  .fact small { font-size: 12px; color: var(--muted); line-height: 1; }
  .bacts { display: flex; gap: 8px; }
  .stepsb { flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border: 0; border-radius: 12px;
    background: color-mix(in srgb, var(--fg) 9%, transparent); color: var(--fg); font: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer; }
  .mapb { flex: none; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 12px;
    background: color-mix(in srgb, var(--fg) 9%, transparent); color: var(--fg); cursor: pointer; }
  .stepsb:hover, .mapb:hover { background: color-mix(in srgb, var(--fg) 14%, transparent); }
  .chev { display: flex; transition: transform .2s; }
  .chev.up { transform: rotate(180deg); }

  /* The steps on one line: dotted while walking, the line's colour while riding. */
  .steps { list-style: none; margin: 2px 0 0; padding: 0; }
  .steps li { position: relative; display: flex; gap: 12px; padding-bottom: 14px; }
  .steps li:last-child { padding-bottom: 0; }
  .steps li:not(:last-child)::before { content: ""; position: absolute; left: 13px; top: 31px; bottom: 3px; border-left: 2px dotted color-mix(in srgb, var(--fg) 28%, transparent); }
  .steps li.ride::before { border-left-style: solid; border-left-color: var(--lc, var(--pc-acc, var(--accent))); }
  .si { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--muted); font-size: 11px; font-weight: 800; line-height: 1; }
  .si.here, .si.end { background: color-mix(in srgb, var(--pc-acc, var(--accent)) 22%, transparent); color: color-mix(in srgb, var(--pc-acc, var(--accent)) 60%, var(--fg)); }
  .sx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
  .s1 { min-height: 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .s1 b { font-size: 15px; font-weight: 600; line-height: 1.1; }
  .tm { flex: none; font-size: 13px; font-weight: 700; color: var(--muted); line-height: 1; }
  .sx small { font-size: 13px; color: var(--muted); line-height: 1.3; }
  @media (prefers-reduced-motion: reduce) { .veh, .chev { transition: none; } }
</style>
