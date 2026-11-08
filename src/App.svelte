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
  import LeaveReminder from "./lib/ui/LeaveReminder.svelte";
  import AlertsPanel from "./lib/ui/AlertsPanel.svelte";
  import RideBar from "./lib/ui/RideBar.svelte";
  import StartScreen from "./lib/ui/StartScreen.svelte";
  import NavGuide from "./lib/ui/NavGuide.svelte";
  import PinSheet from "./lib/ui/PinSheet.svelte";
  import FaresSheet from "./lib/ui/FaresSheet.svelte";
  import MuniReport from "./lib/ui/MuniReport.svelte";
  import AdminBar from "./lib/ui/AdminBar.svelte";
  import { applyTheme } from "./lib/theme";

  const app = new AppState();
  app.init();
  $effect(() => applyTheme(app.theme));
  // «Τώρα» and «Ειδοποιήσεις» with no card: the phone hides the map's own buttons (app.css), as the mockup has none.
  $effect(() => { document.documentElement.toggleAttribute("data-pick", !!app.start && !!app.pickFor); });
  $effect(() => { document.documentElement.toggleAttribute("data-start", !!app.start && !app.pickFor); });
  // A card or a list in the left column (a computer: the bar above it steps aside, Panel.svelte).
  $effect(() => { document.documentElement.toggleAttribute("data-col", app.stack.length > 0 || app.favsOpen || app.nearShown); });
  $effect(() => { document.documentElement.dataset.tab = app.tab; });
  $effect(() => { document.documentElement.toggleAttribute("data-home", (app.tab === "now" || app.tab === "alerts") && !app.stack.length); });
  // iOS leaves the page scrolled up after the keyboard closes (the screen is one fixed page): the top banner goes under
  // the clock and a gap opens at the foot. Back to the top whenever no field has the keyboard.
  $effect(() => {
    const typing = () => { const a = document.activeElement; return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"); };
    const back = () => { if (!typing() && (scrollY || document.documentElement.scrollTop)) scrollTo(0, 0); };
    const later = () => setTimeout(back, 120);
    addEventListener("scroll", back, { passive: true });
    addEventListener("focusout", later);
    visualViewport?.addEventListener("resize", later);
    return () => { removeEventListener("scroll", back); removeEventListener("focusout", later); visualViewport?.removeEventListener("resize", later); };
  });
  $effect(() => { void app.start; void app.guide; setTimeout(() => { if (scrollY) scrollTo(0, 0); }, 150); });
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
<RideBar {app} />
<StartScreen {app} />
<NavGuide {app} />
<LeaveReminder {app} />
<PinSheet {app} />
<FaresSheet {app} />
{#if app.muniTimes.length}<MuniReport {app} />{/if}
<AdminBar {app} />
