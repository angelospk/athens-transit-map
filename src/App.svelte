<script lang="ts">
  import { untrack } from "svelte";
  import { AppState } from "./lib/state.svelte";
  import MapView from "./lib/map/MapView.svelte";
  import Panel from "./lib/ui/Panel.svelte";
  import StopCard from "./lib/ui/StopCard.svelte";
  import VehicleCard from "./lib/ui/VehicleCard.svelte";
  import LineCard from "./lib/ui/LineCard.svelte";
  import MuniLineCard from "./lib/ui/MuniLineCard.svelte";
  import MuniStopCard from "./lib/ui/MuniStopCard.svelte";
  import RailStopCard from "./lib/ui/RailStopCard.svelte";
  import FavsPanel from "./lib/ui/FavsPanel.svelte";
  import NearbyPanel from "./lib/ui/NearbyPanel.svelte";
  import NowPanel from "./lib/ui/NowPanel.svelte";
  import TabBar from "./lib/ui/TabBar.svelte";
  import AlertsPanel from "./lib/ui/AlertsPanel.svelte";
  import RideBar from "./lib/ui/RideBar.svelte";
  import StartScreen from "./lib/ui/StartScreen.svelte";
  import NavGuide from "./lib/ui/NavGuide.svelte";
  import PinSheet from "./lib/ui/PinSheet.svelte";
  import FaresSheet from "./lib/ui/FaresSheet.svelte";
  import MuniReport from "./lib/ui/MuniReport.svelte";
  import { applyTheme } from "./lib/theme";

  const app = new AppState();
  app.init();
  $effect(() => applyTheme(app.theme));
  // «Τώρα» and «Ειδοποιήσεις» with no card: the phone hides the map's own buttons (app.css), as the mockup has none.
  $effect(() => { document.documentElement.toggleAttribute("data-pick", !!app.start && !!app.pickFor); });
  $effect(() => { document.documentElement.toggleAttribute("data-start", !!app.start && !app.pickFor); });
  $effect(() => { document.documentElement.toggleAttribute("data-home", (app.tab === "now" || app.tab === "alerts") && !app.stack.length); });
  // Favourites only: at start (once the lines are loaded) and when it or the favourite bus lines change.
  $effect(() => {
    void app.favOnly; void app.favorites.join("|"); void app.lines;
    untrack(() => app.applyFavOnly());
  });
  // Riding a bus: checked on each new position, with its card open or not.
  $effect(() => {
    void app.ride; void app.rideAhead;
    untrack(() => app.checkRide());
  });
    if (import.meta.env.DEV) Object.assign(window, { __app: app });
</script>

<MapView {app} />
<Panel {app} />
<StopCard {app} />
<VehicleCard {app} />
<LineCard {app} />
<MuniLineCard {app} />
<MuniStopCard {app} />
<RailStopCard {app} />
<FavsPanel {app} />
<NearbyPanel {app} />
<NowPanel {app} />
<AlertsPanel {app} />
<TabBar {app} />
<RideBar {app} />
<StartScreen {app} />
<NavGuide {app} />
<PinSheet {app} />
<FaresSheet {app} />
{#if app.muniTimes.length}<MuniReport {app} />{/if}
