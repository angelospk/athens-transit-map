<script lang="ts">
  // A bus line's chip in its colours; in Athens, OASA's mark in a white disc before the number (from the
  // GreekCaptain redesign). Other cities and modes: the plain chip.
  let { label, bg, fg, oasa = false }: { label: string; bg: string; fg: string; oasa?: boolean } = $props();
</script>

<b class="chip" class:logo={oasa} style:--bg={bg} style:--fg={fg}>{#if oasa}<span class="disc"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>{/if}{label}</b>

<style>
  .chip { flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 40px; padding: 5px 7px;
    border-radius: 7px; background: var(--bg); color: var(--fg); font-size: 13px; font-weight: 700; line-height: 1.15;
    font-variant-numeric: tabular-nums; box-sizing: border-box; }
  .chip.logo { padding-left: 4px; }
  .disc { flex: none; width: 17px; height: 17px; border-radius: 50%; background: #fff; display: grid; place-items: center; }
  .disc img { width: 64%; height: 64%; display: block; }
</style>
