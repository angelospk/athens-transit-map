import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DayStats } from "../src/lib/stats";
import {
  buildStats, cityStatsPage, csvPath, hoursCsv, LICENSE_URL, linesCsv, rawDayUrl, STATS_CITIES, statsPath, type GetText,
} from "../scripts/stats-pages";

// A full day in Europe/Athens: fixes in every hour, so gaps() finds none.
const startOf = (date: string) => Date.parse(`${date}T00:00:00+02:00`) / 1000;
function day(date: string, o: { partial?: boolean; trips?: boolean; delay?: boolean; lines?: DayStats["by_line"] } = {}): DayStats {
  const t0 = startOf(date);
  const hours = Array.from({ length: 24 }, (_, h) => ({
    h, fixes: o.partial && h < 10 ? 0 : 100, vehicles: h < 5 ? 10 : 500, lines: 50,
    dist_m: h < 5 ? 0 : 1_000_000, time_s: h < 5 ? 0 : 200_000, // 18 km/h, none at night
  }));
  const by_line = o.lines ?? [
    { line: "040", fixes: 900, vehicles: 9, dist_m: 1_200_000, time_s: 360_000 }, // 12 km/h
    { line: "Β12", fixes: 900, vehicles: 9, dist_m: 2_400_000, time_s: 360_000 }, // 24 km/h
    { line: "550", fixes: 900, vehicles: 9, dist_m: 1_800_000, time_s: 360_000 }, // 18 km/h
    { line: "<x>", fixes: 9, vehicles: 1, dist_m: 1000, time_s: 100 }, // too few hours to rank
  ];
  return {
    version: 1, date, tz: "Europe/Athens", generated_at: t0 + 100_000,
    first_fix: o.partial ? t0 + 10 * 3600 : t0, last_fix: t0 + 86_399,
    files: 24, fixes: 2400, vehicles: 1200, lines: 280, hours, by_line,
    ...(o.trips ? {
      trips: {
        gtfs: "2026-07-08", gtfs_expired: false, min_coverage: 0.5, planned: 100, run: 80, partial: 10, missed: 10, unmeasured: 0,
        by_line: [
          { line: "040", planned: 50, run: 40, partial: 5, missed: 5, unmeasured: 0, missed_trips: null },
          { line: "999", planned: 50, run: 0, partial: 0, missed: 50, unmeasured: 0, missed_trips: null },
        ],
      },
    } : {}),
    ...(o.delay ? {
      start_delay: { runs: 30, by_line: [{ line: "040", runs: 30, mean_s: 120, p90_s: 300, sum_s: 3600, minutes: [[0, 10], [2, 17], [4, 3]] }] },
    } : {}),
  } as DayStats;
}

const athens = STATS_CITIES.find(c => c.id === "athens")!;
const thess = STATS_CITIES.find(c => c.id === "thessaloniki")!;

describe("cities and paths", () => {
  it("has Athens at the root of the stats branch and Thessaloniki in its own folder", () => {
    expect(athens).toMatchObject({ name: "Αθήνα", dir: "" });
    expect(thess).toMatchObject({ name: "Θεσσαλονίκη", dir: "thessaloniki" });
  });
  it("puts each city's page at /{city}/stats/ and its CSV files under data/", () => {
    expect(statsPath(athens)).toBe("/athens/stats/");
    expect(csvPath(thess, "2026-11-07", "hours")).toBe("/thessaloniki/stats/data/2026-11-07-hours.csv");
    expect(csvPath(athens, "2026-11-07", "lines")).toBe("/athens/stats/data/2026-11-07-lines.csv");
  });
  it("links the raw JSON of a day on the stats branch", () => {
    const base = "https://raw.githubusercontent.com/angelospk/staseis-rt/stats/v1";
    expect(rawDayUrl(athens, "2026-11-05")).toBe(`${base}/days/2026-11-05.json`);
    expect(rawDayUrl(thess, "2026-11-07")).toBe(`${base}/thessaloniki/days/2026-11-07.json`);
  });
});

