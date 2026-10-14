#!/usr/bin/env python3
"""Typical bus speed per road segment (stop to stop), as one GeoJSON for the map's speed layer.

Usage: python3 lab/segspeed/build.py <history_dir> public/speed/segments.geojson [line ...]
  history_dir: hourly CSV.gz from `docker cp atrt-atrt-1:/var/lib/atrt/history <dir>`
  lines: line ids (default: all lines in the history)

Observation = two consecutive fixes of one vehicle on one line, 5-120 s apart,
straight-line speed <= 25 m/s. The pair's midpoint is snapped to the line's
shape (variant = route_code) and credited to the stop-to-stop segment there.
Overlapping stretches of different segments (other lines, other stops, the other direction) are merged
into one piece per road, drawn once; its observations are pooled (merge_segments).
Segments with fewer than MIN_SAMPLES observations are left out. The top-level `meta` member holds the
observation period, the sample count and MIN_SAMPLES (the map's legend shows them).
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
STOP_SNAP_M = 40  # a stop this close to the shape is on it
MIN_SAMPLES = 20  # per segment shown
PART_MIN_SAMPLES = 10  # for its peak / off-peak figure
PARKED_S = 180  # stationary longer than this = layover, dropped
STEP_M = 10  # segment polylines are resampled this often for the merge
MERGE_M = 20  # points this close ...
MERGE_DEG = 35  # ... and heading within this (either direction) are the same road
MIN_PIECE_M = 30  # a stretch of a segment not covered by another is kept as its own piece if this long


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
            last = max(last, self.first_near(sx[i], sy[i], last))
            ss.append(last)
        self.stop_ids, self.stop_s = ids, np.array(ss)

    def first_near(self, px, py, lo):
        """The nearest place on the first passage at or after lo within STOP_SNAP_M of a stop (the nearest
        place overall if none): a loop line starts and ends at the same stop, and the nearest would be the end."""
        ax, ay = self.x[:-1], self.y[:-1]
        dx, dy = np.diff(self.x), np.diff(self.y)
        L2 = np.maximum(dx * dx + dy * dy, 1e-9)
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1)
        dist = np.hypot(px - (ax + t * dx), py - (ay + t * dy))
        s = self.cum[:-1] + t * np.sqrt(L2)
        ok = s >= lo - 1
        near = ok & (dist <= STOP_SNAP_M)
        if near.any():
            i = j = int(np.argmax(near))   # the first shape segment of the passage
            # it goes on while the shared vertex stays near too (a hairpin can come back within reach)
            while j + 1 < len(near) and near[j + 1] and math.hypot(self.x[j + 1] - px, self.y[j + 1] - py) <= STOP_SNAP_M:
                j += 1
            k = i + int(np.argmin(dist[i:j + 1]))
            return float(s[k])
        return float(s[ok][np.argmin(dist[ok])]) if ok.any() else lo

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
    """Consecutive fix pairs per vehicle -> {(line, route): [(t_mid, lat, lon, v_mps, heading_deg)]}."""
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
    times = [f[0] for fixes in rows.values() for f in fixes]
    span = (min(times), max(times)) if times else (0, 0)
    for fixes in rows.values():
        fixes.sort()
        run = []  # current stationary run: a bus standing > PARKED_S is parked, not in traffic
        def flush():
            if run and run[-1][3] - run[0][2] <= PARKED_S:   # first fix to last fix of the run
                for key, obs, _, _ in run:
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
            hd = math.degrees(math.atan2(dx, dy)) % 360   # compass heading of a -> b
            obs = ((a[0] + b[0]) / 2, (a[3] + b[3]) / 2, (a[4] + b[4]) / 2, v, hd)
            if v < 1.0:
                run.append(((a[1], a[2]), obs, a[0], b[0]))
                continue
            flush()
            pairs[(a[1], a[2])].append(obs)
        flush()
    return pairs, span


def _hdiff(h1, h2):
    """Undirected angle between two compass headings, degrees (0..90)."""
    d = np.abs(h1 - h2) % 180
    return np.minimum(d, 180 - d)


def _cell_key(x, y):
    return ((np.floor(x / MERGE_M).astype(np.int64) + (1 << 20)) << 22) + (np.floor(y / MERGE_M).astype(np.int64) + (1 << 20))


def _resample(geom):
    """A polyline [[lon, lat]] -> (s, x, y, heading, cum): a point every STEP_M metres (and the end) with its leg's heading."""
    ll = np.array(geom, dtype=float)
    x, y = xy(ll[:, 1], ll[:, 0])
    dx, dy = np.diff(x), np.diff(y)
    cum = np.concatenate([[0], np.cumsum(np.hypot(dx, dy))])
    if len(ll) < 2 or cum[-1] <= 0:
        return None
    s = np.append(np.arange(0, cum[-1], STEP_M), cum[-1])
    leg = np.clip(np.searchsorted(cum, s, side="right") - 1, 0, len(dx) - 1)
    f = (s - cum[leg]) / np.maximum(cum[leg + 1] - cum[leg], 1e-9)
    hd = np.degrees(np.arctan2(dx[leg], dy[leg])) % 360
    return s, x[leg] + f * dx[leg], y[leg] + f * dy[leg], hd, cum, ll


