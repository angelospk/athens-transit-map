<script lang="ts" module>
  export type IconName = "star" | "star-filled" | "bus" | "metro" | "tram" | "suburban" | "pin" | "stop" | "area" | "street" | "dot";
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
  {:else if name === "metro"}
    <circle cx="10" cy="10" r="7" /><path d="M6.5 13.5V7l3.5 4 3.5-4v6.5" />
  {:else if name === "tram"}
    <rect x="5" y="5" width="10" height="10" rx="2" /><path d="M8 2.5h4M10 2.5V5M7 15l-2 2.5M13 15l2 2.5M5 10h10" />
  {:else if name === "suburban"}
    <rect x="5" y="3" width="10" height="11" rx="3" /><path d="M5 9h10M7.5 14 5.5 17.5M12.5 14l2 3.5" />
  {:else if name === "pin"}
    <path d="M10 18s5.5-5.2 5.5-9.5a5.5 5.5 0 0 0-11 0C4.5 12.8 10 18 10 18z" /><circle cx="10" cy="8.5" r="2" />
  {:else if name === "stop"}
    <path d="M7 18V3" /><rect x="7" y="3" width="9" height="7" rx="1.5" /><path d="M10 6.5h3" />
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
