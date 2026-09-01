#!/usr/bin/env python3
"""Split hand-authored `.ori` / `.osf` documents into per-pattern FOLD samples.

Documents like `traditional_bases.ori` hold several crease patterns tiled in one
canvas, and diagram files hold one connected pattern per step. Each connected
component is its own crease pattern, so this splits on connectivity and writes a
`<out>/samples/<name>/gt.fold` tree — the layout `gt_camv_survey` and
`solve_gt_scorecard` read.

Why this exists: no *generated* corpus in `artifacts/` has a ground truth our own
CAMV checker accepts (the generators sit ~1e-3 deg off Kawasaki, against a 1e-6
deg bar), but hand-authored traditional bases are exact by construction. 69 of
the 88 patterns these three files yield are 0-angle / 0-BLB clean.

Usage:
  python3 scripts/cp-detect/extract-exact-cp-corpus.py <out-dir> <file.ori|file.osf>...
"""

import collections
import json
import os
import sys

ORI_COLOR = {"BLACK_0": "B", "RED_1": "M", "BLUE_2": "V", "CYAN_3": "F"}
OSF_COLOR = {"Black0": "B", "Red1": "M", "Blue2": "V", "Cyan3": "F"}
MERGE_TOLERANCE = 1e-6
MIN_EDGES = 4


def load(path):
    """-> [(ax, ay, bx, by, assignment)] for either supported container."""
    document = json.load(open(path))
    if "lineSegments" in document:
        return [
            (*(float(v) for v in s["a"].split(",")),
             *(float(v) for v in s["b"].split(",")),
             ORI_COLOR.get(s["color"], "U"))
            for s in document["lineSegments"]
        ]
    model = document["workspace"]["creasePattern"]["creasePattern"]
    return [
        (s["a"]["x"], s["a"]["y"], s["b"]["x"], s["b"]["y"],
         OSF_COLOR.get(s["color"], "U"))
        for s in model["document"]["crease_pattern"]["line_segments"]
    ]


def components(segments):
    """Union-find over shared endpoints. Hand-authored files repeat a vertex with
    a few ulps of drift, so endpoints merge on a tolerance rather than equality."""
    points, lookup = [], {}

    def key(x, y):
        cell = (round(x / MERGE_TOLERANCE), round(y / MERGE_TOLERANCE))
        for probe in ((cell[0] + i, cell[1] + j) for i in (-1, 0, 1) for j in (-1, 0, 1)):
            if probe in lookup:
                return lookup[probe]
        lookup[cell] = len(points)
        points.append((x, y))
        return len(points) - 1

    ends = [(key(a, b), key(c, d)) for a, b, c, d, _ in segments]
    parent = list(range(len(points)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, j in ends:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    groups = collections.defaultdict(list)
    for index, (i, _) in enumerate(ends):
        groups[find(i)].append(index)
    return points, ends, groups


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    out = sys.argv[1]
    written = 0
    for path in sys.argv[2:]:
        segments = load(path)
        points, ends, groups = components(segments)
        label = os.path.basename(path).split(".")[0]
        ordered = sorted(groups.values(), key=len, reverse=True)
        for n, members in enumerate(ordered):
            if len(members) < MIN_EDGES:
                continue
            used = sorted({v for m in members for v in ends[m]})
            remap = {v: k for k, v in enumerate(used)}
            coords = [list(points[v]) for v in used]
            # Centre each pattern on the origin; the kernel's epsilons are
            # absolute, and a pattern tiled at y=20000 is not what they assume.
            cx = (min(c[0] for c in coords) + max(c[0] for c in coords)) / 2
            cy = (min(c[1] for c in coords) + max(c[1] for c in coords)) / 2
            name = f"{label}-{n:02d}"
            os.makedirs(f"{out}/samples/{name}", exist_ok=True)
            json.dump({
                "file_spec": 1.1,
                "frame_title": name,
                "vertices_coords": [[c[0] - cx, c[1] - cy] for c in coords],
                "edges_vertices": [[remap[ends[m][0]], remap[ends[m][1]]] for m in members],
                "edges_assignment": [segments[m][4] for m in members],
            }, open(f"{out}/samples/{name}/gt.fold", "w"))
            written += 1
        print(f"{os.path.basename(path)}: {len(segments)} segments -> {len(ordered)} components")
    print(f"wrote {written} samples to {out}/samples")
    return 0


if __name__ == "__main__":
    sys.exit(main())
