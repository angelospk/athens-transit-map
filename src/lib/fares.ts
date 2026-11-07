// OASA fares (oasa.gr, «Prices of products», November 2026) and the ticket a planned trip needs.
// A price pair is [full, reduced]; reduced is null where OASA sells no reduced ticket.
import type { Itinerary, PlanResponse } from "./plan";

export type Price = readonly [number, number | null];
export const FARE = {
  single: [1.2, 0.5],        // 90′, every urban mode, any number of changes; not X80 nor the airport
  daily: [4.1, null],        // 24 h, and X80
  five: [8.2, null],         // 5 × 24 h
  tourist3: [20, null],      // 3 × 24 h, with one round trip to the airport
  month: [27, 13.5],         // 30 days, the city without the airport
  monthAll: [45, 22.5],      // 30 days, the airport too (not X80)
  year: [300, 150],          // 365 days, the city
  airport: [9, 4.5],         // metro or suburban to/from the airport; 90′ on every OASA mode (not Express, X80)
  airportNear: [5.5, 2.7],   // the same from/to Pallini, Kantza or Koropi
  express: [5.5, 2.7],       // one Airport Express ride (X93, X95, X96, X97)
} as const satisfies Record<string, Price>;

export function euro(x: number): string {
  return (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(".", ",")) + " €";
}
export const priceOf = (p: Price, reduced: boolean): number => (reduced && p[1] != null ? p[1] : p[0]);

export interface TicketLine { name: string; note: string; price: Price; n: number }
export interface TripFare { lines: TicketLine[]; total: [number, number]; reducedAll: boolean; x80: boolean }

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const AIRPORT = /ΑΕΡΟΔΡΟΜ|AIRPORT/;
const NEAR = /ΠΑΛΛΗΝ|ΚΑΝΤΖ|ΚΟΡΩΠ|PALLIN|KANTZ|KOROP/;
const EXPRESS = /^[XΧ]9[3567]$/;
const X80 = /^[XΧ]80$/;

/** A ride as the fare sees it: its line's label, its mode, the names of the stops it starts and ends at, its time. */
export interface FareRide { label: string; mode?: string; from: string; to: string; at: number }

/** The tickets one rider needs for the trip, or null for a walk. */
export function tripFare(it: Itinerary, r: PlanResponse): TripFare | null {
  const label = (id = "") => r.lines[id]?.label ?? id.slice(id.indexOf(":") + 1);
  const name = (stop: string | null) => (stop && r.stops[stop]?.name) || "";
  return fareOf(it.legs.filter(l => l.kind === "ride").map(l => ({ label: label(l.line), mode: l.mode, from: name(l.from.stop), to: name(l.to.stop), at: l.depart_at })));
}

/** The same for rides given one by one (the guide, NavGuide). */
export function fareOf(rides: FareRide[]): TripFare | null {
  if (!rides.length) return null;
  const express = rides.filter(l => EXPRESS.test(l.label));
  const x80 = rides.some(l => X80.test(l.label));
  const rest = rides.filter(l => !express.includes(l) && !X80.test(l.label));
  const lines: TicketLine[] = [];
  const air = rest.filter(l => l.mode !== "bus" && l.mode !== "trolley" && (AIRPORT.test(fold(l.from)) || AIRPORT.test(fold(l.to))));
  if (air.length) {
    const near = rest.length === 1 && air.every(l => NEAR.test(fold(l.from)) || NEAR.test(fold(l.to)));
    lines.push(near
      ? { name: "Μετρό αεροδρομίου από Παλλήνη, Κάντζα ή Κορωπί", note: "Ισχύει 90′ σε όλα τα μέσα, εκτός Express και X80", price: FARE.airportNear, n: 1 }
      : { name: "Μετρό αεροδρομίου", note: "Ισχύει 90′ σε όλα τα μέσα, εκτός Express και X80", price: FARE.airport, n: 1 });
  } else if (rest.length) {
    const span = rest[rest.length - 1].at - rest[0].at;
    const n = span > 90 * 60 ? 2 : 1;
    lines.push({ name: "Εισιτήριο 90′", note: rest.length > 1 ? "Ένα για όλη τη διαδρομή, μαζί με τις αλλαγές" : "Λεωφορεία, τρόλεϊ, τραμ, μετρό, προαστιακός", price: FARE.single, n });
  }
  if (express.length) lines.push({ name: "Express αεροδρομίου", note: "Μία διαδρομή · το 90′ δεν ισχύει στα Express", price: FARE.express, n: express.length });
  if (!lines.length && !x80) return null;
  const total: [number, number] = [0, 0];
  for (const l of lines) { total[0] += l.price[0] * l.n; total[1] += priceOf(l.price, true) * l.n; }
  return { lines, total: [Math.round(total[0] * 100) / 100, Math.round(total[1] * 100) / 100], reducedAll: lines.every(l => l.price[1] != null), x80 };
}

/** «Τι σε συμφέρει»: a month of `trips` rides a day on `days` days, each way to pay, cheapest marked. */
export function bestBuy(trips: number, days: number, reduced: boolean): { key: string; label: string; cost: number; best: boolean }[] {
  const out = [{ key: "single", label: `${trips} × 90′ κάθε μέρα`, cost: trips * days * priceOf(FARE.single, reduced) }];
  if (!reduced) out.push({ key: "daily", label: "Ημερήσιο κάθε μέρα", cost: days * FARE.daily[0] });
  out.push({ key: "month", label: "Κάρτα 30 ημερών", cost: priceOf(FARE.month, reduced) });
  const min = Math.min(...out.map(o => o.cost));
  return out.map(o => ({ ...o, cost: Math.round(o.cost * 100) / 100, best: o.cost === min }));
}
