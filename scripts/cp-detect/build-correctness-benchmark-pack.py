#!/usr/bin/env python3
"""Build deterministic CP detector correctness benchmark packs from `.fold` data."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


SCHEMA = "oristudio/cp-detect-correctness-pack/v1"
ASSIGNMENT_LABELS = {0: "M", 1: "V", 2: "B", 3: "U"}
TIER_PROFILES = {
    "clean": ["clean"],
    "smoke": ["clean", "line-style", "v2-watermark", "v2-dashed"],
    "iteration": [
        "clean",
        "line-style",
        "print-light",
        "dark-mode",
        "v2-text",
        "v2-watermark",
        "v2-guide-grid",
        "v2-dashed",
        "v2-faint",
        "v2-ambiguous-mv",
        "v2-combined",
        "v2-dark-combined",
    ],
    "promotion": [
        "clean",
        "line-style",
        "print-light",
        "dark-mode",
        "photo-light",
        "photo-dark",
        "v2-text",
        "v2-watermark",
        "v2-guide-grid",
        "v2-dashed",
        "v2-faint",
        "v2-ambiguous-mv",
        "v2-combined",
        "v2-dark-combined",
    ],
}
TIER_SAMPLES_PER_PROFILE = {"clean": 15, "smoke": 3, "iteration": 8, "promotion": 24}


def main() -> int:
    args = parse_args()
    detector_repo = resolve_detector_repo(args.detector_repo)
    sys.path.insert(0, str(detector_repo))

    from src.data.cpline_dataset import CplineFoldDataset  # noqa: WPS433

    manifest_path = resolve_path(args.manifest, detector_repo)
    out_dir = args.out.resolve()
    samples_dir = out_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    profiles = args.profiles or TIER_PROFILES[args.tier]
    samples_per_profile = (
        args.samples_per_profile
        if args.samples_per_profile is not None
        else TIER_SAMPLES_PER_PROFILE[args.tier]
    )
    rows: list[dict[str, Any]] = []

    for profile in profiles:
        dataset = CplineFoldDataset(
            manifest_path,
            split=args.split,
            limit=samples_per_profile,
            max_edges=args.max_edges,
            image_size=args.image_size,
            augment_profile=profile,
            seed=args.seed,
            family_sampling=args.family_sampling,
        )
        for index in range(len(dataset)):
            item = dataset[index]
            rows.append(
                write_sample(
                    item,
                    profile=profile,
                    profile_index=index,
                    image_size=args.image_size,
                    out_dir=out_dir,
                    samples_dir=samples_dir,
                )
            )

    manifest = {
        "schema": SCHEMA,
        "generated_by": "scripts/cp-detect/build-correctness-benchmark-pack.py",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "detector_repo": str(detector_repo),
        "detector_repo_commit": git_commit(detector_repo),
        "source_manifest": str(manifest_path),
        "tier": args.tier,
        "split": args.split,
        "profiles": profiles,
        "samples_per_profile": samples_per_profile,
        "image_size": args.image_size,
        "max_edges": args.max_edges,
        "seed": args.seed,
        "family_sampling": args.family_sampling,
        "sample_count": len(rows),
        "samples": rows,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (out_dir / "manifest.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    print(json.dumps({"pack": str(out_dir), "samples": len(rows), "profiles": profiles}, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--detector-repo",
        type=Path,
        default=Path(
            os.environ.get(
                "CP_DETECTOR_REPO",
                "/Users/zacharymarion/Documents/code/create-pattern-detector",
            )
        ),
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/generated/synthetic/cp_training_mix_v1/raw-manifest.jsonl"),
    )
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--tier", choices=sorted(TIER_PROFILES), default="smoke")
    parser.add_argument("--profiles", nargs="+")
    parser.add_argument("--samples-per-profile", type=int)
    parser.add_argument("--image-size", type=int, default=1024)
    parser.add_argument("--split", choices=["train", "val", "test"], default="val")
    parser.add_argument("--max-edges", type=int, default=300)
    parser.add_argument("--seed", type=int, default=19)
    parser.add_argument("--family-sampling", choices=["natural", "balanced"], default="balanced")
    return parser.parse_args()


def write_sample(
    item: dict[str, Any],
    *,
    profile: str,
    profile_index: int,
    image_size: int,
    out_dir: Path,
    samples_dir: Path,
) -> dict[str, Any]:
    meta = item["meta"]
    source_id = str(meta["id"])
    sample_id = safe_id(f"{source_id}__{profile}__{profile_index:03d}")
    sample_dir = samples_dir / sample_id
    sample_dir.mkdir(parents=True, exist_ok=True)

    image = tensor_image_to_uint8(item["image"])
    input_path = sample_dir / "input.png"
    Image.fromarray(image, mode="RGB").save(input_path)

    graph = item["graph"]
    vertices = graph["vertices"].numpy().astype(float)
    edges = graph["edges"].numpy().astype(int)
    assignments = graph["assignments"].numpy().astype(int)
    gt_graph = {
        "image_size": image_size,
        "vertices_px": vertices.tolist(),
        "edges_vertices": edges.tolist(),
        "edges_assignment": assignments.tolist(),
        "edges_assignment_labels": [ASSIGNMENT_LABELS.get(int(value), "U") for value in assignments],
    }
    gt_graph_path = sample_dir / "gt.graph.json"
    gt_graph_path.write_text(json.dumps(gt_graph, indent=2) + "\n", encoding="utf-8")

    fold = {
        "file_spec": 1.1,
        "file_creator": "cp-detect correctness benchmark",
        "file_classes": ["singleModel"],
        "frame_classes": ["creasePattern"],
        "vertices_coords": (vertices / max(1.0, float(image_size - 1))).clip(0.0, 1.0).tolist(),
        "edges_vertices": edges.tolist(),
        "edges_assignment": [ASSIGNMENT_LABELS.get(int(value), "U") for value in assignments],
        "cp_detector_benchmark": {
            "schema": SCHEMA,
            "source_id": source_id,
            "profile": profile,
            "image_size": image_size,
        },
    }
    gt_fold_path = sample_dir / "gt.fold"
    gt_fold_path.write_text(json.dumps(fold, indent=2) + "\n", encoding="utf-8")

    render_metadata_path = sample_dir / "render_metadata.json"
    render_metadata_path.write_text(
        json.dumps(meta.get("augmentation", {}), indent=2) + "\n",
        encoding="utf-8",
    )

    return {
        "id": sample_id,
        "source_id": source_id,
        "source_fold_path": str(meta["fold_path"]),
        "family": str(meta.get("family", "")),
        "split": str(meta.get("split", "")),
        "bucket": str(meta.get("bucket", "")),
        "profile": profile,
        "profile_index": profile_index,
        "image_size": image_size,
        "edge_count": int(len(edges)),
        "input_png": relpath(input_path, out_dir),
        "gt_fold": relpath(gt_fold_path, out_dir),
        "gt_graph": relpath(gt_graph_path, out_dir),
        "render_metadata": relpath(render_metadata_path, out_dir),
    }


def tensor_image_to_uint8(tensor: Any) -> np.ndarray:
    array = tensor.detach().cpu().permute(1, 2, 0).numpy()
    return np.rint(array * 255.0).clip(0, 255).astype(np.uint8)


def relpath(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")


def resolve_detector_repo(path: Path) -> Path:
    repo = path.expanduser().resolve()
    if not (repo / "src/data/cpline_dataset.py").exists():
        raise SystemExit(f"Not a create-pattern-detector checkout: {repo}")
    return repo


def resolve_path(path: Path, detector_repo: Path) -> Path:
    candidate = path.expanduser()
    if not candidate.is_absolute():
        candidate = detector_repo / candidate
    return candidate.resolve()


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
