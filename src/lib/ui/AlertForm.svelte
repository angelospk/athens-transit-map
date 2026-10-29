<script lang="ts" module>
  // Kept across forms: the last choice of how early.
  const memo = { n: 3 };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { fetchLines } from "../api";
  import { MAX_LINES } from "../selection";
  import { canPush, startPush, stopPush } from "../push";
  import { stopBack } from "../stops";
  import { encodeAlert, MAX_N, type Rep } from "../tglink";
  import { loadTripIndex, type BoardAt, type TripIndex } from "../trip";
  import type { AppState } from "../state.svelte";

  // A stop alert, set up in one place for the trip planner, a stop's card and a vehicle's next stops: how
  // early (stops before, with the stop that means now), which lines, then "Ειδοποίησέ με" (web push when the
  // browser has it, else in the page) or "Στο Telegram"; a weekly repeat goes to Telegram only. lines: the lines that can be watched, each with its variants and the
  // boarding stop in each (indexes of public/trips.json); ticked: the lines ticked at first (all when not
  // given). label: the boarding stop's name. extra: fields the caller adds on top (the planner's stop choice).
  let { app, lines, label, ticked, extra, onstarted }: {
    app: AppState; lines: { line: string; variants: BoardAt[] }[]; label: string; ticked?: string[];
    extra?: Snippet; onstarted?: () => void;
  } = $props();

  const ALERT_S = 2 * 3600;
  const BOT = "oasa_bus_bot";

  // The stop index of the links (the version the bot checks), and whether it is older than the line list.
  let data = $state.raw<{ ix: TripIndex; stale: boolean } | null>(null);
  let failed = $state(false);
  async function load() {
    failed = false;
    try {
      const [ix, ls] = await Promise.all([app.stopIx ? Promise.resolve(app.stopIx) : loadTripIndex(), fetchLines()]);
      data = { ix, stale: ix.v !== ls.gtfs_version };
    } catch { failed = true; }
  }
  load();

  let n = $state(memo.n);
  $effect(() => { memo.n = n; });
  // The lines left unticked; a new set of lines starts again from `ticked`.
  let off = $state<string[]>([]);
  $effect(() => { const all = lines.map(l => l.line), t = ticked; off = t ? all.filter(l => !t.includes(l)) : []; });
  const targets = $derived(lines.filter(l => !off.includes(l.line)));
  const setTicked = (line: string, on: boolean) => { off = on ? off.filter(l => l !== line) : [...off, line]; };

  // Where the bus is when the alert fires, for one line: the stop n before, when every variant has the same.
  const meaning = $derived.by(() => {
    const t = targets.length === 1 ? targets[0] : undefined, ix = data?.ix;
    if (!t || !ix) return null;
    const names = new Set(t.variants.map(v => stopBack(ix, t.line, v.id, v.i, n)));
    return names.size === 1 ? [...names][0] : null;
  });
  const stopsText = (k: number) => (k === 1 ? "1 στάση πριν" : `${k} στάσεις πριν`);

  const payload = $derived(data && !data.stale ? encodeAlert(data.ix, n, targets) : null);
  // Athens time, as the bot reads it.
  const nextFive = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(Date.now() + 5 * 60_000).map(x => [x.type, x.value]));
    return `${p.hour}:${String(Math.floor(+p.minute / 5) * 5).padStart(2, "0")}`;
  };
  let repDays = $state(0);
  // Hours and minutes as two lists: a time input shows AM/PM on phones set to 12 hours.
  const [h0, m0] = nextFive().split(":").map(Number);
  let repH = $state(h0), repM = $state(m0);
  let repLen = $state(60);
  const rep = $derived.by((): Rep | undefined => (repDays ? { days: repDays, start: repH * 60 + repM, len: repLen } : undefined));
  const tgPayload = $derived(repDays ? (rep && data && !data.stale ? encodeAlert(data.ix, n, targets, rep) : null) : payload);
  const tgLink = $derived(tgPayload && `https://t.me/${BOT}?start=${tgPayload}`);

  const canNotify = typeof Notification !== "undefined";
  // iPhones give web push only to a web app opened from the Home Screen.
  const iosTab = typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
    !matchMedia("(display-mode: standalone)").matches && !(navigator as { standalone?: boolean }).standalone;

  let err = $state<string | null>(null);
  let closed = false;
  $effect(() => () => { closed = true; });
  // One alert at a time: a second tap while the first waits (permission, server) does nothing.
  let pushing = $state(false);
  async function alertMe() {
    if (pushing) return;
    pushing = true;
    try { await start(); } finally { pushing = false; }
  }
  // The permission prompt comes first, from the tap itself (browsers ignore it later).
  async function start() {
    const d = data, t = targets, p = payload;
    if (!d || !t.length) return;
    if (canNotify && Notification.permission === "default") await Notification.requestPermission().catch(() => {});
    // Registered before the alert starts: phones show notifications only through it.
    const reg = await navigator.serviceWorker?.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => null);
    if (closed || t !== targets) return;   // the choice changed while the browser asked
    err = null;
    let push: { id: string; until: number } | null = null;
    if (reg && p && canPush() && Notification.permission === "granted") {
      const ready = await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(r, 5000, null))]);
      push = ready && (await startPush(ready, p));
      if (closed || t !== targets || p !== payload) { if (push) void stopPush(push.id); return; }
      if (!push) err = "Η ειδοποίηση δουλεύει μόνο με τη σελίδα ανοιχτή: ο server ειδοποιήσεων δεν απάντησε.";
    }
    // In the page the alert follows the lines on the map: put them there, as many as fit.
    if (!push) {
      const add = t.map(l => l.line).filter(l => !app.selected.includes(l)).slice(0, MAX_LINES - app.selected.length);
      for (const l of add) app.toggleLine(l);
      if (!t.some(l => app.selected.includes(l.line))) {
        err = `Έως ${MAX_LINES} γραμμές στον χάρτη: βγάλε μία για να έρθει η ειδοποίηση εδώ, ή διάλεξε Telegram.`;
        return;
      }
    }
    const ix = d.ix;
    app.setAlert({ n, until: push?.until ?? Math.floor(app.serverMs() / 1000) + ALERT_S, label,
      lines: t.map(l => ({ line: l.line, variants: l.variants.map(v => ({ id: v.id, i: v.i, name: ix.s[v.from][0] })) })),
      ...(push ? { push: push.id } : {}) });
    onstarted?.();
  }
