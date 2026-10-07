// Line picker search: by id (Latin look-alikes, lowercase, leading zeros) or by part of the name.

import { normalizeLineId } from "./selection";
import type { LineInfo } from "./types";

// Case-, accent- and final-sigma-insensitive Greek matching.
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("el").replace(/ς/g, "σ");
const noZeros = (id: string) => id.replace(/^0+(?=.)/, "");
const byId = (a: LineInfo, b: LineInfo) => a.id.localeCompare(b.id, "el", { numeric: true });

export function searchLines(lines: LineInfo[], query: string): LineInfo[] {
  const sorted = [...lines].sort(byId);
  const q = fold(query.trim());
  if (!q) return sorted;
  const qid = fold(normalizeLineId(query));
  const rank = (l: LineInfo) => {
    const id = fold(l.id);
    if (id === qid || noZeros(id) === noZeros(qid)) return 0;
    if (id.startsWith(qid) || noZeros(id).startsWith(noZeros(qid))) return 1;
    if (fold(l.name).includes(q) || fold(l.name_en).includes(q)) return 2;
    return -1;
  };
  return sorted.map(l => [rank(l), l] as const).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0]).map(([, l]) => l);
}
