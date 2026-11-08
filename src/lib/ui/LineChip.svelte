<script lang="ts">
  // A line's chip with its operator's mark (the compact mockups): OASA's for buses and trolleys (Athens), the metro's
  // and the tram's own; elsewhere, or for another mode, the plain chip in the line's colours.
  import type { CityId } from "../cities";
  let { label, bg, fg, mode = "bus", size = "md", city = "athens" }:
    { label: string; bg: string; fg: string; mode?: string; size?: "sm" | "md" | "lg"; city?: CityId } = $props();
  const LOGO: Record<string, string> = { bus: "icons/oasa.png", trolley: "icons/oasa.png", metro: "icons/metro-logo.svg", tram: "icons/tram-logo.svg" };
  const logo = $derived(city === "athens" && LOGO[mode] ? `${import.meta.env.BASE_URL}${LOGO[mode]}` : "");
</script>

<span class="lc {size}" class:logo={!!logo} style:--lb={bg} style:--lf={fg}>
  {#if logo}
    {#if mode === "bus" || mode === "trolley"}<span class="disc"><img src={logo} alt="" /></span>
    {:else if mode === "tram"}<img class="tram" src={logo} alt="" />
    {:else}<img class="mark" src={logo} alt="" />{/if}
  {/if}<span class="t">{label}</span>
</span>

<style>
  .lc { --h: 26px; flex: none; height: var(--h); min-width: calc(var(--h) * 1.5); display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    padding: 0 9px; box-sizing: border-box; border-radius: calc(var(--h) / 2); background: var(--lb); color: var(--lf); font-size: 13.5px; font-weight: 800; line-height: 1; }
  .lc.sm { --h: 20px; gap: 4px; padding: 0 7px; font-size: 11.5px; }
  .lc.lg { --h: 30px; font-size: 14.5px; }
  .lc.logo { padding-left: 3px; min-width: 0; }
  .t { display: block; line-height: 1; }
  .disc { flex: none; width: calc(var(--h) - 6px); height: calc(var(--h) - 6px); border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
  .disc img { width: 62%; height: 62%; display: block; }
  .mark { flex: none; width: calc(var(--h) - 4px); height: calc(var(--h) - 4px); display: block; }
  .tram { flex: none; height: calc(var(--h) - 6px); width: calc((var(--h) - 6px) * .72); object-fit: contain; display: block; }
</style>
