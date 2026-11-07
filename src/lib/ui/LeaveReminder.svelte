<script lang="ts">
  // «Θύμισέ μου» followed (mockup 40, A2): every 20 s the trip's first bus, live (liveRide.ts); when to leave moves
  // with it. A bus late by 2′ or more says so ("θα σου πω αργότερα"); at leave time «Φύγε τώρα», with where the bus is
  // and the walk: a vibration, a system notification where allowed, and a card with «Ξεκίνα» (the navigator) and
  // «Το επόμενο» (the same for the bus after it). While set, a small pill says when (× takes it off).
  import { untrack } from "svelte";
  import { busNow } from "../liveRide";
  import type { AppState } from "../state.svelte";
  import { clockHM } from "../trains";
  import Icon from "./Icon.svelte";
  import { rise } from "../anim";

  let { app }: { app: AppState } = $props();

  const rm = $derived(app.leaveRemind);
  const runKey = $derived(rm && !rm.fired ? `${rm.key}|${rm.plannedAt}|${rm.prepMin}` : "");

  function tell(title: string, body: string) {
    app.notify(`${title}: ${body}`);
    navigator.vibrate?.([200, 120, 200]);
    try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body, tag: "leave" }); } catch { /* iOS without a home-screen app */ }
  }
  const awayWords = (a: number | null) => a === 0 ? "στη στάση" : a === 1 ? "1 στάση μακριά" : a != null ? `${a} στάσεις μακριά` : "στον δρόμο";
  const mins = (s: number) => { const m = Math.max(0, Math.round(s / 60)); return `${m} ${m === 1 ? "λεπτό" : "λεπτά"}`; };

  function fire() {
    const r = untrack(() => app.leaveRemind);
    if (!r || r.fired) return;
    const bus = r.live ? `Το ${r.line} είναι ${awayWords(r.away)}. ` : `Το ${r.line} φεύγει ${clockHM(r.plannedAt)}. `;
    tell(`Φύγε τώρα για ${r.to}`, `${bus}Θέλεις ${mins(r.walkS)} ως ${r.mode === "metro" || r.mode === "tram" ? "τον σταθμό" : "τη στάση"} ${r.board}.`);
    app.leaveRemind = { ...r, fired: true };
  }

  $effect(() => {
    if (!runKey) return;
    let dead = false;
    const tick = async () => {
      const r = untrack(() => app.leaveRemind);
      if (!r || r.fired) return;
      const now = untrack(() => app.serverNow) / 1000;
      const b = r.ride ? await busNow(r.ride, r.plannedAt, now).catch(() => null) : null;
      if (dead) return;
      const cur = untrack(() => app.leaveRemind);
      if (!cur || cur.key !== r.key || cur.fired) return;
      const at = b ? b.at : cur.plannedAt;
      const leaveAt = at - cur.walkS - cur.prepMin * 60;
      let said = cur.said;
      if (leaveAt - said >= 120 && leaveAt - now > 60) {
        tell(`Το ${cur.line} αργεί λίγο`, `Μην βιαστείς: θα σου πω να φύγεις γύρω στις ${clockHM(leaveAt)} αντί για ${clockHM(said)}.`);
        said = leaveAt;
      } else if (said - leaveAt >= 120) said = leaveAt;   // earlier: no notice, the pill shows it (and the leave notice comes on time)
      app.leaveRemind = { ...cur, leaveAt, said, away: b?.away ?? null, live: !!b?.live, next: b?.next ?? cur.next };
    };
    void tick();
    const poll = setInterval(() => void tick(), 20_000);
    // Between the polls: on time to the second.
    const due = setInterval(() => {
      const r = untrack(() => app.leaveRemind);
      if (r && !r.fired && untrack(() => app.serverNow) / 1000 >= r.leaveAt - 10) fire();
    }, 5_000);
    return () => { dead = true; clearInterval(poll); clearInterval(due); };
  });

  function startTrip() {
    const r = app.leaveRemind;
    if (!r) return;
    app.leaveRemind = null;
    app.startGuide(r.guide);
  }
  function nextBus() {
    const r = app.leaveRemind;
    if (!r) return;
    if (!r.next) { app.notify("Δεν βρήκα επόμενο δρομολόγιο σε αυτή τη στάση."); app.leaveRemind = null; return; }
    const at = r.next - r.walkS - r.prepMin * 60;
    app.leaveRemind = { ...r, plannedAt: r.next, next: null, leaveAt: at, said: at, fired: false, away: null };
    app.notify(`Εντάξει: θα σου πω για το επόμενο ${r.line}, γύρω στις ${clockHM(at)}.`);
  }
