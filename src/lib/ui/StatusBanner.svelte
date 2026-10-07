<script lang="ts">
  import { STALE_S, type AppState } from "../state.svelte";

  let { app }: { app: AppState } = $props();

  // YYYY-MM-DD in Athens; GTFS end dates are inclusive.
  const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
  const GTFS_PAGE = "https://data.gov.gr/dataset/fb049bb1-aea6-4443-95fa-8b941dd6a057";
  // "2026-10-06" -> "6/10"
  const dayMonth = (d: string) => d.slice(5).split("-").reverse().map(Number).join("/");

  const gtfsExpired = $derived(!!app.status?.gtfs_expires && app.status.gtfs_expires < today());

  const messages = $derived.by(() => {
    const out: string[] = [];
    if (app.statusFailed && !app.status) out.push("Δεν υπάρχει σύνδεση με τον διακομιστή δεδομένων. Νέα προσπάθεια σε λίγο.");
    if (app.status && !app.status.ok) out.push("Ο διακομιστής δεδομένων έχει προσωρινό πρόβλημα. Τα στοιχεία μπορεί να μην είναι ενημερωμένα.");
    const stale = app.selected.filter(l => app.live[l] && app.serverNow / 1000 - app.live[l].updated_at > STALE_S);
    if (stale.length) out.push(`Χωρίς ενημέρωση πάνω από 2 λεπτά: ${stale.join(", ")}.`);
    return out;
  });
</script>

{#if messages.length || app.notice || gtfsExpired}
  <div class="warn" role="status">
    {#if app.notice}<p>{app.notice}</p>{/if}
    {#if gtfsExpired && app.status}
      <details>
        <summary>Το πρόγραμμα του ΟΑΣΑ έληξε στις {dayMonth(app.status.gtfs_expires)}· οι καθυστερήσεις είναι κατά προσέγγιση.</summary>
        <p>Ο ΟΑΣΑ δεν έχει δημοσιεύσει ακόμα νέο πρόγραμμα δρομολογίων (GTFS). Ο χάρτης χρησιμοποιεί το
          τελευταίο, που ίσχυε έως {app.status.gtfs_expires}. Οι θέσεις των οχημάτων είναι ζωντανές· οι
          καθυστερήσεις και τα δρομολόγια βγαίνουν από το παλιό πρόγραμμα. Μόλις βγει νέο, ο χάρτης το
          παίρνει αυτόματα.</p>
        <p><a href={GTFS_PAGE} target="_blank" rel="noopener">Το αρχείο του ΟΑΣΑ στο data.gov.gr</a></p>
      </details>
    {/if}
    {#each messages as m (m)}<p>{m}</p>{/each}
  </div>
{/if}

<style>
  .warn { margin-top: 10px; padding: 6px 10px; border-radius: 8px; background: var(--warn-bg); font-size: 12px; }
  p { margin: 2px 0; }
  summary { cursor: pointer; margin: 2px 0; }
  details p { opacity: 0.85; }
  a { color: inherit; }
</style>
