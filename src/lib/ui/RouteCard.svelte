<script lang="ts">
  // One route of «Πού πας;», compact (mockup 39): when to leave, how long, the means, and where its first bus is now on
  // a thin line (the stops before yours, the bus, your stop); the metro and the tram, which have no live positions,
  // dashed with the timetable's time. A tap opens it in place, step by step in words.
  import { untrack } from "svelte";
  import { guideFromPlan, type GuideRide } from "../guide";
  import { busNow, isLiveMode, type BusNow } from "../liveRide";
  import { planSteps, RISK_MIN, type Itinerary, type PlanResponse, type ScaledLeg } from "../plan";
  import type { TripIndex } from "../trip";
  import { titleCase } from "../nearby";
  import { placeNote, toward } from "../stops";
  import { clockHM } from "../trains";
  import { durText } from "../format";
  import Icon from "./Icon.svelte";
  import TransferBox from "./TransferBox.svelte";
  import LineChip from "./LineChip.svelte";
  import type { CityId } from "../cities";
  import { changeLine, levelM, transferLook } from "../transfer";

  let { it, r, ix, legs, nowS, tag = "", open = false, sel = false, live = false, clock = false, target = null, others = [], logos = false, row = false, soon = false, stale = "", city = "athens", steps: stepsFirst = false, onleave, onpick, onmap }: {
    it: Itinerary; r: PlanResponse; ix: TripIndex | null; legs: ScaledLeg[]; nowS: number; tag?: string; open?: boolean; sel?: boolean;
    live?: boolean; others?: Itinerary[]; logos?: boolean; onpick: () => void; onmap?: () => void;
    // Not now (mockup 46): the time to leave on the clock; arriving by a time, how much before it (or after).
    clock?: boolean; target?: { at: number; margin: number; tone: "ok" | "tight" | "late" } | null;
    // A row of the phone's one list (mockup 14) instead of a card of its own: green «Φύγε» when it is the soonest
    // (soon), and a third line only for its live bus or a timetable known to be old (stale: what to say).
    row?: boolean; soon?: boolean; stale?: string; city?: CityId;
    // Opened with its steps (the picked route's sheet on the map, compact mockup 17β).
    steps?: boolean;
    // When to leave, in minutes from now (its live bus counted): handed back for «Ξεκίνα».
    onleave?: (min: number) => void;
  } = $props();

  // Mockup 44: closed, two lines; a tap opens where its bus is and three figures; «Βήματα» opens the steps.
  let stepsOpen = $state(untrack(() => stepsFirst));
  $effect(() => { if (!open) stepsOpen = false; });
  // A change in the steps opens to the station seen from the side (mockup 47 Γ → A).
  let xOpen = $state<number | null>(null);
  $effect(() => { if (!stepsOpen) xOpen = null; });
  // The little side view's levels: the street at the top, a platform lower the deeper its station.
  const gy = (d: number) => (d <= 0 ? 8 : Math.min(29, 14 + d * 0.45));
  // The operators' marks on the line chips (Athens: ΟΑΣΑ for buses and trolleys, the metro's and the tram's own).
  const LOGO: Record<string, string> = { bus: "icons/oasa.png", trolley: "icons/oasa.png", metro: "icons/metro-logo.svg", tram: "icons/tram-logo.svg" };
  const logoOf = (m: string) => (logos && LOGO[m] ? `${import.meta.env.BASE_URL}${LOGO[m]}` : "");
  const tagShort = $derived(tag.replace(/^Η\s+/, "").replace(/\s+τώρα$/, ""));

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
  const leaveShort = $derived(clock ? `Φύγε ${clockHM(it.depart_at)}` : leaveIn === 0 ? "Φύγε τώρα" : leaveIn < 60 ? `Φύγε σε ${leaveIn}′` : `Φύγε στις ${clockHM(nowS + leaveIn * 60)}`);
  const targetText = $derived(!target ? "" : target.tone === "late" ? `Φτάνεις ${-target.margin}′ μετά τις ${clockHM(target.at)}`
    : `${target.tone === "tight" ? "Σφιχτό: " : ""}${target.margin}′ πριν τις ${clockHM(target.at)}`);
  $effect(() => { onleave?.(leaveIn); });
  const leaveRow = $derived(clock || leaveIn >= 60 ? `Φύγε ${clockHM(clock ? it.depart_at : nowS + leaveIn * 60)}` : leaveIn === 0 ? "Φύγε τώρα" : `Φύγε σε ${leaveIn}′`);
  const busMin = $derived(bus ? Math.max(0, Math.round((bus.at - nowS) / 60)) : null);

  // The line: dots for the stops before yours, the bus among them, yours at the right end.
  const n = $derived(bus?.before ?? 0);
  const busPos = $derived(bus?.away != null && n ? Math.max(0, Math.min(100, ((n - Math.min(bus.away, n)) / n) * 100)) : 0);
  const busWhere = $derived(!bus ? "" : !bus.live ? "κατά πρόγραμμα, χωρίς ζωντανή θέση" : bus.away === 0 ? "είναι στη στάση σου"
    : bus.away === 1 ? "1 στάση πριν από τη δική σου" : bus.away != null ? `${bus.away} στάσεις πριν από τη δική σου`
    : n ? `πιο μακριά από ${n} στάσεις` : "ζωντανά");

  const steps = $derived(open && stepsOpen ? planSteps(it, r, others) : []);
  // Opened, before «Βήματα» (compact mockup 17): only where you get on, each change, and where you get off.
  const summary = $derived.by(() => {
    if (!open) return [];
    const all = planSteps(it, r, others), out: { kind: "on" | "change" | "off"; name: string; sub: string; at: number; color: string }[] = [];
    const rides = all.filter(s => s.kind === "ride");
    const first = rides[0], last = rides.at(-1);
    if (!first || !last || first.kind !== "ride" || last.kind !== "ride") return [];
    const w0 = all[0]?.kind === "walk" ? all[0] : null, wEnd = [...all].reverse().find(s => s.kind === "walk" || s.kind === "ride");
    out.push({ kind: "on", name: name(first.from), sub: `Ανέβα στο ${first.label}${w0 ? ` · ${w0.min}′ με τα πόδια${w0.m ? ` · ${w0.m >= 1000 ? (w0.m / 1000).toFixed(1).replace(".", ",") + " χλμ" : Math.round(w0.m / 10) * 10 + " μ"}` : ""}` : ""}`, at: first.at, color: first.color });
    for (const s of all) if (s.kind === "change") out.push({ kind: "change", name: name(s.stop), sub: `Αλλαγή στο ${s.label}${s.min ? ` · ${s.min}′ με τα πόδια` : ""}`, at: s.leaves, color: s.color });
    const hops = last.hops, walkAfter = wEnd?.kind === "walk" ? wEnd.min : 0;
    out.push({ kind: "off", name: name(last.to), sub: `${hops ? `${hops} ${hops === 1 ? "στάση" : "στάσεις"}` : "Κατέβα"}${walkAfter ? ` · μετά ${walkAfter}′ με τα πόδια` : ""}`, at: it.legs[last.leg]?.arrive_at ?? last.at, color: last.color });
    return out;
  });
  // The live bus against the walk to its stop: whether it is caught, and with how much to spare.
  const walkTo0 = $derived(Math.round(walkS / 60));
  const verdict = $derived.by<{ tone: "ok" | "tight"; text: string } | null>(() => {
    if (!bus?.live || busMin == null) return null;
    if (leaveIn > 0) return { tone: "ok", text: `Φύγε σε ${leaveIn}′: είσαι στη στάση ${clockHM(nowS + (leaveIn + walkTo0) * 60)}, πριν έρθει` };
    const spare = busMin - walkTo0;
    return spare >= 0 ? { tone: "ok", text: `Είσαι στη στάση σε ${walkTo0}′ · ${spare}′ περιθώριο` } : { tone: "tight", text: `Φτάνεις στη στάση σε ${walkTo0}′: μάλλον δεν το προλαβαίνεις` };
  });
  const etaText = $derived(!bus ? "" : busMin! < 60 ? (busMin === 0 ? "τώρα" : `σε ${busMin}′`) : clockHM(bus.at));
  const name = (s: string) => titleCase(placeNote(s).place) || s;
  const MODE_WORD: Record<string, string> = { bus: "το λεωφορείο", trolley: "το τρόλεϊ", metro: "το μετρό", tram: "το τραμ", suburban: "τον Προαστιακό" };
  const legMode = (k: number) => it.legs[k]?.mode ?? r.lines[it.legs[k]?.line ?? ""]?.mode ?? "bus";
