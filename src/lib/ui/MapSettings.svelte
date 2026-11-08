<script lang="ts">
  // «Ρυθμίσεις» (the rail's eye button, Panel.svelte). A phone shows it as a page of its own (compact mockup 11), a
  // computer as the popover beside the rail. Groups of rows: a name, at most one short line under it, the control at
  // the right (a switch, two or three choices, or the current value that opens its choices under the row).
  import { MediaQuery } from "svelte/reactivity";
  import type { Snippet } from "svelte";
  import type { AppState } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import { clock, duration } from "../format";
  import { LOOKS } from "../map/look3d";
  import { lastSaved, markSaved, ownLines, saveLines } from "../offline";
  import { resolveDark } from "../theme";
  import SettingPreview, { type PreviewKind } from "./SettingPreview.svelte";

  let { app, cityMissing, cityAge, oldest, onclose }:
    { app: AppState; cityMissing: boolean; cityAge: number | null; oldest: number | null; onclose: () => void } = $props();

  const narrow = new MediaQuery("(max-width: 719px)");
  // A computer: a window over the map (desktop mockup Υ8), the look chosen from pictures, the rest in two columns.
  const wide = $derived(!narrow.current);
  const systemDark = new MediaQuery("(prefers-color-scheme: dark)");
  const dark = $derived(resolveDark(app.theme, systemDark.current));
  type Pic = { value: string; label: string; sub?: string };
  const THEME_PICS: Pic[] = [{ value: "system", label: "Αυτόματο", sub: "όπως η συσκευή" }, { value: "dark", label: "Σκούρο" }, { value: "light", label: "Ανοιχτό" }];
  const LOOK_PICS: Pic[] = [{ value: "off", label: "2D", sub: "ο χάρτης από πάνω" }, { value: "real", label: "Ρεαλιστική", sub: "με σκιές" }, { value: "toon", label: "Μινιατούρα", sub: "χρώματα και περίγραμμα" }];
  const OTHER_PICS: Pic[] = [{ value: "normal", label: "Όπως είναι" }, { value: "dim", label: "Αχνά" }, { value: "hide", label: "Κρυφά" }];
  const look = $derived(app.threeD ? app.look3d : "off");
  const setLook = (v: string) => {
    if (v === "off") { app.setThreeD(false); return; }
    app.setLook3d(v as typeof app.look3d);
    if (!app.threeD) app.setThreeD(true);
  };

  type Toggle = { id: string; title: string; sub?: string; on: boolean; disabled?: boolean; beta?: boolean; set: (v: boolean) => void };
  type Choice<T> = { value: T; label: string; short?: string; hint?: string };   // short: the value in the narrower popover

  const THEMES = [{ value: "system", label: "Αυτόματο" }, { value: "dark", label: "Σκούρο" }, { value: "light", label: "Ανοιχτό" }] as const;
  const OTHERS = [
    { value: "normal", label: "μένουν όπως είναι", short: "όπως είναι" },
    { value: "dim", label: "τα άλλα αχνά", short: "αχνά" },
    { value: "hide", label: "τα άλλα κρυφά", short: "κρυφά" },
  ] as const;
  const STALE = [
    { value: false, label: "φαίνονται", hint: "αχνά, με πορτοκαλί ηλικία" },
    { value: true, label: "κρυφά", hint: "όσα δεν έστειλαν θέση για πάνω από 1½ λεπτό" },
  ] as const;
  const AGES = [
    { value: "never", label: "ποτέ" },
    { value: "old", label: "όταν είναι παλιά" },
    { value: "always", label: "πάντα" },
  ] as const;

  const shows: Toggle[] = $derived([
    { id: "city", title: "Λεωφορεία", sub: cityMissing ? "όχι ακόμα διαθέσιμα" : undefined, on: app.cityOn, disabled: cityMissing, set: v => app.setCityOn(v) },
    ...(app.cityInfo.rail ? [{ id: "trains", title: "Μετρό, τραμ, τρένα", on: app.trainsOn, set: (v: boolean) => app.setTrainsOn(v) }] : []),
    ...(app.municipal ? [{ id: "muni", title: "Δημοτικά λεωφορεία", sub: "από το πρόγραμμα του δήμου, όχι live", on: app.municipalOn,
      set: (v: boolean) => app.setMunicipalOn(v) }] : []),
    { id: "speed", title: "Ταχύτητα στους δρόμους", sub: "κόκκινο αργά, πράσινο γρήγορα", on: app.speedOn, set: v => app.setSpeedOn(v) },
  ]);
  const vehicles: Toggle[] = $derived([
    { id: "ontime", title: "Μόνο όσα είναι στην ώρα τους", sub: "έως 5′ καθυστέρηση", on: app.only.onTime, set: v => app.setOnly({ onTime: v }) },
    { id: "motion", title: "Ομαλή κίνηση", sub: "ανάμεσα στις θέσεις που στέλνουν", on: app.motion, set: v => app.setMotion(v) },
  ]);
  const sends = $derived(app.cityInfo.id === "athens" ? "ο ΟΑΣΑ στέλνει θέση κάθε 20–60″" : `${app.cityInfo.agencyThe.charAt(0).toLowerCase()}${app.cityInfo.agencyThe.slice(1)} στέλνει θέση ανά διαστήματα`);

  // One value row open at a time: its choices show under it.
  let open = $state<string | null>(null);
  const flip = (id: string) => (open = open === id ? null : id);

  // How fresh the data is: the older of the picked lines and the city's buses.
  const age = $derived.by(() => {
    const lines = oldest != null ? Math.max(0, app.serverNow / 1000 - oldest) : null;
    const city = cityAge != null && app.cityOn ? cityAge : null;
    if (lines == null && city == null) return null;
    return Math.max(lines ?? 0, city ?? 0);
  });
  const ageTitle = $derived([oldest != null ? `Γραμμές ${clock(oldest)}` : "", cityAge != null && app.cityOn && app.city ? `Πόλη ${clock(app.city.updated_at)}` : ""]
    .filter(Boolean).join(" · "));

  // «Χωρίς σύνδεση»: the rider's own timetables kept ahead of time (offline.ts); what they open is kept anyway.
  let saving = $state<{ done: number; total: number } | null>(null);
  let saved = $state(lastSaved());
  let saveNote = $state("");
  const savedDay = $derived(saved ? new Date(saved.at).toLocaleDateString("el-GR", { day: "numeric", month: "long" }) : "");
  async function saveOffline() {
    if (saving) return;
    saveNote = "";
    if (!app.online) { saveNote = "Χρειάζεται σύνδεση για να τα κατεβάσω."; return; }
    const ix = await app.loadStops();
    if (!ix) { saveNote = "Δεν φόρτωσαν οι στάσεις. Δοκίμασε ξανά σε λίγο."; return; }
    const places = [app.places.home, app.places.work].flatMap(p => (p ? [p.at] : []));
    const lines = ownLines(ix, app.favs.lines.map(l => l.id), app.favs.stops.map(f => [f.lat, f.lon] as [number, number]), places);
    if (!lines.length) { saveNote = "Βάλε πρώτα αγαπημένες γραμμές ή στάσεις, ή Σπίτι και Δουλειά."; return; }
    saving = { done: 0, total: lines.length };
    const ok = await saveLines(lines, (done, total) => (saving = { done, total }));
    saving = null;
    if (ok) { saved = { at: Date.now(), lines: ok }; markSaved(saved); }
    saveNote = ok === lines.length ? "" : ok ? `Κατέβηκαν ${ok} από ${lines.length}. Οι άλλες: ξανά σε λίγο.` : "Δεν κατέβηκε τίποτα. Δοκίμασε ξανά σε λίγο.";
  }

  // «Σχετικά» opens the ⓘ sheet (MapView listens for «openfeedback»), then its tab or its «Τι νέο».
  function info(to: "sources" | "whatsnew" | "feedback") {
    onclose();
    dispatchEvent(new Event("openfeedback"));
    if (to === "feedback") return;
    const until = performance.now() + 10000;
    const find = () => {
      const el = document.getElementById(to === "sources" ? "info-tab-sources" : "whatsnew-title");
      if (el) { if (to === "sources") el.click(); else el.scrollIntoView({ block: "start" }); }
      else if (performance.now() < until) requestAnimationFrame(find);
    };
    requestAnimationFrame(find);
  }
  let howOpen = $state(false);
