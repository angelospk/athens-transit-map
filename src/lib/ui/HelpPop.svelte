<script lang="ts">
  // What each symbol on the map shows and what a tap on it does. Static: the samples are drawn like the real
  // ones (the vehicle classes are in app.css) and are not interactive.
  import { PALETTE } from "../lineColors";
</script>

<ul>
  <li><span class="s"><span class="bus late1" style:--c={PALETTE[0].bg} style:--t={PALETTE[0].fg}>040</span></span>
    <span>Όχημα γραμμής που ακολουθείς. Κάθε γραμμή έχει δικό της χρώμα, ίδιο στη διαδρομή και στο κουμπί της.
      Η κουκκίδα στη γωνία του είναι η καθυστέρηση. Πάτα το για τις λεπτομέρειες.</span></li>
  <li><span class="s"><span class="ico"><img src="{import.meta.env.BASE_URL}icons/bus.png" alt="" /><i class="d ontime"></i></span><span class="ico"><img src="{import.meta.env.BASE_URL}icons/trolley.png" alt="" /><i class="d late3"></i></span></span>
    <span>Όχημα της πόλης: μπλε το λεωφορείο, πορτοκαλί το τρόλεϊ. Η κουκκίδα στη γωνία του είναι η καθυστέρηση: πράσινη
      στην ώρα του, κίτρινη, πορτοκαλί, κόκκινη όλο και πιο αργά, γκρι χωρίς δρομολόγιο. Πάτα το για να δεις ολόκληρη τη γραμμή του.</span></li>
  <li><span class="s"><span class="bus ontime" style:--c={PALETTE[1].bg} style:--t={PALETTE[1].fg}>550<i class="dir" style="transform: translate(24px, 0) rotate(90deg)"></i></span></span>
    <span>Το βελάκι δείχνει προς πού κινείται. Λείπει όταν το όχημα στέκεται.</span></li>
  <li><span class="s"><span class="age">24″</span></span>
    <span>Πριν από τόσο ήρθε η τελευταία θέση GPS του οχήματος.</span></li>
  <li><span class="s"><span class="bus none stale" style:--c={PALETTE[2].bg} style:--t={PALETTE[2].fg}>2</span></span>
    <span>Αχνό: δεν έστειλε θέση για πάνω από 1½ λεπτό. Η πραγματική θέση του μπορεί να είναι αλλού.</span></li>
  <li><span class="s"><i class="trail"></i></span>
    <span>Μπλε ίχνος: η νέα θέση ήταν πιο μπροστά· το όχημα πήγε ως εκεί και άφησε το δρόμο που έκανε.</span></li>
  <li><span class="s"><i class="trail back"></i></span>
    <span>Γκρι διακεκομμένο ίχνος: η νέα θέση ήταν πιο πίσω. Διόρθωση θέσης, όχι όπισθεν· το όχημα είναι αχνό όσο γυρίζει.</span></li>
  <li><span class="s"><i class="route"></i></span>
    <span>Διαδρομή. Τα βέλη δείχνουν την κατεύθυνση. Πάτα τη για τις στάσεις της.</span></li>
  <li><span class="s"><i class="stop"></i></span>
    <span>Στάση της γραμμής που διάλεξες. Πάτα την για το όνομά της.</span></li>
  <li><span class="s"><span class="ico"><img src="{import.meta.env.BASE_URL}icons/stop.png" alt="" /></span></span>
    <span>Στάση λεωφορείου ή τρόλεϊ (όταν μεγεθύνεις). Πάτα την για τις αφίξεις.</span></li>
  <li><span class="s"><img class="logo" src="{import.meta.env.BASE_URL}icons/metro-logo.svg" alt="" /><span class="disc" style:background="#e30613"><img src="{import.meta.env.BASE_URL}icons/glyph-metro.png" alt="" /></span><img class="logo tram" src="{import.meta.env.BASE_URL}icons/tram-logo.svg" alt="" /></span>
    <span>Σταθμός μετρό ή ΗΣΑΠ, συρμός στο χρώμα της γραμμής του, στάση τραμ, με τα σήματά τους. Πάτα τον για τις γραμμές του.</span></li>
  <li><span class="s"><span class="me"><b></b></span></span>
    <span>Η θέση σου, από το κουμπί του στόχου στον χάρτη.</span></li>
  <li><span class="s"><span class="three">3D</span></span>
    <span>Κτίρια, δέντρα και λεωφορεία σε τρεις διαστάσεις. Στην κάρτα ενός λεωφορείου, «Ακολούθησε σε 3D» και η κάμερα
      πάει πίσω του· ό,τι έχει ήδη περάσει από τη διαδρομή του σβήνει. Σύρε τον χάρτη για να σταματήσεις.</span></li>
  <li><span class="s"><i class="empty">×</i></span>
    <span>Πάτα σε κενό σημείο του χάρτη για να ξαναδείς όλα τα οχήματα.</span></li>
</ul>

<style>
  .ico { position: relative; display: inline-block; flex: none; width: 22px; height: 22px; }
  .ico + .ico { margin-left: 4px; }
  .ico img { display: block; width: 22px; height: 22px; }
  .ico .d { position: absolute; top: -3px; right: -3px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--surface);
    background: var(--d); box-sizing: border-box; }
  .disc { display: inline-grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .15); box-sizing: border-box; }
  .logo + .disc { margin-left: 4px; }
  .logo { display: block; flex: none; width: 24px; height: 24px; }
  .disc + .logo { margin-left: 4px; }
  .logo.tram { width: 18px; height: 26px; object-fit: contain; }
  .disc img { display: block; width: 26px; height: 26px; }
  .three { display: inline-flex; align-items: center; justify-content: center; height: 22px; padding: 0 6px; border-radius: 7px;
    background: var(--accent-bg); color: var(--accent); font-size: 11px; font-weight: 700; line-height: 1; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 56px 1fr; align-items: center; gap: 10px; min-height: 40px; padding: 4px 0; }
  li + li { border-top: 1px solid var(--border); }
  .s { display: flex; align-items: center; justify-content: center; gap: 4px; pointer-events: none; }
  .age { padding: 0 4px; border-radius: 6px; background: var(--control); font: 600 10px/16px var(--font);
    font-variant-numeric: tabular-nums; }
  .trail { display: block; width: 40px; height: 8px; border-radius: 4px; background: var(--accent); opacity: .55; }
  .trail.back { height: 0; border-radius: 0; background: none; border-top: 3px dashed #80868b; opacity: .9; }
  .route { display: block; width: 40px; height: 4px; border-radius: 2px; background: #c2185b; opacity: .8; }
  .stop { display: block; width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px solid #c2185b; }
  .empty { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 1px dashed var(--muted);
    color: var(--muted); font-style: normal; }
  .me { transform: scale(.8); }
</style>
