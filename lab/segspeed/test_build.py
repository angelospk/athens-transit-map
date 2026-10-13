"""Run: python3 -m unittest lab/segspeed/test_build.py (needs numpy)."""
import csv, gzip, os, sys, tempfile, unittest

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


if __name__ == "__main__":
    unittest.main()
