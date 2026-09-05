#!/usr/bin/env python3
"""Classify the corpus designs the prototype could not plan exactly.

For every row of cpoogle-sweep.jsonl with approx > 0, load the ORIPA .cp file from the
external corpus and measure two lattice residuals over its distinct crease lines
(border code 1 excluded), in unit-sheet coordinates:

  angle  : distance of the line direction to the nearest k*pi/8 (22.5 deg family)
  offset : distance of the line offset to the nearest (p + q*sqrt2) / 2^k, |p|,|q| <= 48,
           k <= 6 — the Z[sqrt2] lattice that exact 22.5-degree designs live on

A design is "exact 22.5 degree, RF lacks landmark" only if >98 % of lines pass BOTH tests
at 1e-6. Everything else is off-lattice geometry (freeform / hand-placed vertices / a
richer lattice this probe does not model). This is the prototype's stand-in for the
exactness probe the Rust crate implements (plan D8); it is evidence, not product code.

usage: python3 classify_off_lattice.py <corpus-dir-with-.cp-files> [cpoogle-sweep.jsonl]
"""
import bisect
import glob
import json
import math
import os
import sys

corpus = sys.argv[1]
sweep = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "cpoogle-sweep.jsonl")
rows = [json.loads(l) for l in open(sweep) if l.strip()]
files = sorted(glob.glob(os.path.join(corpus, "*.cp")))
R2 = math.sqrt(2)
CANDS = sorted({(p + q * R2) / 2 ** k for k in range(0, 7) for p in range(-48, 49) for q in range(-48, 49)})


def find(prefix):
    key = prefix.split(".cp")[0][:40]
    return next((f for f in files if key in os.path.basename(f)), None)


def z2_residual(d):
    i = bisect.bisect_left(CANDS, d)
    return min(abs(CANDS[j] - d) for j in (i - 1, i) if 0 <= j < len(CANDS))


def lines_of(path):
    segs = []
    for line in open(path, errors="replace"):
        t = line.split()
        if len(t) < 5:
            continue
        try:
            c = int(float(t[0])); x1, y1, x2, y2 = map(float, t[1:5])
        except ValueError:
            continue
        segs.append((c, x1, y1, x2, y2))
    xs = [v for s in segs for v in (s[1], s[3])]; ys = [v for s in segs for v in (s[2], s[4])]
    x0, y0 = min(xs), min(ys); S = max(max(xs) - x0, max(ys) - y0)
    lines = {}
    for c, x1, y1, x2, y2 in segs:
        if c == 1:  # border
            continue
        dx, dy = (x2 - x1) / S, (y2 - y1) / S; ln = math.hypot(dx, dy)
        if ln < 1e-9:
            continue
        a, b = -dy / ln, dx / ln; d = a * (x1 - x0) / S + b * (y1 - y0) / S
        if a < -1e-9 or (abs(a) < 1e-9 and b < 0):
            a, b, d = -a, -b, -d
        lines[(round(a, 5), round(b, 5), round(d, 5))] = (math.atan2(b, a), d)
    return lines


print(f"{'design':40s} lines  angle-exact  Z[sqrt2]-offset-exact  offset-p90  verdict")
for r in sorted((r for r in rows if r["approx"] > 0), key=lambda r: -r["approx"]):
    f = find(r["file"])
    if not f:
        print(r["file"][:40], "(not found in corpus)"); continue
    L = lines_of(f)
    ang = [min(abs(a - k * math.pi / 8) for k in range(-9, 10)) for a, _ in L.values()]
    ang_ok = sum(x < 1e-6 for x in ang) / len(ang)
    offs = sorted(z2_residual(d) for _, d in L.values())
    off_ok = sum(x < 1e-6 for x in offs) / len(offs)
    p90 = offs[int(len(offs) * 0.9)]
    if ang_ok > 0.98 and off_ok > 0.98:
        verdict = "EXACT 22.5-degree design; RF lacks a landmark"
    elif ang_ok > 0.98:
        verdict = "22.5-degree angles, offsets off-lattice (hand-placed or richer lattice)"
    else:
        verdict = "off-family angles (freeform or noisy)"
    print(f"{os.path.basename(f)[46:86]:40s} {len(L):5d}  {ang_ok:10.2f}  {off_ok:20.2f}  {p90:9.1e}  {verdict}")
