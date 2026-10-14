<script lang="ts">
  // One value per local hour as lines (broken where an hour has no value), with an optional
  // min-max band. Pointer or arrow keys pick an hour (`sel`); the parent says its values.
  type Series = { values: (number | null)[]; cls: string };
  let { w, label, step, series, band = null, valuetext, start, sel = $bindable(null) }: {
    w: number; label: string; step: number; series: Series[];
    band?: { min: (number | null)[]; max: (number | null)[] } | null;
    valuetext: (i: number) => string; start: number; sel?: number | null;
  } = $props();

  const H = 150, M = { l: 34, r: 6, t: 8, b: 20 };
  const nf = (n: number) => n.toLocaleString("el-GR");
  const bw = $derived((w - M.l - M.r) / 24);
  const x = (i: number) => M.l + i * bw + bw / 2;
  const top = $derived.by(() => {
    const vals = [...series.flatMap(s => s.values), ...(band?.max ?? [])].filter((v): v is number => v != null);
    return Math.max(step, Math.ceil(Math.max(0, ...vals) / step) * step);
  });
  const y = (v: number) => M.t + (H - M.t - M.b) * (1 - v / top);
  const ticks = $derived(Array.from({ length: top / step + 1 }, (_, k) => k * step));
  // Runs of hours that all have a value.
  const runs = (ok: (i: number) => boolean) => {
    const out: number[][] = [[]];
    for (let i = 0; i < 24; i++) (ok(i) ? out.at(-1)!.push(i) : out.push([]));
    return out.filter(r => r.length);
  };
  const lines = $derived(series.map(s => ({ cls: s.cls, segs: runs(i => s.values[i] != null).map(r => r.map(i => [x(i), y(s.values[i]!)])) })));
  const bands = $derived(band ? runs(i => band.min[i] != null && band.max[i] != null).map(r =>
    [...r.map(i => `${x(i)},${y(band.max[i]!)}`), ...[...r].reverse().map(i => `${x(i)},${y(band.min[i]!)}`)].join(" ")) : []);
  const now = $derived(sel ?? start);

  const pick = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    sel = Math.max(0, Math.min(23, Math.floor((e.clientX - r.left - M.l) / bw)));
  };
  const key = (e: KeyboardEvent) => {
    const to = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, Home: -24, End: 24 }[e.key];
    if (to == null) return;
    e.preventDefault();
    sel = Math.max(0, Math.min(23, now + to));
  };
</script>

<svg width={w} height={H} role="slider" tabindex="0" aria-label="{label}, βελάκια για ώρα"
  aria-valuemin={0} aria-valuemax={23} aria-valuenow={now} aria-valuetext={valuetext(now)}
  onkeydown={key} onblur={() => (sel = null)}
  onpointermove={pick} onpointerdown={pick} onpointerleave={() => (sel = null)}>
  {#each ticks as v (v)}
    <line class:base={!v} x1={M.l} x2={w - M.r} y1={y(v)} y2={y(v)} />
    <text x={M.l - 5} y={y(v) + 4} text-anchor="end">{nf(v)}</text>
  {/each}
  {#each { length: 8 }, k (k)}
    <text x={x(k * 3)} y={H - 4} text-anchor="middle">{String(k * 3).padStart(2, "0")}</text>
  {/each}
  {#each bands as pts, k (k)}<polygon points={pts} />{/each}
  {#each lines as l, n (n)}
    {#each l.segs as seg, k (k)}
      {#if seg.length > 1}<polyline class={l.cls} points={seg.map(p => p.join(",")).join(" ")} />
      {:else}<circle class={l.cls} cx={seg[0][0]} cy={seg[0][1]} r="3" />{/if}
    {/each}
  {/each}
  {#if sel != null}
    <line class="cross" x1={x(sel)} x2={x(sel)} y1={M.t} y2={y(0)} />
    {#each series as s, n (n)}
      {#if s.values[sel] != null}<circle class={s.cls} cx={x(sel)} cy={y(s.values[sel]!)} r="4" />{/if}
    {/each}
  {/if}
</svg>

<style>
  svg { display: block; touch-action: pan-y; border-radius: 4px; }
  svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  text { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  line { stroke: var(--border); stroke-width: 1; opacity: .6; }
  line.base { opacity: 1; }
  line.cross { stroke: var(--muted); stroke-dasharray: 2 3; opacity: 1; }
  polygon { fill: var(--accent); opacity: .18; }
  polyline { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }
  circle { fill: var(--accent); stroke: var(--bg); stroke-width: 2; }
  polyline.alt { stroke: var(--late2); stroke-dasharray: 5 3; }
  circle.alt { fill: var(--late2); }
</style>
