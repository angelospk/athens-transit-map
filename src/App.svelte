<script lang="ts">
  import { untrack } from "svelte";
  import { AppState } from "./lib/state.svelte";
  import MapView from "./lib/map/MapView.svelte";
  import Panel from "./lib/ui/Panel.svelte";
  import StopCard from "./lib/ui/StopCard.svelte";
  import VehicleCard from "./lib/ui/VehicleCard.svelte";
  import LineCard from "./lib/ui/LineCard.svelte";
  import RailStopCard from "./lib/ui/RailStopCard.svelte";
  import FavsPanel from "./lib/ui/FavsPanel.svelte";
  import SearchModal from "./lib/ui/SearchModal.svelte";
  import { applyTheme } from "./lib/theme";
  import { mapProvider } from "./lib/apple/logic";

  const provider = mapProvider(location.search);   // before init: the card URLs it writes drop `map`
  const app = new AppState();
  app.init();
  $effect(() => applyTheme(app.theme));
  // Favourites only: at start (once the lines are loaded) and when it or the favourite bus lines change.
  $effect(() => {
    void app.favOnly; void app.favorites.join("|"); void app.lines;
    untrack(() => app.applyFavOnly());
  });
  if (import.meta.env.DEV) Object.assign(window, { __app: app });
</script>

{#if provider === "apple"}
  <!-- Experiment: Apple MapKit JS; loaded only on ?map=apple, so the OSM bundle stays as it was. -->
  {#await import("./lib/apple/AppleMapView.svelte") then m}<m.default {app} />{/await}
{:else}
  <MapView {app} />
{/if}
<Panel {app} />
<StopCard {app} />
<VehicleCard {app} />
<LineCard {app} />
<RailStopCard {app} />
<FavsPanel {app} />
<SearchModal {app} />
