<script lang="ts" module>
  export type IconName = "star" | "star-filled" | "bus" | "metro" | "tram" | "suburban" | "pin" | "stop" | "area" | "street" | "dot" | "walk" | "chevron"
    | "clock" | "map" | "route" | "bell" | "layers" | "back" | "close" | "swap" | "search" | "share" | "vibrate" | "shield" | "check"
    | "down" | "cube" | "warn" | "plus" | "chevron-up" | "locate" | "home" | "work" | "ticket" | "pushpin" | "sliders" | "trolley";
</script>

<script lang="ts">
  // The one icon set (UI-SPEC-web-v2 B0): line icons in currentColor on a 20 px grid, hidden from screen readers
  // (a text label beside them, or an aria-label on their button, says what they mean). Inside a sentence, `label`
  // names the icon instead («Πάτα το αστέρι»).
  let { name, size = 16, label }: { name: IconName; size?: number; label?: string } = $props();
</script>

<svg class="icon" viewBox="0 0 20 20" width={size} height={size} aria-hidden={label ? undefined : "true"} role={label ? "img" : undefined}
  aria-label={label} fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" stroke-linejoin="round">
  {#if name === "star" || name === "star-filled"}
    <path d="M10 2.6l2.3 4.7 5.1.7-3.7 3.6.9 5.1L10 14.3l-4.6 2.4.9-5.1L2.6 8l5.1-.7z" fill={name === "star-filled" ? "currentColor" : "none"} />
  {:else if name === "bus"}
    <rect x="4" y="3" width="12" height="12" rx="2" /><path d="M4 10h12M7 15v2M13 15v2" /><circle cx="7.5" cy="12.5" r=".6" /><circle cx="12.5" cy="12.5" r=".6" />
  {:else if name === "trolley"}
    <rect x="4" y="6" width="12" height="10" rx="2" /><path d="M4 12h12M7 16v2M13 16v2M8.5 6 6.5 2M11.5 6l2-4" />
  {:else if name === "metro"}
    <circle cx="10" cy="10" r="7" /><path d="M6.5 13.5V7l3.5 4 3.5-4v6.5" />
  {:else if name === "tram"}
    <rect x="5" y="5" width="10" height="10" rx="2" /><path d="M8 2.5h4M10 2.5V5M7 15l-2 2.5M13 15l2 2.5M5 10h10" />
  {:else if name === "suburban"}
    <rect x="5" y="3" width="10" height="11" rx="3" /><path d="M5 9h10M7.5 14 5.5 17.5M12.5 14l2 3.5" />
  {:else if name === "locate"}
    <circle cx="10" cy="10" r="5.2" /><circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none" /><path d="M10 1.8v2.6M10 15.6v2.6M1.8 10h2.6M15.6 10h2.6" />
  {:else if name === "pin"}
    <path d="M10 18s5.5-5.2 5.5-9.5a5.5 5.5 0 0 0-11 0C4.5 12.8 10 18 10 18z" /><circle cx="10" cy="8.5" r="2" />
  {:else if name === "stop"}
    <path d="M7 18V3" /><rect x="7" y="3" width="9" height="7" rx="1.5" /><path d="M10 6.5h3" />
  {:else if name === "walk"}
    <circle cx="11" cy="3.6" r="1.6" /><path d="M9.6 7.2 7.2 9.4v2.6M9.6 7.2l1.6 4.2 2.6 1.6M9.6 7.2l2.6.4 1.4 2.4M10.4 10l-2 7.5M11.2 11.4l1.2 6.1" />
  {:else if name === "chevron"}
    <path d="M5.5 8l4.5 4.5L14.5 8" />
  {:else if name === "chevron-up"}
    <path d="M5.5 12l4.5-4.5L14.5 12" />
  {:else if name === "home"}
    <path d="M3 9.2 10 3.5l7 5.7V17H3z" /><path d="M8 17v-4.5h4V17" />
  {:else if name === "work"}
    <rect x="2.8" y="6" width="14.4" height="10.5" rx="2" /><path d="M7.5 6V4h5v2M2.8 10.5h14.4" />
  {:else if name === "clock"}
    <circle cx="10" cy="10" r="7.5" /><path d="M10 5.8V10l2.6 1.7" />
  {:else if name === "map"}
    <path d="M7.5 3.3 2.5 5v11.7l5-1.7 5 1.7 5-1.7V3.3l-5 1.7-5-1.7z" /><path d="M7.5 3.3V15M12.5 5v11.7" />
  {:else if name === "route"}
    <circle cx="5" cy="15.8" r="1.7" /><circle cx="15" cy="4.2" r="1.7" /><path d="M6.7 15.8h5.8a2.9 2.9 0 0 0 0-5.8h-5a2.9 2.9 0 0 1 0-5.8h5.8" />
  {:else if name === "bell"}
    <path d="M5 7a5 5 0 0 1 10 0c0 5.8 2.5 7.5 2.5 7.5h-15S5 12.8 5 7" /><path d="M8.6 17.5a1.6 1.6 0 0 0 2.8 0" />
  {:else if name === "layers"}
    <path d="M10 2.5l7.5 4.2L10 10.8 2.5 6.7z" /><path d="M2.5 10.8 10 15l7.5-4.2" />
  {:else if name === "back"}
    <path d="M12.5 5 7.5 10l5 5" />
  {:else if name === "close"}
    <path d="M5 5l10 10M15 5 5 15" />
  {:else if name === "swap"}
    <path d="M6 3.5v13M6 3.5 3 6.5M6 3.5l3 3M14 16.5v-13M14 16.5l-3-3M14 16.5l3-3" />
  {:else if name === "search"}
    <circle cx="9" cy="9" r="5.8" /><path d="M16.7 16.7l-3.4-3.4" />
  {:else if name === "share"}
    <circle cx="15" cy="4.2" r="2.3" /><circle cx="5" cy="10" r="2.3" /><circle cx="15" cy="15.8" r="2.3" /><path d="M7 11.2l6 3.4M13 5.4l-6 3.4" />
  {:else if name === "vibrate"}
    <rect x="6" y="2.5" width="8" height="15" rx="1.7" /><path d="M2.5 6.7v6.6M17.5 6.7v6.6" />
  {:else if name === "shield"}
    <path d="M10 1.7l6.7 3.3v5c0 4.2-2.9 7.1-6.7 8.3-3.8-1.2-6.7-4.1-6.7-8.3V5z" /><path d="M7.1 10l2.1 2.1 3.7-4.2" />
  {:else if name === "check"}
    <path d="M4.2 10l4.2 4.2 7.5-8.4" />
  {:else if name === "down"}
    <path d="M10 4.2v11.6M5 10.8l5 5 5-5" />
  {:else if name === "cube"}
    <path d="M10 2.5l6.7 3.8v7.4L10 17.5l-6.7-3.8V6.3z" /><path d="M10 10l6.7-3.7M10 10v7.5M10 10 3.3 6.3" />
  {:else if name === "warn"}
    <path d="M10 7.5v3.3M10 14.2h.01" /><path d="M8.6 3.3 1.8 15a1.7 1.7 0 0 0 1.4 2.5h13.6a1.7 1.7 0 0 0 1.4-2.5L11.4 3.3a1.7 1.7 0 0 0-2.8 0z" />
  {:else if name === "ticket"}
    <path d="M3 6.2a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 17 6.2v2a2 2 0 0 0 0 3.6v2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.8v-2a2 2 0 0 0 0-3.6z" /><path d="M12 4.7v10.6" stroke-dasharray="1.6 1.8" />
  {:else if name === "pushpin"}
    <path d="M7.5 3h5l-.8 5 2.8 2.8H5.5L8.3 8z" /><path d="M10 10.8V17.5" />
  {:else if name === "sliders"}
    <path d="M3.5 6h7M14.5 6h2M3.5 14h2M9.5 14h7" /><circle cx="12.5" cy="6" r="2" /><circle cx="7.5" cy="14" r="2" />
  {:else if name === "plus"}
    <path d="M10 4.2v11.6M4.2 10h11.6" />
  {:else if name === "area"}
    <circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" />
  {:else if name === "street"}
    <circle cx="10" cy="10" r="5" /><path d="M10 2v3M10 15v3M2 10h3M15 10h3" />
  {:else}
    <circle cx="10" cy="10" r="2.5" fill="currentColor" />
  {/if}
</svg>

<style>
  .icon { flex: none; vertical-align: -0.15em; }
</style>
