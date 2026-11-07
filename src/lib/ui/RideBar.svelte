<script lang="ts">
  // The ride, small: while the user rides a bus with its card closed, a bar of pills at the bottom centre shows how it
  // goes (live or not, stops left and arrival, the buzz, the 3D follow) and leaves the map free. Tapping the pills opens
  // the bus's card again.
  import { busVehicleCard } from "../legacy";
  import { clockHM } from "../trains";
  import type { AppState } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import LoadIcon from "./LoadIcon.svelte";
  import { pop, rise } from "../anim";
  import { LOADS } from "../crowd";

  let { app }: { app: AppState } = $props();

  const r = $derived(app.ride);
  const top = $derived(app.stack.at(-1));
  const onCard = $derived(!!r && top?.kind === "vehicle" && top.id === `oasa:${r.vehicle}`);
  const shown = $derived(!!r && !onCard);

  const ahead = $derived(app.rideAhead);
  const dest = $derived(r?.stop && ahead ? ahead.findIndex(a => a.id === r.stop!.id && a.i === r.stop!.i) : -1);
  const left = $derived(dest >= 0 ? dest + 1 : null);
  const at = $derived(dest >= 0 && ahead ? ahead[dest].at : null);
  const v = $derived(r ? app.live[r.line]?.vehicles.find(x => x.id === r.vehicle) : undefined);
  const age = $derived(v ? app.serverNow / 1000 - v.position_at : null);
  const live = $derived(age != null && age <= 90);
  const c = $derived(r ? app.lineColor(r.line) : { bg: "", fg: "" });
  const key = $derived(r ? `${r.line}/${r.vehicle}` : "");

  const open = () => { if (r) app.push(busVehicleCard(r.line, r.vehicle)); };

  // How full the bus is, from the bar too: a small menu above it.
  let menu = $state(false);
  let wrap: HTMLElement | undefined = $state();
  const chosen = $derived(LOADS.find(o => o.value === r?.load));
</script>

<svelte:document onpointerdown={e => { if (menu && wrap && !wrap.contains(e.target as Node)) menu = false; }}
  onkeydown={e => { if (menu && e.key === "Escape") menu = false; }} />

{#if shown && r}
  <div class="ridebar" role="region" aria-label="Η διαδρομή σου" aria-live="polite" transition:rise={{ y: 20 }}>
    <button type="button" class="main" onclick={open} aria-label="Άνοιξε τη διαδρομή στο {r.line}">
      <span class="pill line" style:--lb={c.bg} style:--lf={c.fg}>{r.line}<i class="dot" class:off={!live}></i></span>
      {#if r.stop && left != null}
        <span class="pill" class:hot={left === 1}><Icon name="down" size={14} />{left === 1 ? "Κατεβαίνεις στην επόμενη" : `${left} στάσεις`}{#if at && left > 1}<small>· {clockHM(at)}</small>{/if}</span>
      {:else}
        <span class="pill quiet">{r.stop ? "Αναμονή θέσης…" : "Πού κατεβαίνεις;"}</span>
      {/if}
    </button>
    <div class="lwrap" bind:this={wrap}>
      <button type="button" class="round load {chosen?.value ?? ''}" aria-haspopup="menu" aria-expanded={menu}
        aria-label={chosen ? `Πόσο γεμάτο: ${chosen.label}` : "Πόσο γεμάτο είναι;"} onclick={() => (menu = !menu)}><LoadIcon level={chosen?.level ?? 0} size={11} /></button>
      {#if menu}
        <div class="lmenu" role="menu" aria-label="Πόσο γεμάτο είναι το λεωφορείο" transition:pop>
          {#each LOADS as o (o.value)}
            <button type="button" role="menuitemradio" aria-checked={r.load === o.value} class="litem {o.value}"
              onclick={() => { app.setRideLoad(o.value); menu = false; }}><LoadIcon level={o.level} size={13} /><span>{o.label}</span></button>
          {/each}
        </div>
      {/if}
    </div>
    <button type="button" class="round" class:on={app.rideBuzz} aria-pressed={app.rideBuzz} aria-label="Δόνηση μία στάση πριν"
      onclick={() => app.setRideBuzz(!app.rideBuzz)}><Icon name="vibrate" size={17} /></button>
    <button type="button" class="round" class:on={app.chase === key} aria-pressed={app.chase === key} aria-label="Ακολούθησε το λεωφορείο στον χάρτη"
      onclick={() => app.setChase(app.chase === key ? null : key)}><Icon name="cube" size={17} /></button>
  </div>
{/if}

<style>
  .ridebar { position: absolute; z-index: 8; left: 50%; bottom: 100px; transform: translateX(-50%); max-width: calc(100% - 24px);
    display: flex; align-items: center; gap: 6px; padding: 6px; box-sizing: border-box; border-radius: var(--sheet-r); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .main { min-width: 0; display: flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
  .pill { flex: none; height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border-radius: 18px;
    background: var(--card); color: var(--fg); font-size: 13px; font-weight: 700; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pill.quiet { color: var(--muted); font-weight: 600; }
  .pill small { font-size: 13px; font-weight: 600; color: var(--muted); }
  .pill.hot { background: color-mix(in srgb, var(--late1) 22%, var(--card)); color: var(--late1); }
  .pill.line { padding: 0 10px 0 12px; background: var(--lb); color: var(--lf); font-size: 14px; font-weight: 800; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ontime); box-shadow: 0 0 0 2px var(--lb), 0 0 0 4px color-mix(in srgb, var(--ontime) 35%, transparent); }
  .dot.off { background: var(--late3); box-shadow: 0 0 0 2px var(--lb); }
  .round { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: var(--card); color: var(--fg); cursor: pointer; }
  .round.on { background: var(--accent); color: var(--on-accent); }
  .lwrap { position: relative; flex: none; }
  .round.load.empty { background: color-mix(in srgb, var(--ontime) 20%, var(--card)); color: var(--ontime); }
  .round.load.some { background: color-mix(in srgb, var(--late1) 20%, var(--card)); color: var(--late1); }
  .round.load.full { background: color-mix(in srgb, var(--late3) 20%, var(--card)); color: var(--late3); }
  .lmenu { transform-origin: 50% 100%; position: absolute; bottom: calc(100% + 12px); left: 50%; transform: translateX(-50%); z-index: 2; min-width: 190px; padding: 6px;
    display: flex; flex-direction: column; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
  .litem { height: 44px; display: flex; align-items: center; gap: 12px; padding: 0 12px; border: 0; border-radius: 11px; background: none;
    color: var(--fg); font: inherit; font-size: 14px; font-weight: 600; line-height: 1; text-align: left; cursor: pointer; }
  .litem:hover { background: var(--control); }
  .litem.empty { --t: var(--ontime); } .litem.some { --t: var(--late1); } .litem.full { --t: var(--late3); }
  .litem :global(svg) { color: var(--t); }
  .litem[aria-checked="true"] { background: color-mix(in srgb, var(--t) 14%, transparent); color: var(--t); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 719px) { .ridebar { bottom: calc(max(12px, env(safe-area-inset-bottom)) + 88px); } }
  .round, .pill { transition: background-color .2s, color .2s, transform .12s; }
  .round:active, .main:active .pill { transform: scale(.94); }
  .pill.hot { animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--late1) 22%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .round, .pill { transition: none; } .pill.hot { animation: none; } }
</style>