def _slice(ll, cum, s0, s1):
    """[lon, lat] coordinates of a polyline (lat/lon array with cumulative metres) between s0 and s1."""
    def at(s):
        i = min(max(int(np.searchsorted(cum, s)) - 1, 0), len(cum) - 2)
        f = (s - cum[i]) / max(cum[i + 1] - cum[i], 1e-9)
        a, b = ll[i], ll[i + 1]
        return [round(a[0] + f * (b[0] - a[0]), 5), round(a[1] + f * (b[1] - a[1]), 5)]
    inner = [[round(p[0], 5), round(p[1], 5)] for p, c in zip(ll, cum) if s0 < c < s1]
    return [at(s0)] + inner + [at(s1)]


def merge_segments(segs):
    """One road, one piece. segs: [{"geom": [[lon, lat]], "obs": [(x, y, heading, v, is_peak)], "lines": set, "names": (a, b)}].
    Segments are taken busiest first; the stretches of a segment that no earlier segment covers (a claimed point within
    MERGE_M going the same way or the opposite way) become pieces of their own, and every observation is pooled into the
    piece it lies on. Returns [{"geom", "v", "peak", "off", "lines", "names"}]."""
    order = sorted(range(len(segs)), key=lambda i: -len(segs[i]["obs"]))
    grid = defaultdict(list)   # cell key -> [(x, y, heading, piece)] of claimed points
    pieces, seg_of, claimed = [], [], []   # claimed[pid] = (x, y, heading)
    seg_pts = {}   # seg -> (x, y, piece) of its resampled points that belong to a piece (own, or the one that covered them)
    for si in order:
        r = _resample(segs[si]["geom"])
        if r is None:
            continue
        s, x, y, hd, cum, ll = r
        key = _cell_key(x, y)
        cand = []
        for k in set(key.tolist()):
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    cand += grid.get(k + (dx << 22) + dy, [])
        covered = np.zeros(len(s), bool)
        pid_of = np.full(len(s), -1)
        if cand:
            c = np.array(cand)
            for a in range(0, len(s), 500):
                sl = slice(a, a + 500)
                near = np.hypot(x[sl, None] - c[None, :, 0], y[sl, None] - c[None, :, 1]) <= MERGE_M
                near &= _hdiff(hd[sl, None], c[None, :, 2]) < MERGE_DEG
                covered[sl] = near.any(axis=1)
                dist = np.where(near, np.hypot(x[sl, None] - c[None, :, 0], y[sl, None] - c[None, :, 1]), np.inf)
                pid_of[sl] = np.where(covered[sl], c[np.argmin(dist, axis=1), 3], -1).astype(int)
        i, n = 0, len(s)
        while i < n:
            if covered[i]:
                i += 1
                continue
            j = i
            while j + 1 < n and not covered[j + 1]:
                j += 1
            if s[j] - s[i] >= MIN_PIECE_M:
                pid = len(pieces)
                pieces.append({"geom": _slice(ll, cum, s[i], s[j]), "v": [], "peak": [], "off": [], "lines": set(),
                               "names": segs[si]["names"]})
                seg_of.append(si)
                claimed.append((x[i:j + 1], y[i:j + 1], hd[i:j + 1]))
                pid_of[i:j + 1] = pid
                for px, py, ph, pk in zip(x[i:j + 1], y[i:j + 1], hd[i:j + 1], key[i:j + 1].tolist()):
                    grid[pk].append((px, py, ph, pid))
            i = j + 1
        has = pid_of >= 0
        if has.any():
            seg_pts[si] = (x[has], y[has], pid_of[has])
    if not pieces:
        return []
    # claimed points sorted by cell, for the observation lookup
    CX = np.concatenate([c[0] for c in claimed])
    CY = np.concatenate([c[1] for c in claimed])
    CH = np.concatenate([c[2] for c in claimed])
    CP = np.concatenate([np.full(len(c[0]), p) for p, c in enumerate(claimed)])
    ck = _cell_key(CX, CY)
    o = np.argsort(ck, kind="stable")
    CX, CY, CH, CP, ck = CX[o], CY[o], CH[o], CP[o], ck[o]
    obs = [np.asarray(sg["obs"], dtype=float).reshape(-1, 5) for sg in segs]
    OS = np.concatenate([np.full(len(a), i) for i, a in enumerate(obs)])
    O = np.concatenate(obs)
    best_d = np.full(len(O), np.inf)
    best_p = np.full(len(O), -1)
    for a in range(0, len(O), 100000):
        ox, oy, oh = O[a:a + 100000, 0], O[a:a + 100000, 1], O[a:a + 100000, 2]
        k0 = _cell_key(ox, oy)
        bd = best_d[a:a + 100000]
        bp = best_p[a:a + 100000]
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                kk = k0 + (dx << 22) + dy
                lo, hi = np.searchsorted(ck, kk, "left"), np.searchsorted(ck, kk, "right")
                for t in range(int((hi - lo).max())):
                    m = np.nonzero(t < hi - lo)[0]
                    ix = lo[m] + t
                    d = np.hypot(ox[m] - CX[ix], oy[m] - CY[ix])
                    good = (d <= MERGE_M) & (_hdiff(oh[m], CH[ix]) < MERGE_DEG) & (d < bd[m])
                    bd[m[good]] = d[good]
                    bp[m[good]] = CP[ix[good]]
    for si in np.unique(OS[best_p < 0]).tolist():   # observations that match no road: the piece of their own seg's nearest point
        if si not in seg_pts:
            continue
        idx = np.nonzero((OS == si) & (best_p < 0))[0]
        px, py, pp = seg_pts[si]
        d = np.hypot(O[idx, 0, None] - px[None, :], O[idx, 1, None] - py[None, :])
        best_p[idx] = pp[np.argmin(d, axis=1)]
    for p, v, pk in zip(best_p.tolist(), O[:, 3].tolist(), O[:, 4].astype(bool).tolist()):
        if p >= 0:
            pieces[p]["v"].append(v)
            pieces[p]["peak" if pk else "off"].append(v)
    ok = best_p >= 0
    for p, si in set(zip(best_p[ok].tolist(), OS[ok].tolist())):
        pieces[p]["lines"] |= segs[si]["lines"]
    return pieces


