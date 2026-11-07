<script lang="ts">
  // «Ειδοποιήσεις» (the mockup's page): what is being watched now (a stop alert, a rail alert, the bus being ridden) in
  // the style of the notification it sends; «Κάθε μέρα», the trips the user takes on given days; which notices to get
  // about their lines; the notices in force today. On a phone a page above the tab bar; on a desktop a card.
  import { dateRange, forLine, isActive, shortTitle, type Disruption } from "../disruptions";
  import { busVehicleCard } from "../legacy";
  import { titleCase } from "../nearby";
  import { DAY_LETTERS, DAY_NAMES, hourText, partOfDay, WHEN, type NotifyPrefs, type Routine } from "../routines";
  import { stopIndex } from "../stops";
  import { walkTo } from "../now";
  import { dropRoutine, syncRoutine } from "../routinePush";
  import { clockHM } from "../trains";
  import type { AppState } from "../state.svelte";
  import Dropdown from "./Dropdown.svelte";
  import Icon from "./Icon.svelte";
  import { rise } from "../anim";

  let { app }: { app: AppState } = $props();

  const MORE = 4;
  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  const shown = $derived(app.tab === "alerts" && !app.stack.length && !app.favsOpen && !app.nearShown);
  $effect(() => { if (shown) void app.loadStops(); });

  const favIds = $derived(app.favs.lines.map(l => l.id));
  const active = $derived(app.disruptions.filter(d => isActive(d, app.serverNow)));
  const mine = $derived(active.filter(d => favIds.some(id => forLine([d], id, app.serverNow).length)));
  let all = $state(false);

  function badge(line: string) {
    const c = app.lineColor(native(line));
    return { label: native(line), bg: c.bg, fg: c.fg };
  }

  // ---- «Κάθε μέρα»
  const HOURS = Array.from({ length: 19 }, (_, k) => ({ value: k + 5, label: `Από ${hourText(k + 5)}` }));
  const put = (id: string, patch: Partial<Routine>) => app.setRoutines(app.routines.map(x => (x.id === id ? { ...x, ...patch } : x)));
  // A change the bot must know (on, days, hour, when): its recurring alert is made again, so it reminds with the page
  // closed too; until the bot answers (or without push) it reminds while the page is open.
  let syncing = $state<Record<string, boolean>>({});
  async function sync(r: Routine) {
    syncing = { ...syncing, [r.id]: true };
    const walk = (app.myPos && walkTo(app.myPos, r.stop)) ?? 5;
    const id = await syncRoutine(app.stopIx ?? (await app.loadStops()), r, walk);
    syncing = { ...syncing, [r.id]: false };
    if (app.routines.some(x => x.id === r.id)) put(r.id, { push: id });
  }
  const setR = (r: Routine, patch: Partial<Routine>) => {
    const next = { ...r, ...patch, push: undefined };
    put(r.id, next);
    void sync({ ...next, push: r.push });
  };
  const dropR = (r: Routine) => { dropRoutine(r); app.setRoutines(app.routines.filter(x => x.id !== r.id)); };

  // A new one: a stop (the favourites, then the nearest) and a line that stops there (from the stop index).
  let adding = $state(false);
  type Pick = { id: string; name: string; lat: number; lon: number };
  const stopChoices = $derived.by<Pick[]>(() => {
    const out: Pick[] = app.favs.stops.map(s => ({ id: s.id, name: titleCase(s.name), lat: s.lat, lon: s.lon }));
    const ix = app.stopIx;
    for (const g of app.nearGroups.slice(0, 3)) {
      const s = ix?.s[g.idx[0]];
      if (s?.[3] && !out.some(o => o.id === `oasa:${s[3]}`)) out.push({ id: `oasa:${s[3]}`, name: titleCase(s[0]), lat: s[1], lon: s[2] });
    }
    return out;
  });
  let newStop = $state("");
  let newLine = $state("");
  $effect(() => { if (adding && !stopChoices.some(s => s.id === newStop)) newStop = stopChoices[0]?.id ?? ""; });
  const linesAt = $derived.by(() => {
    const ix = app.stopIx;
    const k = ix && newStop ? stopIndex(ix, native(newStop)) : -1;
    if (!ix || k < 0) return [];
    return Object.entries(ix.l).filter(([, vs]) => Object.values(vs).some(list => list.includes(k))).map(([l]) => l)
      .sort((a, b) => a.localeCompare(b, "el", { numeric: true }));
  });
  $effect(() => { if (!linesAt.includes(newLine)) newLine = linesAt.find(l => favIds.includes(`oasa:${l}`)) ?? linesAt[0] ?? ""; });
  function save() {
    const s = stopChoices.find(x => x.id === newStop);
    if (!s || !newLine) return;
    const hour = new Date(app.serverNow).getHours();
    const r: Routine = { id: Math.random().toString(36).slice(2, 10), label: partOfDay(hour), on: true, stop: s,
      line: `oasa:${newLine}`, days: [true, true, true, true, true, false, false], hour, when: "leave" };
    app.setRoutines([...app.routines, r]);
    adding = false;
    void sync(r);
  }

  // ---- «Για τις γραμμές σου»
  const PREFS: { k: keyof NotifyPrefs; label: string }[] = [
    { k: "strikes", label: "Απεργίες και στάσεις εργασίας" },
    { k: "changes", label: "Αλλαγές διαδρομής, έργα" },
    { k: "delay", label: "Καθυστέρηση πάνω από 10′" },
  ];

  // The phone's permission, read again when the page shows (it can change in the browser's settings).
  let perm = $state<NotificationPermission | "none">("none");
  $effect(() => { if (shown) perm = typeof Notification === "undefined" ? "none" : Notification.permission; });
  async function allow() {
    if (typeof Notification === "undefined") return;
    perm = await Notification.requestPermission();
    if (perm === "granted") app.notify("Οι ειδοποιήσεις είναι ενεργές");
  }
  const nowHM = $derived(clockHM(app.serverNow / 1000));