</script>

{#snippet toggle(t: Toggle, last = false)}
  <button type="button" class="row" class:sub={!!t.sub} class:last role="switch" aria-checked={t.on} disabled={t.disabled} onclick={() => t.set(!t.on)}>
    <span class="txt">
      <span class="name">{t.title}{#if t.beta}<span class="beta">Beta</span>{/if}</span>
      {#if t.sub}<span class="note">{t.sub}</span>{/if}
    </span>
    <span class="sw" aria-hidden="true"><i></i></span>
  </button>
{/snippet}

{#snippet pick<T>(id: string, title: string, sub: string | undefined, value: T, choices: readonly Choice<T>[], set: (v: T) => void, last = false)}
  {@const chosen = choices.find(c => c.value === value)}
  <button type="button" class="row" class:sub={!!sub} class:last={last && open !== id} aria-expanded={open === id} aria-controls="set-{id}" onclick={() => flip(id)}>
    <span class="txt">
      <span class="name">{title}</span>
      {#if sub}<span class="note">{sub}</span>{/if}
    </span>
    <span class="val">{(narrow.current ? chosen?.label : chosen?.short ?? chosen?.label) ?? ""}<span class="chev" class:open={open === id} aria-hidden="true"><Icon name="chevron" size={14} /></span></span>
  </button>
  {#if open === id}
    <!-- A choice closes the list: its press stops here, or Panel's click-outside would see a button gone from the page. -->
    <div class="opts" class:last id="set-{id}" role="radiogroup" aria-label={title}>
      {#each choices as c (c.value)}
        <button type="button" class="opt" role="radio" aria-checked={c.value === value} onclick={e => { e.stopPropagation(); set(c.value); open = null; }}>
          <span class="txt"><span class="oname">{c.label}</span>{#if c.hint}<span class="note">{c.hint}</span>{/if}</span>
          <span class="tick" aria-hidden="true">{#if c.value === value}<Icon name="check" size={16} />{/if}</span>
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet seg<T>(label: string, value: T, choices: readonly Choice<T>[], set: (v: T) => void)}
  <span class="seg" role="radiogroup" aria-label={label}>
    {#each choices as c (c.value)}
      <button type="button" role="radio" aria-checked={c.value === value} onclick={() => set(c.value)}>{c.label}</button>
    {/each}
  </span>
{/snippet}

{#snippet pics(label: string, kind: PreviewKind, value: string, choices: Pic[], set: (v: string) => void)}
  <div class="pics" role="radiogroup" aria-label={label}>
    {#each choices as c (c.value)}
      <button type="button" class="pic" role="radio" aria-checked={c.value === value} onclick={() => set(c.value)}>
        <span class="art"><SettingPreview {kind} v={c.value} {dark} />{#if c.value === value}<span class="ok" aria-hidden="true"><Icon name="check" size={12} /></span>{/if}</span>
        <span class="pl"><b>{c.label}</b>{#if c.sub}<small>{c.sub}</small>{/if}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet group(title: string, sub: string, inner: Snippet)}
  <div class="grp"><span class="gt"><b>{title}</b><small>{sub}</small></span>{@render inner()}</div>
{/snippet}

{#if wide}
<div class="set wide">
  <header>
    <h2>Ρυθμίσεις</h2>
    <button type="button" class="x" aria-label="Κλείσιμο" onclick={onclose}><Icon name="close" size={18} /></button>
  </header>
  <div class="wbody">
    <section aria-labelledby="set-look-w">
      <h3 id="set-look-w">Εμφάνιση</h3>
      <div class="card look">
        {#snippet themeP()}{@render pics("Θέμα", "theme", app.theme, THEME_PICS, v => app.setTheme(v as typeof app.theme))}{/snippet}
        {#snippet lookP()}{@render pics("Χάρτης σε 3D", "look", look, LOOK_PICS, setLook)}{/snippet}
        {@render group("Θέμα", "η εφαρμογή και ο χάρτης", themeP)}
        {@render group("Χάρτης σε 3D", "κτίρια, δέντρα και τα λεωφορεία ως μοντέλα · beta", lookP)}
      </div>
      {#if app.threeD}
        <div class="card">{@render toggle({ id: "under", title: "Μετρό κάτω από τη γη", sub: "οι σήραγγες και οι σταθμοί σε βάθος", on: app.under, set: v => (app.under = v) }, true)}</div>
      {/if}
    </section>
    <div class="cols">
      <section aria-labelledby="set-others-w">
        <h3 id="set-others-w">Όταν πατάς ένα λεωφορείο</h3>
        <div class="card look one">
          {#snippet othersP()}{@render pics("Τα άλλα οχήματα", "others", app.others, OTHER_PICS, v => app.setOthers(v as typeof app.others))}{/snippet}
          {@render group("Τα άλλα οχήματα", "ακολουθείς ένα· τα υπόλοιπα στον χάρτη", othersP)}
        </div>
      </section>
      <section aria-labelledby="set-map-w">
        <h3 id="set-map-w">Τι δείχνει ο χάρτης</h3>
        <div class="card">
          {#each shows as t (t.id)}{@render toggle(t)}{/each}
          {@render pick("stale", "Λεωφορεία με παλιά θέση", sends, app.only.fresh, STALE, v => app.setOnly({ fresh: v }))}
          {@render pick("ages", "Ηλικία θέσης", "πριν πόσο έστειλε θέση", app.ageMode, AGES, v => app.setAgeMode(v))}
          {#each vehicles as t, i (t.id)}{@render toggle(t, i === vehicles.length - 1)}{/each}
        </div>
      </section>
    </div>
    <div class="cols">
      {@render offline()}
      {@render about()}
    </div>
  </div>
</div>
{:else}
<div class="set" class:page={narrow.current}>
  <header>
    {#if narrow.current}
      <button type="button" class="back" aria-label="Πίσω" onclick={onclose}><Icon name="back" size={22} /></button>
      <h2>Ρυθμίσεις</h2>
    {:else}
      <h2>Ρυθμίσεις</h2>
      <button type="button" class="x" aria-label="Κλείσιμο" onclick={onclose}><Icon name="close" size={16} /></button>
    {/if}
  </header>

  <section aria-labelledby="set-look">
    <h3 id="set-look">Εμφάνιση</h3>
    <div class="card">
      <div class="row">
        <span class="txt"><span class="name">Θέμα</span></span>
        {@render seg("Θέμα", app.theme, THEMES, v => app.setTheme(v))}
      </div>
      {@render toggle({ id: "3d", title: "Χάρτης σε 3D", beta: true, on: app.threeD, set: v => app.setThreeD(v) }, !app.threeD)}
      {#if app.threeD}
        <div class="row">
          <span class="txt"><span class="name">Στυλ 3D</span></span>
          {@render seg("Στυλ 3D", app.look3d, LOOKS.map(([value, label]) => ({ value, label })), v => app.setLook3d(v))}
        </div>
        {@render toggle({ id: "under", title: "Μετρό κάτω από τη γη", sub: "οι σήραγγες και οι σταθμοί σε βάθος", on: app.under, set: v => (app.under = v) }, true)}
      {/if}
    </div>
  </section>

  <section aria-labelledby="set-map">
    <h3 id="set-map">Τι δείχνει ο χάρτης</h3>
    <div class="card">
      {#each shows as t (t.id)}{@render toggle(t)}{/each}
      {@render pick("others", "Όταν πατάς ένα λεωφορείο", "τι γίνεται με τα υπόλοιπα", app.others, OTHERS, v => app.setOthers(v))}
      {@render pick("stale", "Λεωφορεία με παλιά θέση", sends, app.only.fresh, STALE, v => app.setOnly({ fresh: v }))}
      {@render pick("ages", "Ηλικία θέσης", "πριν πόσο έστειλε θέση", app.ageMode, AGES, v => app.setAgeMode(v))}
      {#each vehicles as t, i (t.id)}{@render toggle(t, i === vehicles.length - 1)}{/each}
    </div>
  </section>

  {@render offline()}
  {@render about()}
</div>
{/if}

{#snippet offline()}
  <section aria-labelledby="set-off">
    <h3 id="set-off">Χωρίς σύνδεση</h3>
    <div class="card">
      <div class="row sub last">
        <span class="txt">
          <span class="name">Τα δρομολόγιά σου</span>
          <span class="note">{saving ? `κατεβάζω ${saving.done} από ${saving.total} γραμμές…` : saved ? `${saved.lines} γραμμές · ${savedDay}` : "για να δουλεύει χωρίς ίντερνετ"}</span>
        </span>
        <button type="button" class="dl" disabled={!!saving} onclick={saveOffline}>{saving ? "…" : saved ? "Ανανέωση" : "Κατέβασε"}</button>
      </div>
      {#if saving}<div class="bar" aria-hidden="true"><i style:width="{saving.total ? (saving.done / saving.total) * 100 : 0}%"></i></div>{/if}
      {#if saveNote}<p class="more" role="status">{saveNote}</p>{/if}
    </div>
  </section>

{/snippet}

{#snippet about()}
  <section aria-labelledby="set-about">
    <h3 id="set-about">Σχετικά</h3>
    <div class="card">
      <button type="button" class="row" onclick={() => info("whatsnew")}>
        <span class="txt"><span class="name">Τι νέο</span></span>
        <span class="val">v{__APP_VERSION__}<span class="chev side" aria-hidden="true"><Icon name="chevron" size={14} /></span></span>
      </button>
      <button type="button" class="row" onclick={() => info("sources")}>
        <span class="txt"><span class="name">Από πού έρχονται τα δεδομένα</span></span>
        <span class="val">{#if age != null}<span title={ageTitle}>πριν {duration(age)}</span>{/if}<span class="chev side" aria-hidden="true"><Icon name="chevron" size={14} /></span></span>
      </button>
      <button type="button" class="row" aria-expanded={howOpen} aria-controls="set-how" onclick={() => (howOpen = !howOpen)}>
        <span class="txt"><span class="name">Πώς κινούνται τα οχήματα</span></span>
        <span class="val"><span class="chev" class:open={howOpen} aria-hidden="true"><Icon name="chevron" size={14} /></span></span>
      </button>
      {#if howOpen}
        <p class="more how" id="set-how">
          {sends[0].toUpperCase() + sends.slice(1)}. Πολύ μπροστά, το όχημα πηγαίνει γρήγορα ως εκεί και αφήνει για λίγο μπλε ίχνος. Πίσω, γυρίζει
          αχνό με γκρι διακεκομμένο ίχνος: διόρθωση θέσης, όχι όπισθεν. Αχνό με πορτοκαλί ηλικία: δεν έστειλε θέση για πάνω από 1½ λεπτό.
        </p>
      {/if}
      <button type="button" class="row last" onclick={() => info("feedback")}>
        <span class="txt"><span class="name">Γράψε μας</span></span>
        <span class="val"><span class="chev side" aria-hidden="true"><Icon name="chevron" size={14} /></span></span>
      </button>
    </div>
  </section>
{/snippet}

<style>
  .set { display: flex; flex-direction: column; gap: 16px; font-size: 13px; color: var(--fg); }
  .set.page { padding: calc(12px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom)); }

  header { height: 44px; display: flex; align-items: center; gap: 6px; }
  h2 { flex: 1; margin: 0; font-size: 22px; font-weight: 700; line-height: 1; letter-spacing: -.01em; }
  .set:not(.page) h2 { font-size: 18px; }
  .back { flex: none; width: 40px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 12px; background: none; color: var(--fg); cursor: pointer; }
  .back :global(svg) { stroke-width: 2.4; }
  .x { flex: none; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: var(--control); color: var(--muted); cursor: pointer; }
  .x:hover { background: var(--control-hover); color: var(--fg); }

  section { display: flex; flex-direction: column; gap: 6px; }
  h3 { height: 18px; display: flex; align-items: center; margin: 0; padding: 0 4px; font-size: 13px; font-weight: 700; line-height: 1; color: var(--muted); }
  .card { display: flex; flex-direction: column; border-radius: 16px; background: var(--card); overflow: hidden; }

  /* A row: 46 px, 52 with a line under the name; a hairline between rows. */
  .row { height: 46px; display: flex; align-items: center; gap: 12px; width: 100%; margin: 0; padding: 0 14px; box-sizing: border-box;
    border: 0; border-bottom: 1px solid var(--border); background: none; color: inherit; font: inherit; text-align: left; }
  .row.sub { height: 52px; }
  .row.last { border-bottom: 0; }
  button.row { cursor: pointer; -webkit-tap-highlight-color: transparent; }
  @media (hover: hover) { button.row:hover:not(:disabled) { background: color-mix(in srgb, var(--fg) 4%, transparent); } }
  button.row:active:not(:disabled) { background: color-mix(in srgb, var(--fg) 6%, transparent); }
  button.row:disabled { cursor: default; opacity: .5; }
  .row:focus-visible, .opt:focus-visible, .seg button:focus-visible, .dl:focus-visible, .back:focus-visible, .x:focus-visible {
    outline: 2px solid var(--accent); outline-offset: -2px; }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .name { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .note { font-size: 12px; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .beta { flex: none; height: 18px; display: flex; align-items: center; padding: 0 6px; border-radius: 9px;
    background: color-mix(in srgb, var(--late1) 22%, transparent); color: var(--late1); font-size: 11px; font-weight: 800; line-height: 1; }

  /* The switch. */
  .sw { flex: none; position: relative; width: 44px; height: 26px; border-radius: 13px; background: color-mix(in srgb, var(--fg) 16%, var(--card));
    transition: background-color .2s; }
  .sw i { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .25);
    transition: transform .22s cubic-bezier(.34, 1.4, .64, 1); }
  [aria-checked="true"] > .sw { background: var(--accent); }
  [aria-checked="true"] > .sw i { transform: translateX(18px); }

  /* Two or three choices in the row. */
  .seg { flex: none; height: 30px; display: flex; gap: 2px; padding: 3px; box-sizing: border-box; border-radius: 15px; background: var(--bg); }
  .seg button { height: 24px; display: flex; align-items: center; justify-content: center; margin: 0; padding: 0 10px; border: 0; border-radius: 12px;
    background: none; color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 600; line-height: 1; white-space: nowrap; cursor: pointer; }
  .seg button[aria-checked="true"] { background: color-mix(in srgb, var(--fg) 18%, var(--card)); color: var(--fg); font-weight: 800; }

  /* A value that opens its choices under the row. */
  .val { flex: none; display: flex; align-items: center; gap: 6px; max-width: 46%; font-size: 13.5px; font-weight: 600; line-height: 1; color: var(--muted);
    white-space: nowrap; }
  .chev { flex: none; width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; opacity: .8; transform: rotate(-90deg); transition: transform .2s; }
  .chev :global(svg) { stroke-width: 2.6; }
  .chev.open { transform: rotate(0deg); }
  .opts { display: flex; flex-direction: column; padding: 4px 0; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 45%, var(--card)); }
  .opts.last { border-bottom: 0; }
  .opt { min-height: 42px; display: flex; align-items: center; gap: 12px; width: 100%; margin: 0; padding: 8px 14px 8px 26px; box-sizing: border-box;
    border: 0; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .oname { font-size: 14px; font-weight: 600; line-height: 1; }
  .opt[aria-checked="true"] .oname { color: var(--accent); }
  .tick { flex: none; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: var(--accent); }

  .dl { flex: none; height: 32px; display: flex; align-items: center; justify-content: center; margin: 0; padding: 0 12px; border: 0; border-radius: 10px;
    background: var(--accent); color: #fff; font: inherit; font-size: 13px; font-weight: 800; line-height: 1; cursor: pointer; }
  .dl:disabled { opacity: .6; cursor: default; }
  .bar { height: 4px; margin: 0 14px 12px; border-radius: 2px; background: var(--bg); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 2px; background: var(--accent); transition: width .2s; }
  .more { margin: 0; padding: 0 14px 12px; font-size: 12px; line-height: 1.4; color: var(--muted); }
  .more.how { padding-top: 10px; border-bottom: 1px solid var(--border); }

  @media (prefers-reduced-motion: reduce) { .sw, .sw i, .chev { transition: none; } }

  /* The computer's window (desktop mockup Υ8): a header, then the sections in a scrolling body; the look as pictures. */
  .set.wide { height: 100%; min-height: 0; gap: 0; }
  .wide header { flex: none; height: 72px; padding: 0 16px 0 28px; border-bottom: 1px solid var(--border); }
  .set.wide h2 { font-size: 22px; font-weight: 800; }
  .wide .x { width: 44px; height: 44px; background: var(--card); color: var(--fg); }
  .wbody { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 24px 28px 28px; display: flex; flex-direction: column; gap: 24px; }
  .wide section { gap: 10px; }
  .wide h3 { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
  .wide .card { box-shadow: inset 0 0 0 1px var(--card-border); }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; align-items: start; }
  .look { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; padding: 16px; }
  .grp { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .gt { display: flex; flex-direction: column; gap: 5px; }
  .gt b { font-size: 14.5px; font-weight: 700; line-height: 1.2; }
  .gt small { font-size: 12.5px; line-height: 1.3; color: var(--muted); }
  .pics { display: flex; gap: 10px; }
  .pic { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 8px; margin: 0; padding: 0; border: 0;
    background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .art { position: relative; display: block; aspect-ratio: 3 / 2; border-radius: 12px; overflow: hidden; box-shadow: 0 0 0 1px var(--card-border); transition: box-shadow .15s; }
  .pic:hover .art { box-shadow: 0 0 0 1px color-mix(in srgb, var(--fg) 30%, transparent); }
  .pic[aria-checked="true"] .art { box-shadow: 0 0 0 2px var(--accent); }
  .pic:focus-visible { outline: none; }
  .pic:focus-visible .art { box-shadow: 0 0 0 2px var(--accent), 0 0 0 5px var(--accent-bg); }
  .ok { position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
    border-radius: 50%; background: var(--accent); color: var(--on-accent); }
  .ok :global(svg) { stroke-width: 3; }
  .pl { display: flex; flex-direction: column; gap: 4px; padding: 0 2px; }
  .pl b { font-size: 13px; font-weight: 700; line-height: 1; color: var(--muted); }
  .pic[aria-checked="true"] .pl b { color: var(--fg); }
  .pl small { font-size: 11.5px; line-height: 1.2; color: var(--muted); }
</style>
