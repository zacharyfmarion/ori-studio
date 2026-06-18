#!/usr/bin/env python3
"""Build a deterministic raster CP-detect benchmark pack from repo FOLD fixtures."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


SCHEMA = "oristudio/cp-detect-raster-fold-fixture-pack/v1"
DEFAULT_FIXTURES = [
    "crates/oristudio-cp/resources/default-molecules/blintz.fold",
    "crates/oristudio-cp/resources/default-molecules/bird_base.fold",
    "crates/oristudio-cp/resources/default-molecules/fish_base.fold",
    "crates/oristudio-cp/resources/default-molecules/frog_base.fold",
    "crates/oristudio-cp/resources/default-molecules/dove_base.fold",
    "tests/fixtures/folding-sequence/fold/simple-valley.fold",
    "tests/fixtures/folding-sequence/fold/kite-rabbit-ear-local.fold",
    "tests/fixtures/folding-sequence/fold/squash-local.fold",
    "tests/fixtures/folding-sequence/fold/accordion-book-fold.fold",
    "tests/fixtures/folding-sequence/fold/simultaneous-collapse-unsupported.fold",
    "tests/fixtures/folding-sequence/fold/treemaker-triad-base.fold",
    "crates/oristudio-cp-detect/tests/fixtures/cp-detect-oracle/clean-smoke.fold",
]


def main() -> int:
    args = parse_args()
    repo_root = Path.cwd()
    out_dir = args.out.resolve()
    samples_dir = out_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for fixture in args.fixtures:
        path = (repo_root / fixture).resolve()
        rows.append(
            write_sample(
                path,
                repo_root=repo_root,
                out_dir=out_dir,
                samples_dir=samples_dir,
                image_size=args.image_size,
                line_width=args.line_width,
            )
        )

    manifest = {
        "schema": SCHEMA,
        "generated_by": "scripts/cp-detect/build-raster-fold-fixture-pack.py",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tier": "raster-fold-fixtures",
        "profiles": ["repo-fold-fixture"],
        "image_size": args.image_size,
        "line_width": args.line_width,
        "sample_count": len(rows),
        "samples": rows,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (out_dir / "manifest.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    print(json.dumps({"pack": str(out_dir), "samples": len(rows)}, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image-size", type=int, default=1024)
    parser.add_argument("--line-width", type=int, default=3)
    parser.add_argument("--fixtures", nargs="+", default=DEFAULT_FIXTURES)
    return parser.parse_args()


def write_sample(
    path: Path,
    *,
    repo_root: Path,
    out_dir: Path,
    samples_dir: Path,
    image_size: int,
    line_width: int,
) -> dict[str, Any]:
    fold = json.loads(path.read_text(encoding="utf-8"))
    vertices = fold.get("vertices_coords", [])
    edges = fold.get("edges_vertices", [])
    assignments = fold.get("edges_assignment", ["U"] * len(edges))
    unit_vertices = normalize_vertices(vertices)
    vertices_px = [unit_to_px(point, image_size) for point in unit_vertices]
    sample_id = safe_id(path.with_suffix("").relative_to(repo_root).as_posix())
    sample_dir = samples_dir / sample_id
    sample_dir.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGB", (image_size, image_size), "white")
    draw = ImageDraw.Draw(image)
    for index, edge in enumerate(edges):
        if not valid_edge(edge, len(vertices_px)):
            continue
        assignment = assignment_label(assignments[index] if index < len(assignments) else "U")
        draw.line(
            [tuple(vertices_px[edge[0]]), tuple(vertices_px[edge[1]])],
            fill=assignment_color(assignment),
            width=line_width,
        )
    input_path = sample_dir / "input.png"
    image.save(input_path)

    gt_graph = {
        "image_size": image_size,
        "vertices_px": vertices_px,
        "edges_vertices": edges,
        "edges_assignment_labels": [
            assignment_label(assignments[index] if index < len(assignments) else "U")
            for index in range(len(edges))
        ],
    }
    gt_graph_path = sample_dir / "gt.graph.json"
    gt_graph_path.write_text(json.dumps(gt_graph, indent=2) + "\n", encoding="utf-8")

    gt_fold = dict(fold)
    gt_fold["vertices_coords"] = unit_vertices
    gt_fold["cp_detector_benchmark"] = {
        "schema": SCHEMA,
        "source_fold_path": path.relative_to(repo_root).as_posix(),
        "image_size": image_size,
    }
    gt_fold_path = sample_dir / "gt.fold"
    gt_fold_path.write_text(json.dumps(gt_fold, indent=2) + "\n", encoding="utf-8")

    return {
        "id": sample_id,
        "source_id": path.stem,
        "source_fold_path": path.relative_to(repo_root).as_posix(),
        "family": path.parent.name,
        "split": "repo-fixture",
        "bucket": "raster-fold-fixture",
        "profile": "repo-fold-fixture",
        "profile_index": 0,
        "image_size": image_size,
        "edge_count": len(edges),
        "input_png": relpath(input_path, out_dir),
        "gt_fold": relpath(gt_fold_path, out_dir),
        "gt_graph": relpath(gt_graph_path, out_dir),
    }


def normalize_vertices(vertices: list[Any]) -> list[list[float]]:
    points = [[float(point[0]), float(point[1])] for point in vertices]
    if not points:
        return []
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    if min_x >= -1e-9 and min_y >= -1e-9 and max_x <= 1.0 + 1e-9 and max_y <= 1.0 + 1e-9:
        return [[point[0], point[1]] for point in points]
    span = max(max_x - min_x, max_y - min_y, 1e-9)
    center_x = (min_x + max_x) * 0.5
    center_y = (min_y + max_y) * 0.5
    return [
        [
            min(1.0, max(0.0, 0.5 + (point[0] - center_x) / span)),
            min(1.0, max(0.0, 0.5 + (point[1] - center_y) / span)),
        ]
        for point in points
    ]


def unit_to_px(point: list[float], image_size: int) -> list[float]:
    inset = 32.0
    span = image_size - inset * 2.0
    return [inset + point[0] * span, inset + point[1] * span]


def valid_edge(edge: Any, vertex_count: int) -> bool:
    return (
        isinstance(edge, list)
        and len(edge) == 2
        and isinstance(edge[0], int)
        and isinstance(edge[1], int)
        and 0 <= edge[0] < vertex_count
        and 0 <= edge[1] < vertex_count
    )


def assignment_label(value: Any) -> str:
    if isinstance(value, str):
        label = value.upper()
        if label in {"M", "V", "B", "F", "U"}:
            return label
        if label == "BOUNDARY":
            return "B"
        if label == "MOUNTAIN":
            return "M"
        if label == "VALLEY":
            return "V"
    if value == 0:
        return "M"
    if value == 1:
        return "V"
    if value == 2:
        return "B"
    if value == 3:
        return "F"
    return "U"


def assignment_color(label: str) -> tuple[int, int, int]:
    if label == "M":
        return (210, 45, 58)
    if label == "V":
        return (36, 104, 214)
    if label == "F":
        return (96, 96, 96)
    return (24, 24, 24)


def relpath(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")


if __name__ == "__main__":
    raise SystemExit(main())
