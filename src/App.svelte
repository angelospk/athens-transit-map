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

<MapView {app} />
<Panel {app} />
<StopCard {app} />
<VehicleCard {app} />
<LineCard {app} />
<RailStopCard {app} />
<FavsPanel {app} />
<SearchModal {app} />
