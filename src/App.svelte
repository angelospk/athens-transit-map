<script lang="ts">
  import { AppState } from "./lib/state.svelte";
  import MapView from "./lib/map/MapView.svelte";
  import Panel from "./lib/ui/Panel.svelte";
  import StopCard from "./lib/ui/StopCard.svelte";
  import VehicleCard from "./lib/ui/VehicleCard.svelte";
  import LineCard from "./lib/ui/LineCard.svelte";
  import RailStopCard from "./lib/ui/RailStopCard.svelte";
  import { applyTheme } from "./lib/theme";

  const app = new AppState();
  app.init();
  $effect(() => applyTheme(app.theme));
  if (import.meta.env.DEV) Object.assign(window, { __app: app });
</script>

<MapView {app} />
<Panel {app} />
<StopCard {app} />
<VehicleCard {app} />
<LineCard {app} />
<RailStopCard {app} />
