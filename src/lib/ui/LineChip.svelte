<script lang="ts">
  // A bus line's chip in its colours: the number on the line's colour. No operator mark (the app is unofficial).
  let { label, bg, fg }: { label: string; bg: string; fg: string } = $props();
</script>

<b class="chip" style:--bg={bg} style:--fg={fg}>{label}</b>

<style>
  .chip { flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 40px; padding: 5px 7px;
    border-radius: 7px; background: var(--bg); color: var(--fg); font-size: 13px; font-weight: 700; line-height: 1.15;
    font-variant-numeric: tabular-nums; box-sizing: border-box; }
</style>