describe("hoursCsv", () => {
  it("has a header and 24 hour rows, km/h with one decimal and empty without movement", () => {
    const rows = hoursCsv(day("2026-11-05")).trimEnd().split("\n");
    expect(rows[0]).toBe("hour,fixes,vehicles,lines,dist_m,time_s,kmh");
    expect(rows).toHaveLength(25);
    expect(rows[1]).toBe("0,100,10,50,0,0,");
    expect(rows[9]).toBe("8,100,500,50,1000000,200000,18.0");
  });
});

describe("linesCsv", () => {
  it("joins speed, trips and start delays per line, every line once, sorted", () => {
    const rows = linesCsv(day("2026-11-05", { trips: true, delay: true })).trimEnd().split("\n");
    expect(rows[0]).toBe("line,fixes,vehicles,dist_m,time_s,kmh,trips_planned,trips_run,trips_partial,trips_missed,trips_unmeasured,start_runs,start_mean_s,start_p90_s");
    expect(rows).toContain("040,900,9,1200000,360000,12.0,50,40,5,5,0,30,120,300");
    // In the trip counts only: no speed columns.
    expect(rows).toContain("999,,,,,,50,0,0,50,0,,,");
    expect(rows.slice(1).map(r => r.split(",")[0])).toEqual(["040", "550", "999", "<x>", "Β12"].sort());
  });
  it("quotes a line id that holds a comma or a quote", () => {
    const csv = linesCsv(day("2026-11-05", { lines: [{ line: 'a,"b', fixes: 1, vehicles: 1, dist_m: 0, time_s: 0 }] }));
    expect(csv.split("\n")[1]).toBe('"a,""b",1,1,0,0,,,,,,,,,');
  });
});

