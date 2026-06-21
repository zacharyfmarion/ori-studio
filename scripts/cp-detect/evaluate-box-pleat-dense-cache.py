#!/usr/bin/env python3
"""Evaluate BP orthogonal crease evidence in a CP detector dense cache."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

SCHEMA = "oristudio/cp-detect-box-pleat-dense-heads/v1"


@dataclass
class PixelAggregate:
    pixels: int = 0
    raw_hits: int = 0
    effective_hits: int = 0
    conflicts: int = 0
    suppressed_raw_hits: int = 0
    raw_sum: float = 0.0
    effective_sum: float = 0.0
    non_crease_sum: float = 0.0

    def add(
        self,
        line_prob: np.ndarray,
        effective: np.ndarray,
        non_crease: np.ndarray,
        mask: np.ndarray,
        args: argparse.Namespace,
    ) -> None:
        values = line_prob[mask]
        effective_values = effective[mask]
        non_crease_values = non_crease[mask]
        self.pixels += int(values.size)
        self.raw_hits += int(np.count_nonzero(values >= args.line_threshold))
        self.effective_hits += int(
            np.count_nonzero(effective_values >= args.line_threshold)
        )
        conflict = non_crease_values >= args.non_crease_threshold
        self.conflicts += int(np.count_nonzero(conflict))
        self.suppressed_raw_hits += int(
            np.count_nonzero(
                (values >= args.line_threshold)
                & conflict
                & (values < args.non_crease_strong_line_threshold)
            )
        )
        self.raw_sum += float(values.sum())
        self.effective_sum += float(effective_values.sum())
        self.non_crease_sum += float(non_crease_values.sum())

    def to_dict(self) -> dict[str, float | int]:
        if self.pixels == 0:
            return {
                "pixels": 0,
                "raw_recall": 0.0,
                "effective_recall": 0.0,
                "recall_drop": 0.0,
                "non_crease_conflict_fraction": 0.0,
                "suppressed_raw_hit_fraction": 0.0,
                "line_prob_mean": 0.0,
                "effective_line_prob_mean": 0.0,
                "non_crease_prob_mean": 0.0,
            }
        raw_recall = self.raw_hits / self.pixels
        effective_recall = self.effective_hits / self.pixels
        return {
            "pixels": self.pixels,
            "raw_recall": raw_recall,
            "effective_recall": effective_recall,
            "recall_drop": raw_recall - effective_recall,
            "non_crease_conflict_fraction": self.conflicts / self.pixels,
            "suppressed_raw_hit_fraction": self.suppressed_raw_hits / self.pixels,
            "line_prob_mean": self.raw_sum / self.pixels,
            "effective_line_prob_mean": self.effective_sum / self.pixels,
            "non_crease_prob_mean": self.non_crease_sum / self.pixels,
        }


def main() -> int:
    args = parse_args()
    manifest_path = args.dense_manifest.resolve()
    manifest_root = manifest_path.parent
    dense_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pack_path = resolve_path(manifest_root, dense_manifest["pack"])
    pack_root = pack_path.parent
    samples = dense_manifest.get("samples", [])
    if args.limit is not None:
        samples = samples[: args.limit]

    per_sample: list[dict[str, Any]] = []
    orthogonal_total = PixelAggregate()
    diagonal_total = PixelAggregate()
    all_crease_total = PixelAggregate()

    for sample in samples:
        line_logits = read_dense_map(manifest_root, sample, "line_logits")
        non_crease_logits = read_dense_map(manifest_root, sample, "non_crease_logits")
        line_prob = sigmoid(line_logits)
        non_crease_prob = sigmoid(non_crease_logits)
        effective = effective_line_prob(line_prob, non_crease_prob, args)

        gt_graph = json.loads(
            resolve_path(pack_root, sample["gt_graph"]).read_text(encoding="utf-8")
        )
        masks, frame = target_masks(
            gt_graph, image_size=int(sample["image_size"]), args=args
        )
        sample_orth = PixelAggregate()
        sample_diag = PixelAggregate()
        sample_all = PixelAggregate()
        sample_orth.add(
            line_prob, effective, non_crease_prob, masks["orthogonal"], args
        )
        sample_diag.add(line_prob, effective, non_crease_prob, masks["diagonal"], args)
        sample_all.add(line_prob, effective, non_crease_prob, masks["all_crease"], args)
        orthogonal_total.add(
            line_prob, effective, non_crease_prob, masks["orthogonal"], args
        )
        diagonal_total.add(
            line_prob, effective, non_crease_prob, masks["diagonal"], args
        )
        all_crease_total.add(
            line_prob, effective, non_crease_prob, masks["all_crease"], args
        )

        row = {
            "id": sample["id"],
            "source_id": sample.get("source_id"),
            "profile": sample.get("profile"),
            "edge_count": sample.get("edge_count"),
            "image_size": sample.get("image_size"),
            "best_frame_deg": frame["best_frame_deg"],
            "orthogonal_edges": frame["orthogonal_edges"],
            "diagonal_edges": frame["diagonal_edges"],
            "orthogonal": sample_orth.to_dict(),
            "diagonal": sample_diag.to_dict(),
            "all_crease": sample_all.to_dict(),
        }
        per_sample.append(row)

    summary = {
        "schema": SCHEMA,
        "generated_by": "scripts/cp-detect/evaluate-box-pleat-dense-cache.py",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": git_commit(repo_root()),
        "dense_manifest": str(manifest_path),
        "pack": str(pack_path),
        "sample_count": len(per_sample),
        "config": {
            "line_threshold": args.line_threshold,
            "non_crease_threshold": args.non_crease_threshold,
            "non_crease_strong_line_threshold": args.non_crease_strong_line_threshold,
            "non_crease_suppression_scale": args.non_crease_suppression_scale,
            "angle_tolerance_deg": args.angle_tolerance_deg,
            "target_line_width_px": args.target_line_width_px,
        },
        "orthogonal": orthogonal_total.to_dict(),
        "diagonal": diagonal_total.to_dict(),
        "all_crease": all_crease_total.to_dict(),
        "worst_orthogonal_recall_drop": sorted(
            per_sample,
            key=lambda row: (
                -row["orthogonal"]["recall_drop"],
                row["orthogonal"]["effective_recall"],
                row["id"],
            ),
        )[:10],
    }

    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "per_sample.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in per_sample),
        encoding="utf-8",
    )
    (out_dir / "summary.md").write_text(summary_markdown(summary), encoding="utf-8")
    print(
        json.dumps(
            {
                "out": str(out_dir),
                "sample_count": len(per_sample),
                "orthogonal": summary["orthogonal"],
            },
            indent=2,
        )
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dense-manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--line-threshold", type=float, default=0.65)
    parser.add_argument("--non-crease-threshold", type=float, default=0.65)
    parser.add_argument("--non-crease-strong-line-threshold", type=float, default=0.85)
    parser.add_argument("--non-crease-suppression-scale", type=float, default=0.15)
    parser.add_argument("--angle-tolerance-deg", type=float, default=10.0)
    parser.add_argument("--target-line-width-px", type=int, default=3)
    return parser.parse_args()


def target_masks(
    gt_graph: dict[str, Any], *, image_size: int, args: argparse.Namespace
) -> tuple[dict[str, np.ndarray], dict[str, float | int]]:
    vertices = np.asarray(gt_graph["vertices_px"], dtype=np.float64)
    edges = np.asarray(gt_graph["edges_vertices"], dtype=np.int64)
    assignments = np.asarray(gt_graph["edges_assignment"], dtype=np.int64)
    non_border = assignments != 2
    edge_vertices = vertices[edges]
    deltas = edge_vertices[:, 1, :] - edge_vertices[:, 0, :]
    lengths = np.linalg.norm(deltas, axis=1)
    angles = np.degrees(np.arctan2(deltas[:, 1], deltas[:, 0])) % 180.0
    valid = non_border & (lengths > 1e-9)
    best_frame, in_axis = best_orthogonal_frame(
        angles[valid], lengths[valid], args.angle_tolerance_deg
    )

    orthogonal_edge_mask = np.zeros(len(edges), dtype=bool)
    orthogonal_edge_mask[np.where(valid)[0]] = in_axis
    diagonal_edge_mask = valid & ~orthogonal_edge_mask
    all_crease_mask = valid

    masks = {
        "orthogonal": draw_edge_mask(
            edge_vertices, orthogonal_edge_mask, image_size, args.target_line_width_px
        ),
        "diagonal": draw_edge_mask(
            edge_vertices, diagonal_edge_mask, image_size, args.target_line_width_px
        ),
        "all_crease": draw_edge_mask(
            edge_vertices, all_crease_mask, image_size, args.target_line_width_px
        ),
    }
    return masks, {
        "best_frame_deg": float(best_frame),
        "orthogonal_edges": int(np.count_nonzero(orthogonal_edge_mask)),
        "diagonal_edges": int(np.count_nonzero(diagonal_edge_mask)),
    }


def draw_edge_mask(
    edge_vertices: np.ndarray, edge_mask: np.ndarray, image_size: int, width: int
) -> np.ndarray:
    image = Image.new("1", (image_size, image_size), 0)
    draw = ImageDraw.Draw(image)
    for p0, p1 in edge_vertices[edge_mask]:
        draw.line(
            [
                (float(p0[0]), float(p0[1])),
                (float(p1[0]), float(p1[1])),
            ],
            fill=1,
            width=width,
        )
    return np.asarray(image, dtype=bool)


def best_orthogonal_frame(
    angles: np.ndarray, lengths: np.ndarray, tolerance_deg: float
) -> tuple[float, np.ndarray]:
    if len(angles) == 0:
        return 0.0, np.zeros(0, dtype=bool)
    thetas = np.arange(0.0, 90.0, 0.5, dtype=np.float64)
    dist0 = angle_distance_deg(angles[:, None], thetas[None, :])
    dist1 = angle_distance_deg(angles[:, None], (thetas[None, :] + 90.0) % 180.0)
    in_axis = (dist0 <= tolerance_deg) | (dist1 <= tolerance_deg)
    weighted = (lengths[:, None] * in_axis).sum(axis=0)
    mean_axis_dist = np.divide(
        (lengths[:, None] * np.minimum(dist0, dist1) * in_axis).sum(axis=0),
        np.maximum(weighted, 1e-9),
    )
    best_idx = int(np.argmax(weighted - 1e-6 * mean_axis_dist - 1e-9 * thetas))
    return float(thetas[best_idx]), in_axis[:, best_idx]


def angle_distance_deg(angles: np.ndarray, targets: np.ndarray | float) -> np.ndarray:
    diff = np.abs(angles - targets)
    return np.minimum(diff, 180.0 - diff)


def read_dense_map(root: Path, sample: dict[str, Any], key: str) -> np.ndarray:
    path = resolve_path(root, sample[f"{key}_f32_path"])
    dims = sample["dims"][key]
    values = np.fromfile(path, dtype="<f4")
    expected = int(np.prod(dims))
    if values.size != expected:
        raise ValueError(
            f"{path} has {values.size} floats, expected {expected} for dims={dims}"
        )
    array = values.reshape(dims)
    if array.ndim == 4 and array.shape[0] == 1 and array.shape[1] == 1:
        return array[0, 0]
    if array.ndim == 3 and array.shape[0] == 1:
        return array[0]
    raise ValueError(f"Expected scalar dense head for {key}, got dims={dims}")


def sigmoid(logits: np.ndarray) -> np.ndarray:
    return (1.0 / (1.0 + np.exp(-logits))).astype(np.float32)


def effective_line_prob(
    line_prob: np.ndarray, non_crease_prob: np.ndarray, args: argparse.Namespace
) -> np.ndarray:
    effective = line_prob.copy()
    suppress = (non_crease_prob >= args.non_crease_threshold) & (
        line_prob < args.non_crease_strong_line_threshold
    )
    effective[suppress] *= args.non_crease_suppression_scale
    return effective


def resolve_path(root: Path, value: str | Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return root / path


def summary_markdown(summary: dict[str, Any]) -> str:
    orth = summary["orthogonal"]
    diag = summary["diagonal"]
    return "\n".join(
        [
            f"# {SCHEMA}",
            "",
            f"- Dense manifest: `{summary['dense_manifest']}`",
            f"- Pack: `{summary['pack']}`",
            f"- Samples: `{summary['sample_count']}`",
            "",
            "## Orthogonal BP Crease Pixels",
            "",
            f"- Raw recall: `{orth['raw_recall']:.4f}`",
            f"- Effective recall after non-crease suppression: `{orth['effective_recall']:.4f}`",
            f"- Recall drop: `{orth['recall_drop']:.4f}`",
            f"- Non-crease conflict fraction: `{orth['non_crease_conflict_fraction']:.4f}`",
            f"- Suppressed raw-hit fraction: `{orth['suppressed_raw_hit_fraction']:.4f}`",
            f"- Mean line probability: `{orth['line_prob_mean']:.4f}`",
            f"- Mean non-crease probability: `{orth['non_crease_prob_mean']:.4f}`",
            "",
            "## Diagonal/Other Crease Pixels",
            "",
            f"- Raw recall: `{diag['raw_recall']:.4f}`",
            f"- Effective recall after non-crease suppression: `{diag['effective_recall']:.4f}`",
            f"- Non-crease conflict fraction: `{diag['non_crease_conflict_fraction']:.4f}`",
            "",
            "## Outputs",
            "",
            "- `summary.json`: aggregate metrics and worst samples",
            "- `per_sample.jsonl`: per-sample metrics",
            "",
        ]
    )


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


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
