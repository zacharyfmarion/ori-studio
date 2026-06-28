#!/usr/bin/env python3
"""Build a CP-detector correctness pack from scraped *native* origami CPs.

The scraped dataset ships matched ``.fold`` (clean planar geometry, but with all
assignments stripped to ``U``) and ``.cp`` (ORIPA segment soup that *does* carry
mountain/valley/border via the line-type code) files sharing a filename stem.
This builder:

1. takes the clean ``.fold`` geometry,
2. recovers each edge's assignment (M/V/B) from the matching ``.cp`` by
   geometric label transfer (an edge inherits the label of the collinear ``.cp``
   segment it lies on -- robust to the converter splitting crossings),
3. renders a clean RGB input image using the detector's M/V/B/U palette (the
   model predicts assignment from colour, so the recovered labels are required
   for a meaningful input, not just for scoring),
4. writes ``gt.graph.json`` (vertices in pixels, edges, assignment labels), and
5. buckets samples into easy/medium/hard by edge count and emits a pack manifest
   per bucket plus an ``all`` manifest.

Model inference (the dense-logits cache) is a separate step; see
``infer-native-cp-dense-cache.py``.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

SCHEMA = "oristudio/cp-detect-correctness-pack/v1"
# Matches the detector's render palette (src/data/cpline_augmentations.py).
ASSIGNMENT_RGB = {
    "M": (220, 40, 40),
    "V": (40, 80, 220),
    "B": (0, 0, 0),
    "U": (120, 120, 120),
}
# ORIPA .cp line-type codes.
CP_CODE = {1: "B", 2: "M", 3: "V", 4: "U"}
SUPERSAMPLE = 3


def main() -> int:
    args = parse_args()
    fold_dir = args.fold_dir
    cp_dir = args.cp_dir
    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    samples_dir = out_dir / "samples"
    samples_dir.mkdir(exist_ok=True)

    fold_paths = sorted(fold_dir.glob("*.fold"))
    print(f"found {len(fold_paths)} fold files under {fold_dir}")

    built: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for fold_path in fold_paths:
        stem = fold_path.stem
        cp_path = cp_dir / f"{stem}.cp"
        if not cp_path.exists():
            skipped.append({"id": stem, "reason": "no matching .cp"})
            continue
        try:
            record = build_sample(
                fold_path=fold_path,
                cp_path=cp_path,
                samples_dir=samples_dir,
                out_dir=out_dir,
                image_size=args.image_size,
                inset=args.inset,
                line_width=args.line_width,
                match_tol_px=args.match_tol_px,
            )
        except Exception as exc:  # noqa: BLE001 - per-sample failures are reported
            skipped.append({"id": stem, "reason": f"{type(exc).__name__}: {exc}"})
            continue
        built.append(record)

    if not built:
        raise SystemExit("no samples built (no matched fold/.cp pairs?)")

    built.sort(key=lambda r: r["edge_count"])
    assign_buckets(built, args.bucket_edges)

    if args.limit:
        built = stratified_sample(built, args.limit, args.seed)

    write_manifests(out_dir, built, args)
    print(
        f"built {len(built)} samples "
        f"(easy={sum(1 for r in built if r['bucket'] == 'easy')}, "
        f"medium={sum(1 for r in built if r['bucket'] == 'medium')}, "
        f"hard={sum(1 for r in built if r['bucket'] == 'hard')}); "
        f"skipped {len(skipped)}"
    )
    (out_dir / "skipped.json").write_text(json.dumps(skipped, indent=2) + "\n", encoding="utf-8")
    return 0


def build_sample(
    *,
    fold_path: Path,
    cp_path: Path,
    samples_dir: Path,
    out_dir: Path,
    image_size: int,
    inset: float,
    line_width: int,
    match_tol_px: float,
) -> dict[str, Any]:
    fold = json.loads(fold_path.read_text(encoding="utf-8"))
    vertices_unit = np.asarray(fold["vertices_coords"], dtype=np.float64)
    edges = np.asarray(fold["edges_vertices"], dtype=np.int64)
    if vertices_unit.ndim != 2 or vertices_unit.shape[1] != 2 or edges.size == 0:
        raise ValueError("degenerate fold geometry")

    # Fold vertices are already normalised to the unit square. If not, normalise
    # by their bounding box so the pixel mapping is well defined.
    lo = vertices_unit.min(axis=0)
    hi = vertices_unit.max(axis=0)
    span = np.maximum(hi - lo, 1e-9)
    if lo.min() < -1e-6 or hi.max() > 1 + 1e-6:
        vertices_unit = (vertices_unit - lo) / span

    segments = parse_cp_segments(cp_path)
    if not segments:
        raise ValueError("no parseable .cp segments")
    labels = transfer_assignments(vertices_unit, edges, segments, match_tol_px / image_size)

    span_px = image_size - 2.0 * inset
    vertices_px = inset + vertices_unit.clip(0.0, 1.0) * span_px

    slug = safe_slug(fold_path.stem)
    sample_dir = samples_dir / slug
    sample_dir.mkdir(exist_ok=True)

    gt_graph = {
        "image_size": image_size,
        "geometry_source": str(fold_path),
        "assignment_source": str(cp_path),
        "vertices_px": vertices_px.tolist(),
        "edges_vertices": edges.tolist(),
        "edges_assignment": labels,
        "edges_assignment_labels": labels,
    }
    gt_graph_path = sample_dir / "gt.graph.json"
    gt_graph_path.write_text(json.dumps(gt_graph) + "\n", encoding="utf-8")

    image = render_clean_image(vertices_px, edges, labels, image_size, line_width)
    input_path = sample_dir / "input.png"
    Image.fromarray(image, mode="RGB").save(input_path)

    counts = {k: int(sum(1 for label in labels if label == k)) for k in ("M", "V", "B", "U")}
    return {
        "id": slug,
        "source_id": fold_path.stem,
        "image_size": image_size,
        "edge_count": int(len(edges)),
        "vertex_count": int(len(vertices_unit)),
        "assignment_counts": counts,
        "matched_fraction": round(
            sum(counts[k] for k in ("M", "V", "B")) / max(1, len(labels)), 4
        ),
        "input_png": rel(input_path, out_dir),
        "gt_graph": rel(gt_graph_path, out_dir),
    }


def parse_cp_segments(cp_path: Path) -> list[tuple[str, float, float, float, float]]:
    raw: list[tuple[int, float, float, float, float]] = []
    for line in cp_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0] not in ("1", "2", "3", "4"):
            continue
        try:
            code = int(parts[0])
            x1, y1, x2, y2 = (float(parts[i]) for i in range(1, 5))
        except ValueError:
            continue
        raw.append((code, x1, y1, x2, y2))
    if not raw:
        return []
    xs = [s[1] for s in raw] + [s[3] for s in raw]
    ys = [s[2] for s in raw] + [s[4] for s in raw]
    mnx, mxx, mny, myy = min(xs), max(xs), min(ys), max(ys)
    sx = max(mxx - mnx, 1e-9)
    sy = max(myy - mny, 1e-9)
    out = []
    for code, x1, y1, x2, y2 in raw:
        out.append(
            (
                CP_CODE[code],
                (x1 - mnx) / sx,
                (y1 - mny) / sy,
                (x2 - mnx) / sx,
                (y2 - mny) / sy,
            )
        )
    return out


def transfer_assignments(
    vertices_unit: np.ndarray,
    edges: np.ndarray,
    segments: list[tuple[str, float, float, float, float]],
    tol: float,
) -> list[str]:
    """Assign each fold edge the label of the collinear .cp segment it lies on.

    A fold edge inherits a segment's label when the fold edge's midpoint lies on
    the segment (within ``tol`` perpendicular distance and inside its extent) and
    the directions are near-parallel. This is robust to the FOLD converter having
    split a crossing .cp segment into several collinear fold edges.
    """
    labels: list[str] = []
    for v0, v1 in edges:
        a = vertices_unit[int(v0)]
        b = vertices_unit[int(v1)]
        mid = (a + b) * 0.5
        edir = b - a
        elen = math.hypot(edir[0], edir[1])
        if elen < 1e-12:
            labels.append("U")
            continue
        eux, euy = edir[0] / elen, edir[1] / elen
        best_label = "U"
        best_perp = tol
        for label, x1, y1, x2, y2 in segments:
            sdx, sdy = x2 - x1, y2 - y1
            slen = math.hypot(sdx, sdy)
            if slen < 1e-12:
                continue
            sux, suy = sdx / slen, sdy / slen
            # near-parallel?
            if abs(sux * eux + suy * euy) < 0.985:
                continue
            # projection of midpoint onto the segment
            t = ((mid[0] - x1) * sux + (mid[1] - y1) * suy)
            if t < -tol or t > slen + tol:
                continue
            px = x1 + sux * t
            py = y1 + suy * t
            perp = math.hypot(mid[0] - px, mid[1] - py)
            if perp < best_perp:
                best_perp = perp
                best_label = label
        labels.append(best_label)
    return labels


def render_clean_image(
    vertices_px: np.ndarray,
    edges: np.ndarray,
    labels: list[str],
    image_size: int,
    line_width: int,
) -> np.ndarray:
    scale = SUPERSAMPLE
    canvas = image_size * scale
    image = Image.new("RGB", (canvas, canvas), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    pts = vertices_px * scale
    # Draw border edges last so junctions read cleanly; interior first.
    order = sorted(range(len(edges)), key=lambda i: labels[i] == "B")
    for i in order:
        v0, v1 = edges[i]
        p0 = pts[int(v0)]
        p1 = pts[int(v1)]
        draw.line(
            [(float(p0[0]), float(p0[1])), (float(p1[0]), float(p1[1]))],
            fill=ASSIGNMENT_RGB.get(labels[i], ASSIGNMENT_RGB["U"]),
            width=max(1, int(line_width) * scale),
        )
    image = image.resize((image_size, image_size), Image.Resampling.LANCZOS)
    return np.asarray(image, dtype=np.uint8)


def assign_buckets(records: list[dict[str, Any]], thresholds: tuple[int, int]) -> None:
    easy_max, medium_max = thresholds
    for r in records:
        ec = r["edge_count"]
        r["bucket"] = "easy" if ec <= easy_max else "medium" if ec <= medium_max else "hard"


def stratified_sample(
    records: list[dict[str, Any]], limit: int, seed: int
) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    by_bucket: dict[str, list[dict[str, Any]]] = {"easy": [], "medium": [], "hard": []}
    for r in records:
        by_bucket[r["bucket"]].append(r)
    per = max(1, limit // 3)
    chosen: list[dict[str, Any]] = []
    for bucket, items in by_bucket.items():
        if len(items) <= per:
            chosen.extend(items)
        else:
            chosen.extend(rng.sample(items, per))
    chosen.sort(key=lambda r: r["edge_count"])
    return chosen


def write_manifests(out_dir: Path, records: list[dict[str, Any]], args: argparse.Namespace) -> None:
    def sample_entry(r: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": r["id"],
            "source_id": r["source_id"],
            "family": "native-cp",
            "profile": "clean",
            "bucket": r["bucket"],
            "edge_count": r["edge_count"],
            "vertex_count": r["vertex_count"],
            "assignment_counts": r["assignment_counts"],
            "matched_fraction": r["matched_fraction"],
            "image_size": r["image_size"],
            "threshold": args.threshold,
            "input_png": r["input_png"],
            "gt_graph": r["gt_graph"],
        }

    base = {
        "schema": SCHEMA,
        "generated_by": "scripts/cp-detect/build-native-cp-pack.py",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "scraped/native/cpoogle",
        "image_size": args.image_size,
        "inset_px": args.inset,
        "line_width": args.line_width,
        "bucket_edges": list(args.bucket_edges),
    }
    buckets = {"all": records}
    for name in ("easy", "medium", "hard"):
        buckets[name] = [r for r in records if r["bucket"] == name]
    for name, items in buckets.items():
        manifest = dict(base)
        manifest["bucket"] = name
        manifest["sample_count"] = len(items)
        manifest["samples"] = [sample_entry(r) for r in items]
        path = out_dir / (f"manifest.json" if name == "all" else f"manifest.{name}.json")
        path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def safe_slug(stem: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-")
    return slug[:180]


def rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root))


def parse_args() -> argparse.Namespace:
    base = Path(
        "/Users/zacharymarion/Documents/datasets/create-pattern-detector/scraped/native"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fold-dir", type=Path, default=base / "converted_fold" / "cpoogle")
    parser.add_argument("--cp-dir", type=Path, default=base / "raw" / "cpoogle")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image-size", type=int, default=1024)
    parser.add_argument("--inset", type=float, default=32.0)
    parser.add_argument("--line-width", type=int, default=2)
    parser.add_argument(
        "--match-tol-px",
        type=float,
        default=6.0,
        help="max perpendicular distance (px) for fold-edge -> .cp-segment label transfer",
    )
    parser.add_argument(
        "--bucket-edges",
        type=int,
        nargs=2,
        default=(200, 600),
        metavar=("EASY_MAX", "MEDIUM_MAX"),
        help="edge-count upper bounds for easy and medium buckets",
    )
    parser.add_argument("--limit", type=int, help="stratified subset size (across buckets)")
    parser.add_argument("--seed", type=int, default=19)
    parser.add_argument("--threshold", type=float, default=0.65)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
