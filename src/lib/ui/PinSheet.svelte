<script lang="ts">
  // «Καρφίτσωμα στον χάρτη» (pins.ts): a line or a stop kept on the map in a colour the user picks. A sheet from the
  // bottom on a phone, a small dialog on a computer. Opened from a line's or a stop's card, and from «Καρφιτσωμένα».
  import { tick } from "svelte";
  import type { AppState } from "../state.svelte";
  import { PIN_COLORS, PIN_WIDTH, hueColor, inkOn, type Pin } from "../pins";
  import Icon from "./Icon.svelte";

  let { app }: { app: AppState } = $props();

  let draft = $state<Pin | null>(null);
  let hue = $state<number | null>(null);   // set by the hue strip; a swatch clears it
  let box: HTMLElement | undefined = $state();
  let opener: Element | null = null;
  const existing = $derived(draft ? app.pinOf(draft.kind, draft.id) : undefined);

  $effect(() => {
    const p = app.pinEdit;
    if (!p) { draft = null; return; }
    opener = document.activeElement;
    draft = { ...p };
    hue = PIN_COLORS.some(([c]) => c === p.color) ? null : 0;
    void tick().then(() => box?.querySelector<HTMLElement>("[aria-checked='true']")?.focus());
  });

  function close() {
    app.pinEdit = null;
    const o = opener as HTMLElement | null;
    opener = null;
    void tick().then(() => o?.focus?.());
  }
  function save() { if (draft) app.savePin({ ...draft }); close(); }
  function remove() { if (draft) app.unpin(draft.kind, draft.id); close(); }

  // The hue strip: a press or a drag sets the hue; the arrows step it.
  let strip: HTMLElement | undefined = $state();
  function hueAt(e: PointerEvent) {
    if (!strip || !draft) return;
    const r = strip.getBoundingClientRect();
    hue = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 360);
    draft.color = hueColor(hue);
  }
  function hueKey(e: KeyboardEvent) {
    if (!draft || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    hue = ((hue ?? 0) + (e.key === "ArrowRight" ? 10 : 350)) % 360;
    draft.color = hueColor(hue);
  }
  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
</script>

{#if draft}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (Escape closes) -->
  <div class="scrim" use:portal onclick={e => { if (e.target === e.currentTarget) close(); }}
    onkeydown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pin-h" bind:this={box}>
      <span class="grip" aria-hidden="true"></span>
      <div class="head">
        {#if draft.kind === "line"}
          <span class="badge" style:--c={draft.color} style:--t={inkOn(draft.color)}>{draft.label}</span>
        {:else}
          <span class="dot" style:--c={draft.color} aria-hidden="true"><Icon name="stop" size={18} /></span>
        {/if}
        <span class="ht">
          <b id="pin-h">Καρφίτσωμα στον χάρτη</b>
          <small>{draft.kind === "line" ? `Η γραμμή ${draft.label} μένει πάντα ορατή` : `${draft.label} · μένει πάντα ορατή`}</small>
        </span>
        <button type="button" class="x" aria-label="Κλείσιμο" onclick={close}><Icon name="close" size={16} /></button>
      </div>

      <div class="grp">
        <span class="lab" id="pin-c">Χρώμα</span>
        <div class="sw" role="radiogroup" aria-labelledby="pin-c">
          {#each PIN_COLORS as [c, name] (c)}
            {@const on = hue == null && draft.color === c}
            <button type="button" role="radio" aria-checked={on} aria-label={name} class="swatch" class:on style:--c={c}
              onclick={() => { draft!.color = c; hue = null; }}>
              {#if on}<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M4.5 10.2l3.6 3.6 7.4-8" fill="none" stroke={inkOn(c)} stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
            </button>
          {/each}
        </div>
        <div class="huebox">
          <span class="sub">Ή διάλεξε απόχρωση</span>
          <div class="hue" bind:this={strip} role="slider" tabindex="0" aria-label="Απόχρωση" aria-valuemin={0} aria-valuemax={360} aria-valuenow={hue ?? 0}
            onpointerdown={e => { (e.currentTarget as Element).setPointerCapture(e.pointerId); hueAt(e); }}
            onpointermove={e => { if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) hueAt(e); }} onkeydown={hueKey}>
            {#if hue != null}<i class="knob" style:left="{(hue / 360) * 100}%" style:--c={draft.color}></i>{/if}
          </div>
        </div>
      </div>

      {#if draft.kind === "line"}
        <div class="grp">
          <span class="lab" id="pin-w">Πάχος</span>
          <div class="seg" role="radiogroup" aria-labelledby="pin-w">
            {#each [[1, "Λεπτή"], [2, "Κανονική"], [3, "Έντονη"]] as const as [w, t] (w)}
              <button type="button" role="radio" aria-checked={draft.width === w} onclick={() => (draft!.width = w)}>
                <i style:height="{PIN_WIDTH[w]}px" style:--c={draft.color}></i><span>{t}</span></button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="switches">
        {#if draft.kind === "line"}
          <button type="button" role="switch" aria-checked={draft.vehicles} onclick={() => (draft!.vehicles = !draft!.vehicles)}>
            <span class="st"><b>Ζωντανά οχήματα της γραμμής</b><small>Στο ίδιο χρώμα, και όταν δεν τη διαλέγεις</small></span><span class="track"><i></i></span></button>
        {/if}
        <button type="button" role="switch" aria-checked={draft.top} onclick={() => (draft!.top = !draft!.top)}>
          <span class="st"><b>Πάνω από όλα τα άλλα</b><small>Μένει και όταν ανοίγεις διαδρομή ή άλλη κάρτα</small></span><span class="track"><i></i></span></button>
      </div>

      <div class="acts">
        {#if existing}<button type="button" class="ghost" onclick={remove}>Ξεκαρφίτσωμα</button>{/if}
        <button type="button" class="primary" onclick={save}><Icon name="pushpin" size={18} /><span>{existing ? "Αποθήκευση" : "Καρφίτσωσε"}</span></button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 1500; display: flex; align-items: center; justify-content: center; background: rgba(8, 10, 14, .45);
    animation: fade .15s ease; }
  .sheet { width: 400px; max-width: calc(100% - 24px); max-height: calc(100dvh - 24px); overflow-y: auto; scrollbar-width: none; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 18px; padding: 18px; border-radius: 24px; background: var(--surface); color: var(--fg);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .5); animation: rise .22s cubic-bezier(.2, .8, .2, 1); }
  .sheet::-webkit-scrollbar { display: none; }
  .grip { display: none; }
  .head { display: flex; align-items: center; gap: 12px; }
  .badge { flex: none; display: flex; align-items: center; justify-content: center; min-width: 48px; height: 34px; padding: 0 10px; box-sizing: border-box;
    border-radius: 9px; background: var(--c); color: var(--t); font-size: 16px; font-weight: 800; line-height: 1; }
  .dot { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%;
    background: color-mix(in srgb, var(--c) 20%, transparent); color: var(--c); }
  .ht { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .ht b { font-size: 17px; font-weight: 800; line-height: 1.2; }
  .ht small { font-size: 12.5px; line-height: 1.25; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .x { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%;
    background: var(--control); color: var(--muted); cursor: pointer; }
  .grp { display: flex; flex-direction: column; gap: 10px; }
  .lab { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); line-height: 1; }
  .sw { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 8px; }
  .swatch { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: var(--c);
    cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .12); transition: transform .12s; }
  .swatch.on { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--c); }
  .swatch:active { transform: scale(.92); }
  .huebox { display: flex; flex-direction: column; gap: 8px; }
  .sub { font-size: 12px; color: var(--muted); line-height: 1; }
  .hue { position: relative; height: 18px; border-radius: 9px; cursor: pointer; touch-action: none;
    background: linear-gradient(90deg, #f05c5c, #f0b84d, #b8e04d, #5ce07a, #4dd6e0, #5c8ff0, #a05cf0, #f05cc8, #f05c5c); }
  .hue:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .knob { position: absolute; top: 50%; width: 26px; height: 26px; border-radius: 50%; background: var(--c); border: 3px solid #fff; box-sizing: border-box;
    transform: translate(-50%, -50%); box-shadow: 0 2px 8px rgba(0, 0, 0, .45); pointer-events: none; }
  .seg { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: 14px; background: var(--control); }
  .seg button { height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 6px; border: 0; border-radius: 10px; background: none;
    color: var(--muted); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .seg button[aria-checked="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .18); }
  .seg i { width: 22px; border-radius: 3px; background: var(--c); flex: none; }
  .switches { display: flex; flex-direction: column; border-radius: 16px; background: var(--card); border: 1px solid var(--card-border); overflow: hidden; }
  .switches button { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 8px 14px; border: 0; background: none; color: var(--fg);
    font: inherit; text-align: left; cursor: pointer; }
  .switches button + button { border-top: 1px solid var(--card-border); }
  .st { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .st b { font-size: 14px; font-weight: 700; line-height: 1.2; }
  .st small { font-size: 12px; line-height: 1.3; color: var(--muted); }
  .track { position: relative; flex: none; width: 44px; height: 26px; border-radius: 13px; background: color-mix(in srgb, var(--muted) 38%, transparent); transition: background .15s; }
  .track i { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .3); transition: transform .15s; }
  [aria-checked="true"] > .track { background: var(--accent); }
  [aria-checked="true"] > .track i { transform: translateX(18px); }
  .acts { display: flex; gap: 10px; }
  .acts button { height: 52px; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 0 18px; border: 0; border-radius: 16px;
    font: inherit; font-size: 15px; font-weight: 800; line-height: 1; cursor: pointer; }
  .primary { flex: 1; background: var(--accent); color: var(--on-accent); }
  .ghost { background: var(--control); color: var(--late3); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { transform: translateY(24px); opacity: 0; } }
  @media (max-width: 719px) {
    .scrim { align-items: flex-end; }
    .sheet { width: 100%; max-width: none; margin: 0 8px max(8px, env(safe-area-inset-bottom)); padding: 10px 16px 16px; border-radius: 26px; }
    .grip { display: block; align-self: center; width: 40px; height: 4px; border-radius: 2px; background: var(--border); }
  }
  @media (prefers-reduced-motion: reduce) { .scrim, .sheet { animation: none; } }
</style>
