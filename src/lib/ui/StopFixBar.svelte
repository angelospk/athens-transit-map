<script lang="ts">
  // «Λάθος θέση;» of the stop card: a short bar at the bottom while the user drags the blue pin (MapView) to
  // where the pole stands. The report goes to the feedback path (feedback.ts) with the stop id and the pin's
  // lat/lon; nothing moves on the map. One report per device per stop (stopfix.ts remembers it); a pin more
  // than MAX_MOVE_M from the stop is not sent. Escape (StopCard) cancels.
  import type { AppState } from "../state.svelte";
  import type { IdeaStatus } from "../idea";
  import { sendFeedback } from "../feedback";
  import { MAX_MOVE_M, deviceId, distM, markReported, stopReportText } from "../stopfix";
  import { VERSION } from "../version";

  let { app, ondone }: { app: AppState; ondone: () => void } = $props();
  let status = $state<IdeaStatus>("edit");

  const f = $derived(app.stopFix);
  const at = $derived(app.stopFixAt ?? f?.from);
  const moved = $derived(f && at ? Math.round(distM(f.from, at)) : 0);
  const tooFar = $derived(moved > MAX_MOVE_M);
  const ok = $derived(!!f && moved >= 3 && !tooFar && status !== "sending");

  const close = () => { app.stopFix = null; app.stopFixAt = null; ondone(); };

  // The stop and pin are taken before the send: the user may cancel or open another stop meanwhile.
  async function send() {
    if (!ok || !f || !at) return;
    const target = f, pos = at;
    status = "sending";
    const text = stopReportText({ stop: target.id, name: target.name, from: target.from, lat: pos[0], lon: pos[1], device: deviceId(), at: Date.now() });
    const sent = await sendFeedback({ text, version: VERSION, page: location.pathname + location.search,
      ua: `${navigator.userAgent} · ${innerWidth}×${innerHeight}` });
    if (sent) markReported(target.id);
    if (app.stopFix !== target) return;   // closed or another stop: nothing to show here
    status = sent ? "done" : "failed";
  }
</script>

<section class="fixbar" aria-label="Διόρθωση θέσης στάσης {f?.name ?? ''}">
  {#if status === "done"}
    <p class="title" role="status">Ευχαριστούμε, το πήραμε!</p>
    <p class="hint">Η στάση δεν αλλάζει αμέσως: κάθε πρόταση ελέγχεται με τα GPS των λεωφορείων.</p>
    <div class="row"><button type="button" class="btn primary" onclick={close}>Κλείσιμο</button></div>
  {:else}
    <p class="title">Σύρε την μπλε πινέζα στο κολωνάκι, ή πάτα εκεί</p>
    <p class="hint" class:err={tooFar || status === "failed"} aria-live="polite">
      {#if tooFar}Πάνω από {MAX_MOVE_M} μ από τη στάση. Φέρ’ την πιο κοντά.
      {:else if status === "failed"}Δεν στάλθηκε. Έλεγξε τη σύνδεση και ξαναδοκίμασε.
      {:else if moved < 3}Η κόκκινη πινέζα είναι η θέση που ξέρουμε.
      {:else}Μετακίνηση {moved} μ.{/if}
    </p>
    <div class="row">
      <button type="button" class="btn" onclick={close} disabled={status === "sending"}>Άκυρο</button>
      <button type="button" class="btn primary" onclick={send} disabled={!ok}>{status === "sending" ? "Αποστολή…" : "Αποστολή"}</button>
    </div>
    <p class="fine">Στέλνεται η θέση της πινέζας, η στάση και ένας τυχαίος κωδικός συσκευής.</p>
  {/if}
</section>

<style>
  .fixbar { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 360px; padding: 12px 16px; box-sizing: border-box;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); backdrop-filter: blur(8px); }
  p { margin: 0; }
  .title { font-size: 15px; font-weight: 600; }
  .hint { margin-top: 2px; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .err { color: var(--late3); }
  .row { display: flex; gap: 8px; margin-top: 10px; }
  .btn { flex: 1; min-height: 44px; border: 0; border-radius: 10px; background: var(--control); color: var(--fg); font: inherit;
    font-size: 14px; font-weight: 600; cursor: pointer; }
  .primary { background: var(--accent); color: #fff; }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .fine { margin-top: 6px; color: var(--muted); font-size: 11px; text-align: center; }
  @media (max-width: 719px) {
    .fixbar { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 12px 16px calc(10px + env(safe-area-inset-bottom)); }
  }
</style>
