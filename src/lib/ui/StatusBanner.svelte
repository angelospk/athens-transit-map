<script lang="ts">
  import { bannerMessages } from "../banner";
  import { DEMO_VIDEO_URL } from "../config";
  import { STALE_S, type AppState } from "../state.svelte";
  import { fly } from "svelte/transition";
  import Icon from "./Icon.svelte";

  let { app }: { app: AppState } = $props();

  const banner = $derived(bannerMessages(app.statusFailed, app.status,
    app.selected.filter(l => app.live[l] && app.serverNow / 1000 - app.live[l].updated_at > STALE_S), !app.online));
  const offline = $derived(banner.offline);
  const messages = $derived(banner.messages);
  // ✕ hides what it says now; a different message shows again.
  const key = $derived([app.cityInfo.ready ? "" : app.cityInfo.name, app.notice ?? "", ...messages].join("|"));
  let closed = $state("");
</script>

{#if (messages.length || app.notice || !app.cityInfo.ready) && key !== closed}
  <div class="warn" role="status" transition:fly={{ y: -10, duration: 240 }}>
    <div class="wt">
    {#if !app.cityInfo.ready}<p>{app.cityInfo.name}: έρχεται σύντομα. Τώρα δείχνει μόνο την Αθήνα. <button type="button" class="link" onclick={() => app.setCity("athens")}>Πήγαινε στην Αθήνα</button></p>{/if}
    {#if app.notice}<p>{app.notice}</p>{/if}
    {#each messages as m (m)}<p>{m}</p>{/each}
    {#if offline && app.online && DEMO_VIDEO_URL}<p><a href={DEMO_VIDEO_URL} target="_blank" rel="noopener">Δες πώς δουλεύει</a></p>{/if}
    </div>
    <button type="button" class="wx" aria-label="Κλείσιμο" onclick={() => (closed = key)}><Icon name="close" size={13} /></button>
  </div>
{/if}

<style>
  /* On its own under the bar (Panel's .under): rounded like it, solid, not on a panel. */
  .warn { display: flex; align-items: center; gap: 8px; padding: 10px 6px 10px 16px; border-radius: 22px; background: color-mix(in srgb, var(--warn-fg, #f0ae45) 13%, var(--surface)); color: var(--fg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn-fg, #f0ae45) 30%, transparent), 0 8px 24px rgba(0, 0, 0, .3); font-size: 13.5px; line-height: 1.4; }
  .wt { flex: 1; min-width: 0; }
  .wx { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: none; color: inherit; cursor: pointer; }
  .wx:hover { background: color-mix(in srgb, var(--fg) 10%, transparent); }
  p { margin: 0; }
  p + p { margin-top: 4px; }
  a, .link { color: inherit; font-weight: 600; }
  .link { padding: 0; border: 0; background: none; font: inherit; text-decoration: underline; cursor: pointer; }
</style>
