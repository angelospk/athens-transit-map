<script lang="ts">
  // The bot check's widget (turnstile.ts) inside a feedback form. Nothing without a site key; otherwise the
  // script loads the first time the form is active, and the widget stays invisible unless Cloudflare wants
  // a click (interaction-only). The form calls token() when it sends: the token or "" (sent unverified).
  import { onDestroy } from "svelte";
  import { TOKEN_WAIT_MS, TURNSTILE_SITE_KEY, TokenBox, loadTurnstile, turnstileOn, type TurnstileApi } from "../turnstile";

  let { active }: { active: boolean } = $props();

  const on = turnstileOn();
  const box = new TokenBox();
  let el = $state<HTMLDivElement>();
  let api: TurnstileApi | null = null;
  let id: string | undefined;
  let failed = false;

  $effect(() => {
    if (!on || !active || !el || id || failed) return;
    let gone = false;
    const host = el;
    loadTurnstile().then(t => {
      if (gone || id || !host.isConnected) return;
      api = t;
      id = t.render(host, {
        sitekey: TURNSTILE_SITE_KEY, appearance: "interaction-only", size: "flexible", language: "el",
        callback: (tok: string) => box.set(tok),
        "expired-callback": () => box.clear(),
        "error-callback": () => { box.clear(); },
      });
    }).catch(() => { failed = true; });   // blocked or offline: the sends go out unverified
    return () => { gone = true; };
  });

  /** A fresh token for one send ("" when there is none); the widget then gets the next one. */
  export async function token(): Promise<string> {
    if (!on || failed) return "";
    const t = await box.take(TOKEN_WAIT_MS);   // the script or the token may still be on its way
    if (api && id) try { api.reset(id); } catch { /* the widget is gone */ }
    return t;
  }

  onDestroy(() => { if (api && id) try { api.remove(id); } catch { /* already gone */ } });
</script>

{#if on}<div class="bot" bind:this={el}></div>{/if}

<style>
  .bot { width: 100%; }
</style>
