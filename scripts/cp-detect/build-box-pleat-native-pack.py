#!/usr/bin/env python3
"""Build a CP detector correctness pack from the ML repo's BP native eval spec."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

SCHEMA = "oristudio/cp-detect-correctness-pack/v1"
BOX_PLEAT_SCHEMA = "oristudio/cp-detect-box-pleat-pack/v1"
ASSIGNMENT_LABELS = {0: "M", 1: "V", 2: "B", 3: "U"}
ASSIGNMENT_RGB = {
    0: (220, 40, 40),
    1: (40, 80, 220),
    2: (0, 0, 0),
    3: (120, 120, 120),
}
DEFAULT_EVAL_SPEC = Path("eval_specs/box_pleat_native_v1.json")


def main() -> int:
    args = parse_args()
    detector_repo = resolve_detector_repo(args.detector_repo)
    sys.path.insert(0, str(detector_repo))

    bp_finder = load_bp_finder(detector_repo)
    spec_path = resolve_detector_path(args.eval_spec, detector_repo)
    eval_spec = bp_finder.load_eval_spec(spec_path)
    defaults = bp_finder.eval_spec_defaults(eval_spec)
    fold_root = resolve_fold_root(args.fold_root, detector_repo, defaults)
    pattern = args.pattern or defaults["pattern"]
    candidate_tiers = tuple(args.candidate_tiers or defaults["candidate_tiers"])

    fold_paths = sorted(fold_root.glob(pattern))
    if not fold_paths:
        raise SystemExit(f"No FOLD files matched {pattern!r} under {fold_root}")

    records, errors = bp_finder.score_fold_files(
        fold_paths,
        fold_root=fold_root,
        tolerance_deg=float(
            args.angle_tolerance_deg or defaults["angle_tolerance_deg"]
        ),
        frame_step_deg=float(args.frame_step_deg or defaults["frame_step_deg"]),
        coord_tolerance_frac=float(
            args.coord_tolerance_frac or defaults["coord_tolerance_frac"]
        ),
        min_segments_per_line=int(
            args.min_segments_per_line or defaults["min_segments_per_line"]
        ),
    )
    candidate_records = [
        record for record in records if record.candidate_tier in candidate_tiers
    ]
    fingerprints = bp_finder.build_fingerprints(
        records,
        errors=errors,
        candidate_records=candidate_records,
        candidate_tiers=candidate_tiers,
    )
    verification = None
    if eval_spec.get("expected"):
        verification = bp_finder.compare_expected_fingerprints(
            fingerprints, eval_spec["expected"]
        )
        if args.verify_spec and not all(
            result["matches"] for result in verification.values()
        ):
            mismatches = [
                key for key, result in verification.items() if not result["matches"]
            ]
            raise SystemExit(
                f"BP eval spec verification failed for: {', '.join(mismatches)}"
            )

    selected_records = (
        candidate_records[: args.limit] if args.limit is not None else candidate_records
    )
    out_dir = args.out.resolve()
    samples_dir = out_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    unsupported_profiles = [profile for profile in args.profiles if profile != "clean"]
    if unsupported_profiles:
        raise SystemExit(
            "Box-pleat native packs currently support only the clean profile; "
            f"unsupported profiles: {', '.join(unsupported_profiles)}"
        )

    parser = bp_finder.FOLDParser()
    rows: list[dict[str, Any]] = []
    for rank, record in enumerate(selected_records):
        cp = parser.parse(record.path)
        for profile_index, profile in enumerate(args.profiles):
            sample = render_clean_fold_sample(
                cp,
                bp_finder=bp_finder,
                image_size=args.image_size,
                padding=(
                    args.padding
                    if args.padding is not None
                    else max(8, int(32 * args.image_size / 1024))
                ),
                line_width=(
                    args.line_width
                    if args.line_width is not None
                    else max(1, int(2 * args.image_size / 768))
                ),
            )
            rows.append(
                write_sample(
                    record,
                    sample,
                    rank=rank,
                    profile=profile,
                    profile_index=profile_index,
                    image_size=args.image_size,
                    out_dir=out_dir,
                    samples_dir=samples_dir,
                )
            )

    manifest = {
        "schema": SCHEMA,
        "generated_by": "scripts/cp-detect/build-box-pleat-native-pack.py",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "detector_repo": str(detector_repo),
        "detector_repo_commit": git_commit(detector_repo),
        "box_pleat_eval": {
            "schema": BOX_PLEAT_SCHEMA,
            "spec": str(spec_path),
            "spec_name": eval_spec.get("name"),
            "finder_algorithm": bp_finder.ALGORITHM_ID,
            "fold_root": str(fold_root),
            "glob": pattern,
            "candidate_tiers": list(candidate_tiers),
            "full_candidate_count": len(candidate_records),
            "used_candidate_count": len(selected_records),
            "fingerprints": fingerprints,
            "verification": verification,
        },
        "tier": "box-pleat-native-v1",
        "split": "native",
        "profiles": args.profiles,
        "samples_per_profile": len(selected_records),
        "image_size": args.image_size,
        "seed": args.seed,
        "sample_count": len(rows),
        "samples": rows,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "manifest.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "pack": str(out_dir),
                "samples": len(rows),
                "used_candidates": len(selected_records),
                "full_candidates": len(candidate_records),
                "profiles": args.profiles,
                "verification_ok": verification is None
                or all(result["matches"] for result in verification.values()),
            },
            indent=2,
        )
    )
    return 0


def render_clean_fold_sample(
    cp: Any,
    *,
    bp_finder: Any,
    image_size: int,
    padding: int,
    line_width: int,
) -> SimpleNamespace:
    pixel_vertices, transform = bp_finder.transform_coords(
        cp.vertices,
        image_size=image_size,
        padding=padding,
    )
    image = render_clean_input_image(
        pixel_vertices=pixel_vertices,
        edges=cp.edges,
        assignments=cp.assignments,
        image_size=image_size,
        line_width=line_width,
    )
    return SimpleNamespace(
        image=image,
        pixel_vertices=np.asarray(pixel_vertices, dtype=np.float32),
        edges=np.asarray(cp.edges, dtype=np.int64),
        assignments=np.asarray(cp.assignments, dtype=np.int8),
        metadata={
            "profile": "clean",
            "renderer": "scripts/cp-detect/build-box-pleat-native-pack.py",
            "transform": transform,
            "padding": padding,
            "line_width": line_width,
            "palette": ASSIGNMENT_RGB,
        },
    )


def render_clean_input_image(
    *,
    pixel_vertices: np.ndarray,
    edges: np.ndarray,
    assignments: np.ndarray,
    image_size: int,
    line_width: int,
) -> np.ndarray:
    scale = 3
    canvas_size = image_size * scale
    image = Image.new("RGB", (canvas_size, canvas_size), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    vertices = np.asarray(pixel_vertices, dtype=np.float64) * scale
    for edge_idx, (v1_idx, v2_idx) in enumerate(edges):
        p0 = vertices[int(v1_idx)]
        p1 = vertices[int(v2_idx)]
        assignment = int(assignments[edge_idx])
        draw.line(
            [(float(p0[0]), float(p0[1])), (float(p1[0]), float(p1[1]))],
            fill=ASSIGNMENT_RGB.get(assignment, ASSIGNMENT_RGB[3]),
            width=max(1, int(line_width) * scale),
        )
    return np.asarray(
        image.resize((image_size, image_size), Image.Resampling.LANCZOS),
        dtype=np.uint8,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--detector-repo", type=Path, default=default_detector_repo())
    parser.add_argument("--eval-spec", type=Path, default=DEFAULT_EVAL_SPEC)
    parser.add_argument("--fold-root", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--pattern")
    parser.add_argument("--profiles", nargs="+", default=["clean"])
    parser.add_argument(
        "--limit",
        type=int,
        help="Limit selected BP candidates after full spec verification.",
    )
    parser.add_argument("--image-size", type=int, default=1024)
    parser.add_argument("--padding", type=int)
    parser.add_argument("--line-width", type=int)
    parser.add_argument("--seed", type=int, default=31)
    parser.add_argument("--angle-tolerance-deg", type=float)
    parser.add_argument("--frame-step-deg", type=float)
    parser.add_argument("--coord-tolerance-frac", type=float)
    parser.add_argument("--min-segments-per-line", type=int)
    parser.add_argument("--candidate-tiers", nargs="+")
    parser.add_argument(
        "--no-verify-spec",
        dest="verify_spec",
        action="store_false",
        help="Do not fail if regenerated BP fingerprints differ from the tracked spec.",
    )
    parser.set_defaults(verify_spec=True)
    return parser.parse_args()


def write_sample(
    record: Any,
    sample: Any,
    *,
    rank: int,
    profile: str,
    profile_index: int,
    image_size: int,
    out_dir: Path,
    samples_dir: Path,
) -> dict[str, Any]:
    source_id = f"box_pleat_native_v1-{rank:03d}-{record.canonical_fold_sha256[:12]}"
    sample_id = safe_id(f"{source_id}__{profile}__{profile_index:03d}")
    sample_dir = samples_dir / sample_id
    sample_dir.mkdir(parents=True, exist_ok=True)

    input_path = sample_dir / "input.png"
    Image.fromarray(sample.image, mode="RGB").save(input_path)

    vertices = np.asarray(sample.pixel_vertices, dtype=float)
    edges = np.asarray(sample.edges, dtype=int)
    assignments = np.asarray(sample.assignments, dtype=int)
    gt_graph = {
        "image_size": image_size,
        "vertices_px": vertices.tolist(),
        "edges_vertices": edges.tolist(),
        "edges_assignment": assignments.tolist(),
        "edges_assignment_labels": [
            ASSIGNMENT_LABELS.get(int(value), "U") for value in assignments
        ],
    }
    gt_graph_path = sample_dir / "gt.graph.json"
    gt_graph_path.write_text(json.dumps(gt_graph, indent=2) + "\n", encoding="utf-8")

    fold = {
        "file_spec": 1.1,
        "file_creator": "cp-detect box-pleat native benchmark",
        "file_classes": ["singleModel"],
        "frame_classes": ["creasePattern"],
        "vertices_coords": (vertices / max(1.0, float(image_size - 1)))
        .clip(0.0, 1.0)
        .tolist(),
        "edges_vertices": edges.tolist(),
        "edges_assignment": [
            ASSIGNMENT_LABELS.get(int(value), "U") for value in assignments
        ],
        "cp_detector_benchmark": {
            "schema": BOX_PLEAT_SCHEMA,
            "source_id": source_id,
            "profile": profile,
            "image_size": image_size,
            "canonical_fold_sha256": record.canonical_fold_sha256,
            "bp_score": record.bp_score,
            "candidate_tier": record.candidate_tier,
        },
    }
    gt_fold_path = sample_dir / "gt.fold"
    gt_fold_path.write_text(json.dumps(fold, indent=2) + "\n", encoding="utf-8")

    metadata = {
        "source_fold_id": record.id,
        "source_fold_path": record.path,
        "relative_path": record.relative_path,
        "canonical_fold_sha256": record.canonical_fold_sha256,
        "content_sha256": record.content_sha256,
        "rank": rank,
        "candidate_tier": record.candidate_tier,
        "bp_score": record.bp_score,
        "orthogonal_length_ratio": record.orthogonal_length_ratio,
        "axis_balance": record.axis_balance,
        "best_frame_deg": record.best_frame_deg,
        "repeated_coord_count": record.repeated_coord_count,
        "render_metadata": sample.metadata,
    }
    render_metadata_path = sample_dir / "render_metadata.json"
    render_metadata_path.write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )

    return {
        "id": sample_id,
        "source_id": source_id,
        "source_fold_id": record.id,
        "source_fold_path": record.path,
        "canonical_fold_sha256": record.canonical_fold_sha256,
        "bp_score": record.bp_score,
        "candidate_tier": record.candidate_tier,
        "family": "box-pleat-native-v1",
        "split": "native",
        "bucket": record.candidate_tier,
        "profile": profile,
        "profile_index": profile_index,
        "image_size": image_size,
        "edge_count": int(len(edges)),
        "input_png": relpath(input_path, out_dir),
        "gt_fold": relpath(gt_fold_path, out_dir),
        "gt_graph": relpath(gt_graph_path, out_dir),
        "render_metadata": relpath(render_metadata_path, out_dir),
    }


def load_bp_finder(detector_repo: Path) -> Any:
    script = detector_repo / "scripts/data/find_box_pleat_candidates.py"
    if not script.exists():
        raise SystemExit(f"Missing BP finder in detector repo: {script}")
    spec = importlib.util.spec_from_file_location("find_box_pleat_candidates", script)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Could not import BP finder: {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def default_detector_repo() -> Path:
    if os.environ.get("CP_DETECTOR_REPO"):
        return Path(os.environ["CP_DETECTOR_REPO"])
    return Path(__file__).resolve().parents[2].parent / "create-pattern-detector"


def resolve_detector_repo(path: Path) -> Path:
    repo = path.expanduser().resolve()
    if not (repo / "src/data/cpline_dataset.py").exists():
        raise SystemExit(f"Not a create-pattern-detector checkout: {repo}")
    return repo


def resolve_detector_path(path: Path, detector_repo: Path) -> Path:
    candidate = path.expanduser()
    if not candidate.is_absolute():
        candidate = detector_repo / candidate
    return candidate.resolve()


def resolve_fold_root(
    path: Path | None, detector_repo: Path, defaults: dict[str, Any]
) -> Path:
    if path is not None:
        return resolve_detector_path(path, detector_repo)
    return resolve_detector_path(
        (
            Path(defaults["fold_root"])
            if "fold_root" in defaults
            else Path("data/output/scraped/native/converted_fold")
        ),
        detector_repo,
    )


def relpath(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")


def git_commit(repo: Path) -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=repo,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


if __name__ == "__main__":
    raise SystemExit(main())
