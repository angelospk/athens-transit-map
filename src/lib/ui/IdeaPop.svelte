<script lang="ts">
  // The idea box, a tab of the ⓘ sheet: one free-text question, sent to a Google Form from the page itself.
  // After sending: thanks and a follow link on X, the only way to hear when the app is out.
  // The request and its state live in the sheet (InfoDialog), so leaving the tab mid-send loses nothing.
  import { FOLLOW_URL, MAX_IDEA, canSend, type IdeaStatus } from "../idea";

  let { draft = $bindable(""), status, onsubmit }: { draft?: string; status: IdeaStatus; onsubmit: () => void } = $props();

  const ok = $derived(canSend(draft) && status !== "sending");
  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (ok) onsubmit();
  }
</script>

{#if status === "done"}
  <div class="done" role="status">
    <span class="tick" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </span>
    <h3>Ευχαριστούμε, την πήραμε!</h3>
    <p>Θες να μάθεις πρώτος πότε βγαίνει η εφαρμογή;</p>
    <a class="btn follow" href={FOLLOW_URL} target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" /></svg>
      Ακολούθησε το @twiceuponatimes
    </a>
  </div>
{:else}
  <form onsubmit={submit}>
    <h3>Η σελίδα γίνεται εφαρμογή</h3>
    <p>Τι θα ήθελες να έχει; Αν μπορούσε να κάνει κάτι που καμία άλλη εφαρμογή για λεωφορεία δεν κάνει, τι θα ήταν;</p>
    <textarea id="idea-text" bind:value={draft} maxlength={MAX_IDEA} rows="4" aria-label="Η ιδέα σου" readonly={status === "sending"}
      placeholder="π.χ. ειδοποίηση όταν το 040 είναι 5′ μακριά από τη στάση μου"></textarea>
    <div class="meta">
      {#if status === "failed"}<span class="err" role="alert">Δεν στάλθηκε. Έλεγξε τη σύνδεση και πάτα ξανά «Αποστολή».</span>{:else}<span></span>{/if}
      <span>{draft.length}/{MAX_IDEA}</span>
    </div>
    <button class="btn send" type="submit" disabled={!ok}>{status === "sending" ? "Αποστολή…" : "Αποστολή"}</button>
    <p class="fine">Η ιδέα στέλνεται χωρίς όνομα, email ή τοποθεσία.</p>
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
  .err { color: var(--late3); }
  .btn { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; border: 0; border-radius: 10px;
    font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; }
  .send { background: var(--accent); color: #fff; }
  .send:disabled { opacity: .45; cursor: default; }
  .follow { align-self: stretch; background: var(--fg); color: var(--bg); }   /* black in light, white in dark */
  .fine { font-size: 11px; text-align: center; }
  .done { align-items: center; text-align: center; }
  .tick { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--ontime);
    background: color-mix(in srgb, var(--ontime) 14%, transparent); }
</style>
