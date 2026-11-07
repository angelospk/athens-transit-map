<script lang="ts">
  import { bannerMessages } from "../banner";
  import { DEMO_VIDEO_URL } from "../config";
  import { STALE_S, type AppState } from "../state.svelte";
  import { serviceNote } from "../service";

  let { app }: { app: AppState } = $props();

  const banner = $derived(bannerMessages(app.statusFailed, app.status,
    app.selected.filter(l => app.live[l] && app.serverNow / 1000 - app.live[l].updated_at > STALE_S)));
  const offline = $derived(banner.offline);
  const messages = $derived(banner.messages);

  // The city's service note (service.ts), until × hides it; it comes back if the city's service changes.
  const KEY = "serviceNoteHidden";
  const note = $derived(serviceNote(app.cityInfo.service, app.cityInfo.inName));
  const seen = $derived(`${app.cityId}:${app.cityInfo.service}`);
  let hidden = $state<string[]>((() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } })());
  function hide() {
    hidden = [...hidden, seen];
    try { localStorage.setItem(KEY, JSON.stringify(hidden)); } catch { /* private mode */ }
  }
</script>

{#if note && !(Array.isArray(hidden) && hidden.includes(seen))}
  <div class="info" role="note">
    <p>{note}</p>
    <button type="button" aria-label="Κλείσιμο" onclick={hide}>×</button>
  </div>
{/if}
{#if messages.length || app.notice || !app.cityInfo.ready}
  <div class="warn" role="status">
    {#if !app.cityInfo.ready}<p>{app.cityInfo.name}: έρχεται σύντομα. Τώρα δείχνει μόνο την Αθήνα. <button type="button" class="link" onclick={() => app.setCity("athens")}>Πήγαινε στην Αθήνα</button></p>{/if}
    {#if app.notice}<p>{app.notice}</p>{/if}
    {#each messages as m (m)}<p>{m}</p>{/each}
    {#if offline && DEMO_VIDEO_URL}<p><a href={DEMO_VIDEO_URL} target="_blank" rel="noopener">Δες πώς δουλεύει</a></p>{/if}
  </div>
{/if}

<style>
  .warn { margin-top: 10px; padding: 6px 10px; border-radius: 8px; background: var(--warn-bg); font-size: 12px; }
  p { margin: 2px 0; }
  .info { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; padding: 6px 4px 6px 10px; border-radius: 8px;
    background: var(--control); color: var(--fg); font-size: 12px; }
  .info p { flex: 1; min-width: 0; }
  .info button { flex: none; width: 28px; height: 28px; margin: -4px 0; border: 0; border-radius: 6px; background: none;
    color: var(--muted); font-size: 16px; cursor: pointer; }
  a, .link { color: inherit; font-weight: 600; }
  .link { padding: 0; border: 0; background: none; font: inherit; text-decoration: underline; cursor: pointer; }
</style>
