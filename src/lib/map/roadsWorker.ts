// The road tiles made into map features (athensRoads.decode) off the page's thread: paving the junctions and cutting
// the markings round them takes a dense tile a good part of a second on a phone, and the map would stop meanwhile.
// The features stay here: the page gets each tile's carriageways (for snapping, without their markings), and for the
// tiles round the view one GeoJSON file of all their features, as a Blob, which the map's own worker reads by its
// address. So the features never cross the page's thread (sending them to the map was a second each, in a trace).
import { decode, type AthensRoads, type RoadsFile } from "../athensRoads";

const tiles = new Map<string, AthensRoads>();   // the latest 8, by when last asked for (the page keeps fewer)

type Msg = { id: number; type: "tile"; key: string; text: string } | { id: number; type: "merge"; keys: string[] };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data, post = (x: unknown) => (self as unknown as Worker).postMessage(x);
  try {
    if (m.type === "tile") {
      const d = decode(JSON.parse(m.text) as RoadsFile);
      tiles.delete(m.key);
      tiles.set(m.key, d);
      while (tiles.size > 8) tiles.delete(tiles.keys().next().value!);
      post({ id: m.id, data: { ...d, features: [], roads: d.roads.map(({ marks: _, ...r }) => r) } });
    } else {
      const parts: string[] = [];
      for (const k of m.keys) {
        const t = tiles.get(k);
        if (!t) continue;
        tiles.delete(k);
        tiles.set(k, t);
        for (const f of t.features) parts.push(JSON.stringify(f));
      }
      post({ id: m.id, blob: new Blob([`{"type":"FeatureCollection","features":[${parts.join(",")}]}`], { type: "application/json" }) });
    }
  } catch (err) {
    post({ id: m.id, error: String(err) });
  }
};