</script>

<div class="form">
  {@render extra?.()}
  {#if failed}
    <p class="warn">Δεν φόρτωσαν οι στάσεις. <button type="button" class="link" onclick={load}>Ξανά</button></p>
  {:else if !data}
    <p class="note">Φόρτωση…</p>
  {:else if data.stale}
    <p class="note">Ειδοποίηση: όχι με παλιά δεδομένα στάσεων.</p>
  {:else}
    <div class="step" role="group" aria-label="Πόσες στάσεις πριν">
      <button type="button" class="pm" aria-label="Μία στάση λιγότερη" disabled={n <= 1} onclick={() => n--}>−</button>
      <p class="num" aria-live="polite"><b>{n}</b><small>{n === 1 ? "στάση πριν" : "στάσεις πριν"}</small></p>
      <button type="button" class="pm" aria-label="Μία στάση περισσότερη" disabled={n >= MAX_N} onclick={() => n++}>+</button>
    </div>
    {#if meaning}
      <div class="mean"><small>Τώρα αυτό σημαίνει</small>
        <p>όταν είναι στο <b>{meaning}</b>, {stopsText(n)}</p></div>
    {/if}
    {#if lines.length > 1 || off.length}
      <fieldset>
        <legend>Γραμμές</legend>
        {#each lines as l (l.line)}
          <label class="ln" style:--c={app.lineColor(l.line).bg}>
            <input type="checkbox" checked={!off.includes(l.line)} onchange={e => setTicked(l.line, e.currentTarget.checked)} /><b>{l.line}</b>
          </label>
        {/each}
      </fieldset>
    {/if}
    <button type="button" class="rep" aria-expanded={!!repDays} onclick={() => (repDays = repDays ? 0 : 31)}>
      <span aria-hidden="true">⟳</span> Κάθε εβδομάδα τέτοια ώρα;<span class="chev" aria-hidden="true">{repDays ? "▾" : "›"}</span></button>
    {#if repDays}
      <label>Μέρες
        <select bind:value={repDays}>
          <option value={31}>τις καθημερινές</option>
          <option value={127}>κάθε μέρα</option>
          <option value={96}>τα Σαββατοκύριακα</option>
        </select>
      </label>
      <label>Από
        <select class="hm" bind:value={repH} aria-label="Ώρα">{#each { length: 24 }, h (h)}<option value={h}>{String(h).padStart(2, "0")}</option>{/each}</select>:<select
          class="hm" bind:value={repM} aria-label="Λεπτά">{#each { length: 12 }, k (k)}<option value={k * 5}>{String(k * 5).padStart(2, "0")}</option>{/each}</select>
        για <select bind:value={repLen}>{#each [[30, "½ ώρα"], [60, "1 ώρα"], [90, "1½ ώρα"], [120, "2 ώρες"]] as const as [m, t] (m)}<option value={m}>{t}</option>{/each}</select>
      </label>
    {/if}
    <div class="go">
      {#if !repDays}
        <button type="button" class="main" disabled={!targets.length || pushing} onclick={alertMe}>{pushing ? "…" : `Ειδοποίησέ με ${stopsText(n)}`}</button>
        {#if tgLink}<a class="tg" href={tgLink} target="_blank" rel="noopener">ή στο Telegram</a>{/if}
      {:else if tgLink}
        <a class="main" href={tgLink} target="_blank" rel="noopener">Στο Telegram, κάθε εβδομάδα</a>
      {:else if targets.length}<small class="warn">Διάλεξε ώρα έναρξης, ώστε να τελειώνει ως τα μεσάνυχτα.</small>{/if}
    </div>
    {#if err}<p class="warn" role="status">{err}</p>{/if}
    {#if repDays}
      <p class="note">Η επανάληψη γίνεται στο Telegram (@{BOT}): σου γράφει κάθε φορά που ένα λεωφορείο πλησιάζει, μόνο σε αυτές τις ώρες.
        Εκεί, /list δείχνει τις ειδοποιήσεις σου και τις σταματάει.</p>
    {:else}
      <p class="note">Για 2 ώρες,
        {#if canPush()}και με κλειστή σελίδα ή κλειδωμένη οθόνη.
        {:else}όσο η σελίδα είναι ανοιχτή{canNotify ? "" : ", μόνο μέσα στη σελίδα"}. Στο Telegram και με κλειδωμένη οθόνη.{/if}</p>
    {/if}
    {#if iosTab && !repDays}
      <p class="note">iPhone, για ειδοποίηση εδώ με κλειδωμένη οθόνη: Κοινοποίηση → «Προσθήκη στην οθόνη Αφετηρίας», και άνοιξε τον χάρτη από το εικονίδιο.</p>
    {/if}
  {/if}
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; font-size: 13px; }
  .form > label { display: flex; align-items: center; gap: 8px; color: var(--muted); }
  .form > label select { flex: 1; min-width: 0; }
  .form > label select.hm { flex: none; font-variant-numeric: tabular-nums; }
  fieldset { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; padding: 0; border: 0; }
  legend { float: left; margin-right: 2px; color: var(--muted); }
  .ln { display: inline-flex; align-items: center; gap: 4px; min-height: 30px; padding: 0 8px; border: 2px solid var(--c);
    border-radius: 12px; font-size: 12px; cursor: pointer; }
  .ln input { margin: 0; accent-color: var(--c); }
  .step { display: flex; align-items: center; justify-content: center; gap: 24px; margin: 4px 0 0; }
  .pm { width: 48px; height: 48px; border: 0; border-radius: 50%; background: var(--control); color: var(--fg);
    font-size: 24px; line-height: 1; cursor: pointer; }
  .pm:disabled { opacity: .35; cursor: default; }
  .num { display: flex; flex-direction: column; align-items: center; min-width: 96px; margin: 0; }
  .num b { font-size: 44px; line-height: 1; font-weight: 700; font-variant-numeric: tabular-nums; }
  .num small { color: var(--muted); font-size: 13px; }
  .mean { padding: 10px 12px; border-radius: 12px; background: var(--control); }
  .mean small { display: block; color: var(--muted); font-size: 12px; font-weight: 600; }
  .mean p { margin: 2px 0 0; font-size: 14px; }
  .rep { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 2px; border: 0; background: none; color: var(--fg);
    font: inherit; font-size: 14px; font-weight: 600; text-align: left; cursor: pointer; }
  .rep .chev { margin-left: auto; color: var(--muted); }
  .go { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
  .main { display: grid; place-items: center; min-height: 46px; padding: 0 16px; border: 0; border-radius: 23px; background: var(--fg);
    color: var(--bg); font: inherit; font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer; }
  .main:disabled { opacity: .5; cursor: default; }
  .tg { align-self: center; color: var(--accent); font-size: 13px; font-weight: 600; }
  select { min-height: 34px; padding: 0 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--control);
    color: var(--fg); font-size: 16px; }
  .note { display: block; margin: 0; color: var(--muted); font-size: 12px; }
  .warn { margin: 0; color: var(--late2); }
  .link { border: 0; background: none; color: var(--accent); text-decoration: underline; cursor: pointer; font-size: inherit; }
</style>
