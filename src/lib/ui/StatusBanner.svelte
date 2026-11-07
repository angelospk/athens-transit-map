<script lang="ts">
  import { bannerMessages } from "../banner";
  import { DEMO_VIDEO_URL } from "../config";
  import { STALE_S, type AppState } from "../state.svelte";

  let { app }: { app: AppState } = $props();

  const banner = $derived(bannerMessages(app.statusFailed, app.status,
    app.selected.filter(l => app.live[l] && app.serverNow / 1000 - app.live[l].updated_at > STALE_S), !app.online));
  const offline = $derived(banner.offline);
  const messages = $derived(banner.messages);
</script>

{#if messages.length || app.notice || !app.cityInfo.ready}
  <div class="warn" role="status">
    {#if !app.cityInfo.ready}<p>{app.cityInfo.name}: έρχεται σύντομα. Τώρα δείχνει μόνο την Αθήνα. <button type="button" class="link" onclick={() => app.setCity("athens")}>Πήγαινε στην Αθήνα</button></p>{/if}
    {#if app.notice}<p>{app.notice}</p>{/if}
    {#each messages as m (m)}<p>{m}</p>{/each}
    {#if offline && app.online && DEMO_VIDEO_URL}<p><a href={DEMO_VIDEO_URL} target="_blank" rel="noopener">Δες πώς δουλεύει</a></p>{/if}
  </div>
{/if}

<style>
  /* On its own under the bar (Panel's .under): rounded like it, solid, not on a panel. */
  .warn { padding: 12px 16px; border-radius: 22px; background: color-mix(in srgb, var(--warn-fg, #f0ae45) 13%, var(--surface)); color: var(--fg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn-fg, #f0ae45) 30%, transparent), 0 8px 24px rgba(0, 0, 0, .3); font-size: 13.5px; line-height: 1.4; }
  p { margin: 0; }
  p + p { margin-top: 4px; }
  a, .link { color: inherit; font-weight: 600; }
  .link { padding: 0; border: 0; background: none; font: inherit; text-decoration: underline; cursor: pointer; }
</style>