</script>

{#snippet chip(b: { label: string; bg: string; fg: string }, lg = false)}
  <span class="badge" class:lg style:--lb={b.bg} style:--lf={b.fg}>{b.label}</span>
{/snippet}

{#snippet sw(on: boolean, label: string, flip: () => void)}
  <button type="button" class="sw" class:on role="switch" aria-checked={on} aria-label={label} onclick={flip}><i></i></button>
{/snippet}

{#snippet note(icon: "bus" | "metro" | "vibrate", head: string, title: string, text: string, act: () => void, actLabel: string)}
  <div class="fire">
    <span class="app" aria-hidden="true"><Icon name={icon} size={20} /></span>
    <div class="ftx">
      <div class="fmeta"><span>{head}</span><span>{nowHM}</span></div>
      <b>{title}</b>
      <span>{text}</span>
    </div>
    <button type="button" class="fstop" onclick={act}>{actLabel}</button>
  </div>
{/snippet}

{#snippet notice(d: Disruption)}
  <li>
    <a class="nrow" href={d.url} target="_blank" rel="noopener">
      <span class="nic" class:bad={d.urgent} aria-hidden="true"><Icon name="warn" size={16} /></span>
      <span class="ntx"><b>{shortTitle(d)}</b>{#if d.title !== shortTitle(d)}<small>{d.title}</small>{/if}</span>
      <span class="nside">
        {#if dateRange(d)}<small>{dateRange(d)}</small>{/if}
        {#if d.lines.length}<span class="chips">{#each d.lines.slice(0, 3) as l (l)}{@render chip(badge(l))}{/each}</span>{/if}
      </span>
    </a>
  </li>
{/snippet}

{#if shown}
  <section class="alerts" aria-labelledby="alerts-h" in:rise>
    <div class="ahead">
      <button type="button" class="aback" aria-label="Πίσω στην αρχική" title="Πίσω" onclick={() => app.setTab("now")}><Icon name="back" size={18} /></button>
      <h1 id="alerts-h">Ειδοποιήσεις</h1>
    </div>

    <!-- What is being watched now, as the notification it sends -->
    {#if app.alert}
      {@const a = app.alert}
      {@render note("bus", `Στάσεις · ${a.lines.map(l => native(l.line)).join(", ")}`, `Άφιξη στη στάση ${titleCase(a.label)}`,
        `${a.n === 1 ? "Όταν είναι στην προηγούμενη στάση" : `Όταν είναι ${a.n} στάσεις πριν`}, έως τις ${clockHM(a.until)}${a.push ? ", και με την εφαρμογή κλειστή" : ""}.`,
        () => app.setAlert(null), "Σταμάτα")}
    {/if}
    {#if app.railAlert}
      {@const a = app.railAlert}
      {@render note("metro", `Στάσεις · ${a.label}`, `${a.name} → ${a.toward}`, `${a.min}′ πριν φτάσει, έως τις ${clockHM(a.until)}.`,
        () => app.setRailAlert(null), "Σταμάτα")}
    {/if}
    {#if app.ride}
      {@const r = app.ride}
      {@render note("vibrate", `Στάσεις · ${native(r.line)}`, r.stop ? `Κατεβαίνεις: ${r.stop.name}` : "Είσαι μέσα στο λεωφορείο",
        app.rideBuzz ? "Δόνηση μία στάση πριν κατέβεις." : "Χωρίς δόνηση.", () => app.push(busVehicleCard(r.line, r.vehicle)), "Άνοιξε")}
    {/if}
    {#if !app.alert && !app.railAlert && !app.ride}
      <div class="fire quiet">
        <span class="app" aria-hidden="true"><Icon name="bell" size={20} /></span>
        <div class="ftx">
          <b>Τίποτα δεν παρακολουθείς τώρα</b>
          <span>Πάτα το καμπανάκι σε μια στάση ή σε ένα λεωφορείο, ή φτιάξε μια διαδρομή «Κάθε μέρα».</span>
        </div>
      </div>
    {/if}

    <!-- The daily trips -->
    <div class="sec">
      <div class="head">
        <h2>Κάθε μέρα</h2>
        <button type="button" class="new" aria-expanded={adding} onclick={() => (adding = !adding)}><Icon name={adding ? "close" : "plus"} size={14} /><span>{adding ? "Άκυρο" : "Νέα"}</span></button>
      </div>
      {#if adding}
        <div class="card">
          {#if stopChoices.length}
            <Dropdown variant="field" prefix="Στάση" label="Στάση" value={newStop} options={stopChoices.map(s => ({ value: s.id, label: s.name }))} onpick={v => (newStop = v)} />
            {#if linesAt.length}
              <Dropdown variant="field" prefix="Γραμμή" label="Γραμμή" value={newLine} options={linesAt.map(l => ({ value: l, label: l }))} onpick={v => (newLine = v)} />
              <button type="button" class="primary" onclick={save}>Προσθήκη</button>
            {:else}
              <p class="muted">{app.stopIx ? "Καμία γραμμή λεωφορείου σε αυτή τη στάση." : "Φόρτωση στάσεων…"}</p>
            {/if}
          {:else}
            <p class="muted">Βάλε <Icon name="star" size={13} label="αστέρι" /> σε μια στάση ή δείξε πού είσαι, για να τη διαλέξεις εδώ.</p>
          {/if}
        </div>
      {/if}
      {#each app.routines as r (r.id)}
        <div class="card">
          <div class="rtop">
            {@render chip(badge(r.line), true)}
            <div class="rtx"><b>{r.label}</b><small>{r.stop.name}</small></div>
            {@render sw(r.on, `${r.label}: ${r.on ? "ενεργή" : "ανενεργή"}`, () => setR(r, { on: !r.on }))}
          </div>
          <div class="days" role="group" aria-label="Μέρες">
            {#each DAY_LETTERS as d, k (k)}
              <button type="button" class="day" aria-pressed={r.days[k]} aria-label={DAY_NAMES[k]}
                onclick={() => setR(r, { days: r.days.map((x, j) => (j === k ? !x : x)) })}>{d}</button>
            {/each}
          </div>
          <Dropdown variant="field" prefix="Πότε" label="Πότε" value={r.when} options={WHEN} onpick={v => setR(r, { when: v })} />
          <p class="rstate" class:on={!!r.push}>{syncing[r.id] ? "Σύνδεση…" : r.push ? "Ειδοποίηση και με την εφαρμογή κλειστή" : r.on && r.when !== "change" ? "Ειδοποιεί όσο είναι ανοιχτή η εφαρμογή" : r.on ? "Σου το λέει το «Τώρα», όσο είναι ανοιχτή η εφαρμογή" : "Ανενεργή"}</p>
          <div class="rfoot">
            <Dropdown value={r.hour} options={HOURS} label="Από τι ώρα" onpick={v => setR(r, { hour: v, label: partOfDay(v) })} />
            <button type="button" class="del" onclick={() => dropR(r)}>Διαγραφή</button>
          </div>
        </div>
      {:else}
        {#if !adding}<p class="muted">Η διαδρομή που κάνεις κάθε μέρα: όταν ανοίγεις την εφαρμογή εκείνη την ώρα, το «Τώρα» ξεκινά από αυτή και σε ειδοποιεί.</p>{/if}
      {/each}
    </div>

    <!-- About your lines -->
    <div class="sec">
      <h2>Για τις γραμμές σου</h2>
      <div class="card list">
        {#each PREFS as p (p.k)}
          <div class="trow"><span>{p.label}</span>{@render sw(app.notifyPrefs[p.k], p.label, () => app.setNotifyPref(p.k, !app.notifyPrefs[p.k]))}</div>
        {/each}
        <div class="trow">
          <span class="ttx">Ειδοποιήσεις συσκευής<small>{perm === "granted" ? "Ενεργές" : perm === "denied" ? "Κλειστές από τον browser" : perm === "none" ? "Δεν υποστηρίζονται εδώ" : "Και με την εφαρμογή κλειστή"}</small></span>
          {#if perm === "default"}<button type="button" class="allow" onclick={allow}>Άνοιξέ τες</button>
          {:else if perm === "granted"}<span class="ok" aria-hidden="true"><Icon name="check" size={16} /></span>{/if}
        </div>
      </div>
      {#if app.notifyPrefs.changes && mine.length}
        <ul class="notes">
          {#each mine as d (d.id)}{@render notice(d)}{/each}
        </ul>
      {/if}
    </div>

    {#if active.length}
      <div class="sec">
        <div class="head"><h2>Ανακοινώσεις σήμερα</h2><span class="count">{active.length}</span></div>
        <ul class="notes">{#each all ? active : active.slice(0, MORE) as d (d.id)}{@render notice(d)}{/each}</ul>
        {#if active.length > MORE}
          <button type="button" class="new more" aria-expanded={all} onclick={() => (all = !all)}>
            <span>{all ? "Λιγότερες" : `Άλλες ${active.length - MORE}`}</span><Icon name={all ? "chevron-up" : "down"} size={14} />
          </button>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .alerts { position: absolute; z-index: 6; left: 16px; bottom: 100px; width: 380px; max-height: calc(100dvh - 124px - env(safe-area-inset-top));
    overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 16px; padding: 20px 16px; box-sizing: border-box;
    border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  h1 { margin: 0; font-size: 26px; font-weight: 800; line-height: 1; letter-spacing: -.01em; }
  .ahead { display: flex; align-items: center; gap: 12px; }
  .aback { display: none; flex: none; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; align-items: center; justify-content: center;
    background: var(--control); color: var(--fg); cursor: pointer; }
  h2 { margin: 0; font-size: 15px; font-weight: 700; line-height: 1; }
  .muted { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
  .sec { display: flex; flex-direction: column; gap: 10px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; }

  /* What fires: the notification's own look */
  .fire { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border-radius: 22px;
    background: color-mix(in srgb, var(--accent) 9%, var(--card)); border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--card-border)); }
  .fire.quiet { align-items: center; background: var(--card); border-color: var(--card-border); }
  .app { flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 12px; background: var(--accent); color: var(--on-accent); }
  .fire.quiet .app { background: var(--control); color: var(--muted); }
  .ftx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .fmeta { display: flex; justify-content: space-between; font-size: 12px; line-height: 1; color: color-mix(in srgb, var(--accent) 55%, var(--muted)); }
  .ftx b { font-size: 15px; font-weight: 700; line-height: 1.2; }
  .ftx > span:last-child { font-size: 13px; line-height: 1.3; color: var(--muted); }
  .fstop { flex: none; align-self: center; height: 32px; display: flex; align-items: center; justify-content: center; padding: 0 12px; border: 0;
    border-radius: 16px; background: var(--control); color: var(--fg); font: inherit; font-size: 12px; font-weight: 700; line-height: 1; cursor: pointer; }

  .new { height: 30px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border: 0; border-radius: 15px;
    background: var(--card); color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; }
  .new.more { align-self: flex-start; color: var(--fg); }
  .count { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; padding: 0 8px; border-radius: 12px;
    background: var(--control); color: var(--muted); font-size: 12px; font-weight: 700; line-height: 1; }

  .card { display: flex; flex-direction: column; gap: 14px; padding: 14px; border-radius: 20px; background: var(--card); border: 1px solid var(--card-border); }
  .rtop { display: flex; align-items: center; gap: 10px; }
  .rtx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .rtx b { font-size: 14px; font-weight: 700; line-height: 1; }
  .rtx small { font-size: 12px; line-height: 1.1; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .days { display: flex; gap: 6px; }
  .day { flex: 1; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--border); border-radius: 18px;
    background: transparent; color: var(--muted); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .day[aria-pressed="true"] { background: var(--accent-bg); border-color: color-mix(in srgb, var(--accent) 45%, transparent); color: var(--accent); }
  .rstate { margin: -4px 0 0; display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 1.2; color: var(--muted); }
  .rstate::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--none); }
  .rstate.on::before { background: var(--ontime); }
  .rfoot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .del { height: 34px; display: flex; align-items: center; justify-content: center; padding: 0 12px; border: 0; border-radius: 17px; background: none;
    color: var(--late3); font: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; }
  .primary { height: 44px; display: flex; align-items: center; justify-content: center; padding: 0 16px; border: 0; border-radius: 22px;
    background: var(--accent); color: var(--on-accent); font: inherit; font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; }

  .card.list { gap: 0; padding: 0; }
  .trow { min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 14px; font-size: 14px; line-height: 1.2; }
  .trow + .trow { border-top: 1px solid var(--card-border); }
  .trow > span:first-child { flex: 1; min-width: 0; }
  .ttx { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; }
  .ttx small { font-size: 12px; color: var(--muted); }
  .allow { flex: none; height: 32px; display: flex; align-items: center; justify-content: center; padding: 0 12px; border: 0; border-radius: 16px;
    background: var(--accent-bg); color: var(--accent); font: inherit; font-size: 12px; font-weight: 700; line-height: 1; cursor: pointer; }
  .ok { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
    background: color-mix(in srgb, var(--ontime) 18%, transparent); color: var(--ontime); }

  /* The custom switch */
  .sw { flex: none; position: relative; width: 46px; height: 28px; padding: 0; border: 0; border-radius: 14px; background: var(--border); cursor: pointer; transition: background .15s; }
  .sw i { position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .sw.on { background: var(--accent); }
  .sw.on i { transform: translateX(18px); }

  .badge { display: inline-flex; align-items: center; justify-content: center; flex: none; height: 22px; min-width: 22px; padding: 0 7px; border-radius: 11px;
    background: var(--lb); color: var(--lf); font-size: 11px; font-weight: 800; line-height: 1; }
  .badge.lg { height: 28px; padding: 0 10px; border-radius: 14px; font-size: 13px; }

  .notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .nrow { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 18px; background: var(--card); border: 1px solid var(--card-border);
    color: inherit; text-decoration: none; }
  .nic { flex: none; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--warn-bg); color: var(--warn-fg); }
  .nic.bad { background: var(--bad-bg); color: var(--late3); }
  .ntx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .ntx b { font-size: 14px; font-weight: 700; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ntx small { font-size: 12px; line-height: 1.3; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .nside { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; max-width: 96px; }
  .nside small { font-size: 12px; font-weight: 600; line-height: 1; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }

  button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* A phone: the page itself, the whole screen (no map behind it, so no glass: a solid page), its end clear of the
     floating tab bar. */
  @media (max-width: 719px) {
    .alerts { left: 0; right: 0; top: 0; width: auto; bottom: 0; max-height: none; background: var(--surface);
      -webkit-backdrop-filter: none; backdrop-filter: none; text-shadow: none;
      padding: calc(20px + env(safe-area-inset-top)) 16px calc(max(12px, env(safe-area-inset-bottom)) + 20px); border-radius: 0; box-shadow: none; }
    .aback { display: flex; }
  }
  .sw i { transition: transform .25s cubic-bezier(.34, 1.56, .64, 1); }
  .day, .new, .fstop, .allow, .primary { transition: background-color .15s, color .15s, border-color .15s, transform .12s; }
  .day:active, .new:active, .fstop:active, .allow:active, .primary:active { transform: scale(.96); }
  .fire { animation: fireIn .4s cubic-bezier(.2, .8, .2, 1) both; }
  @keyframes fireIn { from { transform: translateY(-8px) scale(.98); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .sw i, .day, .new, .fstop, .allow, .primary { transition: none; } .fire { animation: none; } }
</style>
