<script lang="ts" module>
  // Read as the page loads: the app tidies its address (the ?admin goes) before this component starts.
  const ASKED = typeof location !== "undefined" && new URLSearchParams(location.search).has("admin");
</script>

<script lang="ts">
  // The admin mode: /?admin asks for the password; then every metro, tram and suburban station on the map can be
  // dragged to where the map shows it (MapView). The moves are kept on this device (app.adminFixes) and exported as
  // public/station-fixes.json, which the site reads for everyone once it is committed. In 3D the metro's street
  // entrances (stairwells and lifts, entrances.ts) are added, moved and turned the same way: kept in
  // app.entranceEdits, exported as public/entrances.json. Only the password's SHA-256
  // is here: it keeps the tools out of sight, it is not a lock (nothing changes for others without a commit).
  import { untrack } from "svelte";
  import type { AppState } from "../state.svelte";
  import { stopsWithFixes, withFixes, type StationFixes } from "../metro";
  import { loadEntrances, normElevation, normHeading, withEdits, type Entrance3D } from "../entrances";
  import Icon from "./Icon.svelte";

  let { app }: { app: AppState } = $props();
  const HASH = "604f43f4f7d7e28292997b6c8acea865e300352ed9f7cccf81db360ff79f07e2";
  // A computer only (a mouse and a wide window): stations are moved by a few metres, with care.
  const pc = typeof matchMedia === "function" && matchMedia("(min-width: 1024px) and (pointer: fine)").matches;
  let open = $state(false), pw = $state(""), wrong = $state(false), input = $state<HTMLInputElement>();

  // Once, as the page starts: already in (this tab), or asked for with ?admin.
  $effect(() => untrack(() => {
    if (!pc) return;
    try { if (sessionStorage.getItem("admin") === "1") app.admin = true; } catch { /* no storage */ }
    if (ASKED && !app.admin) open = true;
  }));

  async function sha(s: string) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function enter(e: Event) {
    e.preventDefault();
    if ((await sha(pw)) !== HASH) { wrong = true; pw = ""; input?.focus(); return; }
    try { sessionStorage.setItem("admin", "1"); } catch { /* no storage */ }
    open = false; pw = ""; wrong = false;
    app.admin = true;
  }
  $effect(() => { if (open && input) input.focus(); });
  // On: the stations with this device's moves; off: as everyone sees them.
  $effect(() => {
    const on = app.admin;
    untrack(() => {
      if (on && app.metro) app.metro = withFixes(app.metro, app.adminFixes);
      if (on && app.stopIx) app.stopIx = { ...app.stopIx, s: stopsWithFixes(app.stopIx.s, app.adminFixes) };
    });
  });
  const moved = $derived(Object.keys(app.adminFixes).length);
  const edited = $derived(Object.keys(app.entranceEdits).length);
  const changes = $derived(moved + edited);
  // The entrance picked on the map (MapView's move handle), as shown now.
  const sel = $derived(app.entranceSel ? app.entrancesShown.find(e => e.id === app.entranceSel) ?? null : null);
  const edit = (patch: Partial<Entrance3D>) => { if (sel) app.editEntrance({ ...sel, ...patch }); };
  const turnBy = (d: number) => { if (sel) edit({ heading: normHeading(Math.round(sel.heading + d)) }); };
  const raiseBy = (d: number) => { if (sel) edit({ elevation: normElevation((sel.elevation ?? 0) + d) }); };
  const metresText = (m: number | undefined) => (m ?? 0).toFixed(2).replace(".", ",");
  let elevText = $state("");
  $effect(() => { elevText = sel ? metresText(sel.elevation) : ""; });
  function setElevation() {
    const v = Number(elevText.replace(",", "."));
    if (sel && Number.isFinite(v)) edit({ elevation: normElevation(v) }); else elevText = sel ? metresText(sel.elevation) : "";
  }
  let headingText = $state("");
  $effect(() => { headingText = sel ? String(Math.round(sel.heading)) : ""; });
  function setHeading() {
    const v = Number(headingText.replace(",", "."));
    if (sel && Number.isFinite(v)) edit({ heading: normHeading(Math.round(v)) }); else headingText = sel ? String(Math.round(sel.heading)) : "";
  }
  function add(kind: "stairs" | "elevator") {
    if (!app.threeD) app.setThreeD(true);
    app.entranceAdd = { n: app.entranceAdd.n + 1, kind };
  }
  function download(name: string, data: unknown) {
    const blob = new Blob([JSON.stringify(data, null, 1) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function exportFixes() {
    if (moved) {
      let base: StationFixes = {};
      try { const r = await fetch(`${import.meta.env.BASE_URL}station-fixes.json`, { cache: "no-store" }); if (r.ok) base = await r.json(); } catch { /* none yet */ }
      const all = { ...base, ...app.adminFixes };
      download("station-fixes.json", Object.fromEntries(Object.keys(all).sort().map(k => [k, all[k]])));
    }
    if (edited) download("entrances.json", withEdits(await loadEntrances(), app.entranceEdits));
  }
  function undo() {
    if (moved) app.clearStationMoves();
    if (edited) app.clearEntranceEdits();
  }
  function leave() {
    try { sessionStorage.removeItem("admin"); } catch { /* no storage */ }
    app.admin = false;
    app.metro = null;
    app.loadMetro();
    app.stopIx = null;
    void app.loadStops();
  }
</script>

{#if open}
  <div class="scrim" role="presentation" onclick={() => (open = false)}></div>
  <form class="ask" onsubmit={enter} aria-label="Διαχείριση">
    <b>Διαχείριση</b>
    <small>Κωδικός για να μετακινείς τους σταθμούς στον χάρτη.</small>
    <input bind:this={input} type="password" autocomplete="current-password" placeholder="Κωδικός" bind:value={pw} class:wrong oninput={() => (wrong = false)} />
    {#if wrong}<span class="err">Λάθος κωδικός.</span>{/if}
    <div class="row">
      <button type="button" class="ghost" onclick={() => (open = false)}>Άκυρο</button>
      <button type="submit" class="go" disabled={!pw}>Είσοδος</button>
    </div>
  </form>
{/if}

{#if app.admin && sel}
  <div class="ent" role="group" aria-label="Επιλεγμένη είσοδος">
    <div class="head">
      <span class="kind">{sel.kind === "elevator" ? "Ασανσέρ" : "Σκάλα"}</span>
      <b>{sel.name}</b>
      <button type="button" class="x" aria-label="Κλείσιμο" onclick={() => (app.entranceSel = null)}><Icon name="close" size={14} /></button>
    </div>
    <div class="fields">
      <label><span>Όνομα</span><input id="ent-name" type="text" value={sel.name} onchange={e => edit({ name: e.currentTarget.value.trim() || sel.name })} /></label>
      <label><span>Λατινικά</span><input id="ent-latin" type="text" value={sel.latin ?? ""} onchange={e => edit({ latin: e.currentTarget.value.trim() || undefined })} /></label>
    </div>
    <div class="line">
      <span class="lbl">Κατεύθυνση</span>
      <div class="turn">
        <button type="button" onclick={() => turnBy(-15)} aria-label="15° αριστερά">−15</button>
        <button type="button" onclick={() => turnBy(-1)} aria-label="1° αριστερά">−1</button>
        <input id="ent-heading" type="text" inputmode="numeric" aria-label="Μοίρες από τον βορρά" bind:value={headingText}
          onchange={setHeading} onkeydown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <button type="button" onclick={() => turnBy(1)} aria-label="1° δεξιά">+1</button>
        <button type="button" onclick={() => turnBy(15)} aria-label="15° δεξιά">+15</button>
      </div>
    </div>
    <div class="line">
      <span class="lbl">Ύψος (μ.)</span>
      <div class="turn">
        <button type="button" onclick={() => raiseBy(-0.5)} aria-label="50 εκ. χαμηλότερα">−0,5</button>
        <button type="button" onclick={() => raiseBy(-0.1)} aria-label="10 εκ. χαμηλότερα">−0,1</button>
        <input id="ent-elevation" type="text" inputmode="decimal" aria-label="Ύψος σε μέτρα από το έδαφος του χάρτη" bind:value={elevText}
          onchange={setElevation} onkeydown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <button type="button" onclick={() => raiseBy(0.1)} aria-label="10 εκ. ψηλότερα">+0,1</button>
        <button type="button" onclick={() => raiseBy(0.5)} aria-label="50 εκ. ψηλότερα">+0,5</button>
      </div>
    </div>
    {#if sel.kind !== "elevator"}
      <div class="line">
        <span class="lbl">Πινακίδα</span>
        <div class="seg" role="group" aria-label="Πλευρά της πινακίδας">
          <button type="button" aria-pressed={sel.signSide === "left"} onclick={() => edit({ signSide: "left" })}>Αριστερά</button>
          <button type="button" aria-pressed={sel.signSide !== "left"} onclick={() => edit({ signSide: "right" })}>Δεξιά</button>
        </div>
      </div>
    {/if}
    <div class="pics">
      <span class="lbl">Εικόνες (αρχείο στο public/)</span>
      {#if sel.kind !== "elevator"}
        <label class="pic"><span>Μπροστά</span><input id="ent-ad-front" type="text" placeholder="ads/…" value={sel.adFront ?? ""}
          onchange={e => edit({ adFront: e.currentTarget.value.trim() || undefined })} /></label>
        <label class="pic"><span>Πίσω</span><input id="ent-ad-back" type="text" placeholder="ads/…" value={sel.adBack ?? ""}
          onchange={e => edit({ adBack: e.currentTarget.value.trim() || undefined })} /></label>
      {/if}
      <label class="pic"><span>Κύκλος</span><input id="ent-roundel" type="text" placeholder="icons/…" value={sel.roundel ?? ""}
        onchange={e => edit({ roundel: e.currentTarget.value.trim() || undefined })} /></label>
      {#if sel.kind !== "elevator"}
        <div class="line">
          <span class="lbl">Διαφήμιση</span>
          <div class="seg" role="group" aria-label="Πώς μπαίνει η διαφήμιση">
            <button type="button" aria-pressed={sel.adFit !== "contain"} onclick={() => edit({ adFit: "cover" })}>Γέμισμα</button>
            <button type="button" aria-pressed={sel.adFit === "contain"} onclick={() => edit({ adFit: "contain" })}>Ολόκληρη</button>
          </div>
        </div>
      {/if}
    </div>
    <button type="button" class="del" onclick={() => app.removeEntrance(sel.id)}>Διαγραφή</button>
  </div>
{/if}

{#if app.admin}
  <div class="bar" role="toolbar" aria-label="Διαχείριση σταθμών">
    <span class="tag">Διαχείριση</span>
    <span class="n">{changes ? `${changes} ${changes === 1 ? "αλλαγή" : "αλλαγές"}` : "Σύρε έναν σταθμό, ή πάτα μια στάση και σύρ’ την"}</span>
    <button type="button" onclick={() => add("stairs")} title="Νέα σκάλα μετρό στο κέντρο του χάρτη (3D)"><span>+ Σκάλα</span></button>
    <button type="button" onclick={() => add("elevator")} title="Νέο ασανσέρ μετρό στο κέντρο του χάρτη (3D)"><span>+ Ασανσέρ</span></button>
    <button type="button" onclick={exportFixes} disabled={!changes} title="Κατέβασε το station-fixes.json και το entrances.json"><Icon name="share" size={15} /><span>Εξαγωγή</span></button>
    <button type="button" onclick={undo} disabled={!changes}><span>Αναίρεση</span></button>
    <button type="button" class="x" aria-label="Έξοδος από τη διαχείριση" onclick={leave}><Icon name="close" size={14} /></button>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 60; background: rgb(0 0 0 / .45); }
  .ask { position: fixed; z-index: 61; left: 50%; top: 30%; translate: -50% 0; width: min(340px, calc(100% - 32px)); box-sizing: border-box;
    display: flex; flex-direction: column; gap: 10px; padding: 18px; border-radius: 24px; background: var(--surface); color: var(--fg);
    box-shadow: 0 20px 50px rgb(0 0 0 / .5), inset 0 0 0 1px var(--card-border, var(--border)); }
  .ask b { font-size: 17px; font-weight: 800; line-height: 1.2; }
  .ask small { font-size: 13px; line-height: 1.35; color: var(--muted); }
  .ask input { height: 46px; padding: 0 14px; border: 0; border-radius: 14px; background: var(--control); color: var(--fg); font: inherit; font-size: 15px; line-height: 1;
    box-shadow: inset 0 0 0 1px var(--border); outline: none; }
  .ask input:focus { box-shadow: inset 0 0 0 2px var(--accent); }
  .ask input.wrong { box-shadow: inset 0 0 0 2px var(--late3, #ff8a8a); }
  .err { font-size: 12.5px; font-weight: 700; line-height: 1; color: var(--late3, #ff8a8a); }
  .row { display: flex; gap: 8px; margin-top: 4px; }
  .row button { flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 14px; font: inherit; font-size: 14.5px; font-weight: 800; line-height: 1; cursor: pointer; }
  .ghost { background: var(--control); color: var(--fg); }
  .go { background: var(--accent); color: var(--on-accent, #fff); }
  .go:disabled { opacity: .5; cursor: default; }
  .bar { position: fixed; z-index: 40; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); translate: -50% 0; max-width: calc(100% - 16px); box-sizing: border-box;
    display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 8px; border-radius: 22px; background: color-mix(in srgb, var(--surface) 92%, transparent);
    -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 10px 30px rgb(0 0 0 / .45), inset 0 0 0 1px #f0ae45; color: var(--fg); }
  .tag { flex: none; height: 26px; padding: 0 9px; border-radius: 13px; display: flex; align-items: center; background: #f0ae45; color: #1a1200; font-size: 12px; font-weight: 800; line-height: 1; }
  .n { min-width: 0; padding: 0 4px; font-size: 13px; font-weight: 700; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar button { flex: none; height: 32px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border: 0; border-radius: 16px;
    background: var(--control); color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .bar button:disabled { opacity: .45; cursor: default; }
  .bar .x { width: 32px; padding: 0; }
  /* The picked 3D entrance: a card above the bar */
  .ent { position: fixed; z-index: 40; left: 50%; bottom: calc(66px + env(safe-area-inset-bottom)); translate: -50% 0; width: 340px; max-width: calc(100% - 16px); box-sizing: border-box;
    display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 22px; background: color-mix(in srgb, var(--surface) 92%, transparent);
    -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 10px 30px rgb(0 0 0 / .45), inset 0 0 0 1px #f0ae45; color: var(--fg); }
  .ent .head { display: flex; align-items: center; gap: 8px; min-height: 32px; }
  .ent .kind { flex: none; height: 24px; padding: 0 9px; border-radius: 12px; display: flex; align-items: center; background: #f0ae45; color: #1a1200; font-size: 12px; font-weight: 800; line-height: 1; }
  .ent .head b { flex: 1; min-width: 0; font-size: 15px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ent button { height: 32px; display: flex; align-items: center; justify-content: center; padding: 0 10px; border: 0; border-radius: 16px;
    background: var(--control); color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .ent .x { flex: none; width: 32px; padding: 0; border-radius: 50%; }
  .ent .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ent label { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .ent label span, .ent .lbl { font-size: 11.5px; font-weight: 700; line-height: 1; color: var(--muted); }
  .ent input { height: 36px; width: 100%; box-sizing: border-box; padding: 0 10px; border: 0; border-radius: 12px; background: var(--control); color: var(--fg);
    font: inherit; font-size: 14px; font-weight: 600; line-height: 1; box-shadow: inset 0 0 0 1px var(--border); outline: none; }
  .ent input:focus { box-shadow: inset 0 0 0 2px #f0ae45; }
  .ent .line { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; }
  .ent .turn { display: flex; align-items: center; gap: 4px; }
  .ent .turn button { width: 38px; padding: 0; font-variant-numeric: tabular-nums; }
  .ent .turn input { width: 56px; height: 32px; padding: 0; text-align: center; font-weight: 800; font-variant-numeric: tabular-nums; }
  .ent .seg { display: flex; height: 32px; padding: 2px; box-sizing: border-box; border-radius: 16px; background: var(--control); }
  .ent .seg button { height: 100%; border-radius: 14px; background: transparent; color: var(--muted); }
  .ent .seg button[aria-pressed="true"] { background: #f0ae45; color: #1a1200; }
  .ent .pics { display: flex; flex-direction: column; gap: 6px; }
  .ent .pic { flex-direction: row; align-items: center; gap: 8px; }
  .ent .pic span { flex: none; width: 58px; }
  .ent .del { align-self: flex-start; background: transparent; color: var(--late3, #ff8a8a); box-shadow: inset 0 0 0 1px currentColor; }
</style>
