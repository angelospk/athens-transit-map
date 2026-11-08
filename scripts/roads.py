#!/usr/bin/env python3
"""The streets of Athens for the 3D mode (src/lib/map/scene3d.ts), from OpenStreetMap.

The base map's vector tiles carry a road's class and nothing more, and their lines are simplified per zoom, so the
streets drawn from them were the wrong width and changed shape as the map zoomed. This builds them once from
OpenStreetMap at full detail, with what the map tags say about each:

  - the carriageway at its real width: `width`, else `lanes` x a lane by class (3.0-3.5 m), plus a parking strip on
    the streets that have one; one-way or not;
  - the pavement each side, by class (none on motorways);
  - the markings: lane lines, the solid centre line of a two-way road, the solid yellow line of a bus lane
    (`bus:lanes`), edge lines on motorways, all cut back at every junction; the marked zebra crossings
    (`highway=crossing`);
  - pedestrian squares (`highway=pedestrian` + `area=yes`) as areas.

Full detail: every point of every way, in whole 1e-7 degrees (OpenStreetMap's own precision). One file for the whole
area, imported by the app as a hashed asset, so a browser downloads it once and keeps it:

    src/data/athens-roads.json  {"origin": [lon, lat], "unit": 1e-7, "r": [road, ...], "a": [square, ...], "x": [crossing, ...]}
      road     = [kind, widthDm, pavementDm, oneway, busDm, points, [[markType, points], ...]]
      kind     0 street, 1 pedestrian street, 2 motorway (no pavement)
      busDm    where a bus drives: its lane's centre, decimetres right of the centreline, in its direction of travel
      markType 0 lane line (dashed by the app: 3 m painted, 6 m clear), 1 centre line, 2 bus-lane line, 4 edge line
      crossing = [dx, dy, bearing (0.1 deg, counter-clockwise from east), half the carriageway (dm)]
      arrow    = [dx, dy, the way it is driven (0.1 deg, ccw from east), turns (bits: 1 left, 2 slight left,
                  4 through, 8 slight right, 16 right), level], in "t": one per lane with `turn:lanes`
                  (`:forward`, `:backward`), 18 m before the junction that lane comes up to
      points   = [dx, dy, dx, dy, ...]: the first from `origin`, each next from the one before, in `unit` degrees

The input is an Overpass API JSON (`out geom`) of the area, e.g. from https://maps.mail.ru/osm/tools/overpass/ with

    [out:json][timeout:180];
    (way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|
      service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|busway)$"](S,W,N,E);
     node["highway"~"^(crossing|traffic_signals)$"](S,W,N,E););
    out geom qt;

Levels (v2): a road on a bridge or in a tunnel keeps where it is, as two last fields: `level`, its OSM `layer` (a
bridge without one is 1, a tunnel -1), 0 on the ground; and `ends`, which of its ends meet the ground (bit 0 its first,
bit 1 its last): there it ramps to the street, and a tunnel has its portal. A tunnel is no longer dropped: the app
draws it under the street.

Tiles (v2, --tiles DIR): all of Attica is too much for one file, so each road, square and crossing goes to the tile its
middle is in (TILE degrees), DIR/<i>_<j>.json, with DIR/index.json listing them (their roads' count) and the widths of
the whole area (the app's layers are one per width), so the app loads only the tiles around the view.

The input may be several Overpass answers back to back (the browser fetched Attica in 25 pieces), gzipped or not;
a way met twice is kept once.

Usage:  pip install shapely
        python3 scripts/roads.py athens.json [--out src/data/athens-roads.json]
        python3 scripts/roads.py attica.json.gz --tiles public/roads
        python3 scripts/roads.py --context public/roads    (only add each tile's neighbours' roads, "c" and "b")
        python3 scripts/junctions.py public/roads          (only the junctions again; after --context)
"""
import argparse, gzip, json, math, os, re
from collections import defaultdict
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

ORIGIN = [23.73, 37.99]
KX = 111320 * math.cos(math.radians(ORIGIN[1]))
KY = 110540

