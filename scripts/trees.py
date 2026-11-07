#!/usr/bin/env python3
"""Street trees for the 3D mode (src/lib/map/scene3d.ts), from the Meta / WRI canopy height map.

The source is a ~1 m canopy height raster (Cloud Optimized GeoTIFF, EPSG:3857), one file per zoom-9 quadkey:
https://registry.opendata.aws/dataforgood-fb-forests/ . Each tree is a local peak of the smoothed canopy, 4 m or
taller; its height is the raster's value there. The trees are cut into zoom-14 web-mercator tiles and written as

    public/trees/14/<x>/<y>.json   {"t": [lonE6, latE6, heightDm, lonE6, latE6, heightDm, ...]}
    public/trees/index.json        {"z": 14, "tiles": ["x/y", ...]}

so the map loads only the tiles in view, only in 3D. The raster is read with HTTP range requests (no full download).

Usage:  pip install rasterio scipy numpy
        python3 scripts/trees.py [--bbox W,S,E,N] [--src path-or-url] [--out public/trees]
Default bbox: central Athens. A bbox over several quadkeys needs one run per source file (--src).
"""
import argparse, json, math, os
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy.ndimage import gaussian_filter, maximum_filter

Z = 14
BASE = "https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/"
R = 6378137.0


def quadkey(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return "".join(str(((x >> i) & 1) + 2 * ((y >> i) & 1)) for i in range(z - 1, -1, -1))


def tile_xy(lon, lat):
    n = 2 ** Z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def tile_merc_bounds(x, y):
    """The tile's bounds in EPSG:3857 metres (west, south, east, north)."""
    size = 2 * math.pi * R / 2 ** Z
    west = -math.pi * R + x * size
    north = math.pi * R - y * size
    return west, north - size, west + size, north


def merc_to_lonlat(mx, my):
    return np.degrees(mx / R), np.degrees(2 * np.arctan(np.exp(my / R)) - math.pi / 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default="23.700,37.955,23.775,38.000")
    ap.add_argument("--src", default=None, help="a local GeoTIFF or URL; default: the quadkey file of the bbox centre")
    ap.add_argument("--out", default="public/trees")
    ap.add_argument("--min-height", type=float, default=4.0)
    a = ap.parse_args()
    w, s, e, n = map(float, a.bbox.split(","))
    src = a.src or "/vsicurl/" + BASE + quadkey((w + e) / 2, (s + n) / 2, 9) + ".tif"
    x0, y0 = tile_xy(w, n)
    x1, y1 = tile_xy(e, s)
    tiles, total = [], 0
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    with rasterio.open(src) as ds:
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                b = tile_merc_bounds(x, y)
                win = from_bounds(*b, transform=ds.transform).round_offsets().round_lengths()
                a_ = ds.read(1, window=win, boundless=True, fill_value=0).astype("float32")
                if a_.size == 0 or not a_.any():
                    continue
                t = ds.window_transform(win)
                sm = gaussian_filter(a_, 0.8)
                peaks = (sm == maximum_filter(sm, size=7)) & (a_ >= a.min_height) & (sm > 0)
                ys, xs = np.nonzero(peaks)
                if not len(xs):
                    continue
                mx = t.c + t.a * (xs + 0.5)
                my = t.f + t.e * (ys + 0.5)
                keep = (mx >= b[0]) & (mx < b[2]) & (my > b[1]) & (my <= b[3])   # this tile only, no duplicates
                lon, lat = merc_to_lonlat(mx[keep], my[keep])
                h = a_[ys[keep], xs[keep]]
                flat = np.column_stack([np.round(lon * 1e6), np.round(lat * 1e6), np.round(h * 10)]).astype(int).ravel().tolist()
                d = os.path.join(a.out, str(Z), str(x))
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, f"{y}.json"), "w") as f:
                    json.dump({"t": flat}, f, separators=(",", ":"))
                tiles.append(f"{x}/{y}")
                total += len(flat) // 3
    with open(os.path.join(a.out, "index.json"), "w") as f:
        json.dump({"z": Z, "source": "Meta / WRI High Resolution Canopy Height Maps (CC BY 4.0)", "tiles": sorted(tiles)}, f,
                  separators=(",", ":"))
    print(f"{len(tiles)} tiles, {total} trees -> {a.out}")


if __name__ == "__main__":
    main()