</script>

<div class="rc" class:row class:open class:sel>
  <button type="button" class="rh" aria-expanded={open} onclick={onpick}>
  {#if row}
    <span class="q1">
      <b class="lv" class:now={soon}>{leaveRow}</b>{#if tag}<span class="tag">{tagShort}</span>{/if}
      <span class="qdu">{#if stale}<i class="olddot" title={stale} aria-label={stale}></i>{/if}{durText(Math.round(it.duration_s / 60))}</span>
    </span>
    <span class="q2">
      <span class="qlegs">
        {#each legs as l, j (j)}
          {#if j}<svg class="qsep" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>{/if}
          {#if l.walk}<span class="qw" aria-label="Πόδια {l.min}′"><Icon name="walk" size={12} />{l.min}</span>
          {:else}<LineChip label={l.label} bg={l.color || "#1f5fc8"} fg={l.text || "#fff"} mode={l.mode} {city} />{/if}
        {/each}
      </span>
      <span class="tms">{clockHM(it.depart_at)} → {clockHM(it.arrive_at)}</span>
    </span>
    {#if target}<span class="r3 {target.tone}"><i></i>{targetText}</span>
    {:else if bus?.live && !open}<span class="q3"><i></i>{rideLabel} ζωντανά · {busMin === 0 ? "στη στάση τώρα" : busMin! < 60 ? `στη στάση σε ${busMin}′` : `στη στάση ${clockHM(bus.at)}`}</span>
    {/if}
  {:else}
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
    {#if target}<span class="r3 {target.tone}"><i></i>{targetText}</span>{/if}
  {/if}
  </button>

  {#if open}
    <div class="body">
      {#if rideLeg && (bus || (!isLiveMode(mode) && live))}
      <div class="lbox">
        <span class="where">
          <span class="wt">
            {#if bus?.live}<i class="dot"></i>{:else}<span class="clk"><Icon name="clock" size={12} /></span>{/if}
            {#if bus?.live}<b>Το {rideLabel} {busMin === 0 ? "είναι στη στάση" : busMin! < 60 ? `έρχεται σε ${busMin}′` : `έρχεται ${clockHM(bus.at)}`}</b>
            {:else}<b>{rideLabel}</b><span class="ws">· {bus ? busWhere : "κατά πρόγραμμα, χωρίς ζωντανή θέση"}</span>{/if}
          </span>
          <span class="eta">{bus?.live ? (bus.away === 0 ? "" : bus.away === 1 ? "1 στάση πριν" : bus.away != null ? `${bus.away} στάσεις πριν` : "") : bus ? (busMin! < 60 ? (busMin === 0 ? "τώρα" : `${busMin}′`) : clockHM(bus.at)) : clockHM(rideLeg.depart_at)}</span>
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
        {#if verdict}<span class="verd {verdict.tone}">{#if verdict.tone === "ok"}<Icon name="check" size={13} />{:else}<Icon name="warn" size={13} />{/if}<span>{verdict.text}</span></span>{/if}
      </div>
      {/if}
      {#if !stepsOpen && summary.length}
        <div class="sum">
          {#each summary as s, k (k)}
            <span class="srw">
              <span class="sic {s.kind}" style:--lc={s.color}>{#if s.kind === "change"}<Icon name="swap" size={14} />{:else}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{#if s.kind === "on"}<path d="M12 19V5M6 11l6-6 6 6" />{:else}<path d="M12 5v14M6 13l6 6 6-6" />{/if}</svg>{/if}</span>
              <span class="stx"><b>{s.name}</b><small>{s.sub}</small></span>
              <span class="stm">{clockHM(s.at)}</span>
            </span>
          {/each}
        </div>
      {/if}
      {#if !stepsOpen}
      <div class="bacts">
        <button type="button" class="stepsb" aria-expanded={stepsOpen} onclick={() => (stepsOpen = !stepsOpen)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></svg><span>Βήματα</span><span class="chev" class:up={stepsOpen}><Icon name="chevron" size={15} /></span></button>
        {#if onmap}<button type="button" class="mapb" aria-label="Δες τη στον χάρτη" title="Δες τη στον χάρτη" onclick={onmap}><Icon name="map" size={17} /><span>Χάρτης</span></button>{/if}
      </div>
      {/if}

      {#if stepsOpen}
        <ol class="steps">
          <li>
            <span class="tc">{clockHM(it.depart_at)}</span>
            <span class="si here"><Icon name="locate" size={14} /></span>
            <span class="sx"><span class="s1"><b>Ξεκίνα</b></span><small>{leaveText}</small></span>
          </li>
          {#each steps as st, k (k)}
            <li class:ride={st.kind === "ride"} style:--lc={st.kind === "ride" ? st.color : undefined}>
              <span class="tc">{st.kind === "walk" ? "" : clockHM(st.kind === "change" ? st.leaves : st.at)}</span>
              {#if st.kind === "walk"}
                <span class="si"><Icon name="walk" size={14} /></span>
                <span class="sx"><span class="s1"><b>Περπάτα {mins(st.min)}</b></span><small>ως {st.to === "στον προορισμό" ? "τον προορισμό" : `${stationAfter(k) ? "τον σταθμό" : "τη στάση"}${st.to === "στη στάση" ? "" : ` ${name(st.to)}`}`}{stationAfter(k) ? ", και κατέβα στο μετρό" : ""}</small></span>
              {:else if st.kind === "change"}
                {@const lk = transferLook(levelM(st.prev.mode, st.prev.label, st.where, st.prev.line, st.stop), levelM(st.mode, st.label, st.to, st.line, st.next || st.stop))}
                {@const tone = st.spare < RISK_MIN ? "tight" : st.spare >= 3 ? "ok" : "mid"}
                <span class="si"><Icon name="swap" size={14} /></span>
                <span class="sx xc">
                  <button type="button" class="xrow" aria-expanded={xOpen === k} onclick={() => (xOpen = xOpen === k ? null : k)}>
                    <svg class="glyph" viewBox="0 0 44 36" aria-hidden="true">
                      <rect width="44" height="36" rx="10" class="gbg"></rect>
                      <rect x="5" y={gy(lk.from) - 2} width="16" height="4" rx="2" fill={st.prev.color}></rect>
                      <rect x="23" y={gy(lk.to) - 2} width="16" height="4" rx="2" fill={st.color}></rect>
                      <path d="M19 {gy(lk.from)} L26 {gy(lk.to)}" class="gw"></path>
                    </svg>
                    <span class="xtx"><b>Αλλαγή · {name(st.stop)}</b><small>{changeLine(lk, st.label, st.mode, st.min, st.m)}</small></span>
                    <span class="xsp {tone}">{tone === "tight" ? "σφιχτό" : tone === "ok" ? "άνετα" : `${st.spare}′`}</span>
                    <span class="chev" class:up={xOpen === k} aria-hidden="true"><Icon name="chevron" size={15} /></span>
                  </button>
                  {#if xOpen === k}<TransferBox {st} compact />{/if}
                </span>
              {:else if st.kind === "ride"}
                {@const md = legMode(st.leg)}
                <span class="si badge" style:background={st.color} style:color={st.text}>{st.label.length > 4 ? "" : st.label}{#if st.label.length > 4}<Icon name={md === "metro" ? "metro" : md === "tram" ? "tram" : "bus"} size={14} />{/if}</span>
                <span class="sx"><span class="s1"><b>Πάρε {MODE_WORD[md] ?? "το λεωφορείο"} {st.label}</b></span>
                  <small>{st.headsign ? `προς ${name(toward(st.headsign))} · ` : ""}από {name(st.from)} · κατέβα {st.hops ? `σε ${st.hops} ${st.hops === 1 ? "στάση" : "στάσεις"}, ` : "στη στάση "}{name(st.to)}</small></span>
              {:else}
                <span class="si end"><Icon name="pin" size={14} /></span>
                <span class="sx"><span class="s1"><b>Έφτασες</b></span><small>Ο προορισμός σου</small></span>
              {/if}
            </li>
          {/each}
        </ol>
        <div class="bacts">
        <button type="button" class="stepsb" aria-expanded={stepsOpen} onclick={() => (stepsOpen = !stepsOpen)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></svg><span>Βήματα</span><span class="chev" class:up={stepsOpen}><Icon name="chevron" size={15} /></span></button>
        {#if onmap}<button type="button" class="mapb" aria-label="Δες τη στον χάρτη" title="Δες τη στον χάρτη" onclick={onmap}><Icon name="map" size={17} /><span>Χάρτης</span></button>{/if}
        </div>
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
  .bacts { display: flex; gap: 8px; }
  .stepsb { flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px; border: 0; border-radius: 14px;
    background: color-mix(in srgb, var(--bg) 45%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 11%, transparent); color: var(--fg); font: inherit; font-size: 14.5px; font-weight: 800; line-height: 1; cursor: pointer; }
  .stepsb .chev { color: var(--muted); }
  .mapb { flex: none; height: 44px; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 16px; border: 0; border-radius: 14px;
    background: color-mix(in srgb, var(--bg) 45%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 11%, transparent); color: var(--fg); font: inherit; font-size: 14.5px; font-weight: 700; line-height: 1; cursor: pointer; }
  /* The live bus in a panel of its own (compact mockup 17): what it does, the line to your stop, whether it is caught. */
  .lbox { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 14px;
    background: color-mix(in srgb, var(--accent) 7%, color-mix(in srgb, var(--bg) 50%, transparent)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent); }
  .lbox .where { height: 16px; }
  .lbox .wt b { font-weight: 800; }
  .lbox .eta { font-size: 12.5px; font-weight: 700; }
  .lbox .track { margin: 0 9px 0 14px; }
  .verd { min-height: 14px; display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; line-height: 1.2; color: var(--ontime); }
  .verd :global(svg) { flex: none; }
  .verd.tight { color: var(--late1, #f0ae45); }
  /* Where you get on, change and get off (compact mockup 17): a row each, its time on the right. */
  .sum { display: flex; flex-direction: column; padding: 2px 10px; border-radius: 14px; background: color-mix(in srgb, var(--bg) 40%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 9%, transparent); }
  .srw { min-height: 50px; display: flex; align-items: center; gap: 12px; }
  .srw + .srw { border-top: 1px solid color-mix(in srgb, var(--fg) 9%, transparent); }
  .sic { flex: none; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .sic.on { background: var(--lc, var(--accent)); color: #fff; }
  .sic.off, .sic.change { background: color-mix(in srgb, var(--fg) 9%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 12%, transparent); color: var(--fg); }
  .stx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
  .stx b { font-size: 14.5px; font-weight: 800; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stx small { font-size: 12px; font-weight: 600; line-height: 1.2; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stm { flex: none; font-size: 13px; font-weight: 700; line-height: 1; color: color-mix(in srgb, var(--fg) 85%, var(--muted)); font-variant-numeric: tabular-nums; }
  @media (hover: hover) { .stepsb:hover, .mapb:hover { background: color-mix(in srgb, var(--fg) 14%, transparent); } }
  .chev { display: flex; transition: transform .2s; }
  .chev.up { transform: rotate(180deg); }

  /* The steps on one line: dotted while walking, the line's colour while riding. */
  .steps { list-style: none; margin: 2px 0 0; padding: 0; }
  .steps li { position: relative; display: flex; gap: 12px; padding-bottom: 14px; }
  .steps li:last-child { padding-bottom: 0; }
  .tc { flex: none; width: 38px; padding-top: 8px; font-size: 12.5px; font-weight: 700; line-height: 1; color: color-mix(in srgb, var(--fg) 80%, var(--muted)); font-variant-numeric: tabular-nums; }
  .steps li { gap: 10px; }
  .steps li:not(:last-child)::before { content: ""; position: absolute; left: 61px; top: 31px; bottom: 3px; border-left: 2px dotted color-mix(in srgb, var(--fg) 28%, transparent); }
  .steps li.ride::before { border-left-style: solid; border-left-color: var(--lc, var(--pc-acc, var(--accent))); }
  .si { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--muted); font-size: 11px; font-weight: 800; line-height: 1; }
  .si.here, .si.end { background: color-mix(in srgb, var(--pc-acc, var(--accent)) 22%, transparent); color: color-mix(in srgb, var(--pc-acc, var(--accent)) 60%, var(--fg)); }
  .sx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
  .s1 { min-height: 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .s1 b { font-size: 15px; font-weight: 600; line-height: 1.1; }
  .tm { flex: none; font-size: 13px; font-weight: 700; color: var(--muted); line-height: 1; }
  .sx small { font-size: 13px; color: var(--muted); line-height: 1.3; }
  .r3 { height: 16px; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; line-height: 1; color: var(--ontime); }
  .r3 i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .r3.tight { color: var(--late1, #f0ae45); }
  .r3.late { color: var(--late3, #ff8a8a); }
  .sx.xc { padding-top: 0; gap: 10px; }
  .xrow { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 14px; border: 1px dashed color-mix(in srgb, var(--fg) 22%, transparent);
    background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .xrow:hover { background: color-mix(in srgb, var(--fg) 5%, transparent); }
  .glyph { flex: none; width: 44px; height: 36px; display: block; }
  .gbg { fill: var(--control); }
  .gw { stroke: var(--fg); stroke-width: 1.6; stroke-dasharray: 1 3; stroke-linecap: round; fill: none; }
  .xtx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .xtx b { font-size: 14.5px; font-weight: 700; line-height: 1.15; }
  .xtx small { font-size: 12.5px; color: var(--muted); line-height: 1.2; }
  .xsp { flex: none; font-size: 12.5px; font-weight: 700; line-height: 1; color: var(--muted); }
  .xsp.tight { color: var(--late3, #ff8a8a); }
  .xsp.ok { color: var(--ontime); }

  /* A row of the phone's one list (mockup 14): no card of its own; the list draws the thin line between rows. The
     picked one: a 2px ring in the accent over a tint. */
  .rc.row { position: relative; border: 0; border-radius: 14px; background: none; overflow: visible; }
  .rc.row:not(:last-child)::after { content: ""; position: absolute; left: 12px; right: 12px; bottom: 0; height: 1px; background: var(--pc-edge, var(--card-border)); }
  .rc.row.sel { background: color-mix(in srgb, var(--pc-acc, var(--accent)) 13%, transparent); box-shadow: inset 0 0 0 2px var(--pc-acc, var(--accent)); }
  .rc.row.sel::after { display: none; }
  .rc.row .rh { min-height: 72px; justify-content: center; gap: 9px; padding: 14px 11px 14px 12px; }
  .q1 { height: 18px; display: flex; align-items: center; gap: 8px; }
  .rc.row .lv { font-size: 16px; }
  .rc.row .tag { height: 20px; font-size: 11.5px; font-weight: 800; }
  .qdu { flex: none; margin-left: auto; font-size: 17px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .q2 { min-height: 24px; display: flex; align-items: center; gap: 6px; }
  .qlegs { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 3px; }
  .qlegs :global(.lc) { --h: 24px; gap: 4px; padding: 0 6px; font-size: 12.5px; }
  .qlegs :global(.lc.logo) { padding-left: 2px; }
  .qsep { flex: none; display: block; margin: 0 -2px; color: color-mix(in srgb, var(--fg) 32%, transparent); }
  .qw { flex: none; height: 24px; display: inline-flex; align-items: center; gap: 2px; padding: 0 5px 0 4px; border-radius: 7px; box-sizing: border-box;
    background: color-mix(in srgb, var(--fg) 9%, transparent); color: color-mix(in srgb, var(--fg) 70%, transparent); font-size: 12px; font-weight: 700; line-height: 1; }
  .qw :global(svg) { flex: none; display: block; }
  .rc.row .tms { margin-left: auto; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .q3 { min-height: 14px; display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; line-height: 1.15; color: var(--ontime); }
  .q3 i { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .q3.old { color: var(--late1, #f0ae45); }
  .rc.row .r3 { font-size: 12px; }
  .rc.row .body { margin: 0 2px; border-top: 1px solid var(--pc-edge, var(--card-border, transparent)); }
  @media (prefers-reduced-motion: reduce) { .veh, .chev { transition: none; } }
  .rc.row .qdu { display: flex; align-items: center; gap: 7px; }
  .olddot { width: 7px; height: 7px; border-radius: 50%; background: #ffb26b; display: block; flex: none; }
</style>
