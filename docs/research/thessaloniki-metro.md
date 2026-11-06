# Μετρό Θεσσαλονίκης στον χάρτη staseis.gr

Έρευνα 2026-11-06. Συνέχεια του `thessaloniki.md` (§0.3, §1.3) και του rt#91. Πρόταση μόνο· δεν άλλαξε κώδικας.

## Σύνοψη

- Σήμερα λειτουργεί **μία γραμμή (M1) με 18 σταθμούς**: κορμός Νέος Σιδ. Σταθμός–25ης Μαρτίου (11), κλάδος Νέας Ελβετίας (2, από 11/2024), κλάδος Καλαμαριάς ως Μίκρα (5, από 27/08/2026). Δύο κλάδοι, ένα κέντρο ελέγχου· 2 στους 3 συρμούς πάνε Μίκρα.
- **Δεν υπάρχει GTFS ούτε live πηγή** για το μετρό. Το GTFS του ΟΣΕΘ (data.gov.gr) έχει 386 routes, όλα `route_type=3` (λεωφορεία). Τίποτα σε Mobility Database ή data.gov.gr. Η thessmetro.gr δεν έχει app, live αφίξεις ή open data.
- **Γεωμετρία υπάρχει, και καλή**: (α) νέο dataset της Ελληνικό Μετρό στο data.gov.gr (GeoJSON σταθμοί + άξονας γραμμών, ενημέρωση 2026-11-06)· (β) OSM: 4 route relations `route=subway` (2 κατευθύνσεις × 2 κλάδοι) με όλους τους σταθμούς.
- **Ωράριο**: επίσημος πίνακας συχνοτήτων στη thessmetro.gr (05:15–00:30 Κυρ–Πέμ, 05:15–02:00 Παρ–Σάβ· κορμός 2:55 στην αιχμή). Οι συχνότητες των κλάδων «αθροίζονται» ακριβώς στη συχνότητα του κορμού, άρα ο πίνακας είναι συνεπής.
- **Πρόταση**: ένας generator στο rt γράφει ένα συνθετικό GTFS με το ίδιο σχήμα που διαβάζει ήδη ο `ParseSTASY` (ρητά trips, όχι `frequencies.txt`). Μετά ο υπάρχων `stasyAdapter` και τα `/v1/rail/stasy/*`, `/v2/vehicles/rail` δουλεύουν χωρίς αλλαγή. Στο web: metro.json ανά πόλη και η ετικέτα «Προγραμματισμένα · όχι live».

## Τι λειτουργεί σήμερα

