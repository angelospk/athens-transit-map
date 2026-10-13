<script lang="ts">
  import { DEMO_VIDEO_URL } from "../config";
  import { STALE_S, type AppState } from "../state.svelte";

  let { app }: { app: AppState } = $props();

  // The last /v1/status call failed (also after earlier successes).
  const offline = $derived(app.statusFailed);
  const messages = $derived.by(() => {
    const out: string[] = [];
    if (offline) out.push("Δεν υπάρχει σύνδεση με τον διακομιστή δεδομένων. Νέα προσπάθεια σε λίγο.");
    if (!offline && app.status && !app.status.ok) out.push("Ο διακομιστής δεδομένων έχει προσωρινό πρόβλημα. Τα στοιχεία μπορεί να μην είναι ενημερωμένα.");
    const stale = app.selected.filter(l => app.live[l] && app.serverNow / 1000 - app.live[l].updated_at > STALE_S);
    if (stale.length) out.push(`Χωρίς ενημέρωση πάνω από 2 λεπτά: ${stale.join(", ")}.`);
    return out;
  });
</script>

{#if messages.length || app.notice}
  <div class="warn" role="status">
    {#if app.notice}<p>{app.notice}</p>{/if}
    {#each messages as m (m)}<p>{m}</p>{/each}
    {#if offline && DEMO_VIDEO_URL}<p><a href={DEMO_VIDEO_URL} target="_blank" rel="noopener">Δες πώς δουλεύει</a></p>{/if}
  </div>
{/if}

<style>
  .warn { margin-top: 10px; padding: 6px 10px; border-radius: 8px; background: var(--warn-bg); font-size: 12px; }
  p { margin: 2px 0; }
  a { color: inherit; font-weight: 600; }
</style>
