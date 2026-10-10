#!/usr/bin/env python3
"""Pilot: typical bus speed per road segment (stop to stop), as one GeoJSON.

Usage: python3 lab/segspeed/build.py <history_dir> <out.geojson> [line ...]
  history_dir: hourly CSV.gz from `docker cp atrt-atrt-1:/var/lib/atrt/history <dir>`
  lines: line ids (default: all lines in the history)

Observation = two consecutive fixes of one vehicle on one line, 5-120 s apart,
straight-line speed <= 25 m/s. The pair's midpoint is snapped to the line's
shape (variant = route_code) and credited to the stop-to-stop segment there.
Segments with the same (from_stop, to_stop) on different lines are merged.
Offline only; not part of the app build.
"""
import csv, gzip, json, math, os, sys, urllib.request
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

BASE = "https://angelospk.github.io/athens-transit-rt/static/v1/lines/"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
ATH = ZoneInfo("Europe/Athens")
LAT0 = 37.98
KX = 111320 * math.cos(math.radians(LAT0))  # m per deg lon
KY = 110540  # m per deg lat
SNAP_M = 35  # max midpoint-to-shape distance
MIN_SAMPLES = 5
PARKED_S = 180  # stationary longer than this = layover, dropped


def xy(lat, lon):
    return (np.asarray(lon) - 23.73) * KX, (np.asarray(lat) - LAT0) * KY


def load_line(lid):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, f"{lid}.json")
    if not os.path.exists(p):
        try:
            with urllib.request.urlopen(BASE + urllib.parse.quote(lid) + ".json", timeout=20) as r:
                data = r.read()
        except Exception as e:  # line without static data
            print(f"skip {lid}: {e}", file=sys.stderr)
            return None
        open(p, "wb").write(data)
    return json.load(open(p))


class Shape:
    """A variant's polyline with cumulative distance and stop positions along it."""

    def __init__(self, variant, stops):
        pts = np.array(variant["shape"], dtype=float)
        self.latlon = pts
        self.x, self.y = xy(pts[:, 0], pts[:, 1])
        d = np.hypot(np.diff(self.x), np.diff(self.y))
        self.cum = np.concatenate([[0], np.cumsum(d)])
        ids = [s for s in variant["stops"] if s in stops]
        sx, sy = xy([stops[s]["lat"] for s in ids], [stops[s]["lon"] for s in ids])
        # monotonic snap: each stop at or after the previous one
        ss, last = [], 0.0
        for i in range(len(ids)):
            s, _ = self.snap(np.array([sx[i]]), np.array([sy[i]]), lo=last)
            last = max(last, float(s[0]))
            ss.append(last)
        self.stop_ids, self.stop_s = ids, np.array(ss)

    def snap(self, px, py, lo=0.0):
        """Project points to the polyline; returns (s along shape, distance)."""
        ax, ay = self.x[:-1], self.y[:-1]
        dx, dy = np.diff(self.x), np.diff(self.y)
        L2 = np.maximum(dx * dx + dy * dy, 1e-9)
        best_s = np.zeros(len(px))
        best_d = np.full(len(px), np.inf)
        for c in range(0, len(px), 2000):
            X, Y = px[c:c + 2000, None], py[c:c + 2000, None]
            t = np.clip(((X - ax) * dx + (Y - ay) * dy) / L2, 0, 1)
            qx, qy = ax + t * dx, ay + t * dy
            dist = np.hypot(X - qx, Y - qy)
            s = self.cum[:-1] + t * np.sqrt(L2)
            dist = np.where(s >= lo - 1, dist, np.inf)
            k = np.argmin(dist, axis=1)
            r = np.arange(len(k))
            best_s[c:c + 2000] = s[r, k]
            best_d[c:c + 2000] = dist[r, k]
        return best_s, best_d

    def slice(self, s0, s1):
        """Lat/lon coordinates of the shape between s0 and s1."""
        def at(s):
            i = min(max(int(np.searchsorted(self.cum, s)) - 1, 0), len(self.cum) - 2)
            f = (s - self.cum[i]) / max(self.cum[i + 1] - self.cum[i], 1e-9)
            a, b = self.latlon[i], self.latlon[i + 1]
            return [round(a[1] + f * (b[1] - a[1]), 5), round(a[0] + f * (b[0] - a[0]), 5)]
        inner = [[round(p[1], 5), round(p[0], 5)] for p, c in zip(self.latlon, self.cum) if s0 < c < s1]
        return [at(s0)] + inner + [at(s1)]


