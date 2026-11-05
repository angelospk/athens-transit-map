<script lang="ts">
  // «Κάτι δεν ισχύει;» on a municipal route or stop (MapView's popup): what the map showed is filled in
  // (municipality, line, stop, the times, when), the user picks what went wrong and may add details. It goes
  // to the feedback sheet (feedback.ts) as one text, marked [Δημοτικά], for a person to check the timetable.
  import type { AppState } from "../state.svelte";
  import { athensClock, reportText } from "../muniTimes";
  import { sendFeedback, MAX_TEXT } from "../feedback";
  import { VERSION } from "../version";
  import { diag } from "../diag";
  import BotCheck from "./BotCheck.svelte";

  let { app }: { app: AppState } = $props();

  const KINDS = ["Δεν πέρασε", "Πέρασε άλλη ώρα", "Άλλη διαδρομή ή στάση", "Δεν κυκλοφορεί πια", "Άλλο"] as const;
  const r = $derived(app.muniReport);
  let pick = $state(0);   // which line, when the stop has several
  let kind = $state<string>("");
  let text = $state("");
  let status = $state<"edit" | "sending" | "done" | "failed">("edit");
  let bot = $state<BotCheck>();
  let dlg: HTMLDialogElement;

  // A new report starts clean; the dialog follows the state.
  $effect(() => {
    if (r) { pick = 0; kind = ""; text = ""; status = "edit"; if (!dlg.open) dlg.showModal(); }
    else if (dlg.open) dlg.close();
  });

  const item = $derived(r?.items[Math.min(pick, r.items.length - 1)]);
  const clock = $derived(athensClock(app.serverNow));
  const ok = $derived(!!item && !!kind && (kind !== "Άλλο" || text.trim().length >= 3) && status !== "sending");
  const close = () => (app.muniReport = null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!ok || !item || !r) return;
    status = "sending";
    const turnstile = (await bot?.token()) ?? "";
    const body = reportText({ table: item.table, line: item.line, stop: r.stop, shown: item.shown, clock, kind, text: text.trim() });
    const sent = await sendFeedback({ text: body, version: VERSION, page: location.pathname + location.search,
      ua: `${navigator.userAgent} · ${innerWidth}×${innerHeight}`, diag: diag.snapshot(), turnstile });
    status = sent ? "done" : "failed";
  }
</script>

<dialog bind:this={dlg} class="sheet" aria-labelledby="muni-report-title" onclose={close}
  onclick={e => { if (e.target === dlg) close(); }}>
  <div class="body">
    <header>
      <h2 id="muni-report-title">Κάτι δεν ισχύει;</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={close}>
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </button>
    </header>
    {#if r && item}
      {#if status === "done"}
        <p class="done" role="status">Ευχαριστούμε. Θα ελέγξουμε το ωράριο με την πηγή του δήμου.</p>
        <button type="button" class="send" onclick={close}>Κλείσιμο</button>
      {:else}
        <form onsubmit={submit}>
          <dl class="what">
            <dt>Δήμος</dt><dd>{item.table.municipality.replace(/^Δήμος /, "")}</dd>
            <dt>Γραμμή</dt>
            <dd>
              {#if r.items.length > 1}
                <select bind:value={pick} aria-label="Γραμμή">
                  {#each r.items as it, i (i)}<option value={i}>{it.line.ref ? `${it.line.ref} · ${it.line.name}` : it.line.name}</option>{/each}
                </select>
              {:else}{item.line.ref ? `${item.line.ref} · ` : ""}{item.line.name}{/if}
            </dd>
            {#if r.stop}<dt>Στάση</dt><dd>{r.stop}</dd>{/if}
            <dt>Έδειξε</dt><dd>{item.shown.length ? item.shown.join(" · ") : "κανένα άλλο σήμερα"}</dd>
          </dl>
          <fieldset class="kinds">
            <legend>Τι δεν ισχύει;</legend>
            {#each KINDS as k (k)}
              <label class:on={kind === k}><input type="radio" name="kind" value={k} bind:group={kind} />{k}</label>
            {/each}
          </fieldset>
          <label class="more">
            <span>Λεπτομέρειες {kind === "Άλλο" ? "" : "(προαιρετικά)"}</span>
            <textarea bind:value={text} rows="3" maxlength={MAX_TEXT - 400}
              placeholder="π.χ. Περίμενα από τις 14:00, πέρασε 14:25. Ή: Στη στάση γράφει άλλο ωράριο."></textarea>
          </label>
          <p class="note">Στέλνονται τα παραπάνω και η ώρα τώρα ({clock.date.split("-").reverse().join("/")}, {String(Math.floor(clock.minutes / 60)).padStart(2, "0")}:{String(clock.minutes % 60).padStart(2, "0")}). Όχι η θέση σου.</p>
          <BotCheck bind:this={bot} active={!!r} />
          {#if status === "failed"}<p class="err" role="alert">Δεν στάλθηκε. Δοκίμασε ξανά.</p>{/if}
          <button type="submit" class="send" disabled={!ok}>{status === "sending" ? "Αποστολή…" : "Αποστολή"}</button>
        </form>
      {/if}
    {/if}
  </div>
</dialog>

<style>
  .sheet { width: min(440px, calc(100% - 32px)); max-height: calc(100% - 48px); padding: 0; border: 1px solid var(--border);
    border-radius: 16px; background: var(--bg); color: var(--fg); box-shadow: var(--shadow); overscroll-behavior: contain; }
  .sheet::backdrop { background: rgba(0, 0, 0, .4); }
  .body { padding: 16px 18px 18px; }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  h2 { flex: 1; margin: 0; font-size: 17px; }
  .close { display: grid; place-items: center; width: 36px; height: 36px; margin: -6px -8px -6px 0; border: 0;
    border-radius: 8px; background: none; color: var(--muted); cursor: pointer; }
  .what { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0 0 12px; padding: 8px 10px;
    border-radius: 8px; background: var(--control); font-size: 13px; }
  .what dt { color: var(--muted); }
  .what dd { margin: 0; font-variant-numeric: tabular-nums; }
  .what select { max-width: 100%; font-size: 16px; }
  .kinds { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; padding: 0; border: 0; }
  .kinds legend { margin-bottom: 6px; font-size: 13px; font-weight: 600; }
  .kinds label { padding: 7px 11px; border: 1px solid var(--border); border-radius: 999px; font-size: 13px; cursor: pointer; }
  .kinds label.on { border-color: var(--accent); background: var(--accent); color: #fff; }
  .kinds input { position: absolute; opacity: 0; pointer-events: none; }
  .kinds label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .more { display: grid; gap: 4px; font-size: 13px; }
  textarea { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg); color: var(--fg); font: inherit; font-size: 16px; resize: vertical; }
  .note { margin: 8px 0; color: var(--muted); font-size: 12px; }
  .err { color: var(--danger, #c0392b); font-size: 13px; }
  .send { width: 100%; min-height: 44px; margin-top: 4px; border: 0; border-radius: 10px; background: var(--accent);
    color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  .send:disabled { opacity: .45; cursor: default; }
  .done { font-size: 15px; }
  @media (max-width: 719px) {
    .sheet { width: 100%; max-width: none; max-height: 90%; margin: auto 0 0; border-radius: 16px 16px 0 0; border-width: 1px 0 0; }
    .body { padding-bottom: calc(18px + env(safe-area-inset-bottom)); }
  }
</style>
