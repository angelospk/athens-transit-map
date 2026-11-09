#!/usr/bin/env python3
"""The accents the stop and line names lack: OASA (and the other feeds) write them in capitals with no accents
(«ΑΓΙΑΣ ΤΡΙΑΔΟΣ»); shown as names they read «Αγιας Τριαδος». For every word of the names in public/*.json this
finds its accented spelling in a Greek word list with frequencies (the most used spelling of the same letters wins)
and writes those that need an accent to src/lib/accents.json, one accented word each, lower case
(nearby.ts titleCase puts them back).

The word lists: hermitdave/FrequencyWords, content/2018/el/el_full.txt (MIT; "word count" per line), and for the
names it lacks (Παπάγου, Κορωπί, Καισαριανή) the Greek spelling dictionary of LibreOffice, npm dictionary-el
(index.dic, one word per line; a word with two spellings of the same letters there is left out):
  curl -o /tmp/el_full.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/el/el_full.txt
  npm pack dictionary-el && tar xzf dictionary-el-*.tgz
  python3 scripts/accents.py /tmp/el_full.txt package/index.dic
"""
import glob
import json
import re
import sys
import unicodedata

def fold(w: str) -> str:
    """Lower case, no accents or diaeresis, final sigma as sigma: the key both spellings share."""
    w = unicodedata.normalize("NFD", w.lower())
    w = "".join(c for c in w if unicodedata.category(c) != "Mn")
    return w.replace("ς", "σ")

def has_accent(w: str) -> bool:
    return any(unicodedata.category(c) == "Mn" for c in unicodedata.normalize("NFD", w))

EXTRA = ["υμηττός", "υμηττού", "καισαριανή", "καισαριανής", "αερολιμένας", "αερολιμένα", "κάντζας", "κάντζα", "ελληνικό", "ελληνικού",
         "ανθούπολη", "ανθούπολης", "ασκληπιείο", "πικροδάφνη", "τερψιθέα", "τερψιθέας", "ηλιούπολη", "ηλιουπόλεως", "βύρωνας", "βύρωνα",
         "περιστέρι", "περιστερίου", "αιγάλεω", "χαϊδάρι", "χαϊδαρίου", "κερατσίνι", "κερατσινίου", "νίκαια", "νικαίας", "δραπετσώνα",
         "δραπετσώνας", "ζωγράφου", "γαλάτσι", "γαλατσίου", "βριλήσσια", "βριλησσίων", "χαλάνδρι", "χαλανδρίου", "μαρούσι", "αμαρουσίου",
         # Athens stop names the lists lack, most frequent first (trips.json, 2026-11-09)
         "αργυρουπόλεως", "αργυρούπολης", "θρακομακεδόνων", "πάρνηθος", "καρέα", "αμφιθέας", "καλλισίων", "σαλαμίνος", "χίου",
         "ζωφριάς", "μεσονυχίου", "λάκας", "νεκτάριος", "νεκταρίου", "περικλέους", "μπουμπουλίνας", "μαγούλας", "καλογρέζας",
         "καλογρέζα", "βαρυμπόμπης", "γλυκερίας", "χαράλαμπος", "ακροπόλεως", "χειμάρας", "υψηλάντου", "βούτζας",
         "αποστολοπούλου", "νερατζιώτισσα", "ζηρίνειο", "μελετίου", "δεκελείας", "κοκκιναρά", "ριζουπόλεως", "αμφιάλης",
         "παλάσκα", "θρασυβούλου", "τρικάλων", "αλαμάνας", "γράμμου", "φυστικιές", "πολυδενδρίου", "βώκου", "ναυαρίνου",
         "βρυούλων", "τζαβέλλα", "παπαστράτου", "κουντουριώτου", "παπανικολή", "ροδοπόλεως", "πανιωνίου", "αριστογείτονος",
         "τριπτολέμου", "προύσσης", "στουρνάρη", "κονίτσης", "παλαιοπαναγιάς", "μεθενίτη", "ορφέως", "σισμανογλείου",
         "καναπίτσας", "χρυσουπόλεως", "τζαβερδέλλα", "θριασίου", "καλλιδρομίου", "λασκάρεως", "πύθωνος", "ελληνορώσων",
         "καλλιφρονά", "κέκροπος", "άθωνος", "γουδή", "παναγούλη", "θάσου", "ησιόδου", "βραυρώνας", "αρίωνος",
         "φραγκοκκλησιάς", "γοργοποτάμου", "κρυστάλλη", "φίλωνος", "πειραιά"]
GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]+")

def words_of(path: str) -> set[str]:
    text = open(path, encoding="utf-8").read()
    # Words in capitals of two letters or more: those titleCase turns into names.
    return {w for w in GREEK.findall(text) if len(w) > 1 and w == w.upper()}

def main() -> None:
    freq_path = sys.argv[1]
    wanted: dict[str, None] = {}
    for p in sorted(glob.glob("public/*.json")):
        for w in words_of(p):
            wanted[fold(w)] = None
    best: dict[str, tuple[int, str]] = {}
    for line in open(freq_path, encoding="utf-8"):
        parts = line.split()
        if len(parts) != 2 or not parts[1].isdigit():
            continue
        w, n = parts[0], int(parts[1])
        if not GREEK.fullmatch(w):
            continue
        k = fold(w)
        if k not in wanted:
            continue
        if k not in best or n > best[k][0]:
            best[k] = (n, w.lower())
    if len(sys.argv) > 2:
        spell: dict[str, set[str]] = {}
        for line in open(sys.argv[2], encoding="utf-8"):
            w = line.strip().split("/")[0]
            if not w or not GREEK.fullmatch(w):
                continue
            k = fold(w)
            if k in wanted and k not in best:
                spell.setdefault(k, set()).add(w.lower())
        for k, ws in spell.items():
            if len(ws) == 1:
                best[k] = (0, next(iter(ws)))
    # Names of the city both lists lack, spelled by hand.
    for w in EXTRA:
        if fold(w) in wanted:
            best[fold(w)] = (1 << 40, w)
    # Only the words whose most used spelling has an accent (a monosyllable has none to give).
    out = sorted({w for _, w in best.values() if has_accent(w)}, key=fold)
    json.dump(out, open("src/lib/accents.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(wanted)} words in the names, {len(out)} with an accent", file=sys.stderr)

if __name__ == "__main__":
    main()
