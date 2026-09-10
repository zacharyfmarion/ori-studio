#!/usr/bin/env python3
"""Rotate a curated case's ground truth so its paper sits upright.

A curated case's `topology.fold` and `truth.fold` are in whatever frame the
pipeline produced when a person curated them, and until the auto-crop could
find a rotated paper that frame kept the paper as it was drawn: a diamond, or
a scan a few degrees off square. The crop now rectifies such a paper to an
upright square, so the pipeline's answer and the curated truth differ by a
rotation, and the benchmark's strict 4 px of 1024 comparison reads that as
total failure — `mammoth-v2`, `rabbit` and `swallow-swallow` score `off` at
edge F1 0.00 while matching their truth at 0.97-1.00 vertex recall once a
rotation is allowed.

This rewrites `vertices_coords` and nothing else. The rotation is rigid and
about the paper's own centre, so every crease, assignment, fold angle and
face is the curated one — the person's judgement is preserved exactly, only
the frame it is expressed in changes. `topology.fold` and `truth.fold` get
the identical transform, because the gate runs one into the other.

The angle comes from the paper's own boundary edges, not from the detector:
the paper is a square, so its `B` edges lie on two perpendicular families,
and the tilt is their common angle taken into (-45, 45]. That is the same
range the crop searches, so the two agree without this ever consulting the
pipeline's answer — which would be circular, since the pipeline's answer is
the thing the truth exists to judge.

    scripts/cp-detect/upright-curated-paper.py <case-dir>... [--apply]
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

FRAMES = ("topology.fold", "truth.fold")
# A boundary edge shorter than this fraction of the paper is a sliver whose
# angle is noise; the paper's sides are subdivided by every crease meeting
# them, so plenty of long ones remain.
MIN_BOUNDARY_EDGE = 0.02


def frame_of(document: dict[str, Any]) -> dict[str, Any]:
    if "vertices_coords" in document:
        return document
    return document["file_frames"][0]


def paper_tilt_degrees(frame: dict[str, Any]) -> float:
    """The angle of the paper's boundary, in (-45, 45].

    Each boundary edge votes with its own length, so the long sides decide
    and a subdivided corner cannot. Angles are taken modulo 90 because the
    four sides of a square are the same two directions.
    """
    coords = frame["vertices_coords"]
    assignments = frame.get("edges_assignment", [])
    spans = [
        (coords[a], coords[b])
        for (a, b), kind in zip(frame["edges_vertices"], assignments)
        if kind == "B"
    ]
    if not spans:
        raise SystemExit("no boundary edges: cannot tell where the paper is")
    longest = max(math.dist(a[:2], b[:2]) for a, b in spans)
    # Circular mean over the doubled angle, so 0 and 90 are one direction.
    x = y = 0.0
    for a, b in spans:
        length = math.dist(a[:2], b[:2])
        if length < longest * MIN_BOUNDARY_EDGE:
            continue
        angle = math.atan2(b[1] - a[1], b[0] - a[0]) * 4.0
        x += length * math.cos(angle)
        y += length * math.sin(angle)
    tilt = math.degrees(math.atan2(y, x)) / 4.0
    return tilt if -45.0 < tilt <= 45.0 else tilt - 90.0 * round(tilt / 90.0)


def paper_centre(frame: dict[str, Any]) -> tuple[float, float]:
    coords = frame["vertices_coords"]
    corners = {
        index
        for (a, b), kind in zip(frame["edges_vertices"], frame.get("edges_assignment", []))
        if kind == "B"
        for index in (a, b)
    }
    xs = [coords[i][0] for i in corners]
    ys = [coords[i][1] for i in corners]
    return (min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0


def rotate(frame: dict[str, Any], degrees: float, centre: tuple[float, float]) -> None:
    radians = math.radians(degrees)
    cos, sin = math.cos(radians), math.sin(radians)
    cx, cy = centre
    for point in frame["vertices_coords"]:
        x, y = point[0] - cx, point[1] - cy
        point[0] = round(cx + x * cos - y * sin, 9)
        point[1] = round(cy + x * sin + y * cos, 9)


def paper_span(frame: dict[str, Any]) -> tuple[float, float]:
    coords = frame["vertices_coords"]
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    return max(xs) - min(xs), max(ys) - min(ys)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", nargs="+", type=Path)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the files; without it, only report what would change",
    )
    parser.add_argument(
        "--min-tilt",
        type=float,
        default=0.25,
        help="leave a paper already this upright alone (degrees)",
    )
    args = parser.parse_args()

    for case in args.cases:
        documents = {}
        for name in FRAMES:
            path = case / name
            if not path.exists():
                print(f"{case.name}: no {name}, skipping case")
                break
            documents[name] = json.loads(path.read_text())
        else:
            tilt = paper_tilt_degrees(frame_of(documents["topology.fold"]))
            if abs(tilt) < args.min_tilt:
                print(f"{case.name}: paper is upright already ({tilt:+.2f}deg)")
                continue
            for name, document in documents.items():
                frame = frame_of(document)
                before = paper_span(frame)
                rotate(frame, -tilt, paper_centre(frame))
                after = paper_span(frame)
                print(
                    f"{case.name}/{name}: rotated {-tilt:+.2f}deg, "
                    f"bounds {before[0]:.0f}x{before[1]:.0f} -> {after[0]:.0f}x{after[1]:.0f}"
                )
                if args.apply:
                    (case / name).write_text(json.dumps(document))
        if not args.apply:
            print("  (dry run; pass --apply to write)")


if __name__ == "__main__":
    main()
