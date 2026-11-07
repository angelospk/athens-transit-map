<script lang="ts">
  // A stop's own name (mockup 40, B2): «Πώς τη λες εσύ;» with a few ideas to tap, and which of the user's ways it is
  // for (to work, home); the home screen then shows there only the lines that go that way. Free, on this device.
  import type { AppState } from "../state.svelte";
  import Sheet from "./Sheet.svelte";
  import Icon from "./Icon.svelte";

  let { app, id, official, onclose }: { app: AppState; id: string; official: string; onclose: () => void } = $props();

  const cur = () => app.stopNames[id] ?? {};
  let name = $state(cur().name ?? "");
  let ways = $state<("home" | "work")[]>([...(cur().ways ?? [])]);
  const IDEAS = ["Της γωνίας", "Απέναντι από το σχολείο", "Δίπλα στο περίπτερο", "Του φούρνου"];
  const WAYS = $derived(([["work", "Για τη δουλειά"], ["home", "Για το σπίτι"]] as const).filter(([k]) => !!app.places[k]));
  const toggle = (k: "home" | "work") => (ways = ways.includes(k) ? ways.filter(x => x !== k) : [...ways, k]);
  let input = $state<HTMLInputElement>();
  function save() {
    app.setStopName(id, { name, ways });
    app.notify(name.trim() ? `Η στάση ${official} λέγεται τώρα «${name.trim()}».` : `Αποθηκεύτηκε.`);
    onclose();
  }
  function clear() { app.setStopName(id, null); onclose(); }
</script>

<Sheet title="Πώς τη λες εσύ;" {onclose}>
  <p class="sp">Στάση {official}. Το όνομα το βλέπεις μόνο εσύ.</p>
  <input class="nin" bind:this={input} bind:value={name} maxlength="40" placeholder="π.χ. Η στάση του φούρνου" aria-label="Το δικό σου όνομα για τη στάση"
    onkeydown={e => { if (e.key === "Enter") save(); }} />
  <div class="ideas">
    {#each IDEAS as x (x)}<button type="button" class="idea" onclick={() => { name = x; input?.focus(); }}>{x}</button>{/each}
  </div>
  {#if WAYS.length}
    <p class="sq">Για πού την παίρνεις;</p>
    <div class="slist">
      {#each WAYS as [k, label] (k)}
        {@const on = ways.includes(k)}
        <button type="button" class="srow" aria-pressed={on} onclick={() => toggle(k)}>
          <span class="ic"><Icon name={k} size={20} /></span><span class="tx">{label}<small>{k === "work" ? "Θα βλέπεις εδώ μόνο τις γραμμές που πάνε στη δουλειά" : "Θα βλέπεις εδώ μόνο τις γραμμές που πάνε στο σπίτι"}</small></span>
          <span class="tick" class:on aria-hidden="true">{#if on}<svg viewBox="0 0 20 20" width="15" height="15"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}</span>
        </button>
      {/each}
    </div>
  {/if}
  <div class="sacts">
    {#if app.stopNames[id]}<button type="button" class="sback" onclick={clear}>Σβήσ' το</button>{/if}
    <button type="button" class="sdone" onclick={save}>Αποθήκευση</button>
  </div>
</Sheet>

<style>
  .nin { width: 100%; height: 56px; margin-top: 14px; padding: 0 16px; box-sizing: border-box; border: 2px solid var(--accent); border-radius: 14px;
    background: color-mix(in srgb, var(--fg) 7%, var(--surface)); color: var(--fg); font: inherit; font-size: 18px; font-weight: 600; line-height: 1; outline: none; }
  .nin::placeholder { color: var(--muted); font-weight: 500; }
  .ideas { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .idea { height: 36px; padding: 0 12px; display: flex; align-items: center; border: 0; border-radius: 10px; background: color-mix(in srgb, var(--fg) 8%, var(--surface));
    color: var(--muted); font: inherit; font-size: 14px; font-weight: 500; line-height: 1; cursor: pointer; }
  .idea:hover { color: var(--fg); }
</style>
