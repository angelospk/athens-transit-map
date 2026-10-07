<script lang="ts">
  import { untrack } from "svelte";
  import { DATA_URL, gaps, hourly, latestDay, MIN_LINE_HOURS, ranking, type DayStats } from "../stats";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let dlg: HTMLDialogElement;
  let data = $state<{ kind: "loading" } | { kind: "ok"; day: DayStats } | { kind: "none" } | { kind: "error" }>({ kind: "loading" });

  async function load() {
    if (data.kind !== "ok") data = { kind: "loading" };
    try {
      const day = await latestDay();
      data = day ? { kind: "ok", day } : { kind: "none" };
    } catch {
      data = { kind: "error" };
    }
  }

  $effect(() => {
    if (open && !dlg.open) {
      dlg.showModal();
      untrack(load);
    } else if (!open && dlg.open) dlg.close();
  });

  const nf = (n: number) => n.toLocaleString("el-GR");
  const dec = (n: number) => n.toLocaleString("el-GR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

  const day = $derived(data.kind === "ok" ? data.day : null);
  const hours = $derived(day ? hourly(day) : []);
  const rank = $derived(day ? ranking(day, 10) : null);
  const missing = $derived(day ? gaps(day) : []);
  const dateText = $derived(day ? new Date(`${day.date}T12:00:00Z`).toLocaleDateString("el-GR",
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
  const missingText = $derived(!missing.length ? "" :
    missing.length === missing.at(-1)! - missing[0] + 1 ? `${hh(missing[0])}–${hh(missing.at(-1)! + 1)}` : `${missing.length} ώρες`);

  // Charts: one hour under the pointer (or the tapped one); none = the summary line.
  let measured = $state(0);
  const w = $derived(Math.max(240, measured)); // 0 while the dialog is closed
  const H = 150, M = { l: 34, r: 6, t: 8, b: 20 };
  let hover = $state<{ chart: "veh" | "kmh"; i: number } | null>(null);
  const bw = $derived((w - M.l - M.r) / 24);
  const x = (i: number) => M.l + i * bw + bw / 2;
  const scale = (max: number, step: number) => {
    const top = Math.max(step, Math.ceil(max / step) * step);
    return { top, y: (v: number) => M.t + (H - M.t - M.b) * (1 - v / top), ticks: Array.from({ length: top / step + 1 }, (_, k) => k * step) };
  };
  const veh = $derived(scale(Math.max(0, ...hours.map(h => h.vehicles)), 250));
  const spd = $derived(scale(Math.max(0, ...hours.map(h => h.kmh ?? 0)), 10));
  // The speed line, broken where an hour has no speed; an hour alone between gaps is a dot.
  const spdSegs = $derived.by(() => {
    const segs: [number, number][][] = [[]];
    hours.forEach((h, i) => (h.kmh == null ? segs.push([]) : segs.at(-1)!.push([x(i), spd.y(h.kmh)])));
    return segs.filter(s => s.length);
  });
  const pick = (chart: "veh" | "kmh", e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    hover = { chart, i: Math.max(0, Math.min(23, Math.floor((e.clientX - r.left - M.l) / bw))) };
  };
  const peak = $derived(hours.reduce((a, h) => (h.vehicles > a.vehicles ? h : a), { h: 0, vehicles: 0, kmh: null as number | null }));
  const slowest = $derived(hours.reduce<(typeof hours)[number] | null>((a, h) =>
    h.kmh != null && h.h >= 6 && (a == null || h.kmh < a.kmh!) ? h : a, null));
  const maxKmh = $derived(rank?.fast[0]?.kmh ?? rank?.slow.at(-1)?.kmh ?? 1);
  // Arrow keys move through the hours of a focused chart; the read-out line above says the value.
  const key = (chart: "veh" | "kmh", e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -24, End: 24 }[e.key];
    if (step == null) return;
    e.preventDefault();
    const i = hover?.chart === chart ? hover.i : chart === "veh" ? peak.h : (slowest?.h ?? 12);
    hover = { chart, i: Math.max(0, Math.min(23, i + step)) };
  };
</script>

<dialog bind:this={dlg} class="sheet" aria-labelledby="stats-title" onclose={() => (open = false)}
  onclick={e => { if (e.target === dlg) open = false; }}
  onkeydown={e => { if (e.key === "Escape") e.stopPropagation(); }}>
  <div class="body">
    <header>
      <h2 id="stats-title">Στατιστικά δικτύου</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => (open = false)}>
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </button>
    </header>

    {#if data.kind === "loading"}
      <p class="muted">Φόρτωση…</p>
    {:else if data.kind === "error"}
      <p class="muted">Τα στατιστικά δεν φόρτωσαν. Κλείσε και άνοιξε ξανά για νέα προσπάθεια.</p>
    {:else if data.kind === "none" || !day}
      <p class="muted">Δεν υπάρχουν ακόμα στατιστικά. Η πρώτη μέρα γράφεται λίγες ώρες μετά τα μεσάνυχτα.</p>
    {:else}
      <p class="lede">{dateText}: {nf(day.vehicles)} λεωφορεία και τρόλεϊ σε {nf(day.lines)} γραμμές.
        {#if missingText}<br /><span class="warn">Μερική μέρα: χωρίς δεδομένα {missingText}.</span>{/if}</p>

      <section bind:clientWidth={measured}>
        <h3>Λεωφορεία στον δρόμο</h3>
        <p class="read" aria-live="polite">
          {#if hover?.chart === "veh"}{hh(hover.i)}: <b>{nf(hours[hover.i].vehicles)}</b> οχήματα
          {:else}Περισσότερα στις {hh(peak.h)}: <b>{nf(peak.vehicles)}</b>{/if}
        </p>
        <svg width={w} height={H} role="slider" tabindex="0" aria-label="Οχήματα ανά ώρα, βελάκια για ώρα"
          aria-valuemin={0} aria-valuemax={23} aria-valuenow={hover?.chart === "veh" ? hover.i : peak.h}
          aria-valuetext={hover?.chart === "veh" ? `${hh(hover.i)}: ${hours[hover.i].vehicles} οχήματα` : `${hh(peak.h)}: ${peak.vehicles} οχήματα`}
          onkeydown={e => key("veh", e)} onblur={() => (hover = null)}
          onpointermove={e => pick("veh", e)} onpointerdown={e => pick("veh", e)} onpointerleave={() => (hover = null)}>
          {#each veh.ticks as v (v)}
            <line class:base={!v} x1={M.l} x2={w - M.r} y1={veh.y(v)} y2={veh.y(v)} />
            <text x={M.l - 5} y={veh.y(v) + 4} text-anchor="end">{nf(v)}</text>
          {/each}
          {#each hours as h, i (h.h)}
            <rect class:on={hover?.chart === "veh" && hover.i === i} x={x(i) - bw * 0.35} width={bw * 0.7} rx="2"
              y={veh.y(h.vehicles)} height={veh.y(0) - veh.y(h.vehicles)} />
            {#if i % 3 === 0}<text x={x(i)} y={H - 4} text-anchor="middle">{String(i).padStart(2, "0")}</text>{/if}
          {/each}
        </svg>
        <p class="note">Διαφορετικά οχήματα που έστειλαν θέση GPS μέσα σε κάθε ώρα.</p>
      </section>

      <section>
        <h3>Μέση ταχύτητα δικτύου</h3>
        <p class="read" aria-live="polite">
          {#if hover?.chart === "kmh"}{hh(hover.i)}: {#if hours[hover.i].kmh != null}<b>{dec(hours[hover.i].kmh!)}</b> km/h{:else}χωρίς δεδομένα{/if}
          {:else if slowest}Πιο αργά στις {hh(slowest.h)}: <b>{dec(slowest.kmh!)}</b> km/h{/if}
        </p>
        <svg width={w} height={H} role="slider" tabindex="0" aria-label="Μέση ταχύτητα ανά ώρα, βελάκια για ώρα"
          aria-valuemin={0} aria-valuemax={23} aria-valuenow={hover?.chart === "kmh" ? hover.i : (slowest?.h ?? 0)}
          aria-valuetext={hover?.chart === "kmh" ? `${hh(hover.i)}: ${hours[hover.i].kmh == null ? "χωρίς δεδομένα" : `${dec(hours[hover.i].kmh!)} km/h`}` : slowest ? `${hh(slowest.h)}: ${dec(slowest.kmh!)} km/h` : ""}
          onkeydown={e => key("kmh", e)} onblur={() => (hover = null)}
          onpointermove={e => pick("kmh", e)} onpointerdown={e => pick("kmh", e)} onpointerleave={() => (hover = null)}>
          {#each spd.ticks as v (v)}
            <line class:base={!v} x1={M.l} x2={w - M.r} y1={spd.y(v)} y2={spd.y(v)} />
            <text x={M.l - 5} y={spd.y(v) + 4} text-anchor="end">{v}</text>
          {/each}
          {#each hours as h, i (h.h)}
            {#if i % 3 === 0}<text x={x(i)} y={H - 4} text-anchor="middle">{String(i).padStart(2, "0")}</text>{/if}
          {/each}
          {#each spdSegs as seg, k (k)}
            {#if seg.length > 1}<polyline points={seg.map(p => p.join(",")).join(" ")} />{:else}<circle cx={seg[0][0]} cy={seg[0][1]} r="3" />{/if}
          {/each}
          {#if hover?.chart === "kmh" && hours[hover.i].kmh != null}
            <line class="cross" x1={x(hover.i)} x2={x(hover.i)} y1={M.t} y2={spd.y(0)} />
            <circle cx={x(hover.i)} cy={spd.y(hours[hover.i].kmh!)} r="4" />
          {/if}
        </svg>
        <p class="note">km/h μαζί με στάσεις και φανάρια, από διαδοχικές θέσεις GPS κάθε οχήματος. Τη νύχτα κινούνται λίγα οχήματα, κυρίως σε μεγάλες γραμμές.</p>
      </section>

      {#if rank && rank.eligible}
        <section>
          <h3>Οι πιο αργές και οι πιο γρήγορες γραμμές</h3>
          <div class="rank">
            {#each [["Πιο αργές", rank.slow], ["Πιο γρήγορες", rank.fast]] as const as [title, rows] (title)}
              <div hidden={!rows.length}>
                <h4>{title}</h4>
                <ol>
                  {#each rows as r (r.line)}
                    <li title="{r.line}: {dec(r.kmh)} km/h, {nf(r.km)} km σε {nf(r.hours)} ώρες κίνησης">
                      <b>{r.line}</b><span class="track"><span style:width="{(r.kmh / maxKmh) * 100}%"></span></span><span class="v">{dec(r.kmh)}</span>
                    </li>
                  {/each}
                </ol>
              </div>
            {/each}
          </div>
          <p class="note">Μέση ταχύτητα σε km/h όλης της μέρας. Μόνο γραμμές με τουλάχιστον {MIN_LINE_HOURS} ώρες κίνησης οχημάτων ({rank.eligible} γραμμές).</p>
        </section>
      {/if}

      <p class="foot"><a href={DATA_URL} target="_blank" rel="noopener">Δες τα δεδομένα</a> · κάθε μέρα σε JSON, και στο API (<code>/v1/stats</code>)</p>
    {/if}
  </div>
</dialog>

<style>
  .sheet { width: min(720px, calc(100% - 32px)); max-height: calc(100% - 48px); padding: 0; border: 1px solid var(--border);
    border-radius: 16px; background: var(--bg); color: var(--fg); box-shadow: var(--shadow); overscroll-behavior: contain; }
  .sheet::backdrop { background: rgba(0, 0, 0, .4); }
  .body { padding: 16px 20px 20px; }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  h2 { flex: 1; margin: 0; font-size: 17px; }
  h3 { margin: 0; font-size: 14px; }
  h4 { margin: 0 0 4px; font-size: 12px; color: var(--muted); font-weight: 600; }
  .close { display: grid; place-items: center; width: 36px; height: 36px; margin: -6px -8px -6px 0; border: 0; border-radius: 8px;
    background: none; color: var(--muted); cursor: pointer; }
  .close:hover { background: var(--control); color: var(--fg); }
  .lede { margin: 0 0 8px; color: var(--muted); }
  .warn { color: var(--late2); }
  .muted { color: var(--muted); }
  section { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
  .read { margin: 2px 0 6px; min-height: 20px; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .read b { color: var(--fg); }
  .note { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
  svg { display: block; touch-action: pan-y; border-radius: 4px; }
  svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  svg text { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  svg line { stroke: var(--border); stroke-width: 1; opacity: .6; }
  svg line.base { opacity: 1; }
  svg line.cross { stroke: var(--muted); stroke-dasharray: 2 3; opacity: 1; }
  svg rect { fill: var(--accent); opacity: .85; }
  svg rect.on { opacity: 1; stroke: var(--fg); stroke-width: 1; }
  polyline { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }
  circle { fill: var(--accent); stroke: var(--bg); stroke-width: 2; }
  .rank { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; margin-top: 8px; }
  ol { margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 40px 1fr 34px; align-items: center; gap: 8px; height: 22px; font-size: 13px; }
  li b { text-align: right; }
  .track { height: 10px; border-radius: 2px; background: var(--control); }
  .track span { display: block; height: 100%; border-radius: 2px; background: var(--accent); }
  .v { color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
  .foot { margin: 18px 0 0; font-size: 12px; color: var(--muted); }
  .foot a { color: var(--accent); }
  @media (max-width: 719px) {
    .sheet { width: 100%; max-width: none; height: 100%; max-height: none; margin: 0; border: 0; border-radius: 0; }
    .body { padding: calc(12px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom)); }
    .rank { grid-template-columns: 1fr; }
  }
</style>
