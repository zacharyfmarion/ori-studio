#!/usr/bin/env python3
"""Run the frozen Python CP detector on a correctness benchmark pack."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image


SCHEMA = "oristudio/cp-detect-correctness-run/v1"
DEFAULT_DETECTOR_REPO = Path("/Users/zacharymarion/.codex/worktrees/a00b/create-pattern-detector")
DEFAULT_CHECKPOINT = Path("checkpoints/runpod_v2_replay_correction_full_4000ada/full/latest.pt")
DEFAULT_CHECKPOINT_MANIFEST = Path("artifacts/checkpoints/runpod-v2-replay-correction-full-4000ada.json")


def main() -> int:
    args = parse_args()
    detector_repo = resolve_detector_repo(args.detector_repo)
    sys.path.insert(0, str(detector_repo))

    from src.inference.pipeline import (  # noqa: WPS433
        build_stage4_builder,
        load_checkpoint_manifest,
        load_cpline_model,
        select_device,
    )
    from src.models.batchnorm import model_eval_with_batchnorm_mode  # noqa: WPS433
    from src.vectorization import (  # noqa: WPS433
        EdgeAssignmentConfig,
        QualityReportConfig,
        RepairConfig,
        attribute_graph_from_logits,
        build_quality_report,
        conservative_repair,
        cpline_outputs_to_evidence,
        save_fold,
    )

    pack_path = args.pack.resolve()
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    pack_root = pack_path.parent
    out_dir = args.out.resolve()
    predictions_dir = out_dir / "predictions"
    reports_dir = out_dir / "reports"
    predictions_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    checkpoint = resolve_path(args.checkpoint, detector_repo)
    checkpoint_manifest = resolve_path(args.checkpoint_manifest, detector_repo)
    manifest = load_checkpoint_manifest(checkpoint_manifest)
    threshold = args.threshold if args.threshold is not None else manifest_threshold(manifest)
    image_size = int(args.image_size or pack["image_size"])
    device = select_device(args.device)

    model = load_cpline_model(checkpoint, device)
    builder = build_stage4_builder(
        image_size,
        threshold,
        repair_near_endpoint_crossings=args.repair_near_endpoint_crossings,
    )
    assignment_config = EdgeAssignmentConfig()
    repair_config = RepairConfig(image_size=image_size)
    report_config = QualityReportConfig(image_size=image_size)

    rows: list[dict[str, Any]] = []
    with torch.no_grad(), model_eval_with_batchnorm_mode(model, batchnorm_mode=args.batchnorm_mode):
        for sample in pack["samples"]:
            rows.append(
                run_sample(
                    sample,
                    pack_root=pack_root,
                    predictions_dir=predictions_dir,
                    reports_dir=reports_dir,
                    model=model,
                    device=device,
                    builder=builder,
                    assignment_config=assignment_config,
                    repair_config=repair_config,
                    report_config=report_config,
                    image_size=image_size,
                    threshold=threshold,
                    infer_assignments=args.infer_assignments,
                    save_fold=save_fold,
                    cpline_outputs_to_evidence=cpline_outputs_to_evidence,
                    attribute_graph_from_logits=attribute_graph_from_logits,
                    conservative_repair=conservative_repair,
                    build_quality_report=build_quality_report,
                )
            )
            print(json.dumps(rows[-1], sort_keys=True), flush=True)

    run_manifest = {
        "schema": SCHEMA,
        "implementation": "python-pytorch",
        "generated_by": "scripts/cp-detect/run-python-correctness-baseline.py",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "detector_repo": str(detector_repo),
        "detector_repo_commit": git_commit(detector_repo),
        "pack": str(pack_path),
        "checkpoint": str(checkpoint),
        "checkpoint_manifest": str(checkpoint_manifest),
        "checkpoint_id": manifest.get("id"),
        "device": str(device),
        "batchnorm_mode": args.batchnorm_mode,
        "threshold": threshold,
        "image_size": image_size,
        "sample_count": len(rows),
        "ok_count": sum(1 for row in rows if row["ok"]),
        "samples": rows,
    }
    (out_dir / "run_manifest.json").write_text(
        json.dumps(run_manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0 if run_manifest["ok_count"] == run_manifest["sample_count"] else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--detector-repo", type=Path, default=DEFAULT_DETECTOR_REPO)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--checkpoint-manifest", type=Path, default=DEFAULT_CHECKPOINT_MANIFEST)
    parser.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="auto")
    parser.add_argument("--batchnorm-mode", choices=["batch-stats", "eval"], default="batch-stats")
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--image-size", type=int)
    parser.add_argument("--infer-assignments", action="store_true")
    parser.add_argument("--repair-near-endpoint-crossings", action="store_true")
    return parser.parse_args()


def run_sample(
    sample: dict[str, Any],
    *,
    pack_root: Path,
    predictions_dir: Path,
    reports_dir: Path,
    model: torch.nn.Module,
    device: torch.device,
    builder: Any,
    assignment_config: Any,
    repair_config: Any,
    report_config: Any,
    image_size: int,
    threshold: float,
    infer_assignments: bool,
    save_fold: Any,
    cpline_outputs_to_evidence: Any,
    attribute_graph_from_logits: Any,
    conservative_repair: Any,
    build_quality_report: Any,
) -> dict[str, Any]:
    sample_id = str(sample["id"])
    fold_path = predictions_dir / f"{sample_id}.fold"
    report_path = reports_dir / f"{sample_id}.json"
    try:
        image_tensor = load_image_tensor(pack_root / sample["input_png"], image_size, device)
        outputs = model(image_tensor)
        evidence = cpline_outputs_to_evidence(outputs, batch_index=0, line_threshold=threshold)
        graph_result = builder.build(evidence)
        attributed = attribute_graph_from_logits(
            graph_result,
            outputs["assignment_logits"][0].detach().cpu(),
            line_prob=evidence.line_prob,
            config=assignment_config,
        )
        repair = conservative_repair(
            attributed,
            line_prob=evidence.line_prob,
            config=repair_config,
            infer_assignments=infer_assignments,
        )
        report = build_quality_report(
            repair.graph,
            repair_actions=repair.actions,
            config=report_config,
        )
        save_fold(
            repair.graph,
            fold_path,
            report=report,
            repair_actions=repair.actions,
            include_metadata=True,
            file_creator="cp-detector correctness python",
            metadata_schema="oristudio/cp-detect-correctness/python/v1",
            extra_metadata={"sample_id": sample_id},
        )
        report_payload = {
            "schema": "oristudio/cp-detect-correctness-sample-report/v1",
            "sample_id": sample_id,
            "status": report.status,
            "quality_report": report.to_dict(),
            "vertex_count": int(len(repair.graph.vertices_coords)),
            "edge_count": int(len(repair.graph.edges_vertices)),
            "border_edge_count": int(np.sum(repair.graph.edges_assignment == 2)),
            "warnings": report.to_dict().get("warnings", []),
        }
        report_path.write_text(json.dumps(report_payload, indent=2) + "\n", encoding="utf-8")
        return {
            "id": sample_id,
            "ok": True,
            "fold": relpath(fold_path, report_path.parent.parent),
            "report": relpath(report_path, report_path.parent.parent),
            "status": report.status,
            "vertices": int(len(repair.graph.vertices_coords)),
            "edges": int(len(repair.graph.edges_vertices)),
            "border_edges": int(np.sum(repair.graph.edges_assignment == 2)),
        }
    except Exception as exc:  # noqa: BLE001 - benchmark reports per-sample failures
        report_payload = {
            "schema": "oristudio/cp-detect-correctness-sample-report/v1",
            "sample_id": sample_id,
            "status": "failed",
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        report_path.write_text(json.dumps(report_payload, indent=2) + "\n", encoding="utf-8")
        return {
            "id": sample_id,
            "ok": False,
            "fold": None,
            "report": relpath(report_path, report_path.parent.parent),
            "status": "failed",
            "error": str(exc),
        }


def load_image_tensor(path: Path, image_size: int, device: torch.device) -> torch.Tensor:
    with Image.open(path) as opened:
        rgb = opened.convert("RGB")
    if rgb.size != (image_size, image_size):
        raise ValueError(f"Expected {image_size}x{image_size}, got {rgb.size}: {path}")
    array = np.asarray(rgb, dtype=np.float32) / 255.0
    tensor = torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0).to(device)
    return tensor


def manifest_threshold(manifest: dict[str, Any]) -> float:
    inference = manifest.get("inference") or {}
    if "vectorizerThreshold" in inference:
        return float(inference["vectorizerThreshold"])
    if "threshold" in inference:
        return float(inference["threshold"])
    evaluation = manifest.get("evaluation") or {}
    if "threshold" in evaluation:
        return float(evaluation["threshold"])
    return 0.65


def relpath(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def resolve_detector_repo(path: Path) -> Path:
    repo = path.expanduser().resolve()
    if not (repo / "src/inference/pipeline.py").exists():
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
