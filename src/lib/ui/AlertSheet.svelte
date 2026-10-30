<script lang="ts">
  import AlertForm from "./AlertForm.svelte";
  import RailAlertForm from "./RailAlertForm.svelte";
  import type { RailSpec } from "../railAlerts";
  import type { BoardAt } from "../trip";
  import type { AppState } from "../state.svelte";

  // The alert form in a sheet over the map, as the phone app has it: "Ειδοποίησέ με στο <stop>", the line
  // and where it goes (when there is one line), the form (a bus's, or with rail a metro, tram or suburban one; color: its line's). A modal <dialog>: focus stays in it, Escape or a
  // tap outside closes it, and the browser gives focus back to the bell that opened it.
  let { app, lines = [], rail, color, label, line, toward, ticked, onclose }: {
    app: AppState; lines?: { line: string; variants: BoardAt[] }[]; rail?: Omit<RailSpec, "min" | "until">; color?: { bg: string; fg: string };
    label: string; line?: string; toward?: string; ticked?: string[]; onclose: () => void;
  } = $props();

  const c = $derived(color ?? (line ? app.lineColor(line) : null));
  let dlg = $state<HTMLDialogElement>();
  $effect(() => {
    const d = dlg;
    if (!d) return;
    d.showModal();
    return () => d.close();
  });
</script>

<dialog bind:this={dlg} aria-labelledby="alert-sheet-title" onclose={onclose}
  onclick={e => { if (e.target === dlg) dlg?.close(); }}>
  <span class="handle" aria-hidden="true"></span>
  <header>
    {#if line && c}<b class="chip" style:--bg={c.bg} style:--fg={c.fg}>{line}</b>{/if}
    <div class="t">
      <h2 id="alert-sheet-title">Ειδοποίησέ με στο {label}</h2>
      {#if toward}<p>προς {toward}</p>{/if}
    </div>
    <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => dlg?.close()}>×</button>
  </header>
  {#if rail}
    <RailAlertForm {app} {rail} onstarted={() => dlg?.close()} />
  {:else}
    <AlertForm {app} {lines} {label} {ticked} onstarted={() => dlg?.close()} />
  {/if}
</dialog>

<style>
  dialog { inset: auto 0 0; width: min(100%, 420px); max-width: none; max-height: calc(100dvh - 48px); margin: 0 auto;
    overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
    border: 0; border-radius: 20px 20px 0 0; background: var(--bg); color: var(--fg); box-shadow: var(--shadow); }
  dialog::backdrop { background: rgba(0, 0, 0, .32); }
  .handle { display: block; width: 36px; height: 4px; margin: 0 auto 12px; border-radius: 2px; background: var(--border); }
  header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
  .chip { flex: none; min-width: 40px; margin-top: 2px; padding: 6px 8px; border-radius: 8px; background: var(--bg); color: var(--fg);
    font-size: 15px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; }
  .t { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 18px; font-weight: 600; }
  .t p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
  .close { flex: none; width: 36px; height: 36px; margin: -4px -8px 0 0; border: 0; border-radius: 8px; background: none;
    color: var(--muted); font-size: 22px; cursor: pointer; }
  .close:hover { background: var(--control); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
