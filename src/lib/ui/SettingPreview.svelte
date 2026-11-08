<script lang="ts" module>
  export type PreviewKind = "theme" | "look" | "others";
</script>

<script lang="ts">
  // A small picture of what a setting's choice looks like (the computer's settings window, desktop mockup Υ8): the
  // theme as the map with the home column on it, the 3D look as a street corner, the other buses while one is followed.
  // The theme's pictures keep their own colours; the others are drawn in the theme in use (`dark`).
  let { kind, v, dark }: { kind: PreviewKind; v: string; dark: boolean } = $props();

  type Pal = { land: string; minor: string; major: string; park: string; panel: string; ink: string };
  const DARK: Pal = { land: "#24252e", minor: "#3b3f4e", major: "#5a6175", park: "#1f5549", panel: "#15181e", ink: "#eef0f3" };
  const LIGHT: Pal = { land: "#e9ebef", minor: "#ffffff", major: "#ffffff", park: "#cde6cd", panel: "#ffffff", ink: "#15181d" };
  const here = $derived(dark ? DARK : LIGHT);
  const uid = $props.id();
</script>

{#snippet map(p: Pal, panel = true)}
  <rect width="150" height="100" fill={p.land} />
  <path d="M92 18 C118 12 140 26 138 46 C128 60 108 58 98 48 Z" fill={p.park} />
  <g fill="none" stroke={p.minor} stroke-width="1.5"><path d="M0 30 L150 22" /><path d="M0 70 L150 64" /><path d="M80 0 L86 100" /><path d="M120 0 L126 100" /><path d="M40 0 L46 100" /></g>
  <g fill="none" stroke={p.major} stroke-width="4" stroke-linecap="round"><path d="M0 56 C40 50 100 50 150 40" /><path d="M100 0 C98 40 104 70 112 100" /></g>
  {#if panel}
    <rect x="6" y="6" width="38" height="88" rx="6" fill={p.panel} />
    <rect x="11" y="12" width="28" height="6" rx="3" fill={p.ink} opacity=".9" />
    <rect x="11" y="24" width="20" height="4" rx="2" fill={p.ink} opacity=".45" />
    <rect x="11" y="34" width="28" height="12" rx="3" fill={p.ink} opacity=".14" />
    <rect x="11" y="50" width="28" height="12" rx="3" fill={p.ink} opacity=".14" />
    <rect x="96" y="52" width="16" height="9" rx="4.5" fill="#2546e0" /><circle cx="74" cy="60" r="4" fill="#4d8af0" stroke="#fff" stroke-width="1.5" />
  {/if}
{/snippet}

{#snippet block(x: number, y: number, w: number, d: number, h: number, c: string[], edge: boolean)}
  <path d="M{x} {y} L{x + w} {y - w * 0.45} L{x + w + d} {y - w * 0.45 + d * 0.45} L{x + d} {y + d * 0.45} Z" fill={c[0]} stroke={edge ? "#1b1d22" : "none"} stroke-width="1.4" stroke-linejoin="round" />
  <path d="M{x} {y} L{x + d} {y + d * 0.45} L{x + d} {y + d * 0.45 + h} L{x} {y + h} Z" fill={c[1]} stroke={edge ? "#1b1d22" : "none"} stroke-width="1.4" stroke-linejoin="round" />
  <path d="M{x + d} {y + d * 0.45} L{x + w + d} {y - w * 0.45 + d * 0.45} L{x + w + d} {y - w * 0.45 + d * 0.45 + h} L{x + d} {y + d * 0.45 + h} Z" fill={c[2]} stroke={edge ? "#1b1d22" : "none"} stroke-width="1.4" stroke-linejoin="round" />
{/snippet}

<svg viewBox="0 0 150 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  {#if kind === "theme"}
    {@render map(v === "light" ? LIGHT : DARK)}
    {#if v === "system"}
      <!-- The device decides: half of each. -->
      <defs><clipPath id="half-{uid}"><path d="M150 0 L150 100 L60 100 Z" /></clipPath></defs>
      <g clip-path="url(#half-{uid})">{@render map(LIGHT)}</g>
    {/if}
  {:else if kind === "look"}
    {#if v === "off"}
      {@render map(here, false)}
      <rect x="62" y="44" width="22" height="11" rx="5.5" fill="#2546e0" /><circle cx="44" cy="62" r="4" fill="#4d8af0" stroke="#fff" stroke-width="1.5" />
    {:else}
      {@const toon = v === "toon"}
      {@const b = toon ? [["#7fb3ff", "#5a8fe0", "#4a7bc8"], ["#ffb36b", "#e8964d", "#cf7f39"]]
        : dark ? [["#5c626d", "#454a53", "#3a3e46"], ["#686d77", "#50545c", "#43474e"]] : [["#f4f5f7", "#d9dce1", "#c9cdd4"], ["#eceef1", "#d2d6dc", "#c2c7cf"]]}
      {@const ground = toon ? "#3d4252" : dark ? "#1d2026" : "#e4e6e9"}
      {@const road = toon ? "#5d6475" : dark ? "#2b2f37" : "#ffffff"}
      <rect width="150" height="100" fill={ground} />
      <path d="M0 84 L150 40 L150 64 L0 108 Z" fill={road} />
      <path d="M6 92 L144 52" stroke={dark || toon ? "#e8eaed" : "#c9cdd4"} stroke-width="1.2" stroke-dasharray="6 6" opacity=".6" />
      {#if !toon}<path d="M58 70 L92 58 L118 68 L84 82 Z" fill="#000" opacity={dark ? 0.28 : 0.1} />{/if}
      {@render block(14, 34, 34, 22, 30, b[0], toon)}
      {@render block(56, 22, 30, 20, 40, b[1], toon)}
      <path d="M96 70 L132 59 L138 62 L102 73 Z" fill={toon ? "#ff5d5d" : "#2546e0"} />
      <path d="M102 73 L138 62 L138 70 L102 81 Z" fill={toon ? "#ff5d5d" : "#2546e0"} opacity=".88" />
      <rect x="122" y="56" width="3" height="16" fill={toon ? "#8a5a2b" : "#6b5440"} />
      <circle cx="123.5" cy="52" r="10" fill={toon ? "#4cd37a" : dark ? "#3f6b45" : "#7fb685"} stroke={toon ? "#1b1d22" : "none"} stroke-width="1.4" />
    {/if}
  {:else}
    {@const op = v === "normal" ? 1 : v === "dim" ? 0.32 : 0}
    {@render map(here, false)}
    <path d="M-4 60 C40 50 80 56 154 34" fill="none" stroke="#2546e0" stroke-width="4" stroke-linecap="round" />
    {#each [[10, 16, "125"], [98, 72, "Ε14"], [116, 8, "307"]] as [x, y, n] (n)}
      <g opacity={op}>
        <rect x={+x} y={+y} width="26" height="13" rx="6.5" fill="#2546e0" stroke={here.land} stroke-width="1.5" />
        <text x={+x + 13} y={+y + 9.6} text-anchor="middle" font-size="8" font-weight="800" fill="#fff">{n}</text>
      </g>
    {/each}
    <rect x="56" y="40" width="34" height="17" rx="8.5" fill="#2546e0" stroke="#fff" stroke-width="2" />
    <text x="73" y="52" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">308</text>
  {/if}
</svg>

<style>
  svg { display: block; width: 100%; height: 100%; font-family: var(--font); }
</style>
