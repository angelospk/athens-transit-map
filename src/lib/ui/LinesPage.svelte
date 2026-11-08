<script lang="ts">
  // «Βρες γραμμή» (compact mockup 7): every line in one list, first the ones that pass near the user (with how many
  // run now), then by mode. Each line once («Α ⇄ Β», not one row per way), names in lower case, the mode's chip.
  import { busId, isBusId } from "../busNs";
  import type { V2Line } from "../v2";
  import type { AppState } from "../state.svelte";
  import { fold } from "../search";
  import { titleCase } from "../nearby";
  import { linesAt } from "../stops";
  import { checkLive, liveCount } from "../liveLines";
  import Icon from "./Icon.svelte";
  import LineChip from "./LineChip.svelte";

  let { app, lines, onopen, onclose }: { app: AppState; lines: V2Line[]; onopen: (l: V2Line) => void; onclose: () => void } = $props();

  type Mode = "all" | "bus" | "metro" | "tram" | "suburban";
  const MODES: [Mode, string][] = [["all", "Όλα"], ["bus", "Λεωφορεία"], ["metro", "Μετρό"], ["tram", "Τραμ"], ["suburban", "Προαστιακός"]];
  let mode = $state<Mode>("all");
  let q = $state("");
  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  const modeOf = (l: V2Line): Exclude<Mode, "all"> => (l.mode === "trolley" ? "bus" : (l.mode as Exclude<Mode, "all">));
  // The rail lines' own ends (their feeds call them «Γραμμή 3»); the suburban ones go by «Π», their ends in the name.
  const RAIL_ENDS: Record<string, string> = { M1: "Πειραιάς ⇄ Κηφισιά", M2: "Ανθούπολη ⇄ Ελληνικό", M3: "Δημοτικό Θέατρο ⇄ Αεροδρόμιο",
    T6: "Πικροδάφνη ⇄ Σύνταγμα", T7: "Ακτή Ποσειδώνος ⇄ Ασκληπιείο Βούλας" };
  const label = (l: V2Line) => (l.mode === "suburban" ? "Π" : l.label ?? native(l.id));
  const ends = (l: V2Line) => RAIL_ENDS[l.label ?? ""] ?? titleCase(l.name).replace(/\s+[-–]\s+/g, " ⇄ ");
  const colours = (l: V2Line) => {
    if (isBusId(l.id)) { const c = app.lineColor(native(l.id)); return { bg: c.bg, fg: c.fg }; }
    return { bg: l.color || "#6b7280", fg: l.text_color || "#ffffff" };
  };

  // The lines that stop at the nearest stops (the stop index), the soonest groups first.
  const near = $derived.by(() => {
    const ix = app.stopIx;
    if (!ix) return [] as V2Line[];
    const ids = new Set<string>();
    for (const g of app.nearGroups.slice(0, 2)) for (const i of g.idx) for (const x of linesAt(ix, i)) ids.add(busId(x.line));
    return lines.filter(l => ids.has(l.id)).slice(0, 6);
  });
  const qf = $derived(fold(q.trim()));
  const hit = (l: V2Line) => !qf || fold(label(l)).startsWith(qf) || fold(l.name).includes(qf);
  const shown = $derived(lines.filter(l => (mode === "all" || modeOf(l) === mode) && hit(l)));
  const groups = $derived.by(() => {
    const order: [Exclude<Mode, "all">, string][] = [["metro", "Μετρό"], ["tram", "Τραμ"], ["suburban", "Προαστιακός"], ["bus", "Λεωφορεία και τρόλεϊ"]];
    const byLabel = (x: V2Line, y: V2Line) => (x.label ?? "").localeCompare(y.label ?? "", "el", { numeric: true });
    return order.map(([m, title]) => ({ m, title, items: shown.filter(l => modeOf(l) === m).sort(m === "bus" ? () => 0 : byLabel) })).filter(g => g.items.length);
  });
  const nearShown = $derived(!qf && (mode === "all" || mode === "bus") ? near : []);
  // How many of each near line run now (their vehicles, asked once a minute at most: liveLines.ts).
  let tick = $state(0);
  $effect(() => { const ids = near.map(l => l.id); if (ids.length) checkLive(ids, () => tick++); });
  const liveOf = (id: string) => { void tick; return liveCount(id); };
