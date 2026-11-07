<script lang="ts">
  // «Θύμισέ μου πότε να φύγω» (mockup 40, A1): for the route picked, the app watches its first bus live and says when
  // to leave: the bus's time at its stop, less the walk there, less the minutes the user wants to get ready. Set
  // here; LeaveReminder follows it while the page is open.
  import { guideFromPlan, type GuideRide } from "../guide";
  import { isLiveMode } from "../liveRide";
  import type { Itinerary, PlanResponse } from "../plan";
  import type { AppState } from "../state.svelte";
  import type { Place, TripIndex } from "../trip";
  import { titleCase } from "../nearby";
  import { clockHM } from "../trains";
  import Sheet from "./Sheet.svelte";

  let { app, it, r, ix, to, onclose }: { app: AppState; it: Itinerary; r: PlanResponse; ix: TripIndex | null; to: Place; onclose: () => void } = $props();

  const key = $derived(`${it.depart_at}-${it.arrive_at}`);
  const rideLeg = $derived(it.legs.find(l => l.kind === "ride") ?? null);
  const mode = $derived(rideLeg ? rideLeg.mode ?? r.lines[rideLeg.line ?? ""]?.mode ?? "bus" : "");
  const label = $derived(rideLeg ? r.lines[rideLeg.line ?? ""]?.label || (rideLeg.line ?? "").slice((rideLeg.line ?? "").indexOf(":") + 1) : "");
  const guide = $derived(guideFromPlan(it, r, ix, titleCase(to.label)));
  const first = $derived((guide.legs.find(l => l.kind === "ride") as GuideRide | undefined) ?? null);
  const walkS = $derived(rideLeg ? rideLeg.depart_at - it.depart_at : 0);
  const walkMin = $derived(Math.max(0, Math.round(walkS / 60)));
  const armed = $derived(app.leaveRemind?.key === key ? app.leaveRemind : null);
  const firstPrep = () => (app.leaveRemind?.key === `${it.depart_at}-${it.arrive_at}` ? app.leaveRemind.prepMin : 2);
  let prep = $state(firstPrep());
  const leaveAt = $derived(armed && armed.prepMin === prep ? armed.leaveAt : (rideLeg?.depart_at ?? it.depart_at) - walkS - prep * 60);
  const live = $derived(isLiveMode(mode));
  const what = $derived(mode === "metro" ? "το μετρό" : mode === "tram" ? "το τραμ" : mode === "trolley" ? "το τρόλεϊ" : "το λεωφορείο");

  function arm() {
    if (!rideLeg) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
    const at = (rideLeg.depart_at) - walkS - prep * 60;
    app.leaveRemind = { key, to: titleCase(to.label), line: label, mode, board: first?.board.name ?? "", ride: live ? first : null, plannedAt: rideLeg.depart_at,
      walkS, prepMin: prep, leaveAt: at, said: at, away: null, live: false, next: null, fired: false, guide };
    app.notify(`Θα σου πω πότε να φύγεις για ${titleCase(to.label)}.`);
    onclose();
  }
  function cancel() { app.leaveRemind = null; onclose(); }
</script>

<Sheet title="Θα σου πω πότε να φύγεις" {onclose}>
  {#if rideLeg}
    <p class="sp">Τώρα βγαίνει γύρω στις <b class="when">{clockHM(Math.max(leaveAt, app.serverNow / 1000))}</b>.</p>
    <p class="sp">{#if live}Κοιτάζω {what} {label} ζωντανά και πόσο περπατάς ως τη στάση {first?.board.name ?? ""} ({walkMin} {walkMin === 1 ? "λεπτό" : "λεπτά"}). Αν αργήσει, θα σου πω αργότερα.
      {:else}Το {label} δεν έχει ζωντανή θέση: μετράω με το πρόγραμμα και πόσο περπατάς ως τον σταθμό ({walkMin} {walkMin === 1 ? "λεπτό" : "λεπτά"}).{/if}</p>
    <p class="sq">Πόση ώρα θες για να ετοιμαστείς;</p>
    <div class="seg" role="radiogroup" aria-label="Πόση ώρα θες για να ετοιμαστείς">
      {#each [0, 2, 5] as m (m)}<button type="button" role="radio" aria-checked={prep === m} class:on={prep === m} onclick={() => (prep = m)}>{m === 0 ? "Καθόλου" : `${m} λεπτά`}</button>{/each}
    </div>
    <p class="sp small">Η ειδοποίηση έρχεται όσο η σελίδα είναι ανοιχτή{typeof Notification !== "undefined" ? ", και στην οθόνη κλειδώματος αν το επιτρέψεις" : ""}.</p>
    <div class="sacts">
      {#if armed}
        <button type="button" class="sback" onclick={cancel}>Μην μου πεις</button>
        <button type="button" class="sdone" onclick={arm}>{armed.prepMin === prep ? "Εντάξει" : "Αποθήκευση"}</button>
      {:else}
        <button type="button" class="sback" onclick={onclose}>Άκυρο</button>
        <button type="button" class="sdone" onclick={arm}>Θύμισέ μου</button>
      {/if}
    </div>
  {:else}
    <p class="sp">Αυτή η διαδρομή είναι μόνο με τα πόδια: δεν έχει λεωφορείο να περιμένεις.</p>
    <div class="sacts"><button type="button" class="sback" onclick={onclose}>Εντάξει</button></div>
  {/if}
</Sheet>

<style>
  .when { color: var(--fg); font-size: 17px; }
  .small { font-size: 13px; }
</style>
