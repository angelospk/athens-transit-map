<script lang="ts">
  // A change between two rides (mockup 47 A, B): the station from the side when either ride is under the street (the
  // street on top, each metro line at its level, the walk between, down or up), what to do in a few steps, and the
  // time to spare said so it means something. Two buses: the walk along the street instead.
  import { RISK_MIN, type PlanStep } from "../plan";
  import { changeMargin, changeWords, levelM, transferLook } from "../transfer";
  import { titleCase } from "../nearby";
  import { placeNote, toward } from "../stops";
  import { clockHM } from "../trains";
  import Icon from "./Icon.svelte";

  let { st, compact = false }: { st: Extract<PlanStep, { kind: "change" }>; compact?: boolean } = $props();

  const name = (s: string) => titleCase(placeNote(s).place) || s;
  const look = $derived(transferLook(levelM(st.prev.mode, st.prev.label, st.where, st.prev.line, st.stop), levelM(st.mode, st.label, st.to, st.line, st.next || st.stop)));
  const towardName = $derived(st.headsign ? name(toward(st.headsign)) : "");
  const words = $derived(changeWords({ stop: name(st.stop), next: st.next ? name(st.next) : "", toward: towardName, m: st.m, min: st.min,
    prev: st.prev, label: st.label, mode: st.mode }, look));
  const WHAT: Record<string, string> = { bus: "Το λεωφορείο", trolley: "Το τρόλεϊ", metro: "Το τρένο", tram: "Το τραμ", suburban: "Ο Προαστιακός" };
  const margin = $derived(changeMargin(st.spare, RISK_MIN, st.missed, { what: WHAT[st.mode] ?? "Το λεωφορείο", at: clockHM(st.leaves),
    rail: ["metro", "tram", "suburban", "rail"].includes(st.mode) }, clockHM));

  // The side view, left to right: where the rider gets off, the walk, where they get on. The street on top; each metro
  // platform as deep as its station is, the deeper one at the bottom (published depths where there are some,
  // transfer.ts). No words in it and no metres: the steps under it say what to do.
  const STREET = 22, BOTTOM = 128;
  const yOf = (d: number, max: number) => (d <= 0 ? STREET : 46 + (d / max) * (BOTTOM - 46));
  const yy = $derived.by(() => {
    const max = Math.max(look.from, look.to, 1);
    let a = yOf(look.from, max), b = yOf(look.to, max);
    // Two platforms close in depth: still far enough apart to see which is lower.
    if (look.from > 0 && look.to > 0 && look.way !== "level" && Math.abs(a - b) < 28) { if (a < b) a = b - 28; else b = a - 28; }
    return [a, b];
  });
  const ya = $derived(yy[0]), yb = $derived(yy[1]);
  const short = (l: string) => (l.length > 4 ? l.slice(0, 4) : l);
  const path = $derived(look.from > 0 && look.to > 0 ? `M136 ${ya} L182 ${yb}` : look.to > 0 ? `M50 ${STREET} H118 L182 ${yb}` : `M136 ${ya} L200 ${STREET} H266`);
</script>

