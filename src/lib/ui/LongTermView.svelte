<script lang="ts">
  import { untrack } from "svelte";
  import { byDayType, DATA_URL, hourBand, lineTrends, LONG_DAYS, MIN_LINE_HOURS, storedDays, type Stored } from "../stats";
  import HourChart from "./HourChart.svelte";

  let data = $state<{ kind: "loading" } | { kind: "ok"; s: Stored } | { kind: "none" } | { kind: "error" }>({ kind: "loading" });

  async function load() {
    if (data.kind !== "ok") data = { kind: "loading" };
    try {
      const s = await storedDays();
      if (!gone) data = s ? { kind: "ok", s } : { kind: "none" };
    } catch {
      if (!gone) data = { kind: "error" };
    }
  }

  // Loaded each time the tab is shown (the module keeps the days an hour); a late answer is dropped.
  let gone = false;
  $effect(() => {
    untrack(load);
    return () => (gone = true);
  });

  const nf = (n: number) => Math.round(n).toLocaleString("el-GR");
  const dec = (n: number) => n.toLocaleString("el-GR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = (c: number) => `${c > 0 ? "+" : "−"}${Math.abs(Math.round(c * 100))}%`;
  const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  const dm = (date: string, weekday = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString("el-GR",
    { ...(weekday ? { weekday: "long" } : {}), day: "numeric", month: "long", timeZone: "UTC" });
  const kmhText = (v: number | null) => (v == null ? "χωρίς δεδομένα" : `${dec(v)} km/h`);

  const MIN_DAYS = 2;
  const stored = $derived(data.kind === "ok" ? data.s : null);
  const days = $derived(stored?.days ?? []);
  const band = $derived(hourBand(days));
  const types = $derived(byDayType(days));
  const trends = $derived(lineTrends(days, 8));
  const weekend = $derived(types.weekend.days), weekday = $derived(types.weekday.days);
  // The slowest daytime hour, where the charts start for the keyboard.
  const slowest = $derived(band.reduce<number | null>((a, b) => b.h >= 6 && b.kmh != null && (a == null || b.kmh < band[a].kmh!) ? b.h : a, null) ?? 12);
  const peak = $derived(types.weekday.hours.reduce((a, b) => ((b.vehicles ?? 0) > (types.weekday.hours[a].vehicles ?? 0) ? b.h : a), 0));
  const maxPct = $derived(Math.max(0.01, ...[...(trends?.slower ?? []), ...(trends?.faster ?? [])].map(t => Math.abs(t.change))));

  let measured = $state(0);
  const w = $derived(Math.max(240, measured));
  let selBand = $state<number | null>(null), selVeh = $state<number | null>(null), selSpd = $state<number | null>(null);

  const bandText = (i: number) => band[i].kmh == null ? `${hh(i)}: χωρίς δεδομένα`
    : `${hh(i)}: ${dec(band[i].kmh!)} km/h, από ${dec(band[i].min!)} έως ${dec(band[i].max!)} (${band[i].n} μέρες)`;
  const pair = (i: number, f: (t: "weekday" | "weekend") => string) =>
    `${hh(i)}: καθημερινές ${f("weekday")}${weekend ? ` · Σαββατοκύριακα ${f("weekend")}` : ""}`;
  const vehText = (i: number) => pair(i, t => { const v = types[t].hours[i].vehicles; return v == null ? "–" : nf(v); });
  const spdText = (i: number) => pair(i, t => kmhText(types[t].hours[i].kmh));
  const series = (key: "vehicles" | "kmh") => [
    ...(weekday ? [{ values: types.weekday.hours.map(h => h[key]), cls: "" }] : []),
    ...(weekend ? [{ values: types.weekend.hours.map(h => h[key]), cls: "alt" }] : []),
  ];
</script>

{#if data.kind === "loading"}
  <p class="muted">Φόρτωση…</p>
{:else if data.kind === "error"}
  <p class="muted">Οι προηγούμενες μέρες δεν φόρτωσαν.</p>
  <button type="button" class="retry" onclick={load}>Δοκίμασε ξανά</button>
{:else if !stored || days.length < MIN_DAYS}
  <p class="muted">Λίγες μέρες ακόμα: {days.length} πλήρεις. Τα μακροχρόνια γραφήματα χρειάζονται τουλάχιστον {MIN_DAYS}.</p>
{:else}
  <p class="lede">{days.length} πλήρεις μέρες, {dm(days[0].date)} – {dm(days.at(-1)!.date)}: {weekday} καθημερινές και {weekend} {weekend === 1 ? "μέρα" : "μέρες"} Σαββατοκύριακου.
    {#if stored.partial || stored.bad}<br /><span class="warn">Εκτός:
      {#if stored.partial}{stored.partial} {stored.partial === 1 ? "μερική μέρα" : "μερικές μέρες"}{/if}{#if stored.partial && stored.bad}, {/if}{#if stored.bad}{stored.bad} {stored.bad === 1 ? "αρχείο" : "αρχεία"} που δεν διαβάστηκαν{/if}.</span>{/if}</p>

  <section bind:clientWidth={measured}>
    <h3>Ταχύτητα ανά ώρα, όλες οι μέρες</h3>
    <p class="read" aria-live="polite">{bandText(selBand ?? slowest)}</p>
    <HourChart {w} label="Μέση ταχύτητα ανά ώρα με εύρος ημερών" step={10} start={slowest} bind:sel={selBand}
      series={[{ values: band.map(b => b.kmh), cls: "" }]} band={{ min: band.map(b => b.min), max: band.map(b => b.max) }} valuetext={bandText} />
    <p class="note">Η γραμμή: km/h όλων των ημερών μαζί (απόσταση προς χρόνο). Η σκιά: από την πιο αργή έως την πιο γρήγορη μέρα σε κάθε ώρα.</p>
  </section>

  <section>
    <h3>Καθημερινές και Σαββατοκύριακα</h3>
    <p class="legend"><span><i class="key"></i>Δευτέρα–Παρασκευή ({weekday} {weekday === 1 ? "μέρα" : "μέρες"})</span>
      {#if weekend}<span><i class="key alt"></i>Σάββατο–Κυριακή ({weekend} {weekend === 1 ? "μέρα" : "μέρες"})</span>{/if}</p>
    <h4>Οχήματα στον δρόμο</h4>
    <p class="read" aria-live="polite">{vehText(selVeh ?? peak)}</p>
    <HourChart {w} label="Οχήματα ανά ώρα, καθημερινές και Σαββατοκύριακα" step={250} start={peak} bind:sel={selVeh}
      series={series("vehicles")} valuetext={vehText} />
    <h4>Μέση ταχύτητα</h4>
    <p class="read" aria-live="polite">{spdText(selSpd ?? slowest)}</p>
    <HourChart {w} label="Μέση ταχύτητα ανά ώρα, καθημερινές και Σαββατοκύριακα" step={10} start={slowest} bind:sel={selSpd}
      series={series("kmh")} valuetext={spdText} />
    <p class="note">Οχήματα: μέσος όρος των ημερών. Ταχύτητα: όλες οι μέρες κάθε ομάδας μαζί. Οι αργίες μετράνε στην ημέρα της εβδομάδας τους.</p>
  </section>

  <section>
    <h3>Γραμμές που άλλαξαν</h3>
    {#if trends && trends.eligible}
      <p class="read">{dm(trends.date, true)} σε σχέση με {trends.baseDays} προηγούμενες {trends.weekend ? "μέρες Σαββατοκύριακου" : "καθημερινές"}</p>
      <div class="rank">
        {#each [["Πιο αργά", trends.slower], ["Πιο γρήγορα", trends.faster]] as const as [title, rows] (title)}
          <div>
            <h4>{title}</h4>
            {#if rows.length}
              <ol>
                {#each rows as t (t.line)}
                  <li title="{t.line}: {dec(t.base)} → {dec(t.kmh)} km/h ({pct(t.change)})">
                    <b>{t.line}</b><span class="v">{dec(t.base)} → {dec(t.kmh)}</span>
                    <span class="track"><span class:up={t.change > 0} style:width="{(Math.abs(t.change) / maxPct) * 100}%"></span></span>
                    <span class="p">{pct(t.change)}</span>
                  </li>
                {/each}
              </ol>
            {:else}<p class="muted small">Καμία.</p>{/if}
          </div>
        {/each}
      </div>
      <p class="note">km/h της τελευταίας μέρας και των προηγούμενων ίδιου τύπου μαζί. Μόνο γραμμές με τουλάχιστον {MIN_LINE_HOURS} ώρες κίνησης οχημάτων και στις δύο ({trends.eligible} γραμμές).</p>
    {:else}
      <p class="muted">Χρειάζονται τουλάχιστον 2 προηγούμενες πλήρεις μέρες ίδιου τύπου με την τελευταία ({days.at(-1) && dm(days.at(-1)!.date, true)}).</p>
    {/if}
  </section>

  <p class="foot"><a href={DATA_URL} target="_blank" rel="noopener">Δες τα δεδομένα</a> · έως {LONG_DAYS} τελευταίες μέρες, μόνο πλήρεις</p>
{/if}

<style>
  h3 { margin: 0; font-size: 14px; }
  h4 { margin: 10px 0 0; font-size: 12px; color: var(--muted); font-weight: 600; }
  .rank h4 { margin: 0 0 4px; }
  .lede { margin: 0 0 8px; color: var(--muted); }
  .warn { color: var(--late2); }
  .muted { color: var(--muted); }
  .small { margin: 0; font-size: 13px; }
  .retry { min-height: 36px; padding: 0 14px; border: 1px solid var(--border); border-radius: 18px; background: var(--control); cursor: pointer; }
  section { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
  .read { margin: 2px 0 6px; min-height: 20px; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .note { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 6px 0 0; color: var(--muted); font-size: 12px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .key { width: 18px; height: 0; border-top: 2px solid var(--accent); }
  .key.alt { border-top: 2px dashed var(--late2); }
  .rank { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; margin-top: 4px; }
  ol { margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 40px 86px 1fr 40px; align-items: center; gap: 8px; height: 22px; font-size: 13px; }
  li b { text-align: right; }
  .track { height: 10px; border-radius: 2px; background: var(--control); }
  .track span { display: block; height: 100%; border-radius: 2px; background: var(--late2); }
  .track span.up { background: var(--ontime); }
  .v, .p { color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .foot { margin: 18px 0 0; font-size: 12px; color: var(--muted); }
  .foot a { color: var(--accent); }
  @media (max-width: 719px) {
    .rank { grid-template-columns: 1fr; }
  }
</style>
