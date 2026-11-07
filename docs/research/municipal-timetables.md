# Municipal bus timetables (2026-11-05)

Follow-up to rt#59 (`docs/research/municipal-buses.md` in athens-transit-rt): the «Δημοτικά» layer
shows 37 OSM routes of 12 municipalities with no times. This note lists where each municipality
publishes its timetable and how hard it is to transcribe. Checked by opening the pages, except
where marked UNVERIFIED. No municipality publishes GTFS or any open data; no Moovit or Google
Transit listing; OASA telematics does not carry these lines.

| Municipality | Source | Format | Date claimed | Granularity | Days | Lines / trips |
|---|---|---|---|---|---|---|
| Αγ. Δημητρίου | dad.gr/environment/perivallon/dimotiki-sygkoinonia/ → `wp-content/uploads/2025/11/ΔΗΜΟΤΙΚΗ-ΣΥΓΚΟΙΝΩΝΙΑ-ΣΤΑΣΕΙΣ-ΑΝΑΛΥΤΙΚΑ.xlsx` | XLSX, real times, sheets «ΓΡΑΜΜΗ Α», «ΓΡΑΜΜΗ Β» | September 2025 | every stop (A1-A32, Β1-Β29) | not stated | 2 lines, ~10 trips (07:30…17:30); page: line A 12:30 not run |
| Αμαρουσίου | maroussi.gr/dimotes/dimotiki-sygkoinonia/ → `wp-content/uploads/2024/05/ΓΡΑΜΜΗ_10.pdf`, `_20`, `_30`, `2026/01/ΓΡΑΜΜΗ_402026.pdf`, `2026/02/ΓΡΑΜΜΗ_80.pdf`, `2024/05/ΓΡΑΜΜΗ-ΗΣΑΠ-ΝΕΡΑΝΤΙΩΤΙΣΣΑ-ΚΗΦΙΣΙΑΣ.pdf` | PDF with text layer (line 10 checked) | line 10: 20/05/2025 | every stop | weekdays + Saturday (line 10) | page lists 6 lines (OSM has 12 relations); line 10: 12 weekday, 6 Saturday trips per direction |
| Παπάγου-Χολαργού | dpapxol.gov.gr/dimotiki-sigkoinwnia/ → `wp-content/uploads/2025/11/1.pdf`, `2.pdf` | PDF with text layer + HTML | 2025/11 upload | every stop (PDF) | circular Mon-Fri; cemetery Mon-Sat | 3-4 lines, 12-16 trips |
| Νέας Ιωνίας | neaionia.gr/sygkoinonies-metafores → `wp-content/uploads/2024/02/ΔΡΟΜΟΛ.-ΠΕΡΙΣΣΟΥ.pdf`, `ΔΡΟΜΟΛ.-ΚΑΛΟΓΡΕΖΑΣ-ΝΕΟ-1.pdf` | PDF with text layer | file 2024-02 | terminus | Mon-Fri | 2 lines, 8-9 trips |
| Χαλανδρίου | chalandri.gr/yphresies/ypodomes-erga/dimotiki-sygkoinonia | HTML text | school 15/9-15/6, summer 15/6-15/9 | terminus | Ο EXPRESS Saturday | Β1, Β2, Γ, Ο: ~5/5/10/2 trips |
| Ελληνικού-Αργυρούπολης | elliniko-argyroupoli.gr/dimotiki-sygkoinonia/ | HTML text | none | terminus | not stated | lines 1, 1΄, 2, 4: 5-16 trips |
| Ηρακλείου Αττικής | iraklio.gr/el/dimotiki-sygkoinonia | HTML text | none | frequency (hourly 7:30-13:30) | Mon-Fri | 1 circular, 35 stops |
| Βύρωνα | dimosbyrona.gr/discover/sygkoinonia-sto-dimo-vyrona/ + notice of 2026-11-05 (JPG not read) | HTML text | 2026-11-05 | frequency (every 30′ 08:00-13:00; Wed/Sat hourly 08:30-12:30) | Mon-Sat | 1 circular, 34 stops |
| Νέας Σμύρνης | neasmyrni.gr/sygkoinwnies/ → `wp-content/uploads/2026/03/Nea_Smyrni_sygkoinwnies_guide-20256-version-2.pdf` | image-only PDF (OCR or by hand) | upload 2026-03 | terminus | Mon-Sat | 4 variants, 10-13 trips |
| Λυκόβρυσης-Πεύκης | likovrisipefki.gr/images/dromologia_dimot_sygkoinwniasFINALv2.pdf | image PDF; OCR ~90% clean | none | every stop | not stated | 2 lines, ~10 trips |
| Γαλατσίου | galatsi.gov.gr/dimotiki-sygkinonia/ (map PDF 2022, not opened) | none found | — | UNVERIFIED: hourly 07:00-20:00 | UNVERIFIED Mon-Fri | 1 circular |
| Μεταμόρφωσης | metamorfossi.gov.gr (no timetable) | only in the app | — | UNVERIFIED: hourly 06:00-19:00 | weekdays | 1 line |

Live GPS: only Μεταμόρφωση, a 3pi Telematics app (`metamorfwsi.3pi-telematics.com`, Android
`com.threepi.android.metamorfositelematics`); no public endpoint seen in its HTML (network traffic
not inspected).

Easiest first: Αγ. Δημητρίου (XLSX), Αμαρουσίου, Παπάγου-Χολαργού, Νέα Ιωνία (PDF text), then the
HTML pages. Νέα Σμύρνη and Λυκόβρυση-Πεύκη need OCR plus a hand check.

Notes for a transcription: OSM relations and the municipalities' line lists do not match one to one
(Μαρούσι: 12 relations, 6 lines on the page), so each timetable needs a hand mapping to its OSM
route. Several sources are seasonal (Χαλάνδρι school/summer) or give a frequency, not times.
