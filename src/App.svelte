<script lang="ts">
  import { AppState } from "./lib/state.svelte";
  import MapView from "./lib/map/MapView.svelte";
  import Panel from "./lib/ui/Panel.svelte";
  import InfoCard from "./lib/ui/InfoCard.svelte";
  import StationCard from "./lib/ui/StationCard.svelte";
  import RailCard from "./lib/ui/RailCard.svelte";
  import TrainCard from "./lib/ui/TrainCard.svelte";
  import StopCard from "./lib/ui/StopCard.svelte";
  import { applyTheme } from "./lib/theme";

  const app = new AppState();
  app.init();
  $effect(() => applyTheme(app.theme));
  if (import.meta.env.DEV) Object.assign(window, { __app: app });
</script>

<MapView {app} />
<Panel {app} />
<InfoCard {app} />
<StationCard {app} />
<RailCard {app} />
<TrainCard {app} />
<StopCard {app} />
