#!/usr/bin/env python3
"""Export frozen Python CP detector evidence for Rust decoder parity work.

This script is oracle tooling only. It imports an existing
create-pattern-detector checkout and records the intermediate evidence produced
by the frozen Python implementation without modifying that implementation.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


DEFAULT_CHECKPOINT = "checkpoints/runpod_v2_replay_correction_full_4000ada/full/latest.pt"
DEFAULT_CHECKPOINT_MANIFEST = "artifacts/checkpoints/runpod-v2-replay-correction-full-4000ada.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument(
        "--detector-repo",
        type=Path,
        default=None,
        help="create-pattern-detector checkout. Defaults to CP_DETECTOR_REPO.",
    )
    parser.add_argument("--checkpoint", type=Path, default=Path(DEFAULT_CHECKPOINT))
    parser.add_argument(
        "--checkpoint-manifest",
        type=Path,
        default=Path(DEFAULT_CHECKPOINT_MANIFEST),
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="auto")
    parser.add_argument("--batchnorm-mode", choices=["batch-stats", "eval"], default="batch-stats")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--alpha-matte", choices=["auto", "white", "black"], default="auto")
    parser.add_argument("--image-size", type=int, default=1024)
    parser.add_argument("--no-verify-checkpoint", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    detector_repo = resolve_detector_repo(args.detector_repo)
    args.output_dir = args.output_dir.expanduser().resolve()
    sys.path.insert(0, str(detector_repo))

    from src.inference.pipeline import (  # noqa: PLC0415
        CPDetectPipeline,
        InferenceConfig,
        InferenceResult,
        _image_tensor,
        apply_rectification_warnings_to_report,
        write_inference_outputs,
    )
    from src.models.batchnorm import model_eval_with_batchnorm_mode  # noqa: PLC0415
    from src.vectorization import (  # noqa: PLC0415
        attribute_graph_from_logits,
        build_quality_report,
        conservative_repair,
        cpline_outputs_to_evidence,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    config = InferenceConfig(
        checkpoint=args.checkpoint,
        checkpoint_manifest=args.checkpoint_manifest,
        device=args.device,
        image_size=args.image_size,
        threshold=args.threshold,
        batchnorm_mode=args.batchnorm_mode,
        rectified=True,
        alpha_matte=args.alpha_matte,
        include_debug=False,
        verify_checkpoint=not args.no_verify_checkpoint,
    )
    with pushd(detector_repo):
        pipeline = CPDetectPipeline(config)

        fixtures: list[dict[str, Any]] = []
        for input_path in args.inputs:
            input_path = input_path.expanduser().resolve()
            fixture_dir = args.output_dir / input_path.stem
            fixture_dir.mkdir(parents=True, exist_ok=True)
            fixture = export_fixture(
                input_path,
                fixture_dir,
                pipeline,
                config,
                InferenceResult,
                _image_tensor,
                model_eval_with_batchnorm_mode,
                cpline_outputs_to_evidence,
                attribute_graph_from_logits,
                conservative_repair,
                build_quality_report,
                apply_rectification_warnings_to_report,
                write_inference_outputs,
            )
            fixtures.append(fixture)
            print(json.dumps({"id": fixture["id"], "status": fixture["expected_status"]}), flush=True)

    manifest = {
        "schema": "oristudio/cp-detect-python-evidence/v1",
        "generated_by": "scripts/cp-detect/export-python-oracle-evidence.py",
        "detector_repo": str(detector_repo),
        "detector_checkpoint_id": pipeline.manifest.get("id"),
        "checkpoint": {
            "path": str(args.checkpoint),
            "manifest": str(args.checkpoint_manifest),
        },
        "config": {
            "image_size": args.image_size,
            "threshold": pipeline.threshold,
            "batchnorm_mode": args.batchnorm_mode,
            "device": args.device,
        },
        "fixtures": fixtures,
    }
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(json_safe(manifest), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {manifest_path}")
    return 0


def export_fixture(
    input_path: Path,
    fixture_dir: Path,
    pipeline: Any,
    config: Any,
    inference_result_type: Any,
    image_tensor_fn: Any,
    model_eval_with_batchnorm_mode: Any,
    cpline_outputs_to_evidence: Any,
    attribute_graph_from_logits: Any,
    conservative_repair: Any,
    build_quality_report: Any,
    apply_rectification_warnings_to_report: Any,
    write_inference_outputs: Any,
) -> dict[str, Any]:
    import torch  # noqa: PLC0415

    rectification = pipeline.rectifier.rectify(input_path, rectified=True)
    image_tensor = image_tensor_fn(rectification.rectified_rgb, pipeline.device)
    with torch.no_grad(), model_eval_with_batchnorm_mode(
        pipeline.model,
        batchnorm_mode=config.batchnorm_mode,
    ):
        outputs = pipeline.model(image_tensor)

    evidence = cpline_outputs_to_evidence(outputs, batch_index=0, line_threshold=pipeline.threshold)
    decoder = pipeline.builder
    effective_line_prob, suppression_stats = decoder._builder._effective_line_prob(  # noqa: SLF001
        evidence.line_prob,
        evidence,
    )
    mask = decoder._builder._line_mask(effective_line_prob)  # noqa: SLF001
    raw_segments = decoder._builder._hough_segments(mask)  # noqa: SLF001
    raw_lines = decoder._builder._merge_segments(raw_segments)  # noqa: SLF001
    carriers = decoder._carriers_from_lines(raw_lines)  # noqa: SLF001
    vertex_stage = vertex_stage_payload(decoder, evidence, carriers, mask)
    edge_stage = edge_stage_payload(decoder, evidence, carriers, effective_line_prob, mask)
    graph_result = decoder.build(evidence)
    attributed = attribute_graph_from_logits(
        graph_result,
        outputs["assignment_logits"][0].detach().cpu(),
        line_prob=evidence.line_prob,
        config=pipeline.assignment_config,
    )
    repair = conservative_repair(
        attributed,
        line_prob=evidence.line_prob,
        config=pipeline.repair_config,
        infer_assignments=config.infer_assignments,
    )
    quality_report = build_quality_report(
        repair.graph,
        repair_actions=repair.actions,
        config=pipeline.report_config,
    )
    apply_rectification_warnings_to_report(quality_report, rectification)

    result = inference_result_type(
        input_path=input_path,
        rectification=rectification,
        graph=repair.graph,
        repair=repair,
        quality_report=quality_report,
        line_prob=evidence.line_prob.astype(np.float32),
        junction_heatmap=evidence.junction_heatmap.astype(np.float32),
        output_fold=fixture_dir / "oracle.fold",
        report_path=fixture_dir / "oracle.report.json",
        debug_dir=None,
    )
    write_inference_outputs(result, config=config, manifest=pipeline.manifest)

    Image.fromarray(rectification.rectified_rgb).save(fixture_dir / "rectified.png")
    write_json(fixture_dir / "rectification.json", rectification.metadata())
    write_json(fixture_dir / "evidence_summary.json", evidence_summary(evidence))
    write_pgm(fixture_dir / "line_prob.pgm", np.rint(evidence.line_prob * 255.0).clip(0, 255).astype(np.uint8))
    write_f32(fixture_dir / "junction_heatmap.f32", evidence.junction_heatmap)
    if evidence.boundary_contact_heatmap is not None:
        write_f32(fixture_dir / "boundary_contact_heatmap.f32", evidence.boundary_contact_heatmap)
    write_f32(fixture_dir / "effective_line_prob.f32", effective_line_prob)
    if evidence.assignment_labels is not None:
        write_pgm(fixture_dir / "assignment_labels.pgm", evidence.assignment_labels.astype(np.uint8))
    if evidence.line_style_prob is not None:
        write_f32(fixture_dir / "line_style_prob.f32", evidence.line_style_prob)
    write_pgm(
        fixture_dir / "effective_line_prob.pgm",
        np.rint(effective_line_prob * 255.0).clip(0, 255).astype(np.uint8),
    )
    write_pgm(fixture_dir / "line_mask.pgm", mask.astype(np.uint8))
    write_json(fixture_dir / "raw_segments.json", raw_segments.astype(float).tolist())
    write_json(fixture_dir / "raw_lines.json", [line_payload(line) for line in raw_lines])
    write_json(fixture_dir / "carriers.json", [carrier_payload(carrier) for carrier in carriers])
    write_json(fixture_dir / "vertex_stage.json", vertex_stage)
    write_json(fixture_dir / "edge_stage.json", edge_stage)
    write_json(fixture_dir / "suppression.json", suppression_stats)

    fold_payload = json.loads((fixture_dir / "oracle.fold").read_text(encoding="utf-8"))
    return {
        "id": input_path.stem,
        "profile": "real-smoke-v2",
        "source_image_path": str(input_path),
        "root": fixture_dir.name,
        "rectification_path": f"{fixture_dir.name}/rectification.json",
        "rectified_image_path": f"{fixture_dir.name}/rectified.png",
        "evidence_summary_path": f"{fixture_dir.name}/evidence_summary.json",
        "line_prob_pgm_path": f"{fixture_dir.name}/line_prob.pgm",
        "junction_heatmap_f32_path": f"{fixture_dir.name}/junction_heatmap.f32",
        "boundary_contact_heatmap_f32_path": (
            None
            if evidence.boundary_contact_heatmap is None
            else f"{fixture_dir.name}/boundary_contact_heatmap.f32"
        ),
        "effective_line_prob_pgm_path": f"{fixture_dir.name}/effective_line_prob.pgm",
        "effective_line_prob_f32_path": f"{fixture_dir.name}/effective_line_prob.f32",
        "assignment_labels_pgm_path": (
            None if evidence.assignment_labels is None else f"{fixture_dir.name}/assignment_labels.pgm"
        ),
        "line_style_prob_f32_path": (
            None if evidence.line_style_prob is None else f"{fixture_dir.name}/line_style_prob.f32"
        ),
        "line_mask_pgm_path": f"{fixture_dir.name}/line_mask.pgm",
        "raw_segments_path": f"{fixture_dir.name}/raw_segments.json",
        "raw_lines_path": f"{fixture_dir.name}/raw_lines.json",
        "carriers_path": f"{fixture_dir.name}/carriers.json",
        "vertex_stage_path": f"{fixture_dir.name}/vertex_stage.json",
        "edge_stage_path": f"{fixture_dir.name}/edge_stage.json",
        "fold_path": f"{fixture_dir.name}/oracle.fold",
        "report_path": f"{fixture_dir.name}/oracle.report.json",
        "expected_status": quality_report.status,
        "expected_vertices": len(fold_payload.get("vertices_coords", [])),
        "expected_edges": len(fold_payload.get("edges_vertices", [])),
    }


def vertex_stage_payload(decoder: Any, evidence: Any, carriers: list[Any], mask: np.ndarray) -> dict[str, Any]:
    intersections = decoder._carrier_intersections(carriers)  # noqa: SLF001
    junctions = decoder._junction_points(evidence, mask)  # noqa: SLF001
    boundary_contacts = decoder._boundary_contact_points(evidence)  # noqa: SLF001
    candidate_vertices, candidate_meta = decoder._candidate_vertices(evidence, carriers, mask)  # noqa: SLF001
    merged_vertices = decoder._merge_vertices(candidate_vertices)  # noqa: SLF001
    merged_meta = decoder._refresh_vertex_meta(merged_vertices, candidate_meta)  # noqa: SLF001
    return {
        "intersections": points_payload(intersections),
        "junctions": points_payload(junctions),
        "boundary_contacts": points_payload(boundary_contacts),
        "candidate_vertices": [
            {"point": point_payload(point), "kind": str(kind)}
            for point, kind in zip(candidate_vertices, candidate_meta)
        ],
        "merged_vertices": [
            {"point": point_payload(point), "kind": str(kind)}
            for point, kind in zip(merged_vertices, merged_meta)
        ],
    }


def edge_stage_payload(
    decoder: Any,
    evidence: Any,
    carriers: list[Any],
    effective_line_prob: np.ndarray,
    mask: np.ndarray,
) -> dict[str, Any]:
    candidate_vertices, candidate_meta = decoder._candidate_vertices(evidence, carriers, mask)  # noqa: SLF001
    merged_vertices = decoder._merge_vertices(candidate_vertices)  # noqa: SLF001
    merged_meta = decoder._refresh_vertex_meta(merged_vertices, candidate_meta)  # noqa: SLF001
    initial_edges, initial_support, initial_assignments = decoder._interior_edges(  # noqa: SLF001
        merged_vertices,
        carriers,
        effective_line_prob,
        evidence,
    )
    vertices_after_drop, interior_edges, _vertex_support, used_boundary = (  # noqa: SLF001
        decoder._drop_unused_non_border_vertices(
            merged_vertices,
            initial_edges,
            initial_support,
            merged_meta,
        )
    )
    interior_support = decoder._support_for_edges(  # noqa: SLF001
        vertices_after_drop,
        interior_edges,
        effective_line_prob,
        evidence.line_style_prob,
    )
    interior_assignments = decoder._assignments_for_edges(  # noqa: SLF001
        vertices_after_drop,
        interior_edges,
        evidence.assignment_labels,
        default=3,
    )
    border_edges, border_support, border_assignments = decoder._border_chain(  # noqa: SLF001
        vertices_after_drop,
        used_boundary,
        effective_line_prob,
    )
    combined_edges, combined_support, combined_assignments = decoder._combine_edges(  # noqa: SLF001
        interior_edges,
        interior_support,
        interior_assignments,
        border_edges,
        border_support,
        border_assignments,
    )
    return {
        "initial_interior_edges": edges_payload(
            initial_edges,
            initial_support,
            initial_assignments,
        ),
        "vertices_after_drop": [
            {"point": point_payload(point), "kind": str(kind)}
            for point, kind in zip(
                vertices_after_drop,
                decoder._refresh_vertex_meta(vertices_after_drop, []),  # noqa: SLF001
            )
        ],
        "used_boundary": [int(idx) for idx in sorted(used_boundary)],
        "interior_edges": edges_payload(
            interior_edges,
            interior_support,
            interior_assignments,
        ),
        "border_edges": edges_payload(border_edges, border_support, border_assignments),
        "combined_edges": edges_payload(
            combined_edges,
            combined_support,
            combined_assignments,
        ),
    }


def edges_payload(edges: Any, support: Any, assignments: Any) -> list[dict[str, Any]]:
    edge_array = np.asarray(edges, dtype=np.int64).reshape(-1, 2)
    support_array = np.asarray(support, dtype=np.float32).reshape(-1)
    assignment_array = np.asarray(assignments, dtype=np.int8).reshape(-1)
    return [
        {
            "vertices": [int(edge[0]), int(edge[1])],
            "support": float(item_support),
            "assignment": int(assignment),
        }
        for edge, item_support, assignment in zip(edge_array, support_array, assignment_array)
    ]


def evidence_summary(evidence: Any) -> dict[str, Any]:
    return {
        "line_prob": array_summary(evidence.line_prob),
        "angle": array_summary(evidence.angle),
        "junction_heatmap": array_summary(evidence.junction_heatmap),
        "assignment_labels": array_summary(evidence.assignment_labels),
        "non_crease_prob": array_summary(evidence.non_crease_prob),
        "line_style_prob": array_summary(evidence.line_style_prob),
        "boundary_contact_heatmap": array_summary(evidence.boundary_contact_heatmap),
        "vertex_type_prob": array_summary(evidence.vertex_type_prob),
        "boundary_side_prob": array_summary(evidence.boundary_side_prob),
        "boundary_offset": array_summary(evidence.boundary_offset),
        "boundary_coord": array_summary(evidence.boundary_coord),
    }


def array_summary(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    array = np.asarray(value)
    summary: dict[str, Any] = {
        "shape": list(array.shape),
        "dtype": str(array.dtype),
    }
    if array.size:
        numeric = array.astype(np.float64, copy=False)
        summary.update(
            {
                "min": float(np.min(numeric)),
                "max": float(np.max(numeric)),
                "mean": float(np.mean(numeric)),
            }
        )
    return summary


def line_payload(line: Any) -> dict[str, Any]:
    return {
        "p0": array_payload(line.p0),
        "p1": array_payload(line.p1),
        "theta": float(line.theta),
        "rho": float(line.rho),
        "support": float(line.support),
        "votes": int(line.votes),
    }


def carrier_payload(carrier: Any) -> dict[str, Any]:
    return {
        "line": line_payload(carrier.line),
        "p0": array_payload(carrier.p0),
        "p1": array_payload(carrier.p1),
        "t_min": float(carrier.t_min),
        "t_max": float(carrier.t_max),
        "direction": array_payload(carrier.direction),
    }


def points_payload(points: Any) -> list[list[float]]:
    array = np.asarray(points, dtype=np.float32)
    if array.size == 0:
        return []
    return [point_payload(point) for point in array.reshape(-1, 2)]


def point_payload(point: Any) -> list[float]:
    array = np.asarray(point, dtype=np.float32).reshape(-1)
    return [float(array[0]), float(array[1])]


def array_payload(value: Any) -> list[float]:
    return [float(item) for item in np.asarray(value).reshape(-1).tolist()]


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(json_safe(value), indent=2) + "\n", encoding="utf-8")


def write_pgm(path: Path, image: np.ndarray) -> None:
    if image.ndim != 2:
        raise ValueError(f"PGM image must be 2D: {path}")
    h, w = image.shape
    with path.open("wb") as handle:
        handle.write(f"P5\n{w} {h}\n255\n".encode("ascii"))
        handle.write(np.ascontiguousarray(image, dtype=np.uint8).tobytes())


def write_f32(path: Path, array: np.ndarray | None) -> None:
    if array is None:
        return
    np.asarray(array, dtype="<f4").tofile(path)


def resolve_detector_repo(arg: Path | None) -> Path:
    value = arg or (Path(os.environ["CP_DETECTOR_REPO"]) if "CP_DETECTOR_REPO" in os.environ else None)
    if value is None:
        raise SystemExit("Pass --detector-repo or set CP_DETECTOR_REPO")
    repo = value.expanduser().resolve()
    if not (repo / "src/inference/pipeline.py").exists():
        raise SystemExit(f"Not a create-pattern-detector checkout: {repo}")
    return repo


class pushd:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.previous: Path | None = None

    def __enter__(self) -> None:
        self.previous = Path.cwd()
        os.chdir(self.path)

    def __exit__(self, *_: Any) -> None:
        if self.previous is not None:
            os.chdir(self.previous)


def json_safe(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, np.ndarray):
        return [json_safe(item) for item in value.tolist()]
    if isinstance(value, np.generic):
        return value.item()
    if hasattr(value, "to_dict"):
        return json_safe(value.to_dict())
    if hasattr(value, "__dataclass_fields__"):
        return json_safe(asdict(value))
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


if __name__ == "__main__":
    raise SystemExit(main())
