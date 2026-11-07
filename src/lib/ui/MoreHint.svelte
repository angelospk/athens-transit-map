<script module lang="ts">
  let nudged = false;   // the opening nudge plays once per visit
</script>

<script lang="ts">
  // «Πιο κάτω» (mockup 35): while a panel has more under its fold, a pill names what is there (the sections marked
  // data-peek, with their icons) and its arrows fall; a tap scrolls to the first of them. Once scrolled, the pill
  // folds into a round «Πάνω» at the right. On the first open the panel nudges up once to show it moves.
  // It sits at the foot of its parent (the sticky «Πάμε» bar, or a sticky foot of its own): its pieces hang above it.
  import Icon, { type IconName } from "./Icon.svelte";

  // inline: in a row of its parent (beside «Μόνο ο χάρτης» under «Πάμε»), its light line on the parent's top edge.
  let { box, inline = false }: { box: HTMLElement | undefined; inline?: boolean } = $props();

  let more = $state(false), scrolled = $state(false);
  let padB = $state(0);   // the panel's own bottom padding: the sticky foot stops above it, the hint goes down to the edge
  let peek = $state.raw<{ label: string; icon: IconName; el: HTMLElement }[]>([]);
  let sc: HTMLElement | null = null;
  const born = Date.now();

  function scroller(b: HTMLElement): HTMLElement {
    const o = getComputedStyle(b).overflowY;
    if ((o === "auto" || o === "scroll") && b.scrollHeight > b.clientHeight + 1) return b;
    return b.parentElement ?? b;
  }
  function measure() {
    if (!box) return;
    const s = scroller(box);
    if (s !== sc) { sc?.removeEventListener("scroll", onScroll); sc = s; s.addEventListener("scroll", onScroll, { passive: true }); }
    padB = !inline && s === box ? parseFloat(getComputedStyle(box).paddingBottom) || 0 : 0;
    const left = s.scrollHeight - s.scrollTop - s.clientHeight;
    more = left > 24;
    scrolled = s.scrollTop > 120;
    const v = s.getBoundingClientRect();
    const acts = box.querySelector<HTMLElement>(".acts");
    const foot = acts ? Math.min(v.bottom, acts.getBoundingClientRect().top) : v.bottom;
    const next: typeof peek = [];
    for (const el of Array.from(box.querySelectorAll<HTMLElement>("[data-peek]"))) {
      if (el.getBoundingClientRect().top > foot - 28) next.push({ label: el.dataset.peek!, icon: (el.dataset.peekIcon ?? "dot") as IconName, el });
    }
    if (next.length !== peek.length || next.some((x, k) => x.label !== peek[k].label)) peek = next;
  }
  let raf = 0;
  function onScroll() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); }

  const label = $derived.by(() => {
    const ls = peek.slice(0, 3).map((x, k) => (k ? x.label.charAt(0).toLowerCase() + x.label.slice(1) : x.label));
    return ls.join(", ");
  });

  // The nudge: up a little, then back with a soft landing; any touch, wheel or key stops it.
  function nudge() {
    if (nudged || !sc || sc.scrollTop > 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    nudged = true;
    const s = sc, H = Math.min(64, s.scrollHeight - s.clientHeight), T = 1300, t0 = performance.now();
    let stop = false;
    const quit = () => { stop = true; };
    const evs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    evs.forEach(e => s.addEventListener(e, quit, { passive: true, once: true }));
    const io = (u: number) => (u < .5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
    const back = (u: number) => { const c = 1.6; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
    const step = (now: number) => {
      if (stop) return;
      const t = Math.min(1, (now - t0) / T);
      const y = t < .4 ? io(t / .4) : 1 - back((t - .4) / .6);
      s.scrollTop = Math.max(0, H * y);
      if (t < 1) requestAnimationFrame(step);
      else evs.forEach(e => s.removeEventListener(e, quit));
    };
    requestAnimationFrame(step);
  }
  $effect(() => {
    if (!more || nudged || Date.now() - born > 8000) return;
    const id = setTimeout(nudge, 600);
    return () => clearTimeout(id);
  });

  $effect(() => {
    const b = box;
    if (!b) return;
    measure();
    const ro = new ResizeObserver(() => onScroll());
    ro.observe(b);
    for (const c of Array.from(b.children)) ro.observe(c);
    const mo = new MutationObserver(() => onScroll());
    mo.observe(b, { childList: true, subtree: true });
    addEventListener("resize", onScroll);
    return () => { ro.disconnect(); mo.disconnect(); removeEventListener("resize", onScroll); sc?.removeEventListener("scroll", onScroll); sc = null; cancelAnimationFrame(raf); raf = 0; };
  });

  function down() {
    const el = peek[0]?.el;
    if (!el || !sc) return;
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 16;
    sc.scrollTo({ top, behavior: "smooth" });
  }
  const up = () => sc?.scrollTo({ top: 0, behavior: "smooth" });
</script>

<div class="hint" class:inline style:transform={padB ? `translateY(${padB}px)` : undefined}>
  {#if more}<span class="fade"></span>{/if}
  {#if more && !scrolled && peek.length}
    <button type="button" class="pill" class:inline onclick={down} aria-label="Πιο κάτω: {label}">
      <span class="pics" aria-hidden="true">{#each peek.slice(0, 3) as p, k (p.label)}<span class="pic {p.icon}" style:z-index={3 - k}><Icon name={p.icon} size={13} /></span>{/each}</span>
      <span class="pt">{label}</span>
      <span class="go" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
    </button>
  {:else if scrolled}
    <button type="button" class="up" class:inline onclick={up} aria-label="Πάνω" title="Πάνω"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg></button>
  {/if}
</div>

<style>
  .hint { position: absolute; left: 0; right: 0; bottom: 100%; height: 0; pointer-events: none; }
  .hint > * { pointer-events: auto; }
  .fade { position: absolute; left: -20px; right: -20px; bottom: 0; height: 130px; pointer-events: none;
    background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--acts-bg, var(--surface)) 85%, transparent) 60%, var(--acts-bg, var(--surface))); }

  .pill { position: absolute; bottom: 16px; left: 50%; translate: -50% 0; height: 44px; max-width: calc(100% - 8px); display: flex; align-items: center; gap: 10px;
    padding: 0 6px 0 8px; border-radius: 22px; overflow: hidden; border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 92%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
    color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; white-space: nowrap; cursor: pointer;
    box-shadow: 0 8px 22px rgba(0, 0, 0, .28); animation: rise .5s cubic-bezier(.2, .8, .2, 1) both; }
  .pill:hover { border-color: color-mix(in srgb, var(--fg) 24%, var(--border)); }
  .pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px) scale(.96); } }
  .pics { display: flex; padding-left: 7px; }
  .pic { position: relative; width: 28px; height: 28px; margin-left: -7px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
    border-radius: 50%; border: 2px solid var(--surface); background: var(--control); color: var(--muted); }
  .pic.home, .pic.route { color: var(--fg); }
  .pic.star { background: color-mix(in srgb, var(--star, #f0ae45) 24%, var(--surface)); color: var(--star, #f0ae45); }
  .pt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .go { flex: none; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; color: var(--muted); }

  .up { position: absolute; bottom: 16px; right: 0; width: 44px; height: 44px; padding: 0; display: flex; align-items: center; justify-content: center;
    border-radius: 50%; border: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 92%, transparent);
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); color: var(--fg); cursor: pointer; box-shadow: 0 8px 22px rgba(0, 0, 0, .28);
    animation: rise .35s cubic-bezier(.2, .8, .2, 1) both; }
  .up:hover { background: var(--control); }
  .up:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* Inline: no fade (the bar has its own), the line on the bar's top edge, the pill and «Πάνω» in the row. */
  .hint.inline { display: contents; }
  .inline .fade { left: 20%; right: 20%; top: 0; bottom: auto; height: 0; background: none; }
  .pill.inline, .up.inline { position: relative; bottom: auto; left: auto; right: auto; translate: none; flex: none; }
  .pill.inline { height: 36px; max-width: 62%; gap: 8px; padding: 0 4px 0 6px; border-radius: 18px; font-size: 12.5px; box-shadow: none; }
  .pill.inline .pic { width: 24px; height: 24px; }
  .pill.inline .go { width: 28px; height: 28px; }
  .up.inline { width: 36px; height: 36px; box-shadow: none; }
  @media (prefers-reduced-motion: reduce) { .pill, .up { animation: none; } }
</style>
