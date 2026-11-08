#!/usr/bin/env python3
"""Drop the alleys (OSM service=alley) from the 3D streets already built (public/roads), without the Overpass extract
they were built from: the base map's vector tiles (OpenFreeMap, zoom 14) still say which lines are alleys.

A built road is an alley when most of it (ALONG of its length) lies within NEAR metres of an alley line of the
vector tiles, and it is a narrow street (kind 0, at most MAX_W wide). Every tile is then written again with
roads.write_tiles, which rebuilds the tiles' context and junctions without them. scripts/roads.py leaves alleys
out of new builds itself.

    python3 scripts/strip_alleys.py public/roads
"""
import concurrent.futures as cf
import glob
import json
import math
import os
import sys
import urllib.request

import mapbox_vector_tile
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(__file__))
import roads  # noqa: E402

Z = 14
NEAR = 3.0      # metres
ALONG = 0.75    # share of a road's points that must be near an alley
MAX_W = 70      # decimetres: wider than this is a street, whatever the tiles say


UA = {"User-Agent": "staseis-roads/1.0 (scripts/strip_alleys.py)"}   # the tile server refuses Python's default one


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()


def tile_url():
    return json.loads(get("https://tiles.openfreemap.org/planet"))["tiles"][0]


def xyz(lon, lat):
    n = 2 ** Z
    return (int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))


def to_lonlat(tx, ty, px, py, extent):
    n = 2 ** Z
    lon = (tx + px / extent) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + 1 - py / extent) / n))))
    return lon, lat


def alleys_in(url, tx, ty):
    """The alley lines of one vector tile, in metres around roads.ORIGIN."""
    try:
        data = get(url.format(z=Z, x=tx, y=ty))
    except Exception as e:  # a missing tile: nothing to drop there
        print(f"tile {tx}/{ty}: {e}", file=sys.stderr)
        return []
    layer = mapbox_vector_tile.decode(data, default_options={"y_coord_down": False}).get("transportation")
    if not layer:
        return []
    ext, out = layer.get("extent", 4096), []
    for f in layer["features"]:
        p = f["properties"]
        if p.get("class") != "service" or p.get("service") != "alley":
            continue
        g = f["geometry"]
        lines = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]] if g["type"] == "LineString" else []
        for line in lines:
            pts = [roads.xy(*to_lonlat(tx, ty, px, py, ext)) for px, py in line]
            if len(pts) >= 2:
                out.append(LineString(pts))
    return out


def decode(pts):
    x, y, out = round(roads.ORIGIN[0] * 1e7), round(roads.ORIGIN[1] * 1e7), []
    for k in range(0, len(pts), 2):
        x += pts[k]; y += pts[k + 1]
        out.append(roads.xy(x / 1e7, y / 1e7))
    return out


def main(d):
    files = [f for f in glob.glob(os.path.join(d, "*_*.json"))]
    tiles = [json.load(open(f)) for f in files]
    rs = [r for t in tiles for r in t.get("r", [])]
    areas = [a for t in tiles for a in t.get("a", [])]
    crossings = [c for t in tiles for c in t.get("x", [])]
    arrows = [a for t in tiles for a in t.get("t", [])]

    # The vector tiles under the road tiles.
    want = set()
    for f in files:
        i, j = map(int, os.path.basename(f)[:-5].split("_"))
        x0, y1 = xyz(i * roads.TILE, j * roads.TILE)
        x1, y0 = xyz((i + 1) * roads.TILE, (j + 1) * roads.TILE)
        want |= {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}
    url = tile_url()
    print(f"{len(rs)} roads in {len(files)} tiles; reading {len(want)} vector tiles")
    lines = []
    with cf.ThreadPoolExecutor(8) as ex:
        for got in ex.map(lambda t: alleys_in(url, *t), sorted(want)):
            lines += got
    print(f"{len(lines)} alley lines")
    tree = STRtree(lines)

    def alley(r):
        if r[0] != 0 or r[1] > MAX_W:
            return False
        pts = decode(r[5])
        near = sum(1 for p in pts if any(lines[k].distance(Point(p)) <= NEAR for k in tree.query(Point(p).buffer(NEAR))))
        return near >= ALONG * len(pts)

    keep = [r for r in rs if not alley(r)]
    print(f"{len(rs) - len(keep)} alleys dropped")
    roads.write_tiles(d, keep, areas, crossings, arrows)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/roads")
