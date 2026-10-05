<script lang="ts">
  import { STALE_S, type AppState } from "../state.svelte";

  let { app }: { app: AppState } = $props();

  // YYYY-MM-DD in Athens; GTFS end dates are inclusive.
  const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });

  const messages = $derived.by(() => {
    const out: string[] = [];
    if (app.statusFailed && !app.status) out.push("Δεν υπάρχει σύνδεση με τον διακομιστή δεδομένων. Νέα προσπάθεια σε λίγο.");
    if (app.status && !app.status.ok) out.push("Ο διακομιστής δεδομένων έχει προσωρινό πρόβλημα. Τα στοιχεία μπορεί να μην είναι ενημερωμένα.");
    if (app.status?.gtfs_expires && app.status.gtfs_expires < today())
      out.push(`Τα δρομολόγια ΟΑΣΑ στον διακομιστή έληξαν (${app.status.gtfs_expires}). Οι καθυστερήσεις μπορεί να μην είναι σωστές.`);
    const stale = app.selected.filter(l => app.live[l] && app.serverNow / 1000 - app.live[l].updated_at > STALE_S);
    if (stale.length) out.push(`Χωρίς ενημέρωση πάνω από 2 λεπτά: ${stale.join(", ")}.`);
    return out;
  });
</script>

{#if messages.length || app.notice}
  <div class="warn" role="status">
    {#if app.notice}<p>{app.notice}</p>{/if}
    {#each messages as m (m)}<p>{m}</p>{/each}
  </div>
{/if}

<style>
  .warn { margin-top: 10px; padding: 6px 10px; border-radius: 8px; background: var(--warn-bg); font-size: 12px; }
  p { margin: 2px 0; }
</style>
