<script lang="ts">
  // «Νέα συντόμευση» (compact mockup 10): a line, its way and the stop it is caught at, shown on «Πού πας;» with its
  // minutes live; or a stop near the user (★), or «Σπίτι» / «Δουλειά».
  import { busId, isBusId } from "../busNs";
  import type { AppState } from "../state.svelte";
  import type { V2Line } from "../v2";
  import { fold } from "../search";
  import { titleCase } from "../nearby";
  import { distM } from "../trip";
  import { linesAt } from "../stops";
  import Sheet from "./Sheet.svelte";
  import Icon from "./Icon.svelte";
  import LineChip from "./LineChip.svelte";

  let { app, lines, onclose, onplace }: { app: AppState; lines: V2Line[]; onclose: () => void; onplace: (k: "home" | "work") => void } = $props();

  type Tab = "place" | "stop" | "line";
  let tab = $state<Tab>("line");
  let q = $state("");
  let line = $state.raw<V2Line | null>(null);
  let variant = $state<string | null>(null);
  let stopK = $state<number | null>(null);
  let listOpen = $state(false);

  const ix = $derived(app.stopIx);
  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  const busLines = $derived(lines.filter(l => isBusId(l.id)));
  const qf = $derived(fold(q.trim()));
  const hits = $derived(qf ? busLines.filter(l => fold(l.label ?? native(l.id)).startsWith(qf) || fold(l.name).includes(qf)).slice(0, 6) : []);
  const ends = (l: V2Line) => titleCase(l.name).replace(/\s+[-–]\s+/g, " ⇄ ");
  const colourOf = (l: string) => app.lineColor(l);
  const modeOf = (l: string) => (app.lineInfo.get(l)?.kind === "trolley" ? "trolley" : "bus");
  const here = $derived(app.myPos ?? app.mapCenter);
  const walk = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));

  // The line's ways: one per last stop, the way the user's nearest stop is on first.
  const ways = $derived.by(() => {
    if (!line || !ix) return [] as { v: string; to: string }[];
    const vs = ix.l[native(line.id)] ?? {}, seen = new Set<string>(), out: { v: string; to: string; m: number }[] = [];
    for (const [v, seq] of Object.entries(vs)) {
      const to = titleCase(ix.s[seq[seq.length - 1]]?.[0] ?? "");
      if (!to || seen.has(to)) continue;
      seen.add(to);
      const m = here ? Math.min(...seq.map(k => distM([ix.s[k][1], ix.s[k][2]], here))) : 0;
      out.push({ v, to, m });
    }
    return out.sort((a, b) => a.m - b.m).slice(0, 2);
  });
  $effect(() => { if (ways.length && !ways.some(w => w.v === variant)) variant = ways[0].v; });
  // Its stops on that way, in order; the nearest one chosen.
  const stops = $derived.by(() => {
    if (!line || !ix || !variant) return [] as { k: number; name: string; m: number }[];
    const seq = ix.l[native(line.id)]?.[variant] ?? [];
    return seq.slice(0, -1).filter(k => ix.s[k]?.[3]).map(k => ({ k, name: titleCase(ix.s[k][0]), m: here ? distM([ix.s[k][1], ix.s[k][2]], here) : 0 }));
  });
  const nearest = $derived(stops.length ? stops.reduce((a, b) => (b.m < a.m ? b : a)) : null);
  $effect(() => { if (nearest && !stops.some(x => x.k === stopK)) stopK = nearest.k; });
  const chosen = $derived(stops.find(x => x.k === stopK) ?? null);
  const way = $derived(ways.find(w => w.v === variant) ?? null);
  const short = (t: string) => (t.length > 8 ? `${t.slice(0, 6)}.` : t);

  function pickLine(l: V2Line) { line = l; q = ""; variant = null; stopK = null; }
  function add() {
    if (!line || !variant || !chosen || !way || !ix) return;
    app.addShortcut({ line: native(line.id), variant, to: way.to, stop: ix.s[chosen.k][3]!, stopName: chosen.name });
    onclose();
  }

  // «Στάση»: the stops nearest the user, each with its star.
  const nearStops = $derived.by(() => {
    if (!ix || !here) return [] as { k: number; id: string; name: string; m: number; lines: string[] }[];
    const out: { k: number; id: string; name: string; m: number; lines: string[] }[] = [];
    ix.s.forEach((x, k) => {
      if (!x[3] || Math.abs(x[1] - here[0]) > 0.006 || Math.abs(x[2] - here[1]) > 0.008) return;
      const m = distM([x[1], x[2]], here);
      if (m < 600) out.push({ k, id: busId(x[3]), name: titleCase(x[0]), m, lines: linesAt(ix, k).map(l => l.line) });
    });
    return out.sort((a, b) => a.m - b.m).slice(0, 6);
  });
</script>

