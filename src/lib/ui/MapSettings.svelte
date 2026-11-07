<script lang="ts">
  // The map's settings (the rail's eye button, Panel.svelte): what the map shows, how it looks, how the vehicles
  // behave. Grouped as a phone's settings are: a card per group, a row per setting (a coloured tile, a name, a line
  // on what it does, the control at the right), the themes and 3D looks as small pictures to pick.
  import type { AppState } from "../state.svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import { clock, duration } from "../format";
  import { LOOKS } from "../map/look3d";

  let { app, cityMissing, cityAge, oldest, onclose }:
    { app: AppState; cityMissing: boolean; cityAge: number | null; oldest: number | null; onclose: () => void } = $props();

  const municipalities = $derived(app.municipal ? new Set(app.municipal.routes.map(r => r.municipality)).size : 0);
  const trains = $derived(app.stasyTrains.length + app.suburbanTrains.length);
  let howOpen = $state(false);

  type Row = { id: string; icon: IconName; tint: string; title: string; sub: string; count?: string; on: boolean; disabled?: boolean; set: (v: boolean) => void };
  const showRows: Row[] = $derived([
    { id: "city", icon: "bus", tint: "#2563eb", title: "Λεωφορεία", sub: cityMissing ? "Όχι ακόμα διαθέσιμα" : "Όλα της πόλης, και τρόλεϊ. Όσες γραμμές διάλεξες μένουν πάντα.",
      count: app.city && !cityMissing ? `${app.city.vehicles.length}` : undefined, on: app.cityOn, disabled: cityMissing, set: (v: boolean) => app.setCityOn(v) },
    { id: "trains", icon: "metro", tint: "#16a34a", title: "Τρένα", sub: "Μετρό και τραμ από το πρόγραμμα, Προαστιακός με GPS.",
      count: app.trainsOn && trains ? `${trains}` : undefined, on: app.trainsOn, set: (v: boolean) => app.setTrainsOn(v) },
    ...(app.municipal ? [{ id: "muni", icon: "bus" as IconName, tint: "#7c3aed", title: "Δημοτικά", sub: `${municipalities} δήμοι, από το OpenStreetMap. Χωρίς ώρες.`,
      on: app.municipalOn, set: (v: boolean) => app.setMunicipalOn(v) }] : []),
    { id: "speed", icon: "route", tint: "#ea580c", title: "Ταχύτητα ανά δρόμο", sub: "Πόσο γρήγορα κινούνται τα λεωφορεία, από στάση σε στάση.",
      on: app.speedOn, set: (v: boolean) => app.setSpeedOn(v) },
  ]);
  const vehicleRows: Row[] = $derived([
    { id: "fresh", icon: "clock", tint: "#0891b2", title: "Μόνο με πρόσφατη θέση", sub: "Όσα έστειλαν θέση τα τελευταία 1½ λεπτά.",
      on: app.only.fresh, set: (v: boolean) => app.setOnly({ fresh: v }) },
    { id: "ontime", icon: "check", tint: "#16a34a", title: "Μόνο στην ώρα τους", sub: "Έως 5 λεπτά καθυστέρηση.",
      on: app.only.onTime, set: (v: boolean) => app.setOnly({ onTime: v }) },
    { id: "motion", icon: "walk", tint: "#db2777", title: "Κίνηση ανάμεσα στις θέσεις", sub: "Κλειστό: το όχημα μένει εκεί που έστειλε θέση.",
      on: app.motion, set: (v: boolean) => app.setMotion(v) },
  ]);
  const THEMES = [["system", "Συσκευής"], ["light", "Φωτεινό"], ["dark", "Σκοτεινό"]] as const;
  const OTHERS = [["normal", "Κανονικά"], ["dim", "Αχνά"], ["hide", "Κρυφά"]] as const;
  const AGES = [["never", "Ποτέ"], ["old", "Παλιές"], ["always", "Πάντα"]] as const;
</script>

