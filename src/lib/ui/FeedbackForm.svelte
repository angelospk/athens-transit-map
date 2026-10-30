<script lang="ts">
  // Feedback, a tab of the ⓘ sheet: free text plus an optional screenshot, sent with the version and
  // the page (feedback.ts). After sending: thanks and a follow link on X.
  // It stays mounted while the sheet is (hidden tab), so leaving the tab mid-send loses nothing.
  import { FOLLOW_URL, type IdeaStatus } from "../idea";
  import { FEEDBACK_URL, MAX_TEXT, canSendFeedback, sendFeedback, shrinkImage } from "../feedback";
  import { VERSION } from "../version";
  import { diag } from "../diag";

  // visible: the tab is shown; leaving it after the thanks brings the form back.
  let { visible }: { visible: boolean } = $props();

  let draft = $state("");
  let status = $state<IdeaStatus>("edit");
  let image = $state<{ type: string; data: string } | null>(null);
  let preview = $state("");
  let imageErr = $state(false);
  let converting = $state(false); // a picked image is being shrunk: no send until it is ready
  let input = $state<HTMLInputElement>();

  const ok = $derived(canSendFeedback(draft) && status !== "sending" && !converting);
  $effect(() => { if (!visible && status === "done") status = "edit"; });

  async function pick() {
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (!file) return;
    imageErr = false;
    converting = true;
    try {
      image = await shrinkImage(file);
      preview = `data:${image.type};base64,${image.data}`;
    } catch { image = null; preview = ""; imageErr = true; }
    converting = false;
  }
  // Everything but the text and the image, as sent; «Τι στέλνεται» shows it.
  const context = () => ({ version: VERSION, page: location.pathname + location.search,
    ua: `${navigator.userAgent} · ${innerWidth}×${innerHeight}`, diag: diag.snapshot() });
  let shown = $state("");

  function dropImage() { image = null; preview = ""; imageErr = false; }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!ok) return;
    status = "sending";
    const sent = await sendFeedback({ ...context(), text: draft, ...(image ? { image } : {}) });
    if (!sent) { status = "failed"; return; }
    draft = "";
    dropImage();
    status = "done";
  }
</script>

{#if status === "done"}
  <div class="done" role="status">
    <span class="tick" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </span>
    <h3>Ευχαριστούμε, το πήραμε!</h3>
    <p>Θες να μαθαίνεις τα νέα της εφαρμογής;</p>
    <a class="btn follow" href={FOLLOW_URL} target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" /></svg>
      Ακολούθησε το @twiceuponatimes
    </a>
  </div>
{:else}
  <form onsubmit={submit}>
    <h3>Γνώμη ή πρόβλημα;</h3>
    <p>Τι δεν δούλεψε, τι σου άρεσε, τι θα ήθελες να έχει;</p>
    <textarea id="feedback-text" bind:value={draft} maxlength={MAX_TEXT} rows="4" aria-label="Η γνώμη σου" readonly={status === "sending"}
      placeholder="π.χ. στη στάση Πειραιάς το 040 έδειχνε 3′ αλλά ήρθε σε 10′"></textarea>
    {#if FEEDBACK_URL}
      <input bind:this={input} type="file" accept="image/*" hidden onchange={pick} />
      {#if preview}
        <div class="shot">
          <img src={preview} alt="Η εικόνα που θα σταλεί" />
          <span>Εικόνα μαζί</span>
          <button type="button" class="x" aria-label="Αφαίρεση εικόνας" onclick={dropImage} disabled={status === "sending"}>
            <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </button>
        </div>
      {:else}
        <button type="button" class="btn attach" onclick={() => input?.click()} disabled={status === "sending" || converting}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></svg>
          {converting ? "Ετοιμάζεται η εικόνα…" : "Πρόσθεσε screenshot"}
        </button>
      {/if}
      {#if imageErr}<span class="err" role="alert">Η εικόνα δεν διαβάστηκε. Δοκίμασε άλλη.</span>{/if}
    {/if}
    <div class="meta">
      {#if status === "failed"}<span class="err" role="alert">Δεν στάλθηκε. Έλεγξε τη σύνδεση και ξαναδοκίμασε σε λίγο.</span>{:else}<span></span>{/if}
      <span>{draft.length}/{MAX_TEXT}</span>
    </div>
    <button class="btn send" type="submit" disabled={!ok}>{status === "sending" ? "Αποστολή…" : "Αποστολή"}</button>
    <p class="fine">Δεν στέλνεται όνομα ή email. Μαζί πάνε αυτόματα η σελίδα που βλέπεις, η έκδοση, η συσκευή και τα
      τελευταία αιτήματα και σφάλματα της σελίδας, για να βρούμε το πρόβλημα. Και η εικόνα, αν βάλεις.</p>
    <details ontoggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) shown = JSON.stringify(context(), null, 1); }}>
      <summary>Τι στέλνεται</summary>
      <pre>{shown}</pre>
    </details>
  </form>
{/if}

<style>
  form, .done { display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; font-size: 15px; }
  p { margin: 0; color: var(--muted); }
  /* 16px: iOS zooms into smaller inputs. */
  textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 88px; padding: 8px 10px; border: 1px solid var(--border);
    border-radius: 10px; background: var(--bg); color: var(--fg); font: inherit; font-size: 16px; line-height: 1.4; }
  textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .meta { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .err { color: var(--late3); font-size: 12px; }
  .btn { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; border: 0; border-radius: 10px;
    font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; }
  .attach { background: var(--control); color: var(--fg); }
  .shot { display: flex; align-items: center; gap: 10px; padding: 6px; border: 1px solid var(--border); border-radius: 10px; font-size: 13px; }
  .shot img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; }
  .shot span { flex: 1; color: var(--muted); }
  .x { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 8px; background: none; color: var(--muted); cursor: pointer; }
  .send { background: var(--accent); color: #fff; }
  .send:disabled { opacity: .45; cursor: default; }
  .follow { align-self: stretch; background: var(--fg); color: var(--bg); }   /* black in light, white in dark */
  .fine { font-size: 11px; text-align: center; }
  details { font-size: 12px; color: var(--muted); text-align: center; }
  summary { cursor: pointer; min-height: 32px; line-height: 32px; }
  pre { max-height: 200px; overflow: auto; margin: 4px 0 0; padding: 8px; border-radius: 8px; background: var(--control);
    text-align: left; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
  .done { align-items: center; text-align: center; }
  .tick { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--ontime);
    background: color-mix(in srgb, var(--ontime) 14%, transparent); }
</style>
