<script lang="ts">
  // The 3D mode's loading screen (MapView's warm3d): over the map while what it needs is fetched and the city is
  // built, so the first thing seen in 3D is the whole street, not one that fills in and stutters.
  let { p, label, oncancel }: { p: number; label: string; oncancel: () => void } = $props();
  const pct = $derived(Math.round(Math.max(0, Math.min(1, p)) * 100));
</script>

<div class="load3d" role="status" aria-live="polite">
  <div class="card">
    <svg class="cube" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
      <path class="top" d="M24 6l16 9-16 9-16-9z" />
      <path class="left" d="M8 15l16 9v18L8 33z" />
      <path class="right" d="M40 15l-16 9v18l16-9z" />
    </svg>
    <b>Ετοιμάζεται το 3D <span class="beta">Beta</span></b>
    <span class="step">{label}</span>
    <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct} aria-label="Φόρτωση 3D"><i style:width="{pct}%"></i></span>
    <small>Την πρώτη φορά κατεβαίνουν δρόμοι και δέντρα, μετά μένουν στη συσκευή.</small>
    <small>Το 3D είναι σε δοκιμή: κάτι μπορεί να μη δείχνει σωστά ή να είναι αργό σε παλιά κινητά.</small>
    <button type="button" class="cancel" onclick={oncancel}>Ακύρωση</button>
  </div>
</div>

<style>
  .load3d { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; padding: 16px;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    animation: fade .2s ease-out .25s both; }   /* not a flash when it is quick (all kept already) */
  .card { display: flex; flex-direction: column; align-items: center; gap: 8px; width: min(300px, 100%); padding: 22px 22px 16px;
    border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); text-align: center; }
  .cube { margin-bottom: 4px; animation: bob 1.6s ease-in-out infinite; }
  .cube .top { fill: var(--accent); }
  .cube .left { fill: color-mix(in srgb, var(--accent) 70%, #000); }
  .cube .right { fill: color-mix(in srgb, var(--accent) 45%, #000); }
  b { font-size: 16px; line-height: 1.2; }
  .step { color: var(--muted); font-size: 13px; line-height: 1.2; }
  .bar { width: 100%; height: 6px; margin: 6px 0 2px; border-radius: 3px; background: var(--control); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 3px; background: var(--accent); transition: width .3s ease-out; }
  small { color: var(--muted); font-size: 11.5px; line-height: 1.35; }
  .cancel { display: inline-flex; align-items: center; justify-content: center; height: 34px; margin-top: 6px; padding: 0 16px; border: 0;
    border-radius: 17px; background: var(--control); color: var(--fg); font: inherit; font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer; }
  .cancel:hover { background: var(--control-hover); }
  @keyframes fade { from { opacity: 0; } }
  @keyframes bob { 50% { transform: translateY(-4px); } }
  @media (prefers-reduced-motion: reduce) { .load3d, .cube { animation: none; } }
  .beta { display: inline-flex; align-items: center; height: 18px; margin-left: 6px; padding: 0 7px; border-radius: 9px; vertical-align: middle;
    background: color-mix(in srgb, var(--late1) 18%, transparent); color: var(--late1); font: 800 10px/1 var(--font); letter-spacing: .04em; text-transform: uppercase; }
</style>
