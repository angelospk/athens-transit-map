// Lines and stops pinned on the map (the pin sheet): each in a colour the user picks, kept on the device.
// A pinned line draws its whole route on top of the others, and (with `vehicles`) its buses in that colour;
// a pinned stop is a pin with its name. `top`: it stays while a trip or another line is open.
import type { FeatureCollection, LineString, Point } from "geojson";

export interface Pin {
  kind: "line" | "stop";
  id: string;            // a line: its OASA id («040»); a stop: its code
  label: string;         // the line's number, or the stop's name
  color: string;
  width: 1 | 2 | 3;
  vehicles: boolean;
  top: boolean;
  at?: [number, number]; // a stop: [lon, lat]
}

export const PIN_COLORS: [string, string][] = [["#5b9dff", "Μπλε"], ["#e5484d", "Κόκκινο"], ["#f0ae45", "Πορτοκαλί"], ["#46c267", "Πράσινο"],
  ["#b58cff", "Μωβ"], ["#ff6fb1", "Ροζ"], ["#2ec5d3", "Τιρκουάζ"], ["#f4f5f7", "Λευκό"]];
export const PIN_WIDTH: Record<1 | 2 | 3, number> = { 1: 3, 2: 5, 3: 8 };

const HEX = /^#[0-9a-f]{6}$/i;
export function isPins(v: unknown): v is Pin[] {
  return Array.isArray(v) && v.every(p => !!p && (p.kind === "line" || p.kind === "stop") && typeof p.id === "string" && typeof p.label === "string"
    && HEX.test(p.color) && [1, 2, 3].includes(p.width) && typeof p.vehicles === "boolean" && typeof p.top === "boolean"
    && (p.kind === "line" || (Array.isArray(p.at) && p.at.length === 2 && p.at.every(Number.isFinite))));
}

export const pinKey = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`;

/** Adds or replaces a pin (same kind and id), keeping the others' order. */
export function setPin(pins: Pin[], p: Pin): Pin[] {
  const i = pins.findIndex(x => pinKey(x) === pinKey(p));
  return i < 0 ? [...pins, p] : pins.map((x, k) => (k === i ? p : x));
}
export const dropPin = (pins: Pin[], kind: Pin["kind"], id: string) => pins.filter(p => !(p.kind === kind && p.id === id));

/** Text on a pin colour: dark on the light ones. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#0a1424" : "#ffffff";
}

/** A hue (0–360) as a bright pin colour, for the hue strip. */
export function hueColor(h: number): string {
  const f = (n: number) => { const k = (n + h / 30) % 12; const c = 0.62 - 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, "0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function pinStopsFC(pins: Pin[], hide: boolean): FeatureCollection<Point> {
  return { type: "FeatureCollection", features: pins.filter(p => p.kind === "stop" && p.at && (p.top || !hide)).map(p => ({
    type: "Feature", properties: { id: p.id, name: p.label, color: p.color, ink: inkOn(p.color) }, geometry: { type: "Point", coordinates: p.at! } })) };
}

/** The pinned lines' routes from their static data: every variant, with the pin's colour and width. */
export function pinLinesFC(pins: Pin[], shape: (id: string) => [number, number][][] | null, hide: boolean): FeatureCollection<LineString> {
  return { type: "FeatureCollection", features: pins.filter(p => p.kind === "line" && (p.top || !hide)).flatMap(p =>
    (shape(p.id) ?? []).map(coordinates => ({ type: "Feature" as const, properties: { id: p.id, color: p.color, w: PIN_WIDTH[p.width] },
      geometry: { type: "LineString" as const, coordinates } }))) };
}
