# Cut a window of the backend's fix history (atrt --history, hourly gzip CSV, UTC hours) for the replay captures.
# Usage: python3 capture/replay_extract.py <history dir> <T0 unix s> [before s=600] [after s=900]
# Get the history with: docker cp atrt-atrt-1:/var/lib/atrt/history <dir>
# Output: capture/replay/fixes.csv.gz (same columns), not in git.
import csv, datetime, gzip, os, sys
src, t0 = sys.argv[1], int(sys.argv[2])
before = int(sys.argv[3]) if len(sys.argv) > 3 else 600
after = int(sys.argv[4]) if len(sys.argv) > 4 else 900
lo, hi = t0 - before - 300, t0 + after
hours = sorted({datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H") for t in range(lo - 3600, hi + 3600, 1800)})
out = os.path.join(os.path.dirname(__file__), "replay", "fixes.csv.gz")
os.makedirs(os.path.dirname(out), exist_ok=True)
n = 0
with gzip.open(out + ".tmp", "wt", newline="") as fo:
    w = None
    for h in hours:
        p = os.path.join(src, h + ".csv.gz")
        if not os.path.exists(p):
            continue
        for r in csv.DictReader(gzip.open(p, "rt")):
            if w is None:
                w = csv.DictWriter(fo, fieldnames=list(r.keys())); w.writeheader()
            if lo <= int(r["fix_t"]) <= hi:
                w.writerow(r); n += 1
if n == 0:
    os.remove(out + ".tmp")
    sys.exit("no fixes in the window: check <history dir> and <T0>")
os.replace(out + ".tmp", out)
print(out, n, "fixes")