</script>

{#if rm?.fired}
  <div class="due" role="alertdialog" aria-labelledby="due-h" transition:rise={{ y: -20 }}>
    <div class="dh">
      <span class="dic" aria-hidden="true"><Icon name="bell" size={18} /></span>
      <b id="due-h">Φύγε τώρα για {rm.to}</b>
      <button type="button" class="x" aria-label="Κλείσιμο" onclick={() => (app.leaveRemind = null)}><Icon name="close" size={14} /></button>
    </div>
    <p>{rm.live ? `Το ${rm.line} είναι ${awayWords(rm.away)}.` : `Το ${rm.line} φεύγει ${clockHM(rm.plannedAt)}.`} Θέλεις {mins(rm.walkS)} ως {rm.mode === "metro" || rm.mode === "tram" ? "τον σταθμό" : "τη στάση"} {rm.board}.</p>
    <div class="da">
      {#if rm.ride}<button type="button" class="db" onclick={nextBus}>Το επόμενο</button>{/if}
      <button type="button" class="db go" onclick={startTrip}>Ξεκίνα</button>
    </div>
  </div>
{:else if rm && !app.start && !app.guide}
  <div class="pill" transition:rise={{ y: -12 }}>
    <span class="pic" aria-hidden="true"><Icon name="bell" size={15} /></span>
    <span class="pt">Φύγε γύρω στις <b>{clockHM(Math.max(rm.leaveAt, app.serverNow / 1000))}</b> · {rm.to}</span>
    <button type="button" class="x" aria-label="Μην μου πεις" title="Μην μου πεις" onclick={() => (app.leaveRemind = null)}><Icon name="close" size={13} /></button>
  </div>
{/if}

<style>
  .pill { position: fixed; z-index: 40; left: 50%; translate: -50% 0; top: calc(env(safe-area-inset-top) + 84px); max-width: calc(100vw - 32px); height: 44px;
    display: flex; align-items: center; gap: 10px; padding: 0 6px 0 8px; box-sizing: border-box; border-radius: 22px; background: var(--surface); color: var(--fg);
    border: 1px solid var(--border); box-shadow: 0 8px 22px rgba(0, 0, 0, .28); font-size: 14px; line-height: 1; white-space: nowrap; }
  .pic { flex: none; width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: var(--on-accent, #fff); display: flex; align-items: center; justify-content: center; }
  .pt { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
  .pt b { color: var(--fg); font-weight: 700; }
  .x { flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: color-mix(in srgb, var(--fg) 8%, transparent); color: var(--muted);
    display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .due { position: fixed; z-index: 90; left: 12px; right: 12px; top: calc(env(safe-area-inset-top) + 12px); max-width: 460px; margin: 0 auto; box-sizing: border-box;
    padding: 14px; border-radius: 22px; background: var(--surface); color: var(--fg); border: 1px solid var(--border); box-shadow: 0 14px 40px rgba(0, 0, 0, .4); }
  .dh { display: flex; align-items: center; gap: 10px; }
  .dic { flex: none; width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: var(--on-accent, #fff); display: flex; align-items: center; justify-content: center; }
  .dh b { flex: 1; font-size: 17px; font-weight: 700; line-height: 1.2; }
  p { margin: 8px 0 0; font-size: 15px; color: var(--muted); line-height: 1.4; }
  .da { display: flex; gap: 8px; margin-top: 12px; }
  .db { flex: 1; height: 48px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 14px; background: color-mix(in srgb, var(--fg) 9%, var(--surface));
    color: var(--fg); font: inherit; font-size: 16px; font-weight: 600; line-height: 1; cursor: pointer; }
  .db.go { background: var(--accent); color: var(--on-accent, #fff); font-weight: 700; }
</style>
