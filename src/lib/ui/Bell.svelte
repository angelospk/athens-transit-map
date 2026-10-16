<script lang="ts">
  // Bell icon for alerts, in the text colour (an emoji does not follow the theme).
  let { label }: { label?: string } = $props();
</script>

<svg class="bell-i" viewBox="0 0 24 24" width="14" height="14" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}>
  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
</svg>

<style>
  .bell-i { flex: none; vertical-align: -2px; }
</style>
