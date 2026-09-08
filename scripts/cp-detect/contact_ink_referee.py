#!/usr/bin/env python3
"""Judge boundary-contact positions against the ink, without a truth.

The curated group's truths are the detector's own output fixed up by eye, so
they inherit the contact head's positions and cannot say whether a contact
correction moved toward or away from the crease. This reads the rectified
grayscale instead: for every contact the correction moved, it fits the
crease's ink centreline from cross-profiles 12–90 px inside the edge (bilinear
samples, one per pixel, Theil–Sen line) and extrapolates it to the paper edge,
then reports how far the head's position and the corrected position each sit
from that crossing.

Usage:
    dump_candidate_pool <model> <off_dir> <cases...>   # with CONTACT_RELOCALIZE=0
    dump_candidate_pool <model> <on_dir>  <cases...>
    python3 scripts/cp-detect/contact_ink_referee.py <off_dir> <on_dir>

Both dumps must come from the same binary except for the switch; `on_dir`
needs the `.rect.png` images the dump writes. The renders are the
calibration: there the crossing sits about half a pixel from the design's
contact.
"""
import collections
import glob
import json
import math
import os
import statistics
import sys

import numpy as np
from PIL import Image

INSET = 32.0
PAPER = 960.0
AXES = {"T": ((1, 0), (0, 1)), "B": ((1, 0), (0, -1)), "L": ((0, 1), (1, 0)), "R": ((0, 1), (-1, 0))}


def side_of(p):
    if p[0] <= 1.0:
        return "L"
    if p[0] >= 1023.0:
        return "R"
    if p[1] <= 1.0:
        return "T"
    if p[1] >= 1023.0:
        return "B"
    return None


def canvas(p):
    return (INSET + p[0] * PAPER / 1024.0, INSET + p[1] * PAPER / 1024.0)


def along(p, side):
    return p[1] if side in "LR" else p[0]


def ink_map(path):
    g = np.asarray(Image.open(path).convert("L"), dtype=np.float32)
    paper = np.percentile(g[40:984, 40:984], 90)
    return np.clip((paper - g) / max(paper - 20.0, 1.0), 0.0, 1.0)


def bilinear(a, x, y):
    x0 = int(math.floor(x))
    y0 = int(math.floor(y))
    if x0 < 0 or y0 < 0 or x0 + 1 >= a.shape[1] or y0 + 1 >= a.shape[0]:
        return 0.0
    fx = x - x0
    fy = y - y0
    return float(
        a[y0, x0] * (1 - fx) * (1 - fy)
        + a[y0, x0 + 1] * fx * (1 - fy)
        + a[y0 + 1, x0] * (1 - fx) * fy
        + a[y0 + 1, x0 + 1] * fx * fy
    )


def crossing(ink, contact, other, side):
    """Where the crease's ink centreline crosses the nominal edge, in pixels along the side; None when the ink does not fit a line."""
    t, inward = AXES[side]
    dx = other[0] - contact[0]
    dy = other[1] - contact[1]
    length = math.hypot(dx, dy)
    if length < 20.0:
        return None
    u = (dx / length, dy / length)
    n = (-u[1], u[0])
    sin = abs(u[0] * inward[0] + u[1] * inward[1])
    if sin < 0.05:
        return None
    r0 = 12.0 / sin
    r1 = min(length - 6.0, r0 + 80.0)
    if r1 - r0 < 10.0:
        return None
    ks = np.arange(-5.0, 5.01, 0.5)
    points = []
    r = r0
    while r <= r1:
        cx = contact[0] + r * u[0]
        cy = contact[1] + r * u[1]
        prof = np.array([bilinear(ink, cx + k * n[0], cy + k * n[1]) for k in ks])
        best = None
        for i in range(len(prof)):
            if prof[i] < 0.25:
                continue
            if (i == 0 or prof[i - 1] <= prof[i]) and (i + 1 >= len(prof) or prof[i + 1] <= prof[i]):
                if best is None or abs(ks[i]) < abs(ks[best]):
                    best = i
        if best is not None:
            lo = hi = best
            floor = prof[best] * 0.5
            while lo > 0 and prof[lo - 1] >= floor and prof[lo - 1] <= prof[lo]:
                lo -= 1
            while hi + 1 < len(prof) and prof[hi + 1] >= floor and prof[hi + 1] <= prof[hi]:
                hi += 1
            w = prof[lo : hi + 1]
            points.append((r, float((w * ks[lo : hi + 1]).sum() / w.sum())))
        r += 1.0
    if len(points) < 8:
        return None
    slopes = [
        (points[j][1] - points[i][1]) / (points[j][0] - points[i][0])
        for i in range(len(points))
        for j in range(i + 1, len(points))
        if points[j][0] - points[i][0] >= 5.0
    ]
    b = statistics.median(slopes)
    a = statistics.median([p[1] - b * p[0] for p in points])
    if statistics.median([abs(p[1] - (a + b * p[0])) for p in points]) > 0.6:
        return None
    u_in = u[0] * inward[0] + u[1] * inward[1]
    n_in = n[0] * inward[0] + n[1] * inward[1]
    den = u_in + b * n_in
    if abs(den) < 1e-6:
        return None
    rr = -a * n_in / den
    e = a + b * rr
    x = (contact[0] + rr * u[0] + e * n[0], contact[1] + rr * u[1] + e * n[1])
    return x[0] * t[0] + x[1] * t[1]


