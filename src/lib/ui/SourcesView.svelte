<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import { BACKEND_REPO, FRONTEND_REPO, GTFS_PAGE, STASY_GTFS_PAGE, TILE_CREDITS } from "../sources";

  let { motion }: { motion: boolean } = $props();

  // The buses in the picture move along the lines, unless motion is off (the app's switch or the system's).
  const reduced = new MediaQuery("(prefers-reduced-motion: reduce)");
  const still = $derived(!motion || reduced.current);
  const buses = [
    { color: "#e63946", dur: 5, path: "M0.1 0.3 H0.85 V0.55", at: [0.1, 0.3] },
    { color: "#2a9d8f", dur: 6, path: "M0.3 0.05 V0.55 H0.95", at: [0.3, 0.05] },
    { color: "#f4a261", dur: 4, path: "M0.5 0.1 V0.9", at: [0.5, 0.1] },
  ];
  const streets = ["M0 0.3 H1", "M0 0.55 H1", "M0.3 0 V0.55", "M0.5 0 V0.55", "M0.85 0.3 V0.55"];
</script>

<p class="lede">Ο χάρτης είναι τρία επίπεδα, το ένα πάνω στο άλλο.</p>

<div class="layers">
  <!-- Decorative: the list says the same. Each sheet is a unit square mapped to a diamond. -->
  <svg viewBox="0 0 300 340" aria-hidden="true">
    <g stroke="var(--border)" stroke-dasharray="4 4" fill="none">
      <path d="M10 55V275" /><path d="M290 55V275" /><path d="M150 100V320" />
    </g>

    <g transform="matrix(140 45 -140 45 150 230)">
      <rect width="1" height="1" fill="#e9e7e1" stroke="#999" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      <path d="M0.05 0.65 Q0.3 0.55 0.5 0.75 T0.95 0.8 V0.95 H0.05 Z" fill="#a9cfe8" />
      <rect x="0.55" y="0.08" width="0.3" height="0.22" fill="#bfdcae" />
      {#each streets as d (d)}<path {d} fill="none" stroke="#fff" stroke-width="6" vector-effect="non-scaling-stroke" />{/each}
      {#each streets as d (d)}<path {d} fill="none" stroke="#c9c5b8" stroke-width="1" vector-effect="non-scaling-stroke" />{/each}
    </g>

    <g transform="matrix(140 45 -140 45 150 120)">
      <rect width="1" height="1" fill="#4a90e2" fill-opacity=".12" stroke="#4a90e2" stroke-width="1.5"
        stroke-dasharray="5 3" vector-effect="non-scaling-stroke" />
      <g fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        {#each buses as b (b.color)}<path d={b.path} stroke={b.color} vector-effect="non-scaling-stroke" />{/each}
      </g>
    </g>

    <g transform="matrix(140 45 -140 45 150 10)">
      <rect width="1" height="1" fill="#888" fill-opacity=".06" stroke="#aaa" stroke-width="1.5"
        stroke-dasharray="2 3" vector-effect="non-scaling-stroke" />
      {#each buses as b (b.color)}
        {#if still}
          <circle cx={b.at[0]} cy={b.at[1]} r="0.05" fill={b.color} stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke" />
        {:else}
          <circle r="0.05" fill={b.color} stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke">
            <animateMotion dur="{b.dur}s" repeatCount="indefinite" path={b.path} />
          </circle>
        {/if}
      {/each}
    </g>

    <g class="num" font-size="13" font-weight="700" text-anchor="middle">
      <text x="14" y="42">3</text><text x="14" y="152">2</text><text x="14" y="262">1</text>
    </g>
  </svg>

  <ol>
    <li>
      <h3><span>3</span> Λεωφορεία, ζωντανά</h3>
      <p>Η τρέχουσα θέση κάθε οχήματος, από τον δικό μας διακομιστή δεδομένων.</p>
      <p class="src"><a href={BACKEND_REPO} target="_blank" rel="noopener">Κώδικας του backend (GitHub)</a></p>
    </li>
    <li>
      <h3><span>2</span> Γραμμές και δρομολόγια</h3>
      <p>Οι διαδρομές, οι στάσεις και το πρόγραμμα του ΟΑΣΑ.</p>
      <p class="src"><a href={GTFS_PAGE} target="_blank" rel="noopener">Αρχείο GTFS του ΟΑΣΑ (data.gov.gr)</a></p>
      <p>Μετρό, ΗΣΑΠ και τραμ: σταθμοί από το GTFS της ΣΤΑΣΥ, χάραξη γραμμών από το OpenStreetMap.</p>
      <p class="src"><a href={STASY_GTFS_PAGE} target="_blank" rel="noopener">GTFS της ΣΤΑΣΥ (data.gov.gr)</a><span aria-hidden="true">&nbsp;·&nbsp;</span><a
        href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap (ODbL)</a></p>
    </li>
    <li>
      <h3><span>1</span> Βασικός χάρτης</h3>
      <p>Δρόμοι, νερό και πάρκα. Ο χάρτης είναι έτοιμος· δεν τον φτιάχνουμε εμείς.</p>
      <p class="src">
        {#each TILE_CREDITS as c, i (c.href)}
          {#if i}<span aria-hidden="true">&nbsp;·&nbsp;</span>{/if}{c.lead ?? ""}<a href={c.href} target="_blank" rel="noopener">{c.text}</a>
        {/each}
      </p>
    </li>
  </ol>
</div>

<p class="code"><a href={FRONTEND_REPO} target="_blank" rel="noopener">Κώδικας αυτού του χάρτη (GitHub)</a></p>

<style>
  .lede { margin: 0 0 8px; color: var(--muted); }
  .layers { display: grid; grid-template-columns: 300px 1fr; gap: 0 20px; align-items: stretch; }
  .layers svg { display: block; width: 100%; max-width: 300px; height: auto; }
  .num { fill: var(--muted); }
  ol { display: grid; grid-template-rows: repeat(3, 1fr); margin: 0; padding: 0; list-style: none; }
  li { align-self: center; }
  h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 2px; font-size: 14px; }
  h3 span { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--control);
    color: var(--muted); font-size: 12px; }
  li p { margin: 0; font-size: 13px; color: var(--muted); }
  li .src { margin-top: 4px; color: var(--fg); }
  .code { margin: 12px 0 0; font-size: 13px; }
  a { color: var(--accent); }
  @media (max-width: 719px) {
    .layers { grid-template-columns: minmax(0, 1fr); gap: 12px; justify-items: center; }
    ol { grid-template-rows: none; gap: 16px; justify-self: stretch; }
  }
</style>
