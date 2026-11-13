<script lang="ts">
  // The line card's quality pill (lib/quality.ts, docs/mockups/quality-v3.html, step 4: docs/mockups/quality-step4-v3.html):
  // one line whose number is coloured by its level (no meter); a tap opens the day's detail and the last 7 days under
  // it. The 7 day files are fetched only then.
  import { slide } from "svelte/transition";
  import { MediaQuery } from "svelte/reactivity";
  import { dayBars, dayFile, halfMin, lastDates, onTimeWindow, type DayWord, type Level, type Quality, type QualityDay } from "../quality";

  // limits: the day's on-time window of `origin_otp` (early_s, late_s; rt#178), for the note.
  let { q, word, date, line, dir, limits }: { q: Quality; word: DayWord; date: string; line: string; dir: number | null;
    limits?: { early_s?: number; late_s?: number } } = $props();

  const LV: Record<Level, string> = { 1: "var(--late3)", 2: "var(--late1)", 3: "var(--ontime)" };
  const LVT: Record<Level, string> = { 1: "lvt-much_worse", 2: "lvt-worse", 3: "lvt-normal" };
  const LVW: Record<Level, string> = { 1: "πολύ χειρότερα από το συνηθισμένο", 2: "λίγο χειρότερα από το συνηθισμένο", 3: "κανονικά" };
  const reduce = new MediaQuery("(prefers-reduced-motion: reduce)");
  let open = $state(false);
  let days = $state.raw<{ date: string; day: QualityDay | null }[] | null>(null);

  $effect(() => {
    if (!open) return;
    // Every open asks dayFile again: its cache keeps the found files and retries a failed one.
    const ds = lastDates(date, 7);
    let live = true;
    void Promise.all(ds.map(d => dayFile(d).then(day => ({ date: d, day })))).then(r => { if (live) days = r; });
    return () => { live = false; };
  });
  const bars = $derived(days ? dayBars(days, q.kind, line, dir) : null);

  const WD = ["Κυ", "Δε", "Τρ", "Τε", "Πε", "Πα", "Σα"];
  const dayName = (d: string, last: boolean) => (last ? word.toLowerCase() : WD[new Date(`${d}T12:00:00Z`).getUTCDay()]);

  // Chart geometry (SVG user units; it scales to the card's width).
  const W = 320, H = 92;
  const ref = $derived(q.kind === "wait" ? q.h.mean_headway_s / 2 / 60 : 0.8);
  const max = $derived(q.kind === "otp" ? 1 : Math.max(ref, ...(bars ?? []).map(b => b?.value ?? 0)) * 1.15);
  const fmt = (v: number) => (q.kind === "wait" ? `${halfMin(v)}′` : `${Math.round(v * 100)}%`);
  const y = (v: number) => H - (v / max) * H;
</script>