def moved_contacts(off_dir, on_dir, key):
    off = json.load(open(os.path.join(off_dir, f"{key}.pool.json")))
    on = json.load(open(os.path.join(on_dir, f"{key}.pool.json")))
    ink = ink_map(os.path.join(on_dir, f"{key}.rect.png"))
    vertices = [(v["x"], v["y"], v["kind"]) for v in off["vertices"]]
    after = [(v["x"], v["y"]) for v in on["vertices"] if v["kind"] == "BoundaryContact"]
    incident = collections.defaultdict(list)
    for span in off["spans"]:
        if span["kind"] == "BorderSpan":
            continue
        for i in span["vertices"]:
            incident[i].append(span)
    rows = []
    for i, v in enumerate(vertices):
        if v[2] != "BoundaryContact" or not incident[i]:
            continue
        side = side_of(v)
        if side is None:
            continue
        head = along(canvas(v), side)
        same = [along(canvas(w), side) for w in after if side_of(w) == side]
        if not same:
            continue
        corrected = min(same, key=lambda a: abs(a - head))
        if abs(corrected - head) < 0.5:
            continue
        estimates = []
        angle = 90.0
        for span in incident[i]:
            other = canvas(vertices[[j for j in span["vertices"] if j != i][0]])
            x = crossing(ink, canvas(v), other, side)
            t, inward = AXES[side]
            d = (other[0] - canvas(v)[0], other[1] - canvas(v)[1])
            length = math.hypot(*d)
            if length > 0:
                angle = min(angle, math.degrees(math.asin(min(1.0, abs(d[0] * inward[0] + d[1] * inward[1]) / length))))
            if x is not None:
                estimates.append(x)
        rows.append(
            {
                "case": key,
                "side": side,
                "angle": angle,
                "head": head,
                "corrected": corrected,
                "ink": statistics.mean(estimates) if estimates else None,
            }
        )
    return rows


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    off_dir, on_dir = sys.argv[1:3]
    keys = [os.path.basename(p)[: -len(".pool.json")] for p in sorted(glob.glob(os.path.join(on_dir, "*.pool.json")))]
    groups = collections.defaultdict(list)
    for key in keys:
        if not os.path.exists(os.path.join(off_dir, f"{key}.pool.json")):
            continue
        if not os.path.exists(os.path.join(on_dir, f"{key}.rect.png")):
            continue
        groups[key.split("__", 1)[0]].extend(moved_contacts(off_dir, on_dir, key))
    for group, rows in sorted(groups.items()):
        judged = [r for r in rows if r["ink"] is not None]
        print(f"{group}: {len(rows)} contacts moved, {len(judged)} with a readable ink centreline, {len(rows) - len(judged)} without")
        if not judged:
            continue
        dh = [abs(r["head"] - r["ink"]) for r in judged]
        dc = [abs(r["corrected"] - r["ink"]) for r in judged]
        closer = sum(1 for a, b in zip(dh, dc) if b < a)
        print(f"  distance to the ink crossing: head median {statistics.median(dh):.2f} px, corrected median {statistics.median(dc):.2f} px; corrected closer on {closer} of {len(judged)}")
        for lo, hi in [(0, 35), (35, 60), (60, 91)]:
            part = [r for r in judged if lo <= r["angle"] < hi]
            if part:
                a = statistics.median(abs(r["head"] - r["ink"]) for r in part)
                b = statistics.median(abs(r["corrected"] - r["ink"]) for r in part)
                c = sum(1 for r in part if abs(r["corrected"] - r["ink"]) < abs(r["head"] - r["ink"]))
                print(f"    creases at {lo}–{hi}° to the edge: n {len(part)}, head {a:.2f} px, corrected {b:.2f} px, corrected closer on {c}")
        worst = sorted(judged, key=lambda r: -(abs(r["corrected"] - r["ink"]) - abs(r["head"] - r["ink"])))[:5]
        print("  corrections that moved furthest from the ink:")
        for r in worst:
            print(f"    {r['case']} {r['side']} {r['angle']:.0f}° at {r['head']:.1f}: correction {r['corrected'] - r['head']:+.2f}, ink says {r['ink'] - r['head']:+.2f}")


if __name__ == "__main__":
    main()
