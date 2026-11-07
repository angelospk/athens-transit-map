<script lang="ts">
  // How full a bus is, as three small figures: as many drawn solid as the level (1 not full, 2 somewhat, 3 full).
  let { level, size = 18 }: { level: 0 | 1 | 2 | 3; size?: number } = $props();
</script>

<svg viewBox="0 0 24 16" width={size * 1.5} height={size} aria-hidden="true" class="load">
  {#each [0, 1, 2] as k (k)}
    <g class:on={k < level} transform="translate({k * 8} 0)">
      <circle cx="4" cy="3.6" r="2.4" />
      <path d="M0.8 15v-3.6A3.2 3.2 0 0 1 4 8.2a3.2 3.2 0 0 1 3.2 3.2V15z" />
    </g>
  {/each}
</svg>

<style>
  .load { display: block; flex: none; }
  g { fill: currentColor; opacity: .28; }
  g.on { opacity: 1; }
</style>