def read_pairs(hist_dir, lines):
    """Consecutive fix pairs per vehicle -> {(line, route): [(t_mid, lat, lon, v_mps)]}."""
    rows = defaultdict(list)
    for f in sorted(os.listdir(hist_dir)):
        if not f.endswith(".csv.gz"):
            continue
        with gzip.open(os.path.join(hist_dir, f), "rt") as fh:
            for r in csv.DictReader(fh):
                if lines and r["line"] not in lines:
                    continue
                rows[r["veh"]].append((int(r["fix_t"]), r["line"], r["route_code"],
                                       int(r["lat"]) / 1e6, int(r["lon"]) / 1e6))
    pairs = defaultdict(list)
    for fixes in rows.values():
        fixes.sort()
        run = []  # current stationary run: a bus standing > PARKED_S is parked, not in traffic
        def flush():
            if run and run[-1][1][0] - run[0][1][0] <= PARKED_S:
                for key, obs in run:
                    pairs[key].append(obs)
            run.clear()
        for a, b in zip(fixes, fixes[1:]):
            dt = b[0] - a[0]
            if not (5 <= dt <= 120) or a[1] != b[1] or a[2] != b[2]:
                flush()
                continue
            dx = (b[4] - a[4]) * KX
            dy = (b[3] - a[3]) * KY
            v = math.hypot(dx, dy) / dt
            if v > 25:
                flush()
                continue
            obs = ((a[0] + b[0]) / 2, (a[3] + b[3]) / 2, (a[4] + b[4]) / 2, v)
            if v < 1.0:
                run.append(((a[1], a[2]), obs))
                continue
            flush()
            pairs[(a[1], a[2])].append(obs)
        flush()
    return pairs


def is_peak(t):
    d = datetime.fromtimestamp(t, ATH)
    return d.weekday() < 5 and (7 <= d.hour < 10 or 14 <= d.hour < 18)


def main():
    hist, out, *lines = sys.argv[1:]
    lines = set(lines)
    pairs = read_pairs(hist, lines)
    print(f"{sum(map(len, pairs.values()))} pairs on {len({k[0] for k in pairs})} lines", file=sys.stderr)
    # seg key -> {"geom", "v": [], "peak": [], "off": [], "lines": set}
    segs = {}
    by_line = defaultdict(dict)
    for (lid, rc), obs in pairs.items():
        by_line[lid][rc] = obs
    for lid, routes in sorted(by_line.items()):
        data = load_line(lid)
        if not data:
            continue
        shapes = {}
        for rc, obs in routes.items():
            if rc not in data["variants"]:
                continue
            if rc not in shapes:
                shapes[rc] = Shape(data["variants"][rc], data["stops"])
            sh = shapes[rc]
            if len(sh.stop_ids) < 2:
                continue
            o = np.array(obs)
            px, py = xy(o[:, 1], o[:, 2])
            s, dist = sh.snap(px, py)
            ok = dist <= SNAP_M
            k = np.searchsorted(sh.stop_s, s, side="right") - 1
            n = len(sh.stop_ids)
            for i in np.nonzero(ok & (k >= 0) & (k < n - 1))[0]:
                j = int(k[i])
                s0, s1 = sh.stop_s[j], sh.stop_s[j + 1]
                if s1 - s0 < 20:
                    continue
                v = o[i, 3]
                # first/last segment: slow pairs are mostly layover at the terminus
                if (j == 0 or j == n - 2) and v < 1.0:
                    continue
                key = (sh.stop_ids[j], sh.stop_ids[j + 1])
                seg = segs.get(key)
                if seg is None:
                    seg = segs[key] = {"geom": sh.slice(s0, s1), "v": [], "peak": [], "off": [], "lines": set(),
                                       "names": (data["stops"][key[0]]["name"], data["stops"][key[1]]["name"])}
                seg["v"].append(v)
                (seg["peak"] if is_peak(o[i, 0]) else seg["off"]).append(v)
                seg["lines"].add(lid)

    def kmh(vs):
        return round(float(np.median(vs)) * 3.6, 1) if len(vs) >= MIN_SAMPLES else None

    feats = []
    for (a, b), seg in segs.items():
        if len(seg["v"]) < MIN_SAMPLES:
            continue
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString", "coordinates": seg["geom"]},
                      "properties": {"kmh": kmh(seg["v"]), "n": len(seg["v"]),
                                     "peak": kmh(seg["peak"]), "off": kmh(seg["off"]),
                                     "from": seg["names"][0], "to": seg["names"][1],
                                     "lines": " ".join(sorted(seg["lines"]))}})
    # slow segments drawn last (on top)
    feats.sort(key=lambda f: -f["properties"]["kmh"])
    json.dump({"type": "FeatureCollection", "features": feats}, open(out, "w"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{len(feats)} segments -> {out}", file=sys.stderr)


if __name__ == "__main__":
    import urllib.parse
    main()