# By class: (lane width m, default lanes one-way, default lanes two-way, pavement m each side, parking strip m, marked)
CLASS = {
    "motorway": (3.5, 3, 4, 0, 0, True), "trunk": (3.5, 2, 4, 0, 0, True),
    "primary": (3.25, 2, 4, 3.5, 0, True), "secondary": (3.25, 2, 2, 3.0, 2.0, True),
    "tertiary": (3.1, 1, 2, 2.6, 2.0, True), "unclassified": (3.0, 1, 2, 2.2, 2.0, False),
    "residential": (3.0, 1, 2, 2.0, 2.0, False), "living_street": (3.0, 1, 1, 1.4, 0, False),
    "service": (3.0, 1, 1, 0.8, 0, False), "busway": (3.5, 1, 2, 0, 0, False),
}
DRIVE = set(CLASS)
DASH = 3.0                       # the shortest lane line kept: one dash


def xy(lon, lat):
    """Metres east and north of ORIGIN (flat: the area is a few km across)."""
    return ((lon - ORIGIN[0]) * KX, (lat - ORIGIN[1]) * KY)


def ll(x, y):
    return (ORIGIN[0] + x / KX, ORIGIN[1] + y / KY)


def enc(lonlats):
    """[lon, lat] points as whole 1e-7 degrees (OpenStreetMap's own precision, ~1 cm): the first from ORIGIN, each
    next one from the one before it."""
    out, px, py = [], round(ORIGIN[0] * 1e7), round(ORIGIN[1] * 1e7)
    for lon, lat in lonlats:
        x, y = round(lon * 1e7), round(lat * 1e7)
        out += [x - px, y - py]
        px, py = x, y
    return out


def num(v):
    if not v:
        return None
    m = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)", v.replace(",", "."))
    return float(m.group(1)) if m else None


def lanes_of(t, oneway, d1, d2):
    v = t.get("lanes")
    n = max((int(x) for x in re.findall(r"\d+", v)), default=0) if v else 0
    return n if 0 < n <= 8 else (d1 if oneway else d2)


def profile(t):
    """A drivable way's cross-section: carriageway width, pavement each side, lanes, one-way, parking strip."""
    hw = t["highway"].replace("_link", "")
    lw, d1, d2, pave, park, marked = CLASS[hw]
    ow = t.get("oneway") in ("yes", "1", "-1", "true") or t.get("junction") == "roundabout" or hw == "motorway"
    lanes = lanes_of(t, ow, d1, d2)
    if t["highway"].endswith("_link"):
        lanes, pave, park = min(lanes, 2), 0 if hw in ("motorway", "trunk") else pave, 0
    if t.get("parking:both") == "no" or t.get("parking:lane:both") == "no_parking":
        park = 0
    w = lanes * lw + park
    tw = num(t.get("width"))
    if tw and 2.5 <= tw <= 40:
        park = max(0.0, min(park, tw - lanes * 2.75))
        lw = (tw - park) / lanes
        w = tw
    sw = t.get("sidewalk") or t.get("sidewalk:both")
    if sw == "no" and hw not in ("motorway", "trunk"):
        pave = 0.6
    return dict(hw=hw, w=w, pave=pave, lanes=lanes, lw=lw, oneway=ow, rev=t.get("oneway") == "-1", park=park,
                marked=marked or (lanes >= 2 and hw != "service"))




def parts(g):
    if g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g]
    if g.geom_type == "MultiLineString":
        return list(g.geoms)
    if g.geom_type == "GeometryCollection":
        return [p for x in g.geoms for p in parts(x)]
    return []


def offset(line, d):
    """The line `d` metres to the left (negative: right)."""
    if abs(d) < 0.01:
        return [line]
    try:
        g = line.offset_curve(d, quad_segs=4, join_style=2, mitre_limit=3)
    except Exception:
        return []
    return [p for p in parts(g) if p.length > 1]


def read_compact(raw):
    """The browser's compact form (the Overpass answers stripped to what this script reads): a line per element,
    `N id lonE7 latE7 {tags}` or `W id node,node,... dx,dy,dx,dy,... {tags}` (points in 1e-7 degrees, each from the
    one before, the first from 0)."""
    out = []
    for ln in raw.splitlines():
        if not ln:
            continue
        kind, rest = ln[0], ln[2:]
        if kind == "N":
            i, x, y, t = rest.split(" ", 3)
            out.append({"type": "node", "id": int(i), "lon": int(x) / 1e7, "lat": int(y) / 1e7, "tags": json.loads(t)})
        elif kind == "W":
            i, ns, gs, t = rest.split(" ", 3)
            d = [int(v) for v in gs.split(",")]
            x = y = 0
            geo = []
            for k in range(0, len(d), 2):
                x += d[k]; y += d[k + 1]
                geo.append({"lon": x / 1e7, "lat": y / 1e7})
            out.append({"type": "way", "id": int(i), "nodes": [int(v) for v in ns.split(",")], "geometry": geo, "tags": json.loads(t)})
    return out


