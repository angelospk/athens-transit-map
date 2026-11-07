<script lang="ts">
  // The three places of the app: «Αρχική» (its «Πού πας;» opens the trip planner, still the "trip" tab), the map
  // and the alerts (AppState.tab). On a phone a bar
  // across the bottom; on a desktop the same row at the bottom of the map's left column. It steps aside while a card
  // (stop, line, vehicle), the favourites or nearby list, a stop fix, a 3D chase or a 3D bus's route has the screen.
  import type { AppState, Tab } from "../state.svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import { rise } from "../anim";

  let { app }: { app: AppState } = $props();

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: "now", label: "Αρχική", icon: "home" },
    { id: "map", label: "Χάρτης", icon: "map" },
    { id: "alerts", label: "Ειδοποιήσεις", icon: "bell" },
  ];
  const shown = $derived(!app.stack.length && !app.chase && !app.stopFix && !app.favsOpen && !app.nearShown && !app.bus3d);
  // A live alert: a dot on the bell, so it is seen from any tab.
  const armed = $derived(!!app.alert || !!app.railAlert);
</script>

{#if shown}
  <nav class="tabs" aria-label="Κύρια" style:--i={Math.max(0, tabs.findIndex(t => t.id === (app.tab === "trip" ? "now" : app.tab)))} in:rise={{ y: 16 }}>
    <i class="ind" aria-hidden="true"></i>
    {#each tabs as t (t.id)}
      <button type="button" class="tab" aria-current={app.tab === t.id || (app.tab === "trip" && t.id === "now") ? "page" : undefined} onclick={() => app.setTab(t.id)}>
        <span class="ico"><Icon name={t.icon} size={22} />{#if t.id === "alerts" && armed}<i class="dot" aria-hidden="true"></i>{/if}</span>
        <span class="lab">{t.label}{#if t.id === "alerts" && armed}<span class="sr">, μία ενεργή</span>{/if}</span>
      </button>
    {/each}
  </nav>
{/if}

<style>
  /* A glass capsule floating over the map: at the bottom centre on a desktop, 16 px in from the edges on a phone. Its
     corners are concentric with the active tab's (26 + the 6 px padding). */
  .tabs { position: absolute; z-index: 7; left: 50%; translate: -50% 0; bottom: calc(16px + env(safe-area-inset-bottom)); width: 380px;
    display: flex; padding: 6px; border-radius: 32px; background: var(--glass); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .tab { flex: 1; min-width: 0; height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
    margin: 0; padding: 0; border: 0; border-radius: 26px; background: none; color: color-mix(in srgb, var(--fg) 72%, transparent); cursor: pointer; }
  .tab:hover { background: color-mix(in srgb, var(--control) 55%, transparent); color: var(--fg); }
  .tab[aria-current="page"] { color: var(--accent); }
  .ico { position: relative; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; }
  .dot { position: absolute; top: 0; right: -1px; width: 8px; height: 8px; border-radius: 50%; background: var(--late2);
    box-shadow: 0 0 0 2px var(--panel); }
  .lab { font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap; }
  .tab[aria-current="page"] .lab { font-weight: 700; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  @media (max-width: 719px) {
    .tabs { left: 16px; right: 16px; translate: none; bottom: max(12px, env(safe-area-inset-bottom)); width: auto; }
    .tab { height: 52px; }
    .tab:hover { background: none; }
  }
  /* The active tab's highlight slides between tabs; the icon gives a small hop. */
  .tabs { isolation: isolate; }
  .ind { position: absolute; z-index: -1; top: 6px; bottom: 6px; left: 6px; width: calc((100% - 12px) / 3); border-radius: 26px;
    background: var(--accent-bg); transform: translateX(calc(var(--i) * 100%)); transition: transform .35s cubic-bezier(.34, 1.3, .64, 1); }
  .tab { transition: color .2s, background-color .15s; }
  .tab[aria-current="page"] .ico { animation: hop .4s cubic-bezier(.34, 1.56, .64, 1); }
  @keyframes hop { 40% { transform: translateY(-3px) scale(1.08); } }
  @media (prefers-reduced-motion: reduce) { .ind, .tab { transition: none; } .tab[aria-current="page"] .ico { animation: none; } }
</style>
