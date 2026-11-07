<script lang="ts" generics="T extends string | number">
  // The app's one dropdown (no native <select>): a button showing the choice, and a list under it. Keyboard: the
  // arrows move, Enter or Space picks, Escape or Tab closes; a press outside closes it too.
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { pop } from "../anim";

  let { value, options, label, onpick, prefix, align = "left", variant = "chip" }: {
    value: T;
    options: readonly { value: T; label: string; hint?: string }[];
    label: string;                 // what is chosen, for screen readers («Από πότε»)
    onpick: (v: T) => void;
    prefix?: string;               // a quiet word before the choice («Πότε»)
    align?: "left" | "right";      // which edge the list lines up with
    variant?: "chip" | "solid" | "field";   // a small pill, a filled pill (the main choice of a row), or a full-width field
  } = $props();

  let open = $state(false);
  let active = $state(0);
  let root: HTMLElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();
  const id = `dd-${Math.random().toString(36).slice(2, 8)}`;
  const current = $derived(options.find(o => o.value === value));

  // The list floats over the page (moved to <body>, placed by the button): a panel that scrolls or clips its content
  // (the planner's column, a sheet) cannot cut it off. Up: above the button when there is no room for it below.
  let up = $state(false);
  let list: HTMLElement | undefined = $state();
  let place = $state("");
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
  function measure() {
    const r = button?.getBoundingClientRect();
    if (!r) return;
    const x = align === "right" ? `right: ${Math.round(innerWidth - r.right)}px` : `left: ${Math.round(r.left)}px`;
    const y = up ? `bottom: ${Math.round(innerHeight - r.top + 6)}px` : `top: ${Math.round(r.bottom + 6)}px`;
    place = `${x}; ${y}; min-width: ${Math.round(r.width)}px`;
  }
  // Scrolled or resized under it: it closes (it would no longer sit by its button).
  $effect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!list?.contains(e.target as Node)) open = false; };
    addEventListener("scroll", off, true);
    addEventListener("resize", off);
    return () => { removeEventListener("scroll", off, true); removeEventListener("resize", off); };
  });
  const reveal = async () => { await tick(); document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); };
  async function show() {
    active = Math.max(0, options.findIndex(o => o.value === value));
    const r = button?.getBoundingClientRect();
    up = !!r && innerHeight - r.bottom < Math.min(270, options.length * 40 + 20) && r.top > innerHeight - r.bottom;
    measure();
    open = true;
    await reveal();
  }
  function pick(v: T) {
    open = false;
    onpick(v);
    button?.focus();
  }
  function key(e: KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); void show(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(options.length - 1, active + 1); void reveal(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); void reveal(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(options[active].value); }
    else if (e.key === " ") e.preventDefault();   // picked on keyup: a keydown pick lets the keyup click open it again
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); open = false; }
    else if (e.key === "Tab") open = false;
  }
</script>

<svelte:document onpointerdown={e => { if (open && root && !root.contains(e.target as Node) && !list?.contains(e.target as Node)) open = false; }} />

<div class="dd {variant}" bind:this={root}>
  <button type="button" bind:this={button} class="btn" class:open role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls="{id}-list"
    aria-label="{label}: {current?.label ?? ''}" aria-activedescendant={open ? `${id}-${active}` : undefined}
    onclick={() => (open ? (open = false) : void show())} onkeydown={key}
    onkeyup={e => { if (e.key === " " && open) { e.preventDefault(); pick(options[active].value); } }}>
    {#if prefix}<span class="pre">{prefix}</span>{/if}
    <span class="val">{current?.label ?? ""}</span>
    <Icon name={open ? "chevron-up" : "chevron"} size={14} />
  </button>
  {#if open}
    <div class="list {variant}" class:right={align === "right"} class:up id="{id}-list" role="listbox" aria-label={label} bind:this={list} use:portal style={place}
      transition:pop={{ start: 0.96, duration: 160 }}>
      {#each options as o, k (o.value)}
        <!-- svelte-ignore a11y_click_events_have_key_events (the keyboard goes through the button) -->
        <div id="{id}-{k}" role="option" tabindex="-1" aria-selected={o.value === value} class="opt" class:active={k === active} class:sel={o.value === value}
          onpointerenter={() => (active = k)} onpointerdown={e => e.preventDefault()} onclick={() => pick(o.value)}>
          <span class="txt"><span>{o.label}</span>{#if o.hint}<small>{o.hint}</small>{/if}</span>
          {#if o.value === value}<Icon name="check" size={15} />{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dd { position: relative; flex: none; }
  .dd.field { flex: 1; min-width: 0; }
  .btn { height: 34px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px 0 12px; border: 1px solid var(--border);
    border-radius: 17px; background: var(--card); color: var(--fg); font: inherit; font-size: 13px; font-weight: 600; line-height: 1;
    white-space: nowrap; cursor: pointer; }
  .field .btn { width: 100%; height: 44px; justify-content: flex-start; gap: 10px; padding: 0 12px 0 14px; border-radius: 14px; }
  .btn.open { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
  .pre { font-size: 12px; font-weight: 500; color: var(--muted); }
  .val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: left; }
  .chip .val, .solid .val { flex: none; }
  .solid .btn { height: 36px; padding: 0 10px 0 14px; border: 0; border-radius: 18px; background: var(--fg); color: var(--surface); font-weight: 700; }
  .solid .pre { color: inherit; opacity: .7; }
  .list.solid { min-width: 170px; }
  .list { position: fixed; z-index: 1000; box-sizing: border-box; max-height: 260px; overflow-y: auto; padding: 6px;
    border-radius: 16px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); display: flex; flex-direction: column; }
  .list.chip { min-width: 170px; }
  .list.right { transform-origin: 100% 0; }
  .list { transform-origin: 0 0; }
  .list.up { transform-origin: 0 100%; }
  .opt { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 12px; border-radius: 11px;
    color: var(--fg); font-size: 14px; font-weight: 600; line-height: 1.1; cursor: pointer; }
  .opt.active { background: var(--control); }
  .opt.sel { background: var(--accent-bg); color: var(--accent); }
  .txt { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .txt small { font-size: 11px; font-weight: 500; color: var(--muted); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .btn :global(svg) { transition: transform .2s; }
  .opt { transition: background-color .12s; }
  @media (prefers-reduced-motion: reduce) { .btn :global(svg), .opt { transition: none; } }
</style>