def read_elements(src):
    """Every element of one Overpass answer, or of several back to back (gzipped or not), each way and node once; or
    of the browser's compact form (read_compact)."""
    raw = (gzip.open if src.endswith(".gz") else open)(src, "rt", encoding="utf-8").read()
    if raw[:2] in ("N ", "W "):
        return read_compact(raw)
    dec, at, seen, out = json.JSONDecoder(), 0, set(), []
    while True:
        while at < len(raw) and raw[at].isspace():
            at += 1
        if at >= len(raw):
            break
        doc, at = dec.raw_decode(raw, at)
        for e in doc.get("elements", []):
            k = (e["type"], e["id"])
            if k not in seen:
                seen.add(k)
                out.append(e)
    return out


def level_of(t):
    """Where a road is: its `layer` on a bridge (1 without one) or in a tunnel (-1 without one, or a covered road under
    something), 0 on the ground. A passage through a building stays on the ground."""
    lay = num(t.get("layer").lstrip("-")) if t.get("layer") else None
    if lay is not None and t.get("layer", "").strip().startswith("-"):
        lay = -lay
    if t.get("bridge") and t.get("bridge") != "no":
        return int(lay) if lay and lay > 0 else 1
    if t.get("tunnel") in ("yes", "culvert", "flooded") or (t.get("covered") == "yes" and lay and lay < 0):
        return int(lay) if lay and lay < 0 else -1
    return 0


TILE = 0.04   # degrees: about 3.5 x 4.4 km here


def tile_of(pts):
    """The tile of an encoded line's middle point."""
    x, y, xs, ys = round(ORIGIN[0] * 1e7), round(ORIGIN[1] * 1e7), [], []
    for k in range(0, len(pts), 2):
        x += pts[k]; y += pts[k + 1]
        xs.append(x); ys.append(y)
    m = len(xs) // 2
    return f"{math.floor(xs[m] / 1e7 / TILE)}_{math.floor(ys[m] / 1e7 / TILE)}"


TURN_BITS = {"left": 1, "sharp_left": 1, "slight_left": 2, "through": 4, "slight_right": 8, "right": 16, "sharp_right": 16}


def turn_code(v):
    """A lane's turn:lanes value ("left;through") as bits; 0 for none, merges and U-turns."""
    c = 0
    for x in v.split(";"):
        c |= TURN_BITS.get(x.strip(), 0)
    return c


def write_tiles(d, roads, areas, crossings, arrows=()):
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.endswith(".json"):
            os.remove(os.path.join(d, f))
    by = defaultdict(lambda: {"r": [], "a": [], "x": [], "t": []})
    for r in roads:
        by[tile_of(r[5])]["r"].append(r)
    for ar in areas:
        by[tile_of(ar)]["a"].append(ar)
    for c in crossings:
        by[tile_of(c[:2])]["x"].append(c)
    for t in arrows:
        by[tile_of(t[:2])]["t"].append(t)
    widths = {"road": set(), "motor": set(), "walk": set(), "path": set()}
    q = lambda w: max(0.5, round(w * 2) / 2)
    for r in roads:
        w, p = r[1] / 10, r[2] / 10
        k = "path" if r[0] == 1 else "motor" if r[0] == 2 else "road"
        widths[k].add(q(w))
        if k == "road":
            widths["walk"].add(max(1, round(w + 2 * p)))
    import time
    index = {"v": 2, "origin": ORIGIN, "unit": 1e-7, "tile": TILE, "source": "© OpenStreetMap contributors (ODbL)",
             "built": int(time.time()),   # the app's cache key: tiles of an older build are fetched again
             "widths": {k: sorted(v) for k, v in widths.items()}, "tiles": {}}
    total = 0
    for key, t in by.items():
        if not t["t"]:
            del t["t"]
        body = {"v": 2, "origin": ORIGIN, "unit": 1e-7, **t}
        path = os.path.join(d, f"{key}.json")
        with open(path, "w") as f:
            json.dump(body, f, separators=(",", ":"))
        index["tiles"][key] = len(t["r"])
        total += os.path.getsize(path)
    with open(os.path.join(d, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))
    add_context(d)
    import junctions   # scripts/junctions.py: each junction's surface, kerbs, islands, roundabouts (needs "c")
    junctions.main(d)
    lv = sum(1 for r in roads if r[7])
    print(f"{len(roads)} ways ({lv} on bridges or in tunnels), {len(areas)} squares, {len(crossings)} crossings -> "
          f"{len(by)} tiles in {d} ({total / 1e6:.1f} MB)")