<Sheet title="Νέα συντόμευση" {onclose}>
  <div class="ns">
    <div class="tabs" role="radiogroup" aria-label="Τι συντόμευση">
      {#each [["place", "Μέρος"], ["stop", "Στάση"], ["line", "Γραμμή"]] as [k, t] (k)}
        <button type="button" role="radio" aria-checked={tab === k} class:on={tab === k} onclick={() => (tab = k as Tab)}>{t}</button>
      {/each}
    </div>

    {#if tab === "line"}
      {#if line}
        {@const c = colourOf(native(line.id))}
        <div class="lf">
          <LineChip label={line.label ?? native(line.id)} bg={c.bg} fg={c.fg} mode={modeOf(native(line.id))} city={app.cityId} />
          <span class="lname">{ends(line)}</span>
          <button type="button" class="redo" aria-label="Άλλη γραμμή" onclick={() => (line = null)}><span><Icon name="close" size={12} /></span></button>
        </div>

        {#if ways.length}
          <div class="blk">
            <span class="cap">Κατεύθυνση</span>
            <div class="ways" role="radiogroup" aria-label="Κατεύθυνση">
              {#each ways as w (w.v)}
                <button type="button" role="radio" aria-checked={variant === w.v} class:on={variant === w.v} onclick={() => (variant = w.v)}>
                  <span class="rd"><i></i></span><span class="wt"><small>προς</small><b>{w.to}</b></span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if chosen}
          <div class="blk">
            <span class="cap">Από τη στάση</span>
            <div class="dd">
              <button type="button" class="ddb" aria-haspopup="listbox" aria-expanded={listOpen} onclick={() => (listOpen = !listOpen)}>
                <span class="oasa"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
                <span class="st"><b>{chosen.name}</b><small>{chosen.k === nearest?.k ? "η πιο κοντινή · " : ""}{walk(chosen.m)}′ με τα πόδια</small></span>
                <span class="chev" class:up={listOpen}><Icon name="chevron" size={16} /></span>
              </button>
              {#if listOpen}
                <ul class="ddl" role="listbox" aria-label="Στάσεις">
                  {#each stops as x (x.k)}
                    <li><button type="button" role="option" aria-selected={x.k === stopK} class:on={x.k === stopK} onclick={() => { stopK = x.k; listOpen = false; }}>
                      <b>{x.name}</b><small>{walk(x.m)}′</small></button></li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>

          <div class="blk">
            <span class="cap">Θα φαίνεται έτσι, με τα λεπτά ζωντανά</span>
            <span class="prev"><LineChip label={line.label ?? native(line.id)} bg={c.bg} fg={c.fg} mode={modeOf(native(line.id))} city={app.cityId} /><span>{short(way?.to ?? "")}</span><span class="pm"><i></i></span></span>
          </div>

          <button type="button" class="go" onclick={add}>Πρόσθεσε στις συντομεύσεις</button>
        {/if}
      {:else}
        <label class="lf search">
          <Icon name="search" size={18} />
          <span class="sr">Γραμμή</span>
          <input type="search" bind:value={q} placeholder="Αριθμός ή όνομα γραμμής" autocomplete="off" spellcheck="false" />
        </label>
        {#if hits.length}
          <div class="hits">
            {#each hits as l (l.id)}
              {@const c = colourOf(native(l.id))}
              <button type="button" class="hit" onclick={() => pickLine(l)}>
                <LineChip label={l.label ?? native(l.id)} bg={c.bg} fg={c.fg} mode={modeOf(native(l.id))} city={app.cityId} />
                <span>{ends(l)}</span>
              </button>
            {/each}
          </div>
        {:else if !q && app.lineShortcuts.length}
          <div class="blk">
            <span class="cap">Οι συντομεύσεις σου</span>
            {#each app.lineShortcuts as sc (sc.line + sc.variant + sc.stop)}
              {@const c = colourOf(sc.line)}
              <div class="hit">
                <LineChip label={sc.line} bg={c.bg} fg={c.fg} mode={modeOf(sc.line)} city={app.cityId} />
                <span>προς {sc.to} · {sc.stopName}</span>
                <button type="button" class="rm" aria-label="Αφαίρεση" onclick={() => app.removeShortcut(sc)}><Icon name="close" size={14} /></button>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    {:else if tab === "stop"}
      <div class="hits">
        {#each nearStops as x (x.k)}
          {@const on = app.isFavStop(x.id)}
          <button type="button" class="hit" aria-pressed={on} onclick={() => app.toggleFavStop({ id: x.id, name: x.name, lat: ix!.s[x.k][1], lon: ix!.s[x.k][2] })}>
            <span class="oasa"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>
            <span class="st"><b>{x.name}</b><small>{x.lines.slice(0, 5).join(", ")} · {walk(x.m)}′</small></span>
            <span class="star" class:on><Icon name={on ? "star-filled" : "star"} size={18} /></span>
          </button>
        {:else}
          <p class="none">Δεν ξέρω πού είσαι· άνοιξε την τοποθεσία για τις κοντινές στάσεις.</p>
        {/each}
      </div>
    {:else}
      <div class="hits">
        {#each [["home", "Σπίτι"], ["work", "Δουλειά"]] as [k, t] (k)}
          {@const p = app.places[k as "home" | "work"]}
          <button type="button" class="hit" onclick={() => onplace(k as "home" | "work")}>
            <span class="ic"><Icon name={k as "home" | "work"} size={18} /></span>
            <span class="st"><b>{t}</b><small>{p ? p.label : "Δεν το έχεις ορίσει"}</small></span>
            <span class="act">{p ? "Άλλαξε" : "Όρισε"}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</Sheet>

<style>
  .ns { display: flex; flex-direction: column; gap: 14px; }
  .tabs { display: flex; gap: 4px; padding: 4px; border-radius: 14px; background: var(--control); }
  .tabs button { flex: 1; height: 36px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 10px; background: none; color: var(--muted);
    font: inherit; font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; }
  .tabs button.on { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgb(0 0 0 / .25); }
  .lf { height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 4px 0 8px; border-radius: 14px; background: var(--control); box-sizing: border-box; }
  .lf.search { padding: 0 12px; color: var(--muted); }
  .lf input { flex: 1; min-width: 0; height: 46px; padding: 0; border: 0; background: none; color: var(--fg); font: inherit; font-size: 16px; line-height: 1; outline: none; }
  .lname { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .redo { flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; background: none; cursor: pointer; }
  .redo span { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--fg) 28%, var(--control)); color: var(--bg); }
  .blk { display: flex; flex-direction: column; gap: 8px; }
  .cap { font-size: 13px; font-weight: 700; line-height: 1; color: var(--muted); padding: 0 2px; }
  .ways { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ways button { height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 0; border-radius: 14px; background: var(--card, var(--control));
    box-shadow: inset 0 0 0 1px var(--card-border, var(--border)); color: var(--fg); font: inherit; text-align: left; cursor: pointer; min-width: 0; }
  .ways button.on { background: var(--accent-bg); box-shadow: inset 0 0 0 2px var(--accent); }
  .rd { flex: none; width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 2px var(--muted); display: flex; align-items: center; justify-content: center; }
  .ways button.on .rd { box-shadow: inset 0 0 0 2px var(--accent); }
  .ways button.on .rd i { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); display: block; }
  .wt { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .wt small { font-size: 12px; line-height: 1; color: var(--muted); }
  .wt b { font-size: 14px; font-weight: 800; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dd { position: relative; }
  .ddb { width: 100%; height: 56px; display: flex; align-items: center; gap: 12px; padding: 0 12px; border: 0; border-radius: 14px; background: var(--card, var(--control));
    box-shadow: inset 0 0 0 1px var(--card-border, var(--border)); color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .oasa { flex: none; width: 32px; height: 32px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; }
  .oasa img { width: 19px; height: 19px; display: block; }
  .st { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .st b { font-size: 15px; font-weight: 700; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st small { font-size: 12.5px; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chev { flex: none; display: flex; color: var(--muted); transition: transform .2s; }
  .chev.up { transform: rotate(180deg); }
  .ddl { position: absolute; z-index: 2; left: 0; right: 0; top: calc(100% + 6px); max-height: 240px; overflow-y: auto; margin: 0; padding: 6px; list-style: none;
    border-radius: 14px; background: var(--surface); box-shadow: 0 10px 30px rgb(0 0 0 / .45), inset 0 0 0 1px var(--card-border, var(--border));
    scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--fg) 25%, transparent) transparent; }
  .ddl::-webkit-scrollbar { width: 6px; }
  .ddl::-webkit-scrollbar-thumb { border-radius: 3px; background: color-mix(in srgb, var(--fg) 25%, transparent); }
  .ddl button { width: 100%; height: 42px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border: 0; border-radius: 10px; background: none; color: var(--fg);
    font: inherit; text-align: left; cursor: pointer; }
  .ddl button b { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ddl button small { font-size: 12.5px; line-height: 1; color: var(--muted); }
  .ddl button.on { background: var(--accent-bg); color: var(--accent); }
  .prev { align-self: flex-start; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 6px; border-radius: 12px; background: var(--card, var(--control));
    box-shadow: inset 0 0 0 1px var(--card-border, var(--border)); font-size: 13px; font-weight: 700; line-height: 1; }
  .pm { display: flex; align-items: center; gap: 5px; color: var(--ontime); }
  .pm i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: block; }
  .go { height: 52px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 16px; background: #4d8af0; color: #ffffff;
    font: inherit; font-size: 16px; font-weight: 800; line-height: 1; cursor: pointer; }
  .hits { display: flex; flex-direction: column; }
  .hit { min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 4px; border: 0; border-radius: 12px; background: none; color: var(--fg);
    font: inherit; font-size: 14.5px; font-weight: 600; line-height: 1; text-align: left; cursor: pointer; }
  .hit > span:not(.oasa):not(.ic):not(.star):not(.act) { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ic { flex: none; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--control); }
  .star { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; color: var(--muted); }
  .star.on { color: var(--star); }
  .act { flex: none; font-size: 14px; font-weight: 700; color: var(--accent); }
  .rm { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: var(--control); color: var(--muted); cursor: pointer; }
  .none { margin: 6px 2px; font-size: 14px; color: var(--muted); line-height: 1.35; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