{#snippet row(r: Row)}
  <div class="row" class:off={r.disabled}>
    <span class="tile" style:--t={r.tint} aria-hidden="true"><Icon name={r.icon} size={17} /></span>
    <span class="txt">
      <span class="name">{r.title}{#if r.count}<em>{r.count} τώρα</em>{/if}</span>
      <span class="sub">{r.sub}</span>
    </span>
    <button type="button" class="sw" role="switch" aria-checked={r.on} aria-label={r.title} disabled={r.disabled} onclick={() => r.set(!r.on)}><i></i></button>
  </div>
{/snippet}

<div class="set">
  <header>
    <h3>Ρυθμίσεις χάρτη</h3>
    <button type="button" class="x" aria-label="Κλείσιμο" onclick={onclose}><Icon name="close" size={16} /></button>
  </header>

  <h4>Στον χάρτη</h4>
  <div class="card">
    {#each showRows as r (r.id)}{@render row(r)}{/each}
  </div>

  <h4>Εμφάνιση</h4>
  <div class="card pad">
    <span class="label">Θέμα</span>
    <div class="picks" role="radiogroup" aria-label="Θέμα χάρτη">
      {#each THEMES as [v, label] (v)}
        <button type="button" class="pick" role="radio" aria-checked={app.theme === v} onclick={() => app.setTheme(v)}>
          <span class="prev theme-{v}" aria-hidden="true"><i class="road a"></i><i class="road b"></i><i class="dot"></i></span>
          <span class="plab">{#if app.theme === v}<Icon name="check" size={13} />{/if}{label}</span>
        </button>
      {/each}
    </div>
    <span class="label">3D <span class="beta">Beta</span></span>
    <div class="picks two" role="radiogroup" aria-label="Εμφάνιση 3D">
      {#each LOOKS as [v, label] (v)}
        <button type="button" class="pick" role="radio" aria-checked={app.look3d === v} onclick={() => { app.setLook3d(v); if (!app.threeD) app.setThreeD(true); }}>
          <span class="prev look-{v}" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i></span>
          <span class="plab">{#if app.look3d === v}<Icon name="check" size={13} />{/if}{label}</span>
        </button>
      {/each}
    </div>
    {#if app.threeD}
      <div class="row inset">
        <span class="tile" style:--t="#0a7cc4" aria-hidden="true"><Icon name="metro" size={17} /></span>
        <span class="txt"><span class="name">Υπόγεια</span><span class="sub">Το μετρό στα τούνελ του, κάτω από τον δρόμο.</span></span>
        <button type="button" class="sw" role="switch" aria-checked={app.under} aria-label="Υπόγεια" onclick={() => (app.under = !app.under)}><i></i></button>
      </div>
    {/if}
  </div>

  <h4>Λεωφορεία</h4>
  <div class="card">
    <div class="row col">
      <span class="name">Όταν πατάς ένα, τα άλλα</span>
      <div class="seg3" role="radiogroup" aria-label="Τα άλλα λεωφορεία όταν πατάς ένα">
        {#each OTHERS as [v, label] (v)}
          <button type="button" role="radio" aria-checked={app.others === v} onclick={() => app.setOthers(v)}>
            <i class="ghost {v}" aria-hidden="true"></i>{label}
          </button>
        {/each}
      </div>
    </div>
    {#each vehicleRows as r (r.id)}{@render row(r)}{/each}
    <div class="row col">
      <span class="name">Ηλικία θέσης <b class="age">24″</b></span>
      <span class="sub">Πριν πόσο έστειλε θέση. Μετρό και τραμ: από το πρόγραμμα, όχι GPS.</span>
      <div class="seg3" role="radiogroup" aria-label="Ηλικία θέσης">
        {#each AGES as [m, t] (m)}
          <button type="button" role="radio" aria-checked={app.ageMode === m} onclick={() => app.setAgeMode(m)}>{t}</button>
        {/each}
      </div>
    </div>
    <button type="button" class="row how" aria-expanded={howOpen} onclick={() => (howOpen = !howOpen)}>
      <span class="tile" style:--t="#64748b" aria-hidden="true"><Icon name="map" size={17} /></span>
      <span class="txt"><span class="name">Πώς κινούνται τα οχήματα</span></span>
      <span class="chev" class:open={howOpen} aria-hidden="true"><Icon name="chevron" size={16} /></span>
    </button>
    {#if howOpen}
      <p class="howtext">
        Ο ΟΑΣΑ στέλνει θέσεις κάθε 20–60″. Όταν η νέα θέση είναι πολύ μπροστά, το όχημα πηγαίνει γρήγορα ως εκεί, πάνω στον
        δρόμο, και αφήνει για λίγο μπλε ίχνος. Όταν είναι πίσω, γυρίζει αχνό με γκρι διακεκομμένο ίχνος: διόρθωση θέσης, όχι
        όπισθεν. Αχνό όχημα με πορτοκαλί ηλικία: δεν έστειλε θέση για πάνω από 1½ λεπτό, άρα μπορεί να είναι αλλού.
      </p>
    {/if}
  </div>

  {#if oldest != null || (cityAge != null && app.cityOn)}
    <p class="fresh">
      {#if oldest != null}<span title="Ώρα δεδομένων {clock(oldest)}">Γραμμές: πριν {duration(Math.max(0, app.serverNow / 1000 - oldest))}</span>{/if}
      {#if cityAge != null && app.cityOn}<span title="Ώρα δεδομένων {clock(app.city!.updated_at)}">Πόλη: πριν {duration(cityAge)}</span>{/if}
    </p>
  {/if}
</div>

<style>
  .set { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  header { display: flex; align-items: center; gap: 10px; margin: -2px 0 4px; }
  h3 { flex: 1; margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -.01em; line-height: 1.2; }
  .x { flex: none; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: var(--control); color: var(--muted); cursor: pointer; }
  .x:hover { background: var(--control-hover); color: var(--fg); }
  h4 { margin: 10px 4px 0; font-size: 12px; font-weight: 700; letter-spacing: .04em; color: var(--muted); }
  .card { display: flex; flex-direction: column; border-radius: 18px; background: var(--card); border: 1px solid var(--card-border); overflow: hidden; }
  .card.pad { padding: 12px; gap: 10px; }
  .label { font-size: 12px; font-weight: 600; color: var(--muted); line-height: 1; }
  .beta { display: inline-flex; align-items: center; height: 16px; margin-left: 6px; padding: 0 6px; border-radius: 8px; vertical-align: middle;
    background: color-mix(in srgb, var(--late1) 18%, transparent); color: var(--late1); font: 800 10px/1 var(--font); letter-spacing: .04em; text-transform: uppercase; }

  /* A row: tile, name and line, the switch. */
  .row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 10px 12px; box-sizing: border-box; text-align: left;
    width: 100%; border: 0; background: none; color: inherit; font: inherit; }
  .row + .row, .row + .howtext { border-top: 1px solid var(--card-border); }
  .row.inset { padding: 10px 0 0; min-height: 0; border-top: 1px solid var(--card-border); }
  .row.off { opacity: .55; }
  .row.col { flex-direction: column; align-items: stretch; gap: 8px; }
  .tile { flex: none; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 10px;
    background: var(--t); color: #fff; }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .name { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; line-height: 1.2; }
  .name em { height: 20px; display: inline-flex; align-items: center; padding: 0 8px; border-radius: 10px; background: var(--accent-bg); color: var(--accent);
    font-size: 11px; font-weight: 700; font-style: normal; line-height: 1; white-space: nowrap; }
  .sub { font-size: 12px; line-height: 1.35; color: var(--muted); }
  .age { height: 20px; display: inline-flex; align-items: center; padding: 0 6px; border-radius: 6px; background: var(--control); font-size: 11px;
    font-variant-numeric: tabular-nums; line-height: 1; }

  /* The switch: a pill with a knob, its knob sliding over. */
  .sw { flex: none; position: relative; width: 46px; height: 28px; padding: 0; border: 0; border-radius: 14px; background: var(--control-hover);
    cursor: pointer; transition: background-color .2s; }
  .sw i { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .3); transition: transform .22s cubic-bezier(.34, 1.4, .64, 1); }
  .sw[aria-checked="true"] { background: var(--accent); }
  .sw[aria-checked="true"] i { transform: translateX(18px); }
  .sw:disabled { cursor: default; }
  .sw:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Pictures to pick: the themes and the 3D looks. */
  .picks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .picks.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pick { display: flex; flex-direction: column; gap: 6px; padding: 4px; border: 0; border-radius: 14px; background: none; color: inherit; font: inherit; cursor: pointer; }
  .prev { position: relative; display: block; height: 58px; border-radius: 11px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--card-border); }
  .pick[aria-checked="true"] .prev { box-shadow: 0 0 0 2px var(--accent); }
  .plab { display: flex; align-items: center; justify-content: center; gap: 4px; height: 18px; font-size: 12px; font-weight: 600; line-height: 1; color: var(--muted); }
  .pick[aria-checked="true"] .plab { color: var(--accent); }
  .theme-light { background: #eef1f4; }
  .theme-dark { background: #1c2028; }
  .theme-system { background: linear-gradient(135deg, #eef1f4 0 50%, #1c2028 50% 100%); }
  .road { position: absolute; height: 6px; border-radius: 3px; }
  .road.a { left: -10%; right: -10%; top: 22px; transform: rotate(-12deg); }
  .road.b { top: -10%; bottom: -10%; left: 58%; width: 6px; height: auto; transform: rotate(18deg); }
  .theme-light .road { background: #fff; box-shadow: 0 0 0 1px #d8dde4; }
  .theme-dark .road { background: #353b47; }
  .theme-system .road { background: #9aa3b0; }
  .dot { position: absolute; left: 30%; top: 32px; width: 12px; height: 12px; border-radius: 50%; background: #2563eb; border: 2px solid #fff; box-sizing: border-box; }
  .look-real { background: linear-gradient(#2b3039, #20242b); }
  .look-toon { background: linear-gradient(#f3e6c9, #e8d6ae); }
  .b1, .b2, .b3 { position: absolute; bottom: 10px; width: 22%; border-radius: 3px 3px 0 0; }
  .b1 { left: 12%; height: 26px; } .b2 { left: 39%; height: 38px; } .b3 { left: 66%; height: 20px; }
  .look-real .b1, .look-real .b2, .look-real .b3 { background: linear-gradient(90deg, #5a616d 0 55%, #474d58 55%); }
  .look-toon .b1, .look-toon .b2, .look-toon .b3 { background: linear-gradient(#e2683c 0 8px, #fbf6ea 8px); border-radius: 4px 4px 1px 1px; }

  /* Three choices in a row. */
  .seg3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: 13px; background: var(--control); }
  .seg3 button { height: 34px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 6px; border: 0; border-radius: 10px;
    background: none; color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 600; line-height: 1; white-space: nowrap; cursor: pointer; }
  .seg3 button[aria-checked="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .15); }
  .ghost { flex: none; width: 10px; height: 10px; border-radius: 50%; background: #2563eb; }
  .ghost.dim { opacity: .35; }
  .ghost.hide { background: none; box-shadow: inset 0 0 0 1.5px currentColor; opacity: .5; }

  .how { cursor: pointer; border-top: 1px solid var(--card-border); }
  .how:hover { background: var(--control); }
  .chev { flex: none; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; color: var(--muted); transform: rotate(-90deg);
    transition: transform .2s; }
  .chev.open { transform: rotate(0deg); }
  .howtext { margin: 0; padding: 4px 14px 14px 58px; font-size: 12px; line-height: 1.5; color: var(--muted); }
  .fresh { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 4px 4px 0; font-size: 11.5px; color: var(--muted); }
  @media (pointer: coarse) { .seg3 button { height: 40px; } }
  @media (prefers-reduced-motion: reduce) { .sw, .sw i, .chev { transition: none; } }
</style>