describe("cityStatsPage", () => {
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map(d => day(d, { trips: true, delay: true }));
  const html = cityStatsPage(athens, days);
  it("names the plan the trips count against: OASA's daily schedule, the expired GTFS only for the lines left on it (rt#99)", () => {
    const withSource = (source: "oasa_daily" | "mixed" | undefined) => {
      const d = day("2026-11-08", { trips: true });
      d.trips = { ...d.trips!, gtfs_expired: true, schedule_source: source,
        by_line: d.trips!.by_line.map((l, i) => ({ ...l, schedule_source: source === "mixed" && i === 1 ? "gtfs" as const : "oasa_daily" as const })) };
      return cityStatsPage(athens, [d]);
    };
    const daily = withSource("oasa_daily");
    expect(daily).toContain("ημερήσιο πρόγραμμα του ΟΑΣΑ");
    expect(daily).not.toContain("έχει λήξει");
    const mixed = withSource("mixed");
    expect(mixed).toContain("ημερήσιο πρόγραμμα του ΟΑΣΑ");
    expect(mixed).toContain("Για 1 γραμμή");
    expect(withSource(undefined)).toContain("έχει λήξει");
  });
  it("a citybus.gr city counts against the citybus.gr timetable, never OASA's (staseis-rt#151)", () => {
    const patras = STATS_CITIES.find(c => c.id === "patras")!;
    expect(patras.dir).toBe("patras");
    const d = day("2026-11-12", { trips: true });
    d.trips = { ...d.trips!, gtfs_expired: false, schedule_source: "citybus_timetable",
      by_line: d.trips!.by_line.map(l => ({ ...l, schedule_source: "citybus_timetable" as const })) };
    const page = cityStatsPage(patras, [d]);
    expect(page).toContain("ωράριο του citybus.gr");
    expect(page).not.toContain("ΟΑΣΑ");
    expect(page).not.toContain("έχει λήξει");
  });

  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);

  it("is a page of its own with a canonical URL on staseis.gr", () => {
    expect(html).toContain('<link rel="canonical" href="https://staseis.gr/athens/stats/">');
    expect(html).toMatch(/<h1>[^<]*Αθήνα[^<]*<\/h1>/);
    expect(html).toContain("<title>Στατιστικά δικτύου · Αθήνα");
  });

  it("describes the data as a schema.org Dataset under CC BY 4.0 with CSV and JSON downloads", () => {
    expect(ld["@type"]).toBe("Dataset");
    expect(ld.license).toBe(LICENSE_URL);
    expect(LICENSE_URL).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(ld.url).toBe("https://staseis.gr/athens/stats/");
    expect(ld.temporalCoverage).toBe("2026-11-02/2026-11-05");
    expect(ld.spatialCoverage.geo).toMatchObject({ "@type": "GeoCoordinates" });
    const urls = ld.distribution.map((d: { contentUrl: string }) => d.contentUrl);
    expect(urls).toContain("https://staseis.gr/athens/stats/data/2026-11-05-hours.csv");
    expect(urls).toContain("https://staseis.gr/athens/stats/data/2026-11-05-lines.csv");
    expect(urls).toContain(rawDayUrl(athens, "2026-11-05"));
    expect(ld.distribution.map((d: { encodingFormat: string }) => d.encodingFormat)).toEqual(expect.arrayContaining(["text/csv", "application/json"]));
  });

  it("shows the newest day per hour in a table with 24 rows", () => {
    const table = html.match(/<table id="hours">(.*?)<\/table>/s)![1];
    expect(table.match(/<tr>/g)).toHaveLength(25); // header + 24 hours
    expect(table).toContain("<td>08:00</td><td>500</td><td>18,0</td>");
  });

  it("ranks the slowest and fastest lines and leaves out lines with too few hours", () => {
    const slow = html.match(/<table id="slow">(.*?)<\/table>/s)![1];
    const fast = html.match(/<table id="fast">(.*?)<\/table>/s)![1];
    expect(slow.indexOf("040")).toBeGreaterThan(-1);
    expect(fast).toContain("Β12");
    expect(html).not.toContain("<x>"); // not ranked, and never raw
  });

  it("escapes a line id from the data", () => {
    const evil = day("2026-11-05", { lines: [
      { line: "<b>x</b>", fixes: 900, vehicles: 9, dist_m: 1_200_000, time_s: 360_000 },
      { line: "040", fixes: 900, vehicles: 9, dist_m: 2_400_000, time_s: 360_000 },
    ] });
    const page = cityStatsPage(athens, [evil]);
    expect(page).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(page).not.toContain("<b>x</b>");
  });

  it("builds without generated_at, leaving out dateModified", () => {
    const d = day("2026-11-05") as Partial<DayStats>;
    delete d.generated_at;
    const page = cityStatsPage(athens, [d as DayStats]);
    expect(page).not.toContain("dateModified");
    const far = { ...day("2026-11-05"), generated_at: 1e20 };
    expect(cityStatsPage(athens, [far])).not.toContain("dateModified");
  });

  it("shows the share of scheduled trips that ran", () => {
    expect(html).toContain("80 από 100");
  });

  it("compares the days when there are at least two complete ones", () => {
    expect(html).toContain('<table id="band">');
    expect(html).toContain('<table id="daytype">');
    expect(html).toContain('<table id="delay">');
  });

  it("lists every day with its CSV files and its JSON, newest first", () => {
    const archive = html.match(/<table id="days">(.*?)<\/table>/s)![1];
    expect(archive.indexOf("2026-11-05")).toBeLessThan(archive.indexOf("2026-11-02"));
    for (const d of ["2026-11-02", "2026-11-05"]) {
      expect(archive).toContain(`href="${csvPath(athens, d, "hours")}"`);
      expect(archive).toContain(`href="${csvPath(athens, d, "lines")}"`);
      expect(archive).toContain(`href="${rawDayUrl(athens, d)}"`);
    }
  });

  it("names the licence and the source on the page", () => {
    expect(html).toContain(`href="${LICENSE_URL}"`);
    expect(html).toContain("ΟΑΣΑ");
  });

  it("marks a partial newest day and skips the comparison with one complete day", () => {
    const one = cityStatsPage(thess, [day("2026-11-06"), day("2026-11-07", { partial: true })]);
    expect(one).toContain("μερική");
    expect(one).not.toContain('<table id="band">');
    expect(one).not.toContain('<table id="delay">'); // no start_delay in these days
    expect(one).toContain("ΟΣΕΘ");
    expect(one).toContain('href="https://staseis.gr/thessaloniki/stats/"');
  });
});

