// The municipal timetables we transcribed by hand (data/municipal/*.json, checked by tests/muniData.test.ts),
// loaded with the «Δημοτικά» layer. A file that fails parseTimetable is left out, never shown half.
import { parseTimetable, type MuniTimetable } from "./muniTimes";

const files = import.meta.glob("../../data/municipal/*.json", { import: "default" });

export async function loadTimetables(): Promise<MuniTimetable[]> {
  const all = await Promise.all(Object.values(files).map(load => load().then(parseTimetable, () => null)));
  return all.filter((t): t is MuniTimetable => t !== null);
}
