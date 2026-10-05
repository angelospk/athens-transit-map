// Shapes from docs/CONTRACT.md (v1).

export interface Vehicle {
  id: string;
  lat: number;
  lon: number;
  bearing: number | null;
  position_at: number;
  route_code: string;
  variant: string | null;
  trip_id: string | null;
  trip_label: string | null;
  delay_s: number | null;
  next_stop_id: string | null;
}

export interface LineLive {
  line: string;
  updated_at: number;
  next_update_at: number;
  vehicles: Vehicle[];
}

export interface Status {
  ok: boolean;
  gtfs_version: string;
  gtfs_expires: string;
  updated_at: number;
  lines_active: number;
  budget_rps: number;
}

export interface LineInfo {
  id: string;
  name: string;
  name_en: string;
  color: string;
  text_color: string;
  kind: "bus" | "trolley";
}

export interface LinesIndex {
  gtfs_version: string;
  lines: LineInfo[];
}

export interface Variant {
  headsign: string;
  direction: number;
  shape: [number, number][];
  stops: string[];
}

export interface Stop {
  name: string;
  lat: number;
  lon: number;
}

export interface LineStatic {
  id: string;
  variants: Record<string, Variant>;
  stops: Record<string, Stop>;
}
