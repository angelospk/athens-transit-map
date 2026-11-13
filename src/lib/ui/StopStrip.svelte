<script lang="ts">
  // The line card's stop strip (lib/stopStrip.ts, docs/mockups/line-strip-v1.html): every stop of the shown direction
  // down a rail in the line's colour, each vehicle on the rail where it is now (between two stops) with its phrase, and
  // a yellow or red outline round a slow gap (Athens, Thessaloniki), as on the map. Rows have fixed heights, so a
  // vehicle's place is worked out, not measured.
  import { fmtDelay } from "../format";
  import { levelClass, vehiclePhrase } from "../liveQuality";
  import type { Strip } from "../stopStrip";
  import type { V2Stop, V2Vehicle } from "../v2";
  import Icon from "./Icon.svelte";

  let { strip, stops, color, isBus, tc, onvehicle, onstop }: {
    strip: Strip; stops: Record<string, V2Stop>; color: { bg: string; fg: string }; isBus: boolean;
    tc: (s: string | null | undefined) => string; onvehicle: (v: V2Vehicle) => void; onstop?: (id: string, name: string) => void;
  } = $props();

  const STOP_H = 30, GAP_H = 12, GAP_TEXT_H = 26;
  // The centre of each stop row, from the top of the strip.
  const centres = $derived.by(() => {
    const out: number[] = [];
    let y = 0;
    strip.stops.forEach((_, i) => {
      out.push(y + STOP_H / 2);
      y += STOP_H + (i < strip.gaps.length ? (strip.gaps[i] ? GAP_TEXT_H : GAP_H) : 0);
    });
    return out;
  });
  const yAt = (at: number) => {
    const k = Math.min(Math.floor(at), centres.length - 1), j = Math.min(k + 1, centres.length - 1);
    return centres[k] + (centres[j] - centres[k]) * (at - k);
  };
  const said = (v: V2Vehicle) => vehiclePhrase(v.quality, v.delay_s)
    ?? (v.delay_s !== null ? { text: fmtDelay(v.delay_s), level: null } : null);
  const name = (id: string) => tc(stops[id]?.name ?? "");
</script>

<div class="strip" style:--c={color.bg} style:--t={color.fg}>
  <ol aria-label="Οι στάσεις της κατεύθυνσης">
    {#each strip.stops as id, i (i)}
      {@const end = i === 0 || i === strip.stops.length - 1}
      <li class="stop" class:end>
        <span class="dot" aria-hidden="true"></span>
        {#if onstop}<button type="button" class="nm" onclick={() => onstop(id, stops[id]?.name ?? "")}>{name(id)}</button>
        {:else}<span class="nm">{name(id)}</span>{/if}
      </li>
      {#if i < strip.gaps.length}
        {@const g = strip.gaps[i]}
        <li class="gap {g?.level ?? ''}" class:text={!!g} aria-hidden={!g}>
          <span class="rail"></span>
          {#if g}<span class="why lvt-{g.level}">{g.text}</span>{/if}
        </li>
      {/if}
    {/each}
  </ol>
  {#each strip.vehicles as { v, at } (v.id)}
    {@const p = said(v)}
    {@const y = yAt(at)}
    <button type="button" class="veh {levelClass(v.quality?.level)}" class:ring={!!v.quality} style:top="{y}px"
      aria-label="Όχημα{v.label ? ` ${v.label}` : ''}, μετά τη στάση {name(strip.stops[Math.floor(at)])}{p ? `: ${p.text}` : ''}"
      onclick={() => onvehicle(v)}><Icon name={isBus ? "bus" : "dot"} size={14} /></button>
    {#if p}<span class="say {p.level ? `lvt-${p.level}` : 'plain'}" style:top="{y}px" aria-hidden="true">{p.text}</span>{/if}
  {/each}
</div>

<style>
  .strip { position: relative; margin: 2px 0 4px; font-variant-numeric: tabular-nums; }
  ol { list-style: none; margin: 0; padding: 0; }
  .stop { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; height: 30px; }
  .dot { justify-self: center; width: 11px; height: 11px; border-radius: 50%; background: var(--bg); border: 2.5px solid var(--c);
    position: relative; z-index: 2; }
  .end .dot { width: 14px; height: 14px; border-width: 3px; }
  .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 84px 0 0; font-size: 13.5px; text-align: left; }
  button.nm { height: 30px; border: 0; background: none; color: inherit; font: inherit; font-size: 13.5px; cursor: pointer; }
  button.nm:hover { text-decoration: underline; }
  .end .nm { font-weight: 650; }
  .gap { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; height: 12px; }
  .gap.text { height: 26px; }
  /* The rail piece runs from the stop above to the stop below, under both dots. */
  .rail { justify-self: center; align-self: stretch; width: 5px; margin: -15px 0; border-radius: 3px; background: var(--c); }
  .worse .rail { box-shadow: 0 0 0 4px var(--late1); position: relative; z-index: 1; }
  .much_worse .rail { box-shadow: 0 0 0 4px var(--late3); position: relative; z-index: 1; }
  .why { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* A vehicle: the map's marker, smaller, on the rail; its phrase on the right of the same height. */
  .veh { position: absolute; left: 20px; width: 26px; height: 26px; padding: 0; transform: translate(-50%, -50%); z-index: 3;
    display: grid; place-items: center; border-radius: 50%; border: 2px solid #fff; background: var(--c); color: var(--t); cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, .35); }
  .veh.ring { box-shadow: 0 0 0 2.5px var(--d), 0 1px 4px rgba(0, 0, 0, .35); }
  .veh:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .say { position: absolute; right: 0; transform: translateY(-50%); z-index: 3; padding: 0 0 0 6px; background: var(--panel, var(--bg));
    font-size: 12.5px; white-space: nowrap; pointer-events: none; }
  .say.plain { color: var(--muted); }
</style>
