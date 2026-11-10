<script lang="ts">
  // In a bus line's card, the rider's stop of the chosen direction (lineStop.ts: the stop the card came from, else the
  // nearest one): its name, the walk there, this line's next buses there (asked every 20 s, as the stop card does),
  // a bell for this line at this stop and walking directions in the phone's map. Icons say what words used to.
  import { untrack } from "svelte";
  import { fetchStop, peekStop } from "../api";
  import { alertLinesAt, arrivalGroups, timeText, usualRows, type StopBoard } from "../stops";
  import { busStopCard } from "../legacy";
  import { lineStopFor, walkDirectionsUrl } from "../lineStop";
  import { distM } from "../trip";
  import { titleCase, walkMin } from "../nearby";
  import type { AppState } from "../state.svelte";
  import type { FetchResult } from "../poller";
  import Bell from "./Bell.svelte";
  import Icon from "./Icon.svelte";

  let { app, line, variants, toward }: { app: AppState; line: string; variants: string[]; toward: string } = $props();

  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  // The card under this one: a stop the user came from.
  const fromCode = $derived.by(() => { const c = app.stack.at(-2); return c?.kind === "stop" ? native(c.id) : null; });
  const ix = $derived(app.stopIx);
  const at = $derived(ix ? lineStopFor(ix, line, variants, { stopCode: fromCode, pos: app.myPos }) : null);
  const s = $derived(ix && at ? ix.s[at.k] : null);
  const code = $derived(s?.[3] ?? null);
  const name = $derived(s ? titleCase(s[0]) : "");
  // The walk there: also to the stop the card came from, when the location is known.
  const walkM = $derived(at?.m ?? (s && app.myPos ? distM(app.myPos, [s[1], s[2]]) : null));

  let board = $state.raw<StopBoard | null>(null);
  let now = $state(Date.now());
  const boardOf = (r: FetchResult | undefined) => {
    const b = r?.body as StopBoard | null | undefined;
    return r?.status === 200 && b && Array.isArray(b?.arrivals) ? b : null;
  };
  $effect(() => {
    const c = code;
    board = null;
    if (!c) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    untrack(() => { now = app.serverMs(); board = boardOf(peekStop(c)); });
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        const b = boardOf(await fetchStop(c));
        if (!alive) return;
        now = app.serverMs();
        if (b) board = b;
      }
      timer = setTimeout(load, 20_000);
    };
    void load();
    const tick = setInterval(() => (now = app.serverMs()), 10_000);
    return () => { alive = false; clearTimeout(timer); clearInterval(tick); };
  });

  // This line's buses here in the chosen direction (a row with no variant counts: the board may not know it).
  const group = $derived(board ? arrivalGroups(board.arrivals, now).find(g => g.line === line && (!g.variant || variants.includes(g.variant))) : undefined);
  const usual = $derived(board && !group ? usualRows(board.usual, [], now).find(u => u.line === line) : undefined);
  const first = $derived(group?.times[0]);
  const late = $derived(first && !first.est && first.late >= 2 ? first.late : 0);   // an estimate has no delay to tell

  const alertLines = $derived(app.cityInfo.alerts && ix && at
    ? alertLinesAt(ix, at.k, [line]).map(l => ({ ...l, variants: l.variants.filter(v => variants.includes(v.id)) })).filter(l => l.variants.length)
    : []);
  let alertOpen = $state(false);
  $effect(() => { void code; alertOpen = false; });
</script>

{#if s && code}
  <div class="ls">
    <button type="button" class="name" onclick={() => app.push(busStopCard(code, name))} aria-label="Στάση {name}">
      <Icon name="stop" size={16} /><b>{name}</b>{#if walkM != null}<span class="walk" title="Με τα πόδια"><Icon name="walk" size={14} />{walkMin(walkM)}′</span>{/if}
    </button>
    <div class="row">
      {#if first}
        <span class="next" aria-live="polite">
          <span class="dot" class:est={!!first.est} title={first.est ? "Εκτίμηση" : "Ζωντανά"} aria-hidden="true"></span>
          <b>{timeText(first)}</b>
          {#if late}<span class="late" title="Καθυστέρηση">+{late}′</span>{/if}
          {#if group && group.times.length > 1}<small>{group.times.slice(1).map(timeText).join(" · ")}</small>{/if}
        </span>
      {:else if usual}
        <span class="next muted"><Icon name="dot" size={12} /><small>{usual.text}</small></span>
      {:else}
        <span class="next muted"><small>{board ? "Κανένα καθ’ οδόν τώρα" : "Φόρτωση…"}</small></span>
      {/if}
      {#if alertLines.length}
        <button type="button" class="ic" class:on={alertOpen} aria-label="Ειδοποίηση για το {line} στη στάση {name}" title="Ειδοποίηση"
          onclick={() => (alertOpen = true)}><Bell /></button>
      {/if}
      <a class="ic" href={walkDirectionsUrl(s[1], s[2])} target="_blank" rel="noopener" aria-label="Οδηγίες με τα πόδια ως τη στάση {name}"
        title="Οδηγίες ως τη στάση"><Icon name="directions" size={18} /></a>
    </div>
  </div>
  {#if alertOpen}
    {#await import("./AlertSheet.svelte") then m}
      <m.default {app} lines={alertLines} label={name} {line} {toward} onclose={() => (alertOpen = false)} />
    {/await}
  {/if}
{/if}

<style>
  .ls { margin: 10px 0 2px; padding: 10px 12px; border-radius: 12px; background: var(--control); }
  .name { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 32px; padding: 0; border: 0; background: none; color: inherit;
    font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
  .name b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .name:hover b { text-decoration: underline; text-underline-offset: 3px; }
  .walk { flex: none; display: inline-flex; align-items: center; gap: 2px; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
  .next { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; }
  .next b { font-size: 24px; line-height: 1.05; font-weight: 700; font-variant-numeric: tabular-nums; }
  .next small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
  .next.muted { align-items: center; gap: 6px; color: var(--muted); }
  .dot { flex: none; align-self: center; width: 8px; height: 8px; border-radius: 50%; background: var(--ontime); }
  .dot.est { background: var(--muted); }
  .late { color: var(--late2); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .ic { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 50%;
    background: var(--panel); color: var(--fg); cursor: pointer; text-decoration: none; }
  .ic:hover, .ic.on { color: var(--accent); }
  .ic:focus-visible, .name:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
