// A change between two rides, told as the station seen from the side (mockup 47): where each ride is (the street, or a
// metro line's level under it), which way the rider goes (down, up), and in words what to do. The levels are the 3D
// view's (map/metroDepth.ts): approximate, so only their order is told («πιο κάτω»), never metres.
import { depthAt } from "./map/metroDepth";

/** M1, M2 or M3 from a metro line's label or id («M3», «Μ3», "stasy:M3", "3"); null for anything else. */
export function metroId(mode: string, label: string, id = ""): string | null {
  if (mode !== "metro") return null;
  for (const t of [label, id.slice(id.indexOf(":") + 1)]) {
    const m = /^[MΜ]?\s*([123])$/i.exec(t.trim());
    if (m) return `M${m[1]}`;
  }
  return null;
}

/** How far under the street a ride is boarded or left (metres, 0 on the street: buses, trolleys, the tram). */
export function levelM(mode: string, label: string, at: [number, number], id = ""): number {
  const m = metroId(mode, label, id);
  return m ? Math.round(depthAt(m, at[0], at[1])) : 0;
}

export interface TransferLook {
  from: number; to: number;        // the two levels (metres under the street)
  way: "down" | "up" | "level";
  diff: number;                    // metres between them, rounded to 5
  under: boolean;                  // either end is under the street: the side view is worth showing
}
export function transferLook(from: number, to: number): TransferLook {
  const d = to - from;
  return { from, to, way: Math.abs(d) < 5 ? "level" : d > 0 ? "down" : "up", diff: Math.round(Math.abs(d) / 5) * 5, under: from > 0 || to > 0 };
}

/** «Γραμμή 3» for a metro line, else the label as it is. */
export const lineWord = (mode: string, label: string, id = "") => { const m = metroId(mode, label, id); return m ? `Γραμμή ${m.slice(1)}` : label; };

// One step in words: plain text and, at most once, a bold part (the line or the platform to look for).
export interface Words { t: string; b?: string; after?: string }

export interface ChangeFacts {
  stop: string; next: string; toward: string;   // names, as shown
  m: number; min: number;                       // the walk between (metres, minutes with the station's)
  prev: { label: string; mode: string }; label: string; mode: string;
}
const RAIL = new Set(["metro", "rail", "suburban", "tram"]);
const VEHICLE: Record<string, string> = { bus: "λεωφορείο", trolley: "τρόλεϊ", metro: "μετρό", tram: "τραμ", suburban: "Προαστιακό", rail: "τρένο" };
const dist = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} μ` : `${(m / 1000).toFixed(1).replace(".", ",")} χλμ`);

/** What to do, in order: out of the first ride, to the second, onto its platform or at its stop. */
export function changeWords(c: ChangeFacts, look: TransferLook): Words[] {
  const out: Words[] = [];
  const fromMetro = c.prev.mode === "metro" && look.from > 0, toMetro = c.mode === "metro" && look.to > 0;
  const toRail = RAIL.has(c.mode);
  // Down or up to the platform only between two metro lines; from the street the step before says «κάτω».
  const platform: Words = { t: toRail ? (fromMetro && toMetro && look.way !== "level" ? (look.way === "down" ? "Κατέβα στην αποβάθρα " : "Ανέβα στην αποβάθρα ") : "Αποβάθρα ") : `Πάρε το ${c.label} `,
    b: c.toward ? `προς ${c.toward}` : undefined };
  if (!c.toward) platform.t = platform.t.trimEnd();
  if (fromMetro && toMetro) {
    out.push({ t: `Βγες από το ${c.prev.label} και ακολούθησε τις πινακίδες για τη `, b: lineWord(c.mode, c.label), after: "." });
  } else if (toMetro) {
    if (c.m >= 20) out.push({ t: `Κατέβα στη στάση ${c.stop} και περπάτα ${dist(c.m)} ως την είσοδο του σταθμού.` });
    else out.push({ t: `Κατέβα στη στάση ${c.stop}: η είσοδος του σταθμού είναι εκεί.` });
    out.push({ t: `Ακυρωτικά, και κάτω στη `, b: lineWord(c.mode, c.label), after: "." });
  } else if (fromMetro) {
    out.push({ t: `Βγες από τον σταθμό στον δρόμο.` });
    out.push({ t: c.m >= 20 ? `Περπάτα ${dist(c.m)} ως ${toRail ? "την αποβάθρα" : "τη στάση"}${c.next ? ` ${c.next}` : ""}.` : `${toRail ? "Η αποβάθρα" : "Η στάση"} είναι στην έξοδο.` });
  } else if (c.m >= 20) {
    out.push({ t: `Περπάτα ${dist(c.m)} ως ${toRail ? "την αποβάθρα" : "τη στάση"}${c.next ? ` ${c.next}` : ""}.` });
  } else {
    out.push({ t: `Μείνε στη στάση ${c.stop}.` });
  }
  out.push({ ...platform, after: platform.b ? "." : platform.t.endsWith(".") ? "" : "." });
  return out;
}

/** The time to spare, said so it means something: tight (and what then), enough, or just the minutes. */
export function changeMargin(spare: number, risk: number, missed: { in_min: number; arrive_at: number } | null, next: { what: string; at: string; rail: boolean },
  clock: (t: number) => string): { tone: "tight" | "ok" | "mid"; big: string; small: string } {
  const then = missed ? `Αν το χάσεις, το επόμενο σε ${missed.in_min}′. Φτάνεις ${clock(missed.arrive_at)}.` : "";
  if (spare < risk) return { tone: "tight", big: spare <= 0 ? "Σφιχτό: φεύγει μόλις φτάσεις" : `Σφιχτό: ${spare}′ περιθώριο`, small: then };
  if (spare >= 3) return { tone: "ok", big: `Άνετα: ${spare}′ περιθώριο`, small: `${next.what} ${next.at} σε περιμένει ${next.rail ? "στην αποβάθρα" : "στη στάση"}.` };
  return { tone: "mid", big: `${spare}′ περιθώριο`, small: then };
}

/** «Κατεβαίνεις στο Μ3 · 3′»: the change in one line, for the list of steps. */
export function changeLine(look: TransferLook, nextLabel: string, nextMode: string, min: number, m = 0): string {
  const what = nextMode === "metro" ? nextLabel : VEHICLE[nextMode] ?? nextLabel;
  const verb = look.way === "down" ? `Κατεβαίνεις στο ${what}` : look.way === "up" ? (look.to > 0 ? `Ανεβαίνεις στο ${what}` : "Βγαίνεις στον δρόμο")
    : look.under ? `Στο ${what}` : m >= 20 ? `Περπατάς ${dist(m)}` : "Ίδια στάση";
  return `${verb}${min ? ` · ${min}′` : ""}`;
}
