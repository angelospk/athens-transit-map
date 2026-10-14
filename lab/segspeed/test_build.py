"""Run: python3 -m unittest lab/segspeed/test_build.py (needs numpy)."""
import csv, gzip, math, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402

LAT0, LON0 = 37.98, 23.73
M_LAT = 1 / build.KY   # degrees per metre
M_LON = 1 / build.KX


def at(x, y):
    """Lat, lon of a point x metres east and y metres north of (LAT0, LON0)."""
    return LAT0 + y * M_LAT, LON0 + x * M_LON


class FirstNear(unittest.TestCase):
    def shape(self, pts, stops):
        variant = {"shape": [list(at(x, y)) for x, y in pts], "stops": [f"s{i}" for i in range(len(stops))]}
        st = {f"s{i}": dict(zip(("lat", "lon"), at(x, y))) for i, (x, y) in enumerate(stops)}
        return build.Shape(variant, st)

    def test_stop_snaps_to_nearest_point_of_its_passage(self):
        # straight shape along x; a stop at x=100, 30 m off: the passage starts near x=80, the stop belongs at 100
        sh = self.shape([(0, 0), (50, 0), (90, 0), (100, 0), (110, 0), (300, 0)], [(0, 0), (100, 30)])
        self.assertAlmostEqual(sh.stop_s[1], 100, delta=1)

    def test_hairpin_that_comes_back_is_another_passage(self):
        sh = self.shape([(0, 0), (500, 0), (100, 30), (100, 600)], [(0, 0), (100, 30)])
        self.assertAlmostEqual(sh.stop_s[1], 100, delta=1)

    def test_loop_line_first_stop_is_at_the_start(self):
        sh = self.shape([(0, 0), (500, 0), (500, 500), (0, 500), (0, 5)], [(0, 0), (500, 250), (0, 0)])
        self.assertLess(sh.stop_s[0], 5)
        self.assertGreater(sh.stop_s[2], 1900)


class ParkedRuns(unittest.TestCase):
    def pairs(self, fixes):
        d = tempfile.mkdtemp()
        with gzip.open(os.path.join(d, "h.csv.gz"), "wt", newline="") as f:
            w = csv.DictWriter(f, ["veh", "line", "route_code", "fix_t", "lat", "lon"])
            w.writeheader()
            for t, x in fixes:
                lat, lon = at(x, 0)
                w.writerow({"veh": "v", "line": "1", "route_code": "r", "fix_t": t, "lat": int(lat * 1e6), "lon": int(lon * 1e6)})
        return build.read_pairs(d, set())[0].get(("1", "r"), [])

    def test_standing_longer_than_parked_s_is_dropped(self):
        # 4 standing pairs over 240 s (midpoints only 180 s apart): parked
        self.assertEqual(self.pairs([(0, 0), (60, 0), (120, 0), (180, 0), (240, 0)]), [])

    def test_short_stop_is_kept(self):
        self.assertEqual(len(self.pairs([(0, 0), (60, 0), (120, 0)])), 2)


class Merge(unittest.TestCase):
    """merge_segments: one road, one line. Overlapping stretches of different segments (other lines,
    other stops, the other direction) become one piece; its observations are pooled."""

    def seg(self, pts, v, line, n=30, names=("A", "B")):
        geom = [[at(x, y)[1], at(x, y)[0]] for x, y in pts]   # [lon, lat]
        obs = []
        for k in range(n):   # spread along the polyline, heading of the leg they are on
            f = (k + 0.5) / n * (len(pts) - 1)
            i = min(int(f), len(pts) - 2)
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            t = f - i
            hd = math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360
            obs.append((x0 + t * (x1 - x0), y0 + t * (y1 - y0), hd, v, k % 2 == 0))
        return {"geom": geom, "obs": obs, "lines": {line}, "names": names}

    @staticmethod
    def xs(piece):
        return [build.xy(lat, lon)[0] for lon, lat in piece["geom"]]

    def test_two_lines_on_one_road_become_one_piece(self):
        a = self.seg([(0, 0), (500, 0)], 5.0, "1", n=30)
        b = self.seg([(0, 6), (500, 6)], 10.0, "2", n=25)
        out = build.merge_segments([b, a])
        self.assertEqual(len(out), 1)
        self.assertEqual(len(out[0]["v"]), 55)
        self.assertEqual(out[0]["lines"], {"1", "2"})
        self.assertEqual(len(out[0]["peak"]) + len(out[0]["off"]), 55)

    def test_other_direction_is_the_same_road(self):
        a = self.seg([(0, 0), (500, 0)], 5.0, "1")
        b = self.seg([(500, 8), (0, 8)], 10.0, "2", n=20)
        self.assertEqual(len(build.merge_segments([a, b])), 1)

    def test_crossing_roads_stay_apart(self):
        a = self.seg([(0, 0), (500, 0)], 5.0, "1")
        b = self.seg([(250, -250), (250, 250)], 10.0, "2", n=20)
        out = build.merge_segments([a, b])
        self.assertEqual(len(out), 2)
        self.assertEqual(sorted(len(p["v"]) for p in out), [20, 30])

    def test_shared_stretch_goes_to_the_busier_line_the_rest_stays(self):
        a = self.seg([(0, 0), (500, 0)], 5.0, "1", n=40)
        b = self.seg([(0, 5), (300, 5), (300, 400)], 10.0, "2", n=30)
        out = build.merge_segments([a, b])
        self.assertEqual(len(out), 2)
        own = next(p for p in out if p["lines"] == {"2"})
        self.assertGreater(min(self.xs(own)), 270)          # only the turn north is its own
        main = next(p for p in out if "1" in p["lines"])
        self.assertIn("2", main["lines"])                    # its observations on the shared road count there
        self.assertEqual(len(main["v"]) + len(own["v"]), 70)
        self.assertEqual(main["names"], ("A", "B"))


if __name__ == "__main__":
    unittest.main()
