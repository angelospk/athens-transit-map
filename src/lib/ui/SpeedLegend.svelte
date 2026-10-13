<script lang="ts">
  import { SPEED_STOPS, speedNote, type SpeedMeta } from "../speed";

  // The speed layer's legend: colours, where the numbers come from, and a × that turns the layer off.
  let { meta, onclose }: { meta: SpeedMeta | null; onclose: () => void } = $props();
  const note = $derived(meta && speedNote(meta));
</script>

<section class="legend" aria-label="Ταχύτητα λεωφορείων">
  <header>
    <b>Ταχύτητα λεωφορείων</b>
    <span class="scale" aria-label="από αργά (κόκκινο) σε γρήγορα (μπλε), km/h">
      {#each SPEED_STOPS as [v, c] (v)}<i style:background={c}>{v}</i>{/each}<small>km/h</small>
    </span>
    <button type="button" class="close" aria-label="Κλείσιμο ταχυτήτων" title="Κλείσιμο ταχυτήτων" onclick={onclose}>×</button>
  </header>
  <details>
    <summary>{#if note}{note.period} · {note.samples} μετρήσεις · μαζί με τις στάσεις{:else}Φόρτωση…{/if}</summary>
    <p>
      Διάμεση ταχύτητα ανά κομμάτι από στάση σε στάση{#if note}, από τις θέσεις GPS {note.period} ({note.samples} μετρήσεις,
      τουλάχιστον {note.min} ανά κομμάτι){/if}. Μετράει και την ώρα στις στάσεις: είναι ταχύτητα λεωφορείου, όχι κίνηση
      αυτοκινήτων. Πάτα ένα κομμάτι για km/h.
    </p>
  </details>
</section>

<style>
  .legend { position: absolute; z-index: 1; right: 10px; bottom: 40px; width: 300px; max-width: calc(100% - 20px);
    padding: 4px 10px 6px; border-radius: 10px; background: var(--panel); color: var(--fg); box-shadow: var(--shadow); font-size: 12px; }
  header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  b { font-size: 12px; }
  .scale { display: inline-flex; align-items: center; gap: 2px; }
  .scale i { min-width: 22px; padding: 1px 0; border-radius: 3px; color: #fff; font: 600 11px/14px system-ui, sans-serif;
    font-style: normal; text-align: center; text-shadow: 0 0 2px #000, 0 0 2px #000; }
  .scale small { margin-left: 3px; color: var(--muted); }
  .close { width: 32px; height: 32px; margin: -6px -8px -6px auto; border: 0; border-radius: 8px; background: none; color: var(--muted);
    font-size: 20px; cursor: pointer; }
  .close:hover { background: var(--control); color: var(--fg); }
  summary { margin-top: 2px; color: var(--muted); font-size: 11px; cursor: pointer; }
  p { margin: 4px 0 0; color: var(--muted); font-size: 11px; line-height: 1.35; }
</style>
