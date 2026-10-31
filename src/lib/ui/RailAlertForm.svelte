<script lang="ts" module>
  // Kept across forms: the last choice of how early.
  const memo = { min: 3 };
</script>

<script lang="ts">
  import { canPush, railTelegram, startRailPush, stopPush } from "../push";
  import type { RailSpec } from "../railAlerts";
  import type { AppState } from "../state.svelte";

  // A metro, tram or suburban alert: how many minutes before the train reaches the stop, then
  // "Ειδοποίησέ με" (web push: the bot polls the stop's /v2 board, so it needs a browser that has it; on an
  // iPhone, the map opened from the Home Screen), or "Στο Telegram" (any browser: the bot gives a link).
  let { app, rail, onstarted }: { app: AppState; rail: Omit<RailSpec, "min" | "until">; onstarted?: () => void } = $props();

  const MAX_MIN = 20;
  let min = $state(memo.min);
  $effect(() => { memo.min = min; });
  const minText = (m: number) => `${m}′ πριν`;

  const iosTab = typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
    !matchMedia("(display-mode: standalone)").matches && !(navigator as { standalone?: boolean }).standalone;
  const able = canPush();

  let err = $state<string | null>(null);

  // The Telegram link for this many minutes: a new number needs a new link.
  const BOT = "oasa_bus_bot";
  let tg = $state<{ min: number; url: string } | null>(null);
  let tgBusy = $state(false);
  const tgUrl = $derived(tg?.min === min ? tg.url : null);
  async function toTelegram() {
    if (tgBusy) return;
    tgBusy = true;
    err = null;
    const m = min, p = await railTelegram({ ...rail, min: m });
    tgBusy = false;
    if (p) {
      const url = `https://t.me/${BOT}?start=${p}`;
      tg = { min: m, url };
      setTimeout(() => { if (tg?.url === url) tg = null; }, 14 * 60_000);   // the bot keeps it 15 minutes
    }
    else err = "Ο server ειδοποιήσεων δεν απάντησε. Δοκίμασε ξανά σε λίγο.";
  }
  let closed = false;
  $effect(() => () => { closed = true; });
  let pushing = $state(false);
  async function alertMe() {
    if (pushing) return;
    pushing = true;
    try { await start(); } finally { pushing = false; }
  }
  // The permission prompt comes first, from the tap itself (browsers ignore it later).
  async function start() {
    err = null;
    if (Notification.permission === "default") await Notification.requestPermission().catch(() => {});
    if (Notification.permission !== "granted") { err = "Χωρίς άδεια για ειδοποιήσεις δεν γίνεται. Δώσ' την από τις ρυθμίσεις του browser."; return; }
    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => null);
    const ready = reg && (await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(r, 5000, null))]));
    const m = min, spec = { ...rail, min: m };
    const r = ready && (await startRailPush(ready, spec));
    if (closed) { if (r) void stopPush(r.id); return; }
    if (!r) { err = "Ο server ειδοποιήσεων δεν απάντησε. Δοκίμασε ξανά σε λίγο."; return; }
    app.setRailAlert({ id: r.id, until: r.until, stop: rail.stop, line: rail.line, label: rail.label, toward: rail.toward, name: rail.name, min: m });
    onstarted?.();
  }
</script>

<div class="form">
  <div class="step" role="group" aria-label="Πόσα λεπτά πριν">
    <button type="button" class="pm" aria-label="Ένα λεπτό λιγότερο" disabled={min <= 1} onclick={() => min--}>−</button>
    <p class="num" aria-live="polite"><b>{min}′</b><small>πριν φτάσει</small></p>
    <button type="button" class="pm" aria-label="Ένα λεπτό περισσότερο" disabled={min >= MAX_MIN} onclick={() => min++}>+</button>
  </div>
  {#if able}
    <button type="button" class="main" disabled={pushing} onclick={alertMe}>{pushing ? "…" : `Ειδοποίησέ με ${minText(min)}`}</button>
    {#if err}<p class="warn" role="status">{err}</p>{/if}
    <p class="note">Για 2 ώρες, και με κλειστή σελίδα. Αν δεν έρχεται κανένα δρομολόγιο (απεργία, τέλος δρομολογίων), σου το λέει.</p>
  {:else if iosTab}
    <p class="warn">Στο iPhone η ειδοποίηση έρχεται μόνο στον χάρτη από την οθόνη Αφετηρίας: Κοινοποίηση → «Προσθήκη στην οθόνη Αφετηρίας», και άνοιξέ τον από το εικονίδιο. Ή στο Telegram:</p>
  {:else}
    <p class="warn">Αυτός ο browser δεν δίνει ειδοποιήσεις (ή τις έχεις κλείσει για τη σελίδα). Γίνεται στο Telegram:</p>
  {/if}
  {#if tgUrl}
    <a class={able ? "tg" : "main"} href={tgUrl} target="_blank" rel="noopener">Άνοιξε το Telegram και πάτα Start</a>
    <p class="note">Ο σύνδεσμος ισχύει 15 λεπτά. Η ειδοποίηση έρχεται στο Telegram (@{BOT}) για 2 ώρες.</p>
  {:else}
    <button type="button" class={able ? "tg" : "main"} disabled={tgBusy} onclick={toTelegram}>{tgBusy ? "…" : able ? "ή στο Telegram" : `Στο Telegram, ${minText(min)}`}</button>
  {/if}
  {#if err && !able}<p class="warn" role="status">{err}</p>{/if}
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; font-size: 13px; }
  .step { display: flex; align-items: center; justify-content: center; gap: 24px; margin: 4px 0 0; }
  .pm { width: 48px; height: 48px; border: 0; border-radius: 50%; background: var(--control); color: var(--fg);
    font-size: 24px; line-height: 1; cursor: pointer; }
  .pm:disabled { opacity: .35; cursor: default; }
  .num { display: flex; flex-direction: column; align-items: center; min-width: 96px; margin: 0; }
  .num b { font-size: 44px; line-height: 1; font-weight: 700; font-variant-numeric: tabular-nums; }
  .num small { color: var(--muted); font-size: 13px; }
  .main { display: grid; place-items: center; min-height: 46px; padding: 0 16px; border: 0; border-radius: 23px; background: var(--fg);
    color: var(--bg); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
  .main:disabled { opacity: .5; cursor: default; }
  .note { margin: 0; color: var(--muted); font-size: 12px; }
  .tg { align-self: center; min-height: 36px; padding: 0 8px; border: 0; background: none; color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
  a.main, a.tg { text-decoration: none; }
  .warn { margin: 0; color: var(--late2); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