Γραμμή M1 (η thessmetro.gr τη λέει «Thessaloniki Metro Stations (M1)», 18 σταθμοί). Κατάσταση στις 2026-11-06: «The services are running normally along the entire length of the Line 1» ([thessmetro.gr](https://www.thessmetro.gr/en/)).

- **Βασική γραμμή**: 13 σταθμοί, Νέος Σιδ. Σταθμός–Νέα Ελβετία. Εγκαίνια 30/11/2024 ([tanea.gr](https://www.tanea.gr/2024/11/30/greece/plithos-kosmou-sto-metro-tis-thessalonikis-ola-osa-eginan-sta-egkainia/)). Το dataset της Ελληνικό Μετρό δίνει `MONTH=11, YEAR=2024` σε αυτούς τους σταθμούς.
- **Κλάδος Καλαμαριάς**: 5 σταθμοί (Νομαρχία, Καλαμαριά, Αρετσού, Νέα Κρήνη, Μίκρα). Εγκαίνια 27/08/2026 ([emetro.gr δελτίο](https://www.emetro.gr/?p=36068)). Επιβάτες από τις 15:00 της ίδιας μέρας ([gocar](https://www.gocar.gr/news/feed/54662,Metro_8essalonikhs_Ti_wra_einai_egkainia.html)). Το dataset δίνει `MONTH=8, YEAR=2026`.
- Η γραμμή έκλεισε 29/05–19/06/2026 για τις δοκιμές ένταξης του κλάδου ([emetro.gr](https://www.emetro.gr/?p=35610)). Τέτοια κλεισίματα θα ξαναγίνουν (π.χ. επεκτάσεις).
- Στο OSM φαίνονται ως `proposed` οι μελλοντικοί σταθμοί (Αεροδρόμιο, Μενεμένη κ.λπ.). Δεν τους δείχνουμε.

Σταθμοί (συντεταγμένες από το GeoJSON της Ελληνικό Μετρό· διαφέρουν από το OSM λιγότερο από ~10 m στους σταθμούς που ελέγχθηκαν). `LINE`: 12 = κορμός, 1 = κλάδος Ν. Ελβετίας, 2 = κλάδος Καλαμαριάς.

| Σταθμός | EN | LINE | lat, lon | Άνοιξε |
|---|---|---|---|---|
| ΝΕΟΣ ΣΙΔ. ΣΤΑΘΜΟΣ | NEW RAILWAY STATION | 12 | 40.64393, 22.92876 | 11/2024 |
| ΔΗΜΟΚΡΑΤΙΑΣ | DIMOKRATIAS | 12 | 40.64089, 22.93446 | 11/2024 |
| ΒΕΝΙΖΕΛΟΥ | VENIZELOU | 12 | 40.63694, 22.94212 | 11/2024 |
| ΑΓΙΑΣ ΣΟΦΙΑΣ | AGIAS SOFIAS | 12 | 40.63467, 22.94649 | 11/2024 |
| ΣΙΝΤΡΙΒΑΝΙ | SINTRIVANI | 12 | 40.63079, 22.95420 | 11/2024 |
| ΠΑΝΕΠΙΣΤΗΜΙΟ | PANEPISTIMIO | 12 | 40.62623, 22.96057 | 11/2024 |
| ΠΑΠΑΦΗ | PAPAFI | 12 | 40.61968, 22.96304 | 11/2024 |
| ΕΥΚΛΕΙΔΗΣ | EFKLEIDIS | 12 | 40.61569, 22.96044 | 11/2024 |
| ΦΛΕΜΙΝΓΚ | FLEMING | 12 | 40.61191, 22.95737 | 11/2024 |
| ΑΝΑΛΗΨΗ | ANALIPSI | 12 | 40.60565, 22.95803 | 11/2024 |
| 25ης ΜΑΡΤΙΟΥ | 25 MARTIOU | 12 | 40.60117, 22.95858 | 11/2024 |
| ΒΟΥΛΓΑΡΗ | VOULGARI | 1 | 40.59499, 22.96067 | 11/2024 |
| ΝΕΑ ΕΛΒΕΤΙΑ | NEA ELVETIA | 1 | 40.59328, 22.96936 | 11/2024 |
| ΝΟΜΑΡΧΙΑ | NOMARCHIA | 2 | 40.59158, 22.95711 | 08/2026 |
| ΚΑΛΑΜΑΡΙΑ | KALAMARIA | 2 | 40.58469, 22.95309 | 08/2026 |
| ΑΡΕΤΣΟΥ | ARETSOU | 2 | 40.57836, 22.95446 | 08/2026 |
| ΝΕΑ ΚΡΗΝΗ | NEA KRINI | 2 | 40.57204, 22.96123 | 08/2026 |
| ΜΙΚΡΑ | MIKRA | 2 | 40.56805, 22.96616 | 08/2026 |

Μήκη από το GeoJSON (άθροισμα `SHAPE_Length` των τμημάτων): κορμός 6,39 km, κορμός + Μίκρα ≈ 10,70 km, κορμός + Ν. Ελβετία ≈ 8,0 km. Το τμήμα 25ης Μαρτίου–Βούλγαρη έχει δύο one-way άξονες (ID 11, 12)· μέτρησα τον μέσο όρο.

## Πηγές δεδομένων

### GTFS (στατικό)

- **ΟΣΕΘ GTFS** (data.gov.gr, slice `517f491b`, 27/10–15/11, τοπικά στο `~/.local/state/atrt-thess/`): 386 routes, `route_type` όλα `3`, agency μόνο `OSETH`. Μετρό δεν υπάρχει. Υπάρχουν όμως λεωφορεία-τροφοδότες με «ΣΤΑΘΜΟΣ ΜΕΤΡΟ» στο όνομα (02Μ, 03Χ, 04A, 06Α, 06Β, 10, 11T, 58Μ, 66). Ελέγχθηκε με `unzip -p … routes.txt`.
- **data.gov.gr CKAN** (`package_search?q=metro|μετρό|gtfs`, 2026-11-06): GTFS μόνο για ΟΑΣΘ/ΟΣΕΘ και ΟΑΣΑ/ΣΤΑΣΥ. Για το μετρό Θεσσαλονίκης υπάρχουν μόνο γεωχωρικά datasets (βλ. παρακάτω).
- **Mobility Database** (catalog CSV, 2026-11-06): για Ελλάδα μόνο ΟΑΣΑ (λεωφορεία, ράγα) και ένα ανενεργό TRAINOSE. Τίποτα για μετρό Θεσσαλονίκης.
- **Transitland**: το API ζητά κλειδί (HTTP 401)· δεν ελέγχθηκε. Το `thessaloniki.md` §0.3 το είχε ελέγξει χωρίς εύρημα (2026-11-05).
- **thessmetro.gr** (ΘΕΜΑ / Thessaloniki Metro Automatic): ούτε GTFS ούτε σελίδα open data ([thessmetro.gr](https://www.thessmetro.gr/en/)).
- Ρεπορτάζ 2025 λέει ότι η ΘΕΜΑ πρέπει να δώσει GTFS χωριστά στη Google· δεν βρέθηκε ότι έγινε ([parallaxi](https://parallaximag.gr/thessaloniki-news/metro-thessalonikis-6-mines-meta-se-anamoni-gia-dyo-vasikes-ekkremotites), από το `thessaloniki.md`). **ΑΝΕΠΙΒΕΒΑΙΩΤΟ** αν η Google δείχνει σήμερα δρομολόγια μετρό.

### Live

- Καμία δημόσια live πηγή, κανένα GTFS-RT. Η thessmetro.gr δεν έχει live αφίξεις ούτε journey planner.
- Εφαρμογή: οδηγοί αναφέρουν «app του μετρό» για εισιτήρια ([elxis](https://elxis.com/gr/thessaloniki-metro-the-complete-guide)). **ΑΝΕΠΙΒΕΒΑΙΩΤΟ** αν υπάρχει επίσημη εφαρμογή με αφίξεις. Το σύστημα είναι CBTC, άρα η θέση κάθε συρμού υπάρχει εσωτερικά· δεν δημοσιεύεται.
- Η εφαρμογή OSETH Bus (AMCO) έχει backend για λεωφορεία· δεν ξέρουμε αν δίνει και μετρό (ίδια επιφύλαξη με `thessaloniki.md` §1.2).

### Γεωμετρία

1. **Ελληνικό Μετρό, «Δίκτυο Γραμμών Μετρό Θεσσαλονίκης»** (`diktyo-grammon-metro-thessalonikis`, high value dataset, δημιουργία 2026-11-05, ενημέρωση 2026-11-06): `metro_stations.geojson` (18 σημεία, με ημερομηνία ένταξης) και `metro_lines.geojson` (18 τμήματα centerline, WGS84). Άδεια: **δεν δηλώνεται** (`license_id` κενό)· η περιγραφή γράφει κατά λάθος «Μετρό Αθήνας» και «ενδεικτική» γεωμετρία. [data.gov.gr](https://data.gov.gr/api/3/action/package_show?id=diktyo-grammon-metro-thessalonikis)
2. **Αττικό Μετρό GIS** (`gis-thessaloniki-metro-base`, `…-kalamaria_ext`): shapefile ZIP, άδεια **CC Non-Commercial**. Δεν τα χρειαζόμαστε.
3. **OpenStreetMap** (Overpass, `overpass-api.de`, δεδομένα 2026-11-06T19:40Z):
   - relation 6152448 `Βασική Γραμμή Μετρό (Ν.Σ.Σ. - Νέα Ελβετία)`, ref 1, `#ff0000`, 13 stops, 4 ways
   - relation 7885077 (αντίστροφη), 13 stops, 4 ways
   - relation 7898294 `Γραμμή Μετρό Καλαμαριάς (Ν.Σ.Σ. - Μίκρα)`, ref 2, `#0070ff`, 16 stops, 3 ways
   - relation 7898293 (αντίστροφη), 16 stops, 3 ways
   - όλα `operator=Thessaloniki Metro Automatic`, PTv2. Δεν υπάρχει `route_master` για το μετρό.
   - 18 κόμβοι `railway=station` + `station=subway` με `name` και `name:en`, + 8 `proposed`.
   - Σημείωση: το OSM δίνει ref «1»/«2» και δύο χρώματα, ενώ ο φορέας λέει μία γραμμή M1. Εμείς ακολουθούμε τον φορέα.
   - Ο mirror `overpass.kumi.systems` είχε δεδομένα του 2026-07-24 (πριν τον κλάδο Καλαμαριάς)· χρησιμοποιούμε `overpass-api.de`.

Ερώτημα Overpass που δουλεύει (χρειάζεται `User-Agent`, αλλιώς 406):

```
[out:json][timeout:60];
(relation["route"="subway"](40.5,22.85,40.7,23.1););
out body; >; out skel qt;
```

Πρόταση: γεωμετρία ράγας από το OSM (ODbL, όπως ήδη για την Αθήνα στο `railgeo`). Σταθμοί και ονόματα από το OSM, με διασταύρωση με το GeoJSON της Ελληνικό Μετρό σε test.

## Ωράρια

Πηγή: [thessmetro.gr FAQ](https://www.thessmetro.gr/en/?p=654) και [αρχική](https://www.thessmetro.gr/en/), πρόσβαση 2026-11-06. Η σελίδα δεν έχει ημερομηνία· γράφει ότι το ωράριο «επανέρχεται από 7 Αυγούστου» (χωρίς έτος) και ότι «Train frequencies are adjusted according to passenger demand».

Ώρες: **05:15–00:30 Κυρ–Πέμ, 05:15–02:00 Παρ–Σάβ**. Είναι πρώτη και τελευταία αναχώρηση από τις τρεις αφετηρίες (Ν. Σιδ. Σταθμός, Ν. Ελβετία, Μίκρα).

| Ημέρα | Ώρες | Κορμός | 25ης Μαρτίου–Μίκρα | 25ης Μαρτίου–Ν. Ελβετία |
|---|---|---|---|---|
| Δευ–Πέμ | 05:15–07:30 | 5:00 | 7:30 | 15:00 |
| Δευ–Πέμ | 07:30–00:30 | 2:55 | 4:23 | 8:45 |
| Παρ | 05:15–07:30 | 5:00 | 7:30 | 15:00 |
| Παρ | 07:30–02:00 | 2:55 | 4:23 | 8:45 |
| Σάβ | 05:15–07:30 | 10:00 | 15:00 | 30:00 |
| Σάβ | 07:30–02:00 | 2:55 | 4:23 | 8:45 |
| Κυρ/αργία | 05:15–07:30 | 10:00 | 15:00 | 30:00 |
| Κυρ/αργία | 07:30–00:30 | 3:25 | 5:07 | 10:15 |

Έλεγχος συνέπειας: 1/4:23 + 1/8:45 = 1/2:55· 1/7:30 + 1/15:00 = 1/5:00· 1/5:07 + 1/10:15 = 1/3:25. Άρα ο κορμός είναι ακριβώς η ένωση των δύο κλάδων, με αναλογία 2:1 υπέρ Μίκρας. Αυτό ταιριάζει με το «δύο προς ένα» του [gocar](https://www.gocar.gr/news/feed/54662,Metro_8essalonikhs_Ti_wra_einai_egkainia.html).

Χρόνος διαδρομής:
- Μίκρα–Ν. Σιδ. Σταθμός: περίπου 24–26 λεπτά ([gocar](https://www.gocar.gr/news/feed/54662,Metro_8essalonikhs_Ti_wra_einai_egkainia.html), δημοσιογραφική πηγή). «Περίπου 15 λεπτά από τη Μίκρα μέχρι το κέντρο» ([emetro.gr](https://www.emetro.gr/?p=36068), δήλωση Επιτρόπου).
- Ν. Ελβετία–Ν. Σιδ. Σταθμός: δεν βρέθηκε επίσημο νούμερο. Από την αναλογία μήκους (8,0 / 10,7 km) βγαίνει ~18–20 λεπτά. **ΑΝΕΠΙΒΕΒΑΙΩΤΟ**.
- Χρόνοι ανά διαστάθμιο: δεν δημοσιεύονται. Τους μοιράζουμε ανάλογα με την απόσταση, με στάση ~25 s ανά σταθμό. **ΑΝΕΠΙΒΕΒΑΙΩΤΟ**: θέλει μία μέτρηση σε πραγματική διαδρομή.

## Πώς το κάνει η Αθήνα σήμερα

Backend (`athens-transit-rt`). Οι αριθμοί γραμμής είναι από το checkout `3201d52` (branch `fix/matcher-commit`, 2026-11-06)· στο `main` (`15e9926`) μπορεί να διαφέρουν λίγο.

- `internal/server/city.go:20-22`: το `City.Rail` ανοίγει **μαζί** ΣΤΑΣΥ, Προαστιακό, alerts ΟΑΣΑ και δημοτικά. Η Θεσσαλονίκη (`city.go:34-36`) έχει `Rail: false`.
- `internal/server/app.go:231`: `rail.STASYStore{CatalogURL, Dir: <state>/stasy}`. `app.go:243-244`: οι adapters `stasy` και `proastiakos` μπαίνουν μόνο με `a.rail()`. `app.go:730-731`: το `a.stasy.Run` τρέχει μόνο με `a.rail()`.
- `internal/rail/stasy.go:490-499`: το `STASYStore` φορτώνει τα `.txt` από τον δίσκο (`loadLocal`, `:545`) και ελέγχει το CKAN μία φορά τη μέρα (`:29`, `:31`).
- `internal/rail/stasy.go:706-710` (στο `main`): διαβάζει μόνο `stops`, `routes`, `trips`, `stop_times`, `calendar`, `calendar_dates`. **Όχι `frequencies.txt`**. Άρα κάθε συρμός πρέπει να είναι ρητό trip.
- `internal/rail/stasy_vehicles.go:71-74`: `Vehicles(now)` βρίσκει κάθε trip που τρέχει τώρα και δίνει το ζεύγος `from`/`to` (στάση + ώρα). Κανένα live σήμα.
- `internal/server/v2_stasy.go:19-21`: ο `stasyAdapter` δίνει Arrivals με source timetable και Vehicles ως estimates πάνω στην ράγα του OSM, με knots.
- `internal/railgeo/railgeo.go:22-23`: embed `metro.json` (γραμμές Αθήνας από `scripts/metro-osm.ts` του web). `stasy_stops.json`: ονόματα σταθμών GR/EN.
- Endpoints: `http.go:54-56` `GET /v1/rail/stasy/{departures,vehicles,trips/{id}}`· `v2.go:118` `GET /v2/vehicles/rail` (`v2.go:374`, max-age 15 s).

Σχήμα `/v1/rail/stasy/vehicles` (όπως στο web, `src/lib/trains.ts:13-15`):

```ts
interface StasyPlace { name: string; lat: number; lon: number; at: number }
interface StasyVehicle { trip: string; line: string; route_color: string; headsign: string; from: StasyPlace; to: StasyPlace }
```

Web (`athens-transit-map`):

- `src/lib/trains.ts:1-4, 31-33`: ο χάρτης παίρνει `/v1/rail/stasy/vehicles` + `/v2/vehicles/rail` (knots) και κινεί τον συρμό με δικό του ρολόι.
- `src/lib/state.svelte.ts:747-760`: poll κάθε 15 s όσο το `trainsOn` είναι ενεργό.
- `src/lib/metro.ts:1, 34`: στατικό layer γραμμών και σταθμών από `public/metro.json` (`{source, lines[{id,name,color,paths}], stations[{name,lat,lon,lines}]}`).
- `src/lib/v2.ts:137-139`: ένα όχημα με `position.kind === "estimate"` δείχνει ήδη «πρόγραμμα» αντί για ηλικία GPS.
- `src/lib/legacy.ts:20, 44-54`: τα ids είναι σκληρά στο namespace `stasy` (`stasy:M1`, `stasy:<σταθμός>-metro`).
- Δημοτικά ως «προγραμματισμένα»: `src/lib/ui/MuniLineCard.svelte:83` («Προγραμματισμένα · όχι live») και `src/lib/ui/MuniStopCard.svelte:76`. Πλαίσιο στο `docs/research/municipal-timetables.md`.
- `src/lib/cities.ts:18-19`: Θεσσαλονίκη `ready: false`, hint «ΟΑΣΘ · σύντομα».

## Πρόταση για Θεσσαλονίκη

Αρχή: ο backend βγάζει **ένα συνθετικό GTFS με το σχήμα ΣΤΑΣΥ**, ώστε όλος ο υπάρχων κώδικας (adapter, endpoints, client) να δουλεύει όπως είναι. Ό,τι βγαίνει από αυτό είναι «προγραμματισμένο», ποτέ live.

### Βήματα

1. **Πίνακας-πηγή σε Go** (`internal/rail/thessmetro.go`, νέο): σταθμοί (όνομα GR/EN, lat/lon από OSM), οι δύο κλάδοι, ο πίνακας συχνοτήτων πάνω, ώρες λειτουργίας, χρόνοι διαστάθμων. Ένα test «κλειδώνει» τον πίνακα, ώστε μια αλλαγή στη thessmetro.gr να είναι αλλαγή μιας γραμμής.
2. **Generator** (`atrt metro-thess` ή συνάρτηση που τρέχει στην εκκίνηση): γράφει `<state>/stasy/{routes,stops,trips,stop_times,calendar,calendar_dates}.txt`.
   - Μία route `M1` (ο φορέας λέει μία γραμμή), χρώμα του φορέα (**ΑΝΕΠΙΒΕΒΑΙΩΤΟ** το hex· το OSM έχει `#ff0000`).
   - Δύο μοτίβα ανά κατεύθυνση: Ν.Σ.Σ.↔Μίκρα (16 στάσεις) και Ν.Σ.Σ.↔Ν. Ελβετία (13 στάσεις). Headsign = τερματικός.
   - **Συρμοί από τη συχνότητα**: για κάθε ζώνη ώρας, αναχωρήσεις από την αφετηρία ανά headway του κλάδου. Η Ν. Ελβετία μετατοπίζεται ώστε στον κορμό να βγαίνει μοτίβο Μ-Μ-Ε με σταθερό 2:55. Τελευταία αναχώρηση 00:30 ή 02:00 (ως `24:30`/`26:00` της ίδιας μέρας λειτουργίας, όπως ήδη τα διαβάζει το `serviceDays`, `stasy_vehicles.go:55`).
   - Χρόνοι: ανάλογα με την απόσταση πάνω στη ράγα, με στάση ~25 s, βαθμονομημένα ώστε Μίκρα–Ν.Σ.Σ. = 25 λεπτά.
   - Ημερολόγιο: τέσσερα service ids (Δευ–Πέμ, Παρ, Σάβ, Κυρ). Οι αργίες παίρνουν το service της Κυριακής μέσω `calendar_dates` (λίστα ελληνικών αργιών, μαζί με τις κινητές).
   - Περίπου 380 trips τη μέρα Δευ–Πέμ ανά κατεύθυνση. Μικρό αρχείο.
3. **City**: χωρίζουμε το `Rail` σε δύο πεδία, π.χ. `Metro MetroSource` (`"stasy-ckan"` | `"thess-synthetic"` | `""`) και `AthensExtras bool` (Προαστιακός, alerts, δημοτικά). Αλλαγές στο `city.go:20-36` και στα `app.go:231, 243, 730`. Με `thess-synthetic` το `STASYStore` δεν ρωτά CKAN· φορτώνει μόνο τοπικά (`CatalogURL == ""` → μόνο `loadLocal`, ή ο generator γράφει πριν το `Run`).
4. **Namespace**: κρατάμε `stasy` στην instance της Θεσσαλονίκης. Κάθε πόλη είναι χωριστή υπηρεσία, άρα δεν υπάρχει σύγκρουση id, και το web (`legacy.ts`) δεν αλλάζει. Trade-off: το όνομα «stasy» είναι λάθος για τη Θεσσαλονίκη. Εναλλακτικά νέο namespace `thema`, με αλλαγές στο `legacy.ts` και στα favs.
5. **Ράγα για τα knots**: το `railgeo` ενσωματώνει μόνο το `metro.json` της Αθήνας. Χρειάζεται `metro-thessaloniki.json` (από τις 4 relations του OSM, με το `scripts/metro-osm.ts` με bbox Θεσσαλονίκης) και επιλογή ανά πόλη στο `railgeo.go`. Ονόματα σταθμών στο `stasy_stops.json` ή σε δεύτερο αρχείο ανά πόλη.
6. **Πεδίο στο API**: κάθε departure και όχημα έχει ήδη `source: timetable` / `position.kind: "estimate"`. Δεν χρειάζεται νέο πεδίο.
7. **Web**:
   - `public/metro-thessaloniki.json` (ίδιο σχήμα με `metro.json`)· το `metro.ts:34` φορτώνει το αρχείο της πόλης.
   - `cities.ts:18-19`: hint «ΟΑΣΘ · Μετρό», όταν η πόλη γίνει `ready`.
   - Κάρτα γραμμής και σταθμού μετρό: η ίδια ετικέτα με τα δημοτικά, «Προγραμματισμένα · όχι live» (όπως `MuniLineCard.svelte:83`). Το «πρόγραμμα» στο όχημα υπάρχει ήδη (`v2.ts:139`).
   - Στη Θεσσαλονίκη κρύβουμε τα chips τραμ και Προαστιακού (δεν υπάρχουν).
8. **Tests**: (α) ο πίνακας συχνοτήτων ως fixture· (β) Δευτέρα 08:00 → ~5 συρμοί στον κορμό ανά κατεύθυνση (~15 λεπτά διαδρομή / 2:55), 2:1 Μίκρα/Ελβετία· (γ) Σάββατο 01:30 υπάρχουν συρμοί, Κυριακή 01:30 όχι· (δ) αργία = Κυριακή· (ε) σταθμοί OSM και GeoJSON Ελληνικό Μετρό απέχουν < 50 m.

### Αρχεία που αλλάζουν

| Repo | Αρχείο | Αλλαγή |
|---|---|---|
| rt | `internal/rail/thessmetro.go` (+`_test.go`) | νέο: πίνακας + generator |
| rt | `internal/server/city.go` | `Rail` → `Metro` + `AthensExtras` |
| rt | `internal/server/app.go` (231, 243, 730) | επιλογή πηγής μετρό ανά πόλη |
| rt | `internal/rail/stasy.go` | `STASYStore` μόνο τοπικά όταν δεν έχει catalog |
| rt | `internal/railgeo/railgeo.go` + `metro-thessaloniki.json` | ράγα και σταθμοί ανά πόλη |
| rt | `cmd/atrt` | υποεντολή `metro-thess` (αν γίνει CLI) |
| web | `scripts/metro-osm.ts` | bbox/relations ανά πόλη |
| web | `public/metro-thessaloniki.json` | νέο |
| web | `src/lib/metro.ts`, `src/lib/cities.ts` | αρχείο ανά πόλη, hint |
| web | κάρτες γραμμής/σταθμού μετρό | ετικέτα «Προγραμματισμένα · όχι live» |

Σειρά: πρώτα rt (issue rt#91, PR, review). Μετά web (web#40, αφού γίνει deploy η instance Θεσσαλονίκης, rt#90).

## Ρίσκα & ανοιχτά

- **Οι θέσεις των συρμών είναι επινόηση.** Η πραγματική συχνότητα αλλάζει «ανάλογα με τη ζήτηση». Η ετικέτα πρέπει να φαίνεται σε κάθε κάρτα. Ίσως οι συρμοί στον χάρτη να είναι αχνοί ή να φαίνονται μόνο όταν ανοίγει η γραμμή (απόφαση προϊόντος για τον Harold).
- **Η σελίδα της thessmetro.gr δεν έχει ημερομηνία.** Χρειάζεται εβδομαδιαίος έλεγχος (όπως ο έλεγχος πηγών των δημοτικών, `scripts/municipal-watch.ts`) που ειδοποιεί όταν αλλάξει ο πίνακας.
- **Διακοπές λειτουργίας** (π.χ. 29/05–19/06/2026) δεν φαίνονται σε κανένα feed. Το πρόγραμμα θα δείχνει συρμούς που δεν υπάρχουν. Χρειάζεται χειροκίνητο «κλειστό» flag ή ανάγνωση της κατάστασης από την αρχική της thessmetro.gr.
- **Χρόνοι διαστάθμων και Ν. Ελβετία–Ν.Σ.Σ.**: **ΑΝΕΠΙΒΕΒΑΙΩΤΑ**. Μία πραγματική διαδρομή με χρονόμετρο λύνει το θέμα.
- **Χρώμα και όνομα γραμμής**: ο φορέας λέει M1· το OSM δίνει δύο refs και δύο χρώματα. Επιλέγουμε M1 + ένα χρώμα· το hex θέλει έλεγχο στον επίσημο χάρτη.
- **Άδειες**: GeoJSON Ελληνικό Μετρό χωρίς δηλωμένη άδεια, Αττικό Μετρό GIS CC-NC. Παίρνουμε τη γεωμετρία από το OSM (ODbL, με απόδοση) και τα άλλα μόνο για έλεγχο.
- **Μέρα λειτουργίας μετά τα μεσάνυχτα** (Παρ/Σάβ ως 02:00): στηρίζεται στο υπάρχον `serviceDays` (σήμερα + χθες). Θέλει test στο όριο, και γύρω από την αλλαγή ώρας.
- **Live στο μέλλον**: αν η ΘΕΜΑ δώσει GTFS (π.χ. για Google), ο generator αντικαθίσταται από CKAN/URL χωρίς αλλαγή στο web. Αν δώσει GTFS-RT, χρειάζεται νέος adapter.
- **Ανοιχτό για τον Harold**: πριν ή μετά το deploy της instance Θεσσαλονίκης (rt#90); Namespace `stasy` (μηδέν αλλαγές στο web) ή `thema` (σωστό όνομα, περισσότερη δουλειά);

## Πηγές

Όλες με πρόσβαση 2026-11-06.

- thessmetro.gr, αρχική (ώρες, 18 σταθμοί M1, κατάσταση): https://www.thessmetro.gr/en/
- thessmetro.gr, FAQ (πίνακας συχνοτήτων): https://www.thessmetro.gr/en/?p=654
- emetro.gr, εγκαίνια επέκτασης Καλαμαριάς (27/08/2026): https://www.emetro.gr/?p=36068
- emetro.gr, προσωρινή διακοπή 29/05–19/06/2026: https://www.emetro.gr/?p=35610
- data.gov.gr, Δίκτυο Γραμμών Μετρό Θεσσαλονίκης (Ελληνικό Μετρό): https://data.gov.gr/api/3/action/package_show?id=diktyo-grammon-metro-thessalonikis
  - σταθμοί: https://data.gov.gr/dataset/e6e6578e-d798-47e4-9e52-54f78d6672cf/resource/36101544-f491-433a-be63-eb96908e8cca/download/metro_stations.geojson
  - γραμμές: https://data.gov.gr/dataset/e6e6578e-d798-47e4-9e52-54f78d6672cf/resource/e41e7ff8-78eb-4194-a4ca-36aaea41129b/download/metro_lines.geojson
- data.gov.gr, GIS Thessaloniki Metro Base / Kalamaria_ext (Αττικό Μετρό, CC-NC): https://data.gov.gr/api/3/action/package_show?id=gis-thessaloniki-metro-base
- data.gov.gr, CKAN search: https://data.gov.gr/api/3/action/package_search?q=gtfs
- OSETH GTFS slice 517f491b (ελέγχθηκε τοπικά): https://data.gov.gr/api/3/action/package_show?id=42c9a7da-c86c-48b1-914c-f340e8bef00d
- Mobility Database catalog: https://bit.ly/catalogs-csv
- OpenStreetMap relations: https://www.openstreetmap.org/relation/6152448, https://www.openstreetmap.org/relation/7885077, https://www.openstreetmap.org/relation/7898293, https://www.openstreetmap.org/relation/7898294
- gocar.gr, 26/08/2026 (2:1, 24–26 λεπτά, 15:00): https://www.gocar.gr/news/feed/54662,Metro_8essalonikhs_Ti_wra_einai_egkainia.html
- tanea.gr, εγκαίνια 30/11/2024: https://www.tanea.gr/2024/11/30/greece/plithos-kosmou-sto-metro-tis-thessalonikis-ola-osa-eginan-sta-egkainia/
- elxis.com, οδηγός (app εισιτηρίων, ΑΝΕΠΙΒΕΒΑΙΩΤΟ): https://elxis.com/gr/thessaloniki-metro-the-complete-guide
- parallaximag.gr (GTFS προς Google, 2025): https://parallaximag.gr/thessaloniki-news/metro-thessalonikis-6-mines-meta-se-anamoni-gia-dyo-vasikes-ekkremotites
