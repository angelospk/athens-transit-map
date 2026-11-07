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
  // «Άλλο»: the user's own minutes, a step of one (1 to 60).
  let own = $state(![0, 2, 5].includes(firstPrep()));
  const setOwn = (m: number) => { prep = Math.max(1, Math.min(60, m)); };
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
      {#each [0, 2, 5] as m (m)}<button type="button" role="radio" aria-checked={!own && prep === m} class:on={!own && prep === m} onclick={() => { own = false; prep = m; }}>{m === 0 ? "Καθόλου" : `${m} λεπτά`}</button>{/each}
      <button type="button" role="radio" aria-checked={own} class:on={own} onclick={() => { own = true; if ([0, 2, 5].includes(prep)) prep = 10; }}>Άλλο</button>
    </div>
    {#if own}
      <div class="step" role="group" aria-label="Δικά σου λεπτά">
        <button type="button" class="sb" aria-label="Λιγότερα" disabled={prep <= 1} onclick={() => setOwn(prep - (prep > 10 ? 5 : 1))}>−</button>
        <span class="sv"><b>{prep}</b> λεπτά</span>
        <button type="button" class="sb" aria-label="Περισσότερα" disabled={prep >= 60} onclick={() => setOwn(prep + (prep >= 10 ? 5 : 1))}>+</button>
      </div>
    {/if}
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
  .step { margin-top: 10px; height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 6px; border-radius: 14px;
    background: color-mix(in srgb, var(--fg) 7%, var(--surface)); }
  .sb { width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--fg) 12%, var(--surface)); color: var(--fg); font: inherit; font-size: 24px; font-weight: 500; line-height: 1; cursor: pointer; }
  .sb:disabled { opacity: .35; cursor: default; }
  .sv { font-size: 16px; color: var(--muted); line-height: 1; }
  .sv b { font-size: 20px; color: var(--fg); font-weight: 700; }
</style>
