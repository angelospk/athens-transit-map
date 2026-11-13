<script lang="ts">
  // What each symbol on the map shows and what a tap on it does. Static: the samples are drawn like the real
  // ones (the vehicle classes are in app.css) and are not interactive.
  import { PALETTE } from "../lineColors";

  // live: the city has live quality levels (Athens, Thessaloniki; lib/liveQuality.ts), so a followed line's
  // vehicles wear a ring and its slow segments a halo instead of the delay dot.
  let { live = false }: { live?: boolean } = $props();
</script>

<ul>
  {#if live}
    <li><span class="s"><span class="bus late1 ring" style:--c={PALETTE[0].bg} style:--t={PALETTE[0].fg}><i class="glyph"></i><span class="num">040</span></span></span>
      <span>Όχημα επιλεγμένης γραμμής, στο χρώμα της. Περίγραμμα, σε σύγκριση με το συνηθισμένο αυτής της ώρας: πράσινο
        κανονικά, κίτρινο λίγο χειρότερα, κόκκινο πολύ χειρότερα, γκρι άγνωστο. Συχνή γραμμή: απόσταση από το προηγούμενο
        όχημα· αραιή: καθυστέρηση. Πάτημα: λεπτομέρειες.</span></li>
  {:else}
    <li><span class="s"><span class="bus late1" style:--c={PALETTE[0].bg} style:--t={PALETTE[0].fg}><i class="glyph"></i><span class="num">040</span></span></span>
      <span>Όχημα γραμμής που ακολουθείς. Κάθε γραμμή έχει δικό της χρώμα, ίδιο στη διαδρομή και στο κουμπί της.
        Η τελεία είναι η καθυστέρηση, το νούμερο από κάτω η γραμμή. Πάτα το για τις λεπτομέρειες.</span></li>
  {/if}
  <li><span class="s"><span class="pic"><img src="{import.meta.env.BASE_URL}icons/bus.png" alt="" /><i class="dot ontime"></i></span><span class="pic"><img src="{import.meta.env.BASE_URL}icons/trolley.png" alt="" /><i class="dot late3"></i></span></span>
    <span>Όχημα της πόλης: μπλε λεωφορείο, πορτοκαλί τρόλεϊ. Η τελεία είναι η καθυστέρηση: πράσινη στην ώρα του, κίτρινη,
      πορτοκαλί, κόκκινη όλο και πιο αργά, γκρι χωρίς δρομολόγιο. Πάτα το για να δεις ολόκληρη τη γραμμή του.</span></li>
  <li><span class="s"><span class="bus ontime" class:ring={live} style:--c={PALETTE[1].bg} style:--t={PALETTE[1].fg}><i class="glyph"></i><i class="dir" style="transform: translate(20px, 0) rotate(90deg)"></i></span></span>
    <span>Το βελάκι δείχνει προς πού κινείται. Λείπει όταν το όχημα στέκεται.</span></li>
  <li><span class="s"><span class="age">24″</span></span>
    <span>Πριν από τόσο ήρθε η τελευταία θέση GPS του οχήματος.</span></li>
  <li><span class="s"><span class="bus none stale" class:ring={live} style:--c={PALETTE[2].bg} style:--t={PALETTE[2].fg}><i class="glyph"></i></span></span>
    <span>Αχνό: δεν έστειλε θέση για πάνω από 1½ λεπτό. Η πραγματική θέση του μπορεί να είναι αλλού.</span></li>
  <li><span class="s"><i class="trail"></i></span>
    <span>Μπλε ίχνος: η νέα θέση ήταν πιο μπροστά· το όχημα πήγε ως εκεί και άφησε το δρόμο που έκανε.</span></li>
  <li><span class="s"><i class="route"></i></span>
    <span>Διαδρομή. Τα βέλη δείχνουν την κατεύθυνση. Πάτα τη για τις στάσεις της.</span></li>
  {#if live}
    <li><span class="s"><i class="route slow"></i></span>
      <span>Κίτρινο περίγραμμα στη διαδρομή: κίνηση πιο αργή από συνήθως· κόκκινο: πολύ πιο αργή. Πάτημα: η ταχύτητα.</span></li>
  {/if}
  <li><span class="s"><i class="stop"></i></span>
    <span>Στάση της γραμμής που διάλεξες. Πάτα την για το όνομά της.</span></li>
  <li><span class="s"><span class="sign"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span></span>
    <span>Στάση λεωφορείου. Πάτα την για τις αφίξεις.</span></li>
  <li><span class="s"><i class="station"></i></span>
    <span>Σταθμός μετρό, ΗΣΑΠ ή τραμ. Από κοντά δείχνει το σήμα του μετρό ή του τραμ. Πάτα τον για τις γραμμές του.</span></li>
  <li><span class="s"><span class="me"><b></b></span></span>
    <span>Η θέση σου, από το κουμπί του στόχου στον χάρτη.</span></li>
  <li><span class="s"><i class="empty">×</i></span>
    <span>Πάτα σε κενό σημείο του χάρτη για να ξαναδείς όλα τα οχήματα.</span></li>
</ul>

<style>
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 56px 1fr; align-items: center; gap: 10px; min-height: 40px; padding: 4px 0; }
  li + li { border-top: 1px solid var(--border); }
  .s { display: flex; align-items: center; justify-content: center; gap: 4px; pointer-events: none; }
  .pic { position: relative; display: block; width: 24px; height: 24px; }
  .pic img { width: 100%; height: 100%; display: block; }
  .pic .dot { position: absolute; right: -3px; top: -3px; }
  .dot { display: block; width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--bg); }
  .sign { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .35); }
  .sign img { width: 14px; height: 14px; display: block; }
  .age { padding: 0 4px; border-radius: 6px; background: var(--control); font: 600 10px/16px system-ui, sans-serif;
    font-variant-numeric: tabular-nums; }
  .trail { display: block; width: 40px; height: 8px; border-radius: 4px; background: var(--accent); opacity: .55; }
  .route { display: block; width: 40px; height: 4px; border-radius: 2px; background: #c2185b; opacity: .8; }
  .route.slow { opacity: 1; box-shadow: 0 0 0 4.5px color-mix(in srgb, var(--late1) 85%, transparent); }
  .stop { display: block; width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px solid #c2185b; }
  .station { display: block; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 2px solid #e30613; }
  .empty { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 1px dashed var(--muted);
    color: var(--muted); font-style: normal; }
  .me { transform: scale(.8); }
</style>
