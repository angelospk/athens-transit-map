import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTimetable } from "../src/lib/muniTimes";
import { loadTimetables } from "../src/lib/muniTables";

// The hand-transcribed timetables (data/municipal/*.json): a typo must fail here, not show a wrong time.
const dir = join(__dirname, "..", "data", "municipal");
const files = readdirSync(dir).filter(f => f.endsWith(".json"));

describe("data/municipal", () => {
  it("has timetables", () => expect(files.length).toBeGreaterThan(0));
  it.each(files)("%s is a valid timetable with its watch hashes filled in", f => {
    const t = parseTimetable(JSON.parse(readFileSync(join(dir, f), "utf8")));
    expect(t).not.toBeNull();
    expect(t!.watch.length).toBeGreaterThan(0);
    for (const w of t!.watch) expect(w.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("gives each OSM route to one line only", () => {
    const seen = new Map<string, string>();
    for (const f of files) for (const l of parseTimetable(JSON.parse(readFileSync(join(dir, f), "utf8")))!.lines)
      for (const r of l.routes) { expect(seen.get(r), `${r} in ${f} and ${seen.get(r)}`).toBeUndefined(); seen.set(r, f); }
  });
  it("loads every file in the app", async () => {
    expect((await loadTimetables()).length).toBe(files.length);
  });
});
