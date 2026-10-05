<script lang="ts">
  import { AppState } from "./lib/state.svelte";
  import MapView from "./lib/map/MapView.svelte";
  import Panel from "./lib/ui/Panel.svelte";
  import InfoCard from "./lib/ui/InfoCard.svelte";

  const app = new AppState();
  app.init();
  if (import.meta.env.DEV) Object.assign(window, { __app: app });
</script>

<MapView {app} />
<Panel {app} />
<InfoCard {app} />