describe("buildStats", () => {
  const RAW = "https://raw.example/v1";
  const files = (map: Record<string, unknown>): GetText => async url => {
    const key = url.slice(RAW.length + 1);
    return key in map ? (typeof map[key] === "string" ? (map[key] as string) : JSON.stringify(map[key])) : null;
  };

  it("writes a page and two CSV files per day for each city that has days, and returns their paths", async () => {
    const out = mkdtempSync(join(tmpdir(), "stats-"));
    const get = files({
      "index.json": { version: 1, latest: "2026-11-05", days: ["2026-11-04", "2026-11-05"] },
      "days/2026-11-04.json": day("2026-11-04"),
      "days/2026-11-05.json": day("2026-11-05"),
      // Thessaloniki: no index yet (404).
    });
    const r = await buildStats(out, get, RAW);
    expect(r.cities).toEqual([{ id: "athens", days: 2, bad: 0 }]);
    expect(r.paths).toEqual(["/athens/stats/"]);
    expect(existsSync(join(out, "athens/stats/index.html"))).toBe(true);
    expect(readFileSync(join(out, "athens/stats/data/2026-11-05-hours.csv"), "utf8")).toBe(hoursCsv(day("2026-11-05")));
    expect(existsSync(join(out, "athens/stats/data/2026-11-04-lines.csv"))).toBe(true);
    expect(existsSync(join(out, "thessaloniki"))).toBe(false);
    // No link to a city page that was not built.
    expect(readFileSync(join(out, "athens/stats/index.html"), "utf8")).not.toContain('href="/thessaloniki/stats/"');
  });

  it("links the stats pages of the other built cities", () => {
    const html = cityStatsPage(athens, [day("2026-11-05")], [athens, thess]);
    expect(html).toContain('href="/thessaloniki/stats/"');
  });

  it("links the live map on the city's own path (web#47)", () => {
    expect(cityStatsPage(athens, [day("2026-11-05")])).toContain('<a class="cta" href="/athens/">');
    expect(cityStatsPage(thess, [day("2026-11-05")])).toContain('<a class="cta" href="/thessaloniki/">');
    expect(cityStatsPage(thess, [day("2026-11-05")])).toContain('<footer><a href="/thessaloniki/">Στάσεις</a>');
  });

  it("skips a city whose index lists no day, and a day file that is missing or malformed", async () => {
    const out = mkdtempSync(join(tmpdir(), "stats-"));
    const get = files({
      "index.json": { version: 1, latest: "2026-11-05", days: ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "../x"] },
      "days/2026-11-04.json": "not json",
      "days/2026-11-05.json": day("2026-11-05"),
      // Trip counts without a list of lines: the page and the CSV would throw on it.
      "days/2026-11-06.json": { ...day("2026-11-06", { trips: true }), trips: { ...day("2026-11-06", { trips: true }).trips, by_line: null } },
      "thessaloniki/index.json": { version: 1, latest: "", days: [] },
    });
    const r = await buildStats(out, get, RAW);
    expect(r.cities).toEqual([{ id: "athens", days: 1, bad: 3 }]);
    expect(existsSync(join(out, "athens/stats/data/2026-11-04-hours.csv"))).toBe(false);
    expect(existsSync(join(out, "thessaloniki"))).toBe(false);
  });

  it("rejects when the stats branch cannot be read, so a deploy keeps the old site", async () => {
    const out = mkdtempSync(join(tmpdir(), "stats-"));
    await expect(buildStats(out, async () => { throw new Error("HTTP 500"); }, RAW)).rejects.toThrow("HTTP 500");
  });
});
