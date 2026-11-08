<script lang="ts" module>
  // Read as the page loads: the app tidies its address (the ?admin goes) before this component starts.
  const ASKED = typeof location !== "undefined" && new URLSearchParams(location.search).has("admin");
</script>

<script lang="ts">
  // The admin mode: /?admin asks for the password; then every metro, tram and suburban station on the map can be
  // dragged to where the map shows it (MapView). The moves are kept on this device (app.adminFixes) and exported as
  // public/station-fixes.json, which the site reads for everyone once it is committed. Only the password's SHA-256
  // is here: it keeps the tools out of sight, it is not a lock (nothing changes for others without a commit).
  import { untrack } from "svelte";
  import type { AppState } from "../state.svelte";
  import { stopsWithFixes, withFixes, type StationFixes } from "../metro";
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

  async function exportFixes() {
    let base: StationFixes = {};
    try { const r = await fetch(`${import.meta.env.BASE_URL}station-fixes.json`, { cache: "no-store" }); if (r.ok) base = await r.json(); } catch { /* none yet */ }
    const all = { ...base, ...app.adminFixes };
    const sorted = Object.fromEntries(Object.keys(all).sort().map(k => [k, all[k]]));
    const blob = new Blob([JSON.stringify(sorted, null, 1) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "station-fixes.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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

{#if app.admin}
  <div class="bar" role="toolbar" aria-label="Διαχείριση σταθμών">
    <span class="tag">Διαχείριση</span>
    <span class="n">{moved ? `${moved} ${moved === 1 ? "μετακίνηση" : "μετακινήσεις"}` : "Σύρε έναν σταθμό, ή πάτα μια στάση και σύρ’ την"}</span>
    <button type="button" onclick={exportFixes} disabled={!moved} title="Κατέβασε το station-fixes.json"><Icon name="share" size={15} /><span>Εξαγωγή</span></button>
    <button type="button" onclick={() => app.clearStationMoves()} disabled={!moved}><span>Αναίρεση</span></button>
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
</style>