CONTEXT_M = 60   # how far past its edge a tile sees its neighbours' roads


def add_context(d):
    """Each tile computed alone (athensRoads.decode) could not see past its edge: a road changing width, or a junction,
    right on it showed as a step or with no paving, because the other part was in the next tile. So each tile also
    gets its neighbours' roads that come within CONTEXT_M of it, as "c" (looked at, not drawn: the next tile draws
    them), and its own box, "b" [west, south, east, north] in degrees (what lies at a point outside it, the tile
    that owns that point draws)."""
    tiles = {}
    for f in os.listdir(d):
        if f.endswith(".json") and f != "index.json":
            with open(os.path.join(d, f)) as h:
                tiles[f[:-5]] = json.load(h)
    def pts_of(r):
        x, y, out = round(ORIGIN[0] * 1e7), round(ORIGIN[1] * 1e7), []
        for k in range(0, len(r[5]), 2):
            x += r[5][k]; y += r[5][k + 1]
            out.append((x / 1e7, y / 1e7))
        return out
    pts = {k: [pts_of(r) for r in t["r"]] for k, t in tiles.items()}
    added = 0
    for key, t in tiles.items():
        i, j = map(int, key.split("_"))
        w, s_, e, n = i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE
        mx = CONTEXT_M / (111320 * math.cos(math.radians((s_ + n) / 2))); my = CONTEXT_M / 110540
        ctx = []
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                nk = f"{i + di}_{j + dj}"
                if (di or dj) and nk in tiles:
                    for r, ps in zip(tiles[nk]["r"], pts[nk]):
                        if any(w - mx <= x <= e + mx and s_ - my <= y <= n + my for x, y in ps):
                            ctx.append(r)
        t["b"] = [round(w, 6), round(s_, 6), round(e, 6), round(n, 6)]
        t["c"] = ctx
        added += len(ctx)
        with open(os.path.join(d, f"{key}.json"), "w") as h:
            json.dump(t, h, separators=(",", ":"))
    ip = os.path.join(d, "index.json")
    if os.path.exists(ip):   # a new stamp: browsers keep tiles by it, and these changed
        import time
        with open(ip) as h:
            ix = json.load(h)
        ix["built"] = int(time.time())
        with open(ip, "w") as h:
            json.dump(ix, h, separators=(",", ":"))
    print(f"context: {added} neighbouring ways over {len(tiles)} tiles")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("--out", default="src/data/athens-roads.json")
    ap.add_argument("--tiles", default=None)
    ap.add_argument("--context", default=None)
    a = ap.parse_args()
    if a.context:
        return add_context(a.context)
    els = read_elements(a.src)
    nodes = {e["id"]: e for e in els if e["type"] == "node"}
    ways = [e for e in els if e["type"] == "way" and "geometry" in e and e.get("tags", {}).get("highway")]

    # The drivable network: a node shared by two drivable ways (or met twice by one) is a junction.
    seen = defaultdict(int)
    prof = {}
    for w in ways:
        t = w["tags"]
        if t["highway"].replace("_link", "") not in DRIVE or t.get("area") == "yes" or t.get("service") == "alley":
            continue   # alleys (service=alley): left out, as on the base map (basemap.ts)
        prof[w["id"]] = profile(t)
        for n in set(w["nodes"]):
            seen[n] += 1
        seen[w["nodes"][0]] += 1   # an end of a way is a junction with whatever it meets
        seen[w["nodes"][-1]] += 1
    jr = defaultdict(float)        # junction node -> how far the markings stay back from it (m)
    for w in ways:
        p = prof.get(w["id"])
        if not p:
            continue
        for n in w["nodes"]:
            if seen[n] >= 2:
                jr[n] = max(jr[n], p["w"] / 2 + 2.5)

    on_way = defaultdict(list)     # node -> [(way, index)]
    for w in ways:
        if w["id"] in prof:
            for i, n in enumerate(w["nodes"]):
                on_way[n].append((w, i))
    crossings = []                 # [x, y, bearing of the road (0.1 deg, ccw from east), half the carriageway (dm)]
    for nid, n in nodes.items():
        t = n.get("tags", {})
        if t.get("highway") != "crossing":
            continue
        c = (t.get("crossing") or "").split(";")[0]
        if c not in ("traffic_signals", "uncontrolled", "marked", "zebra") and t.get("crossing_ref") != "zebra":
            continue
        if not on_way.get(nid):
            continue
        w, i = max(on_way[nid], key=lambda wi: prof[wi[0]["id"]]["w"])
        g = w["geometry"]
        a_, b_ = g[max(0, i - 1)], g[min(len(g) - 1, i + 1)]
        ax, ay = xy(a_["lon"], a_["lat"])
        bx, by = xy(b_["lon"], b_["lat"])
        if math.hypot(bx - ax, by - ay) < 0.5:
            continue
        ang = math.degrees(math.atan2(by - ay, bx - ax)) % 180
        crossings.append(enc([(n["lon"], n["lat"])]) + [round(ang * 10), round(prof[w["id"]]["w"] * 5)])

    # Which ends of a bridge or a tunnel meet the ground: an end node no other way at the same level shares. There the
    # app ramps the road down (or up) to the street and stands a tunnel's portal; where two pieces of one bridge
    # meet, it does not.
    lvl = {w["id"]: level_of(w["tags"]) for w in ways}
    at_node = defaultdict(set)
    for w in ways:
        for n in (w["nodes"][0], w["nodes"][-1]):
            at_node[n].add(lvl[w["id"]])
        for n in w["nodes"][1:-1]:
            at_node[n].add(lvl[w["id"]])
    def ends_of(w, rev=False):
        lv = lvl[w["id"]]
        if not lv:
            return 0
        a_, b_ = w["nodes"][0], w["nodes"][-1]
        if rev:
            a_, b_ = b_, a_
        # An end meets the ground when every other way there is on the ground; another bridge or tunnel piece
        # there (even of another layer: a stack's ramp) continues it, so no ramp down to the street between them.
        alone = lambda n: all(lvl[x] == 0 for x in ways_at[n] if x != w["id"])
        return (1 if alone(a_) else 0) | (2 if alone(b_) else 0)
    ways_at = defaultdict(list)
    for w in ways:
        for n in w["nodes"]:
            ways_at[n].append(w["id"])

    roads, areas, n_marks = [], [], 0
    arrows = []
    drive_at = defaultdict(set)    # node -> the drivable ways through or ending at it
    for w in ways:
        if w["id"] in prof:
            for n in w["nodes"]:
                drive_at[n].add(w["id"])
    for w in ways:
        t = w["tags"]
        hw = t["highway"]
        geo = [(g["lon"], g["lat"]) for g in w["geometry"]]
        if len(geo) < 2:
            continue
        pts = [xy(*g) for g in geo]
        if hw == "pedestrian" and t.get("area") == "yes" and w["nodes"][0] == w["nodes"][-1]:
            areas.append(enc(geo))
        elif hw == "pedestrian":
            wd = num(t.get("width")) or 6.0
            roads.append([1, round(min(wd, 20) * 10), 0, 0, 0, enc(geo), [], level_of(t), ends_of(w)])
        elif w["id"] in prof:
            p = prof[w["id"]]
            nids = w["nodes"]
            if p["rev"]:
                geo, pts, nids = geo[::-1], pts[::-1], nids[::-1]
            line = LineString(pts)
            marks = []
            L, lw, n = p["w"], p["lw"], p["lanes"]
            # The lanes' block: one-way, the parking strip on the right; two-way, half of it each side.
            centre = p["park"] / 2 if p["oneway"] else 0.0       # the block's centre, metres left of the centreline
            left = centre + (n * lw) / 2
            if p["oneway"]:
                bus = -(centre - (n * lw) / 2 + lw / 2)               # the right-hand lane's centre, metres right
                bwd = 0
            else:
                fwd = (int(t.get("lanes:forward") or 0) or (n + 1) // 2) if n > 1 else 1
                bwd = max(0, n - fwd) if n > 1 else 0
                bus = (n * lw) / 2 - lw / 2 if n > 1 else L / 4
            if p["marked"] and L >= 5:
                busl = (t.get("bus:lanes") or t.get("bus:lanes:forward") or "").split("|")
                for k in range(1, n):
                    d = left - k * lw
                    centreline = not p["oneway"] and k == bwd
                    yellow = p["oneway"] and any(busl[j] == "designated" for j in (k - 1, k) if 0 <= j < len(busl))
                    for o in offset(line, d):
                        marks.append((2 if yellow else 1 if centreline else 0, o))
                if p["hw"] in ("motorway", "trunk"):
                    for d in (left - 0.3, left - n * lw + 0.3):
                        for o in offset(line, d):
                            marks.append((4, o))
                if hw == "busway":
                    for d in (L / 2 - 0.25, -L / 2 + 0.25):
                        for o in offset(line, d):
                            marks.append((2, o))
            # Cut back at the junctions, so no line runs across a crossing street.
            holes = [Point(*xy(*g)).buffer(jr[nid], 8) for nid, g in zip(nids, geo) if jr.get(nid)]
            hole = unary_union(holes) if holes else None
            out = []
            for typ, g in marks:
                for q in (parts(g.difference(hole)) if hole is not None else [g]):
                    if q.length >= (DASH if typ == 0 else 2.0):
                        out.append([typ, enc([ll(x, y) for x, y in q.coords])])
            n_marks += len(out)
            # Turn arrows, one per lane, 18 m before the junction its lanes come up to, when OSM says (turn:lanes, one
            # value per lane, left to right as driven): the lanes the way it is drawn at its end, those against it at
            # its start. Lanes as above: the forward ones right of the backward ones.
            if line.length >= 25:
                def put(spec, offs, s, sense):
                    vals = spec.split("|")
                    if len(vals) != len(offs):
                        return
                    a_, b_ = line.interpolate(max(0, s - 1)), line.interpolate(min(line.length, s + 1))
                    tx, ty = b_.x - a_.x, b_.y - a_.y
                    tl = math.hypot(tx, ty) or 1
                    tx, ty = tx / tl, ty / tl
                    c_ = line.interpolate(s)
                    for v, o in zip(vals, offs):
                        code = turn_code(v)
                        if not code:
                            continue
                        x_, y_ = c_.x - ty * o, c_.y + tx * o
                        ang = math.degrees(math.atan2(ty * sense, tx * sense)) % 360
                        arrows.append(enc([ll(x_, y_)]) + [round(ang * 10) % 3600, code, level_of(t)])
                junction = lambda nid: len(drive_at[nid]) >= 3 or (len(drive_at[nid]) >= 2 and seen[nid] >= 3)
                if p["oneway"]:
                    offs = [left - lw / 2 - j * lw for j in range(n)]
                    if t.get("turn:lanes") and junction(nids[-1]):
                        put(t["turn:lanes"], offs, line.length - 18, 1)
                else:
                    fwd_n = n - bwd
                    if t.get("turn:lanes:forward") and junction(nids[-1]):
                        put(t["turn:lanes:forward"], [left - lw / 2 - (bwd + j) * lw for j in range(fwd_n)], line.length - 18, 1)
                    if t.get("turn:lanes:backward") and bwd and junction(nids[0]):
                        put(t["turn:lanes:backward"], [left - lw / 2 - (bwd - 1 - j) * lw for j in range(bwd)], 18, -1)
            kind = 2 if p["hw"] in ("motorway", "trunk") and p["pave"] == 0 else 0
            roads.append([kind, round(L * 10), round(p["pave"] * 10), 1 if p["oneway"] else 0, round(bus * 10), enc(geo), out,
                          level_of(t), ends_of(w, p["rev"])])

    if a.tiles:
        write_tiles(a.tiles, roads, areas, crossings, arrows)
        return
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump({"v": 1, "origin": ORIGIN, "unit": 1e-7, "source": "© OpenStreetMap contributors (ODbL)",
                   "r": roads, "a": areas, "x": crossings, "t": arrows}, f, separators=(",", ":"))
    print(f"{len(roads)} ways, {len(areas)} squares, {n_marks} lines, {len(crossings)} crossings -> {a.out} "
          f"({os.path.getsize(a.out) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
