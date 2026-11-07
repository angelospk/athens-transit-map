#!/usr/bin/env python3
"""Junctions and roundabouts for the 3D streets, worked out once per tile with real polygon geometry (shapely).

The streets are drawn as lines at their widths, one way at a time; where several ways meet, their ends, edges and the
gaps between them piled up: wedges, slivers, steps, kerbs across the road. So here, for each junction:

  - its zone: a disc round each junction point (1.5 x the widest road's half width there, and R + 2 m); discs that
    touch make one junction (two divided roads crossing: four points, one zone);
  - its surface: every carriageway in it as a polygon (flat ends, round joins), joined; then closed by R (grown by R,
    shrunk by R back): a gap narrower than 2R between two carriageways is paved, and every inside corner gets a kerb
    radius of R; only inside the zone, so a divided road keeps its median between junctions;
  - its holes: a small one (under 25 m2), or one with four or more junction points round it (the middle of two divided
    roads crossing), is paved; any other is an island (the one between a slip road and the junction, a pork chop), and
    is drawn as pavement with a kerb;
  - its kerbs: the surface's edge inside the zone (where the zone's own edge cuts across a road, none);
  - a roundabout (a ring of one-way ways, nearly round, 50-12000 m2 inside) is fitted with a circle: its carriageway an
    exact ring at the ways' width, its middle an island, a dashed lane line round it when it is 7 m wide or more.

Written into each tile (they must already have their neighbours' roads, "c": roads.py add_context):
    "j": [[own, ring, hole, ...], ...]   a junction's surface; own 1 if this tile draws it (its middle is in the tile),
                                         0 if it is only for cutting this tile's lane lines
    "k": [line, ...]                     kerbs                    "i": [[ring, hole, ...], ...]   islands
    "o": [[x, y, R cm, half cm], ...]    roundabouts' lane lines   "w": [[ring, ...], ...]         pavement round them
Points as everywhere in the tiles (roads.py enc).

Usage:  python3 scripts/junctions.py public/roads
"""
import json, math, os, sys, time
from collections import defaultdict
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import linemerge, polygonize, unary_union
from shapely.strtree import STRtree

ORIGIN = [23.73, 37.99]
KX = 111320 * math.cos(math.radians(ORIGIN[1]))
KY = 110540
R = 4.0             # m: the kerb radius at an inside corner; gaps under 2R in a junction are paved
CONTEXT_M = 60
TOL = 0.2         # m: outlines kept to 20 cm (what shows at street zoom), so the tiles stay small
FLAT, ROUND = 2, 1  # shapely cap/join styles


def xy(lon, lat):
    return ((lon - ORIGIN[0]) * KX, (lat - ORIGIN[1]) * KY)


def enc_xy(pts):
    out, px, py = [], round(ORIGIN[0] * 1e7), round(ORIGIN[1] * 1e7)
    for x, y in pts:
        X, Y = round((ORIGIN[0] + x / KX) * 1e7), round((ORIGIN[1] + y / KY) * 1e7)
        out += [X - px, Y - py]
        px, py = X, Y
    return out


def dec(d):
    x, y, out = round(ORIGIN[0] * 1e7), round(ORIGIN[1] * 1e7), []
    for k in range(0, len(d) - 1, 2):
        x += d[k]; y += d[k + 1]
        out.append((x / 1e7, y / 1e7))
    return out


def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]


def lines(g):
    if g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    out = []
    for p in getattr(g, "geoms", []):
        out += lines(p)
    return out


def ring_enc(r, step=0):
    c = list(r.coords)
    return enc_xy(c)


def circle_fit(pts):
    """Least-squares circle (Kasa) through points: centre and radius."""
    n = len(pts)
    sx = sum(p[0] for p in pts) / n; sy = sum(p[1] for p in pts) / n
    u = [(p[0] - sx, p[1] - sy) for p in pts]
    suu = sum(a * a for a, b in u); svv = sum(b * b for a, b in u); suv = sum(a * b for a, b in u)
    suuu = sum(a ** 3 for a, b in u); svvv = sum(b ** 3 for a, b in u)
    suvv = sum(a * b * b for a, b in u); svuu = sum(b * a * a for a, b in u)
    det = suu * svv - suv * suv
    if abs(det) < 1e-9:
        return None
    uc = (0.5 * (suuu + suvv) * svv - 0.5 * (svvv + svuu) * suv) / det
    vc = (0.5 * (svvv + svuu) * suu - 0.5 * (suuu + suvv) * suv) / det
    cx, cy = uc + sx, vc + sy
    rad = sum(math.hypot(p[0] - cx, p[1] - cy) for p in pts) / n
    return cx, cy, rad