<div class="quality">
  <button type="button" class="q" aria-expanded={open} aria-controls="quality-more" onclick={() => (open = !open)}>
    <span class="txt"><span class="k">{word} ·</span> <b>{q.parts[0]}<span class={LVT[q.level]}>{q.parts[1]}</span>{q.parts[2]}</b><span class="sr">, {LVW[q.level]}</span></span>
    <span class="chev" class:up={open} aria-hidden="true">›</span>
  </button>

  {#if open}
    <div id="quality-more" class="more" role="region" aria-label="Λεπτομέρειες ποιότητας" transition:slide={{ duration: reduce.current ? 0 : 200 }}>
      {#if q.kind === "otp"}
        {@const o = q.o}
        <p class="h">{word}, αναχώρηση από την αφετηρία ({o.measured} δρομολόγια)</p>
        <div class="stack" aria-hidden="true">
          {#if o.early}<i style:flex={o.early} style:background="var(--late3)"></i>{/if}
          {#if o.on_time}<i style:flex={o.on_time} style:background="var(--ontime)"></i>{/if}
          {#if o.late}<i style:flex={o.late} style:background="var(--late1)"></i>{/if}
        </div>
        <p class="keys">
          <span style:--c="var(--late3)">νωρίτερα {o.early}</span>
          <span style:--c="var(--ontime)">στην ώρα {o.on_time}</span>
          <span style:--c="var(--late1)">πιο αργά {o.late}</span>
        </p>
        <p class="h">Στην ώρα, τελευταίες 7 μέρες</p>
      {:else}
        <p class="h">Μέση αναμονή στη στάση, τελευταίες 7 μέρες</p>
      {/if}

      {#if bars}
        <svg viewBox="0 -14 {W} {H + 30}" role="img"
          aria-label={bars.map((b, i) => `${dayName(days![i].date, i === bars.length - 1)}: ${b ? fmt(b.value) : "χωρίς στοιχεία"}`).join(", ")}>
          <line x1="0" x2={W} y1={y(ref)} y2={y(ref)} class="ref" />
          {#each bars as b, i (i)}
            {@const bw = W / bars.length}
            {@const last = i === bars.length - 1}
            {#if b}
              <rect x={i * bw + bw * 0.18} y={y(b.value)} width={bw * 0.64} height={H - y(b.value)} rx="3" fill={LV[b.level]} opacity={last ? 1 : 0.55} />
              <text x={i * bw + bw / 2} y={y(b.value) - 4} text-anchor="middle" class="val" class:last>{fmt(b.value)}</text>
            {:else}
              <text x={i * bw + bw / 2} y={H - 4} text-anchor="middle">—</text>
            {/if}
            <text x={i * bw + bw / 2} y={H + 14} text-anchor="middle" class:last>{dayName(days![i].date, last)}</text>
          {/each}
          <line x1="0" x2={W} y1={H} y2={H} class="base" />
        </svg>
      {:else}
        <p class="note">Φόρτωση…</p>
      {/if}

      {#if q.kind === "otp"}
        <p class="note">«Στην ώρα»: {onTimeWindow(limits)} από το πρόγραμμα. Όποιο φεύγει νωρίτερα από αυτό μετράει εκτός, γιατί όποιος έρχεται στην ώρα το χάνει. Διακεκομμένη: 80%.</p>
      {:else}
        {@const h = q.h}
        <p class="note">Διακεκομμένη: η αναμονή αν τα λεωφορεία έρχονταν ομοιόμορφα (μισό headway).
          {word}: {h.n + 1} διελεύσεις{q.from_h !== null && q.to_h !== null ? ` ${String(q.from_h).padStart(2, "0")}–${String(q.to_h).padStart(2, "0")}` : ""}, κάθε ~{halfMin(h.mean_headway_s / 60)}′ κατά μέσο όρο{typeof h.off_headway_share === "number" ? `· ${Math.round(h.off_headway_share * 10)} στις 10 ήρθαν μαζί με άλλο ή μετά από μεγάλο κενό` : ""}.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* The level shows in the colour of the number only (app.css .lvt-*, 4.5:1); the other words stay --fg or --muted. */
  .quality { margin: 0 0 8px; border-radius: 10px; background: var(--control); font-variant-numeric: tabular-nums; }
  .q { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 36px; padding: 8px 12px; border: 0; border-radius: 10px;
    background: none; color: var(--fg); font: inherit; font-size: 13px; line-height: 1.35; text-align: left; cursor: pointer; }
  .q:hover { box-shadow: inset 0 0 0 1px var(--border); }   /* not --control-hover: --muted on it is under 4.5:1 */
  .q:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .txt { flex: 1; min-width: 0; }
  .k { color: var(--muted); }
  .txt b { font-weight: 650; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .chev { flex: none; color: var(--muted); font-size: 16px; transition: transform .2s cubic-bezier(.2, .8, .2, 1); }
  .chev.up { transform: rotate(90deg); }
  .more { padding: 0 12px 10px; font-size: 12px; }
  .h { margin: 6px 0 4px; font-weight: 600; color: var(--muted); }
  .keys + .h { margin-top: 12px; }
  .stack { display: flex; gap: 2px; height: 14px; border-radius: 3px; overflow: hidden; }
  .keys { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 5px 0 0; color: var(--muted); }
  .keys span::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 4px; border-radius: 2px; background: var(--c); }
  svg { display: block; width: 100%; height: auto; margin-top: 4px; overflow: visible; }
  svg text { fill: var(--muted); font-size: 11px; }
  svg text.val { fill: var(--fg); }
  svg text.last { font-weight: 700; }
  .ref { stroke: var(--fg); stroke-dasharray: 3 3; opacity: .55; }
  .base { stroke: var(--border); }
  .note { margin: 8px 0 0; color: var(--muted); line-height: 1.4; }
  @media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
</style>
