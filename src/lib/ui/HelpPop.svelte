<script lang="ts">
  // What each symbol on the map shows and what a tap on it does. Static: the samples are drawn like the real
  // ones (the vehicle classes are in app.css) and are not interactive.
</script>

<ul>
  <li><span class="s"><span class="bus late1">040</span></span>
    <span>Όχημα γραμμής που βλέπεις αναλυτικά. Το χρώμα είναι η καθυστέρηση. Πάτα το για τις λεπτομέρειες και τη διαδρομή του.</span></li>
  <li><span class="s"><i class="dot ontime"></i><i class="dot late2"></i></span>
    <span>Όχημα της πόλης, με «Όλα τα λεωφορεία» ανοιχτό. Πάτα το για να δεις ολόκληρη τη γραμμή του.</span></li>
  <li><span class="s"><span class="bus ontime">550<i class="dir" style="transform: translate(24px, 0) rotate(90deg)"></i></span></span>
    <span>Το βελάκι δείχνει προς πού κινείται. Λείπει όταν το όχημα στέκεται.</span></li>
  <li><span class="s"><span class="age">24″</span></span>
    <span>Πριν από τόσο ήρθε η τελευταία θέση GPS του οχήματος.</span></li>
  <li><span class="s"><span class="bus none stale">2</span></span>
    <span>Αχνό: δεν έστειλε θέση για πάνω από 1½ λεπτό. Η πραγματική θέση του μπορεί να είναι αλλού.</span></li>
  <li><span class="s"><i class="trail"></i></span>
    <span>Μπλε ίχνος: το όχημα πήγε σε νέα θέση και άφησε το δρόμο που έκανε.</span></li>
  <li><span class="s"><i class="route"></i></span>
    <span>Διαδρομή. Τα βέλη δείχνουν την κατεύθυνση. Πάτα τη για τις στάσεις της.</span></li>
  <li><span class="s"><i class="stop"></i></span>
    <span>Στάση της γραμμής που διάλεξες. Πάτα την για το όνομά της.</span></li>
  <li><span class="s"><i class="station"></i></span>
    <span>Σταθμός μετρό, ΗΣΑΠ ή τραμ. Πάτα τον για τις γραμμές του.</span></li>
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
  .dot { display: block; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .15); }
  .age { padding: 0 4px; border-radius: 6px; background: var(--control); font: 600 10px/16px system-ui, sans-serif;
    font-variant-numeric: tabular-nums; }
  .trail { display: block; width: 40px; height: 8px; border-radius: 4px; background: var(--accent); opacity: .55; }
  .route { display: block; width: 40px; height: 4px; border-radius: 2px; background: #c2185b; opacity: .8; }
  .stop { display: block; width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px solid #c2185b; }
  .station { display: block; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 2px solid #e30613; }
  .empty { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 1px dashed var(--muted);
    color: var(--muted); font-style: normal; }
  .me { transform: scale(.8); }
</style>