<section class="xb" class:compact aria-label="Η αλλαγή">
  {#if !compact}
    <span class="xtop"><span class="xt"><span class="xi"><Icon name="swap" size={15} /></span>Αλλαγή · {name(st.stop)}</span>
      {#if st.min}<span class="xw"><Icon name="walk" size={13} />{st.min}′</span>{/if}</span>
  {/if}

  {#if look.under}
    <svg class="side" viewBox="0 0 320 150" role="img" aria-label={look.way === "down" ? "Κατεβαίνεις" : look.way === "up" ? "Ανεβαίνεις" : "Ίδιο επίπεδο"}>
      <rect class="earth" x="0" y="25" width="320" height="125" rx="12"></rect>
      <rect class="ground" x="0" y={STREET - 3} width="320" height="6" rx="3"></rect>
      {#if look.from > 0 && look.to > 0}<text class="t mute" x="308" y="12">δρόμος</text>{/if}
      {#if look.from > 0}
        <rect x="44" y={ya - 5} width="92" height="10" rx="5" style:fill="color-mix(in srgb, {st.prev.color} 80%, #fff)"></rect>
        <g transform="translate(24 {ya})"><circle r="13" fill={st.prev.color} stroke="#fff" stroke-width="2"></circle><text class="bd" y="3.5">{short(st.prev.label)}</text></g>
      {:else}
        <g transform="translate(8 {STREET - 11})"><rect width="42" height="22" rx="6" fill={st.prev.color}></rect><text class="bd" x="21" y="15">{short(st.prev.label)}</text></g>
      {/if}
      {#if look.to > 0}
        <rect x="182" y={yb - 5} width="92" height="10" rx="5" style:fill="color-mix(in srgb, {st.color} 80%, #fff)"></rect>
        <g transform="translate(296 {yb})"><circle r="13" fill={st.color} stroke="#fff" stroke-width="2"></circle><text class="bd" y="3.5">{short(st.label)}</text></g>
      {:else}
        <g transform="translate(270 {STREET - 11})"><rect width="42" height="22" rx="6" fill={st.color}></rect><text class="bd" x="21" y="15">{short(st.label)}</text></g>
      {/if}
      <path class="walk" d={path} marker-end="url(#xarrow)"></path>
      {#if look.from > 0}<circle class="me" cx="136" cy={ya} r="6"></circle>{/if}
      <defs><marker id="xarrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1l8 4-8 4z" class="arrow"></path></marker></defs>
    </svg>
  {:else}
    <svg class="flat" viewBox="0 0 300 70" role="img" aria-label={st.m >= 20 ? `${st.m} μέτρα με τα πόδια` : "Ίδια στάση"}>
      <rect width="300" height="70" rx="10" class="fbg"></rect>
      <path d="M0 46 H300" class="road"></path>
      {#if st.m >= 20}<path d="M40 46 C90 46 110 22 170 22 L248 22" class="fwalk"></path>{/if}
      <g transform={st.m >= 20 ? "translate(40 46)" : "translate(120 46)"}><circle r="12" fill={st.prev.color} stroke="#fff" stroke-width="2"></circle><text class="bd" y="4">{short(st.prev.label)}</text></g>
      <g transform={st.m >= 20 ? "translate(260 22)" : "translate(180 46)"}><circle r="12" fill={st.color} stroke="#fff" stroke-width="2"></circle><text class="bd" y="4">{short(st.label)}</text></g>
    </svg>
  {/if}

  <ol class="xsteps">
    {#each words as w, k (k)}<li><b>{k + 1}</b><span>{w.t}{#if w.b}<strong>{w.b}</strong>{/if}{w.after ?? ""}</span></li>{/each}
  </ol>

  <div class="mg {margin.tone}">
    <i></i><span><b>{margin.big}</b>{#if margin.small}<small>{margin.small}</small>{/if}</span>
  </div>
</section>

<style>
  .xb { display: flex; flex-direction: column; gap: 14px; padding: 14px; border-radius: 18px; background: var(--card); border: 1px solid var(--card-border); }
  .xb.compact { padding: 12px; gap: 12px; }
  .xtop { min-height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .xt { min-width: 0; display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 800; line-height: 1.2; }
  .xi { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
  .xw { flex: none; height: 26px; display: flex; align-items: center; gap: 4px; padding: 0 9px; border-radius: 13px; background: var(--control);
    color: var(--fg); font-size: 12.5px; font-weight: 600; line-height: 1; }
  .side { display: block; width: 100%; height: auto; }
  .earth { fill: color-mix(in srgb, var(--fg) 5%, transparent); }
  .ground { fill: color-mix(in srgb, var(--fg) 22%, transparent); }
  .t { font: 600 11px/1 var(--font, Commissioner, system-ui, sans-serif); }
  .t.mute { fill: var(--muted); text-anchor: end; }
  .bd { fill: #fff; font: 800 10px/1 var(--font, Commissioner, system-ui, sans-serif); text-anchor: middle; }
  .walk { fill: none; stroke: var(--fg); stroke-width: 2.4; stroke-dasharray: 1 6; stroke-linecap: round; }
  .arrow { fill: var(--fg); }
  .me { fill: var(--accent); stroke: #fff; stroke-width: 2.5; }
  .flat { display: block; width: 100%; height: 70px; }
  .fbg { fill: var(--surface); }
  .road { stroke: var(--border); stroke-width: 12; fill: none; }
  .fwalk { stroke: var(--accent); stroke-width: 3; stroke-dasharray: 2 6; stroke-linecap: round; fill: none; }
  .xsteps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 14px; line-height: 1.4; }
  .xsteps li { display: flex; align-items: flex-start; gap: 10px; }
  .xsteps li > b { flex: none; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
    background: var(--control); font-size: 12px; font-weight: 700; line-height: 1; }
  .xsteps li > span { padding-top: 2px; }
  .xsteps strong { font-weight: 800; }
  .mg { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; border-radius: 14px; background: var(--control); }
  .mg i { flex: none; width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: var(--muted); }
  .mg > span { display: flex; flex-direction: column; gap: 4px; }
  .mg b { font-size: 14px; line-height: 1.25; }
  .mg small { font-size: 13px; line-height: 1.35; color: var(--muted); }
  .mg.tight { background: var(--bad-bg, color-mix(in srgb, #e5484d 16%, transparent)); }
  .mg.tight b { color: var(--late3, #ff8a8a); }
  .mg.tight i { background: var(--late3, #ff8a8a); }
  .mg.ok { background: color-mix(in srgb, var(--ontime) 14%, transparent); }
  .mg.ok i { background: var(--ontime); }
  .mg.ok b { color: var(--ontime); }
</style>