</script>

<div class="lp">
  <div class="top">
    <button type="button" class="back" aria-label="Πίσω" onclick={onclose}><Icon name="back" size={20} /></button>
    <label class="field">
      <Icon name="search" size={18} />
      <span class="sr">Γραμμή</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="search" bind:value={q} placeholder="Αριθμός ή όνομα γραμμής" autocomplete="off" spellcheck="false" />
    </label>
  </div>
  <div class="modes" role="radiogroup" aria-label="Μέσο">
    {#each MODES as [m, t] (m)}
      <button type="button" role="radio" aria-checked={mode === m} class:on={mode === m} onclick={() => (mode = m)}>{t}</button>
    {/each}
  </div>

  {#if nearShown.length}
    <div class="sec">
      <span class="sh">Περνούν κοντά σου</span>
      {#each nearShown as l (l.id)}
        {@const c = colours(l)}
        {@const n = liveOf(l.id)}
        <button type="button" class="row two" onclick={() => onopen(l)}>
          <LineChip label={label(l)} bg={c.bg} fg={c.fg} mode={l.mode} city={app.cityId} size="lg" />
          <span class="tx"><b>{ends(l)}</b></span>
          {#if n}<span class="live"><i></i>{n} τώρα</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#each groups as g (g.m)}
    <div class="sec">
      <span class="sh">{g.title}</span>
      {#each g.items.slice(0, qf ? 60 : g.m === "bus" ? 40 : 20) as l (l.id)}
        {@const c = colours(l)}
        <button type="button" class="row" onclick={() => onopen(l)}>
          <LineChip label={label(l)} bg={c.bg} fg={c.fg} mode={l.mode} city={app.cityId} size="lg" />
          <span class="tx"><b>{ends(l)}</b></span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="none">{lines.length ? "Καμία γραμμή με αυτό το όνομα." : "Φόρτωση…"}</p>
  {/each}
</div>

<style>
  .lp { display: flex; flex-direction: column; gap: 12px; }
  .top { display: flex; align-items: center; gap: 6px; }
  .back { flex: none; width: 36px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; background: none; color: var(--fg); cursor: pointer; }
  .field { flex: 1; min-width: 0; height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 12px; box-sizing: border-box; border-radius: 14px; background: var(--control); color: var(--muted); }
  .field input { flex: 1; min-width: 0; height: 42px; padding: 0; border: 0; outline: none; background: none; color: var(--fg); font: inherit; font-size: 16px; line-height: 1; }
  .modes { display: flex; gap: 6px; overflow-x: auto; margin: 0 -16px; padding: 0 16px; scrollbar-width: none; }
  .modes::-webkit-scrollbar { display: none; }
  .modes button { flex: none; height: 34px; display: flex; align-items: center; padding: 0 13px; border: 0; border-radius: 17px; background: var(--card, var(--control));
    box-shadow: inset 0 0 0 1px var(--card-border, transparent); color: var(--fg); font: inherit; font-size: 13.5px; font-weight: 700; line-height: 1; cursor: pointer; }
  .modes button.on { background: var(--fg); color: var(--bg); box-shadow: none; font-weight: 800; }
  .sec { display: flex; flex-direction: column; }
  .sh { height: 24px; display: flex; align-items: center; padding: 0 2px; font-size: 13px; font-weight: 700; line-height: 1; color: var(--muted); }
  .row { height: 48px; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .row.two { height: 52px; }
  .tx { flex: 1; min-width: 0; }
  .tx b { display: block; font-size: 14.5px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .live { flex: none; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; line-height: 1; color: var(--ontime); }
  .live i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .none { margin: 12px 2px; color: var(--muted); font-size: 14px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
