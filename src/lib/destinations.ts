// «Χρήσιμοι προορισμοί» (mockup 1β): the airport, the ports, the intercity coaches and trains, and a few places in
// town, in three groups, per city. A tap plans the trip there from where the user is.
import type { CityId } from "./cities";

export type DestKind = "plane" | "ship" | "coach" | "train" | "museum" | "library" | "square";
export type DestGroup = "ports" | "intercity" | "city";
export interface Dest { label: string; hint: string; kind: DestKind; group: DestGroup; at: [number, number] }

export const GROUP_TITLE: Record<DestGroup, string> = { ports: "Αεροδρόμιο και λιμάνια", intercity: "Υπεραστικά", city: "Στην πόλη" };

const BY_CITY: Partial<Record<CityId, Dest[]>> = {
  athens: [
    { label: "Αεροδρόμιο", hint: "Ελ. Βενιζέλος · M3", kind: "plane", group: "ports", at: [37.9364, 23.9445] },
    { label: "Λιμάνι Πειραιά", hint: "Πύλες Ε1–Ε12 · M1", kind: "ship", group: "ports", at: [37.9420, 23.6465] },
    { label: "Λιμάνι Ραφήνας", hint: "ΚΤΕΛ από Αθήνα", kind: "ship", group: "ports", at: [38.0225, 24.0103] },
    { label: "ΚΤΕΛ Κηφισού", hint: "Κηφισού 100", kind: "coach", group: "intercity", at: [38.0057, 23.7116] },
    { label: "ΚΤΕΛ Λιοσίων", hint: "Λιοσίων 260", kind: "coach", group: "intercity", at: [38.0096, 23.7188] },
    { label: "Σταθμός Λαρίσης", hint: "Τρένα · M2", kind: "train", group: "intercity", at: [37.9922, 23.7206] },
    { label: "Σύνταγμα", hint: "Κέντρο · M2, M3", kind: "square", group: "city", at: [37.9755, 23.7348] },
    { label: "Ακρόπολη", hint: "Μουσείο · M2", kind: "museum", group: "city", at: [37.9685, 23.7285] },
    { label: "ΚΠΙΣΝ", hint: "Καλλιθέα", kind: "library", group: "city", at: [37.9397, 23.6913] },
  ],
  thessaloniki: [
    { label: "Αεροδρόμιο", hint: "Μακεδονία", kind: "plane", group: "ports", at: [40.5197, 22.9709] },
    { label: "Λιμάνι", hint: "Επιβατικός σταθμός", kind: "ship", group: "ports", at: [40.6346, 22.9327] },
    { label: "ΚΤΕΛ Μακεδονίας", hint: "Γιαννιτσών 244", kind: "coach", group: "intercity", at: [40.6577, 22.9065] },
    { label: "Σιδηροδρομικός σταθμός", hint: "Τρένα", kind: "train", group: "intercity", at: [40.6445, 22.9285] },
    { label: "Λευκός Πύργος", hint: "Παραλία", kind: "square", group: "city", at: [40.6264, 22.9484] },
    { label: "Αριστοτέλους", hint: "Πλατεία", kind: "square", group: "city", at: [40.6325, 22.9410] },
  ],
};

/** The city's destinations in their groups, in the order of GROUP_TITLE; a group with none is left out. */
export function destGroups(city: CityId): { group: DestGroup; title: string; items: Dest[] }[] {
  const all = BY_CITY[city] ?? [];
  return (Object.keys(GROUP_TITLE) as DestGroup[])
    .map(group => ({ group, title: GROUP_TITLE[group], items: all.filter(d => d.group === group) }))
    .filter(g => g.items.length);
}

/** All of the city's destinations, in group order. */
export const destsOf = (city: CityId): Dest[] => destGroups(city).flatMap(g => g.items);
