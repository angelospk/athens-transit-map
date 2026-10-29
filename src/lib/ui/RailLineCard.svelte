<script lang="ts">
  import { termini } from "../metro";
  import { clockHM, lineTrains } from "../trains";
  import type { AppState } from "../state.svelte";
  import Back from "./Back.svelte";

  // A metro/tram line or a suburban corridor on its own, as a bus route is: its track on the map (MapView),
  // and here its trains now by destination, each with its next stop; a tap opens the train and brings it into view.
  let { app }: { app: AppState } = $props();

  const sel = $derived(app.railLine);
  const metroLine = $derived(sel?.kind === "metro" ? app.metro?.lines.find(l => l.id === sel.id) : undefined);
  const corridor = $derived(sel?.kind === "suburban" ? app.suburban?.corridors[sel.id] : undefined);
  const color = $derived(metroLine?.color ?? corridor?.color ?? "#666666");
  const title = $derived.by(() => {
    if (metroLine && app.metro) { const t = termini(app.metro, metroLine.id); return t ? `${t[0]} – ${t[1]}` : metroLine.name; }
    return corridor?.name ?? "";
  });
  const nowS = $derived(app.serverNow / 1000);
  const trains = $derived(sel ? lineTrains(sel, app.stasyTrains, app.suburbanTrains, nowS, app.stasyMotion) : []);
  const groups = $derived.by(() => {
    const out: { to: string; list: typeof trains }[] = [];
    for (const t of trains) {
      const g = out.find(x => x.to === t.to);
      if (g) g.list.push(t); else out.push({ to: t.to, list: [t] });
    }
    return out;
  });
  const when = (at: number) => { const m = Math.round((at - nowS) / 60); return m <= 0 ? "τώρα" : m < 60 ? `${m}′` : clockHM(at); };
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && app.railLine) app.closeCards(); }} />

{#if sel && (metroLine || corridor)}
  <section class="card" aria-live="polite" aria-label="Γραμμή {metroLine?.id ?? corridor?.name}">
    <header>
      <Back {app} />
      <b class="chip" style:--accent={color}>{metroLine?.id ?? "Π"}</b>
      <h2>{title}</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.closeCards()}>×</button>
    </header>
    <p class="src">{sel.kind === "metro" ? "Θέσεις κατά προσέγγιση, από το πρόγραμμα της ΣΤΑΣΥ, όχι live." : "Θέσεις από το GPS των τρένων (Hellenic Train)."}</p>
    {#if !app.trainsOn}
      <p>Τα τρένα είναι κρυφά: άνοιξέ τα από το κουμπί με το μάτι.</p>
    {:else if groups.length}
      <div class="list">
        {#each groups as g (g.to)}
          <h3>→ {g.to}</h3>
          <ul>
            {#each g.list as t (t.sel.id)}
              <li><button type="button" onclick={() => { const p = t.pos; app.push(app.cardOfTrain(t.sel)); app.flyTo(p); }}>
                <span class="next">επόμενη: {t.next || "…"}</span>
                <span class="when">{#if t.at != null}{when(t.at)}{/if}{#if t.delay}{" "}<em>{t.delay > 0 ? "+" : ""}{t.delay}′</em>{/if}</span>
              </button></li>
            {/each}
          </ul>
        {/each}
      </div>
    {:else}
      <p>Κανένα τρένο της γραμμής στον χάρτη τώρα.</p>
    {/if}
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 340px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  h2 { flex: 1; margin: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip { flex: none; min-width: 30px; padding: 2px 6px; border-radius: 6px; background: var(--accent); color: #fff;
    font-size: 12px; text-align: center; }
  p { margin: 0 0 8px; color: var(--muted); font-size: 12px; }
  .src { font-size: 11px; }
  .list { max-height: 40vh; overflow-y: auto; overscroll-behavior: contain; }
  h3 { margin: 6px 0 2px; font-size: 12px; font-weight: 600; color: var(--muted); }
  ul { list-style: none; margin: 0; padding: 0; }
  li button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 0 4px; margin: 0 -4px; border: 0;
    border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  li button:hover { background: var(--control); }
  .next { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; }
  .when em { font-style: normal; font-size: 11px; color: var(--late2); }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
    .list { max-height: 32vh; }
  }
</style>