def is_peak(t):
    d = datetime.fromtimestamp(t, ATH)
    return d.weekday() < 5 and (7 <= d.hour < 10 or 14 <= d.hour < 18)


def main():
    hist, out, *lines = sys.argv[1:]
    lines = set(lines)
    pairs, span = read_pairs(hist, lines)
    print(f"{sum(map(len, pairs.values()))} pairs on {len({k[0] for k in pairs})} lines", file=sys.stderr)
    # seg key -> {"geom", "obs": [(x, y, heading, v, is_peak)], "lines": set, "names"}
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
                    seg = segs[key] = {"geom": sh.slice(s0, s1), "obs": [], "lines": set(),
                                       "names": (data["stops"][key[0]]["name"], data["stops"][key[1]]["name"])}
                seg["obs"].append((float(px[i]), float(py[i]), float(o[i, 4]), float(v), is_peak(o[i, 0])))
                seg["lines"].add(lid)

    def kmh(vs, least=MIN_SAMPLES):
        return round(float(np.median(vs)) * 3.6, 1) if len(vs) >= least else None

    feats = []
    for seg in merge_segments(list(segs.values())):
        if len(seg["v"]) < MIN_SAMPLES:
            continue
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString", "coordinates": seg["geom"]},
                      "properties": {"kmh": kmh(seg["v"]), "n": len(seg["v"]),
                                     "peak": kmh(seg["peak"], PART_MIN_SAMPLES), "off": kmh(seg["off"], PART_MIN_SAMPLES),
                                     "from": seg["names"][0], "to": seg["names"][1],
                                     "lines": " ".join(sorted(seg["lines"]))}})
    # slow segments drawn last (on top)
    feats.sort(key=lambda f: -f["properties"]["kmh"])
    meta = {"from": span[0], "to": span[1], "samples": sum(f["properties"]["n"] for f in feats),
            "segments": len(feats), "min_samples": MIN_SAMPLES}
    json.dump({"type": "FeatureCollection", "meta": meta, "features": feats}, open(out, "w"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{len(feats)} segments -> {out}", file=sys.stderr)


if __name__ == "__main__":
    import urllib.parse
    main()