def tile_junctions(t, key, tile):
    i, j = map(int, key.split("_"))
    box = (i * tile, j * tile, (i + 1) * tile, (j + 1) * tile)
    bx0, by0 = xy(box[0], box[1]); bx1, by1 = xy(box[2], box[3])
    def mine(x, y):
        return bx0 <= x < bx1 and by0 <= y < by1
    reach = Polygon([(bx0 - CONTEXT_M, by0 - CONTEXT_M), (bx1 + CONTEXT_M, by0 - CONTEXT_M), (bx1 + CONTEXT_M, by1 + CONTEXT_M), (bx0 - CONTEXT_M, by1 + CONTEXT_M)])

    ways = []   # (xy points, half, pave, oneway, node keys)
    for r in t["r"] + t.get("c", []):
        kind, wdm, pdm, oneway, pts = r[0], r[1], r[2], r[3], r[5]
        lv = r[7] if len(r) > 7 else 0
        if kind == 1 or lv:
            continue
        ll_ = dec(pts)
        if len(ll_) < 2:
            continue
        keys = [(round(lo * 1e7), round(la * 1e7)) for lo, la in ll_]
        p = [xy(lo, la) for lo, la in ll_]
        ways.append((p, max(0.5, round(wdm / 10 * 2) / 2) / 2, pdm / 10, oneway, keys))
    if not ways:
        return {}
    arms = defaultdict(int); widest = defaultdict(float); pos = {}; at = defaultdict(list)
    for wi, (p, h, pv, ow, keys) in enumerate(ways):
        for n, k in enumerate(keys):
            arms[k] += 1 if n in (0, len(keys) - 1) else 2
            widest[k] = max(widest[k], h)
            pos[k] = p[n]
            at[k].append(wi)
    jpts = [k for k, a in arms.items() if a >= 3]
    geoms = [LineString(p) for p, *_ in ways]
    tree = STRtree(geoms)

    # Roundabouts: faces of the one-way network, round and small.
    rbs = []
    ow_lines = [geoms[wi] for wi, w in enumerate(ways) if w[3]]
    if ow_lines:
        net = unary_union(ow_lines)
        cover = net.buffer(1.0)
        for face in polygonize(net):
            a = face.area
            if not 50 <= a <= 12000:
                continue
            per = face.exterior.length
            if 4 * math.pi * a / per ** 2 < 0.9:   # a circle 1, a hexagon 0.91, a square block 0.79
                continue
            if face.exterior.difference(cover).length > 0.05 * per:
                continue
            pts = [face.exterior.interpolate(d).coords[0] for d in [k * per / 72 for k in range(72)]]
            fit = circle_fit(pts)
            if not fit:
                continue
            cx, cy, rad = fit
            if rad > 45 or max(abs(math.hypot(x - cx, y - cy) - rad) for x, y in pts) > max(1.5, 0.1 * rad):
                continue
            ex = face.exterior.buffer(1.5)
            ring = [wi for wi in tree.query(ex) if ways[wi][3] and geoms[wi].difference(ex).length < 0.25 * geoms[wi].length]
            if not ring:
                continue
            h = sorted(ways[wi][1] for wi in ring)[len(ring) // 2]
            pv = max(ways[wi][2] for wi in ring)
            rbs.append({"c": (cx, cy), "R": rad, "h": h, "pave": pv, "ring": set(ring)})
    ringways = set().union(*[rb["ring"] for rb in rbs]) if rbs else set()

    # The zones, joined into junctions.
    discs = [Point(pos[k]).buffer(min(22.0, 1.5 * widest[k] + R + 2), 16) for k in jpts]
    discs += [Point(rb["c"]).buffer(rb["R"] + rb["h"] + R + 4, 32) for rb in rbs]
    if not discs:
        return {}
    zones = polys(unary_union(discs))
    out = {"j": [], "k": [], "i": [], "o": [], "w": []}
    jtree = STRtree([Point(pos[k]) for k in jpts]) if jpts else None
    for zone in zones:
        if not zone.intersects(reach):
            continue
        c = zone.centroid
        own = 1 if mine(c.x, c.y) else 0
        near = zone.buffer(R + 3)
        wis = [wi for wi in tree.query(near) if wi not in ringways]
        # Round ends, as the map draws each way (so nothing it draws sticks out of the surface), and where a road
        # changes width, the change made gradual (6 m per metre of difference), as roads.py's taper in the app.
        parts = [geoms[wi].intersection(near).buffer(ways[wi][1], 8, cap_style=ROUND, join_style=ROUND) for wi in wis]
        parts = [p for p in parts if not p.is_empty]
        for k in set(k for wi in wis for k in (ways[wi][4][0], ways[wi][4][-1])):
            if arms[k] != 2 or len(at[k]) != 2 or not zone.buffer(10).contains(Point(pos[k])):
                continue
            a, b = at[k]
            if a == b or abs(ways[a][1] - ways[b][1]) < 0.375:
                continue
            wide, nar = (a, b) if ways[a][1] > ways[b][1] else (b, a)
            g = geoms[nar] if ways[nar][4][0] == k else LineString(list(geoms[nar].coords)[::-1])
            L = min(30.0, max(10.0, 12 * (ways[wide][1] - ways[nar][1])), 0.95 * g.length)
            if L < 2:
                continue
            p0 = g.interpolate(0); p1 = g.interpolate(min(1.0, L)); pL = g.interpolate(L); pB = g.interpolate(max(0.0, L - 1))
            def cross(pt, q, h):
                dx, dy = q.x - pt.x, q.y - pt.y; n = math.hypot(dx, dy) or 1
                return [(pt.x - dy / n * h, pt.y + dx / n * h), (pt.x + dy / n * h, pt.y - dx / n * h)]
            hw, hn = ways[wide][1], ways[nar][1]
            mid = [g.interpolate(L * f) for f in (0.25, 0.5, 0.75)]
            pts = cross(p0, p1, hw)
            for f, m in zip((0.25, 0.5, 0.75), mid):
                sm = f * f * (3 - 2 * f); q = g.interpolate(min(g.length, L * f + 1))
                pts += cross(m, q, hw + (hn - hw) * sm)
            pts += [tuple(c) for c in cross(pB, pL, hn)]
            parts.append(Polygon(pts).convex_hull if False else unary_union([Polygon(pts[i:i + 2] + pts[i + 2:i + 4][::-1]).convex_hull for i in range(0, len(pts) - 2, 2)]))
        rb_here = [rb for rb in rbs if zone.contains(Point(rb["c"]))]
        islands = []
        for rb in rb_here:
            outer = Point(rb["c"]).buffer(rb["R"] + rb["h"], 32)
            inner = Point(rb["c"]).buffer(max(0.0, rb["R"] - rb["h"]), 32)
            parts.append(outer.difference(inner))
            if rb["R"] - rb["h"] > 1.5:
                islands.append(inner)
        if not parts:
            continue
        S = unary_union(parts)
        C = S.buffer(R, 8, join_style=ROUND).buffer(-R, 8, join_style=ROUND)
        C = C.union(S)
        for isl in islands:
            C = C.difference(isl)
        P = C.intersection(zone)
        # A median (or any gap the closing paved) that goes on out of the zone ends in a round nose, its half width
        # back into the zone, not cut straight where the zone ends.
        gaps = C.difference(S)
        out_ = gaps.difference(zone)
        if not out_.is_empty:
            noses = out_.buffer(2.5, 16).intersection(gaps)
            P = P.difference(noses).buffer(0)
        kept = []
        res = []
        for poly in polys(P):
            holes = []
            for hole in poly.interiors:
                H = Polygon(hole)
                if any(H.buffer(0.5).contains(isl.buffer(-0.5)) for isl in islands):
                    holes.append(hole); kept.append(H); continue
                n = len(jtree.query(H.buffer(12.0))) if jtree else 0
                if H.area < 25 or (n >= 4 and H.area < 1500):
                    continue   # paved
                holes.append(hole); kept.append(H)
            res.append(Polygon(poly.exterior, holes))
        if not res:
            continue
        P = unary_union(res)
        # The small faces the roads enclose here (a slip road's island, a median's end): pavement, inside the kerbs.
        wide_ = zone.buffer(45)
        near_w = list(tree.query(wide_))
        net = unary_union([geoms[wi] for wi in near_w])
        faces = [f for f in polygonize(net) if f.area < 500 and f.intersects(zone)]
        if faces:
            roads_ = unary_union([geoms[wi].buffer(ways[wi][1], 16, cap_style=ROUND, join_style=ROUND) for wi in near_w]).union(P)
            for face in faces:
                for isl in polys(face.difference(roads_).buffer(-0.45, 8).buffer(0.4, 8)):   # its tips rounded
                    if isl.area > 3 and isl.distance(zone) < 1:
                        kept.append(isl)
        else:
            roads_ = unary_union([geoms[wi].buffer(ways[wi][1], 16, cap_style=ROUND, join_style=ROUND) for wi in near_w]).union(P)
        # And what is open on one side only (between a road coming in and one going out, a splitter island): a
        # piece of the zone not on any road, with road round most of it (70%), small.
        edge = roads_.buffer(0.3)
        for bit in polys(zone.difference(roads_)):
            if 3 < bit.area < 400 and not any(k.intersects(bit.buffer(-0.5)) for k in kept):
                per = bit.exterior.length
                if bit.exterior.intersection(edge).length >= 0.7 * per:   # a block's corner: about 0.55
                    for isl in polys(bit.buffer(-0.45, 8).buffer(0.4, 8)):
                        if isl.area > 3:
                            kept.append(isl)
        for poly in polys(P):
            out["j"].append([own] + [enc_xy(poly.exterior.simplify(TOL).coords)] + [enc_xy(r.simplify(TOL).coords) for r in poly.interiors])
        if not own:
            continue
        # Kerbs: the surface's edge inside the zone, but not where it runs over a carriageway (a way the closing did
        # not reach, a cut): a kerb is only where road meets pavement.
        inside = zone.buffer(-0.3).difference(S.buffer(-0.25))
        for ln in lines(linemerge(lines(P.boundary.intersection(inside)))):
            if ln.length >= 0.8:
                out["k"].append(enc_xy(ln.simplify(TOL).coords))
        for H in kept:
            out["i"].append([enc_xy(H.exterior.simplify(TOL).coords)])
        for rb in rb_here:
            if 2 * rb["h"] >= 7:
                lo, la = ORIGIN[0] + rb["c"][0] / KX, ORIGIN[1] + rb["c"][1] / KY
                out["o"].append(enc_xy([rb["c"]]) + [round(rb["R"] * 100), round(rb["h"] * 100)])
        for rb in rb_here:   # a roundabout's pavement round it, a ring too (its ways' own is a polygon)
            for poly in polys(Point(rb["c"]).buffer(rb["R"] + rb["h"] + max(1.5, rb["pave"]), 64)):
                out["w"].append([enc_xy(poly.exterior.coords)])
    return out


def main(d, only=()):
    with open(os.path.join(d, "index.json")) as h:
        ix = json.load(h)
    tile = ix["tile"]
    keys = sorted(k for k in ix["tiles"])
    if only:
        keys = [k for k in keys if k in only]
    t0 = time.time()
    tot = defaultdict(int)
    if os.environ.get("PART"):   # PART=i/n: every n-th tile from the i-th (to run several at once)
        a, b = map(int, os.environ["PART"].split("/"))
        keys = keys[a::b]
    for n, key in enumerate(keys):
        p = os.path.join(d, f"{key}.json")
        with open(p) as h:
            t = json.load(h)
        for k in ("j", "k", "i", "o", "w"):
            t.pop(k, None)
        res = tile_junctions(t, key, tile)
        for k, v in res.items():
            if v:
                t[k] = v
                tot[k] += len(v)
        with open(p, "w") as h:
            json.dump(t, h, separators=(",", ":"))
        if n % 20 == 0:
            print(f"{n + 1}/{len(keys)} {key} {time.time() - t0:.0f}s", flush=True)
    if not only and not os.environ.get("PART"):
        ix["built"] = int(time.time())
        with open(os.path.join(d, "index.json"), "w") as h:
            json.dump(ix, h, separators=(",", ":"))
    print(dict(tot), f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
