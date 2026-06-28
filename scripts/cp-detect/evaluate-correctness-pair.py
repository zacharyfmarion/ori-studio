#!/usr/bin/env python3
"""Evaluate Python and browser CP detector runs against benchmark GT."""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from current_model import default_detector_repo, load_current_model

SCHEMA = "oristudio/cp-detect-correctness-report/v1"
CURRENT_MODEL = load_current_model()
DEFAULT_DETECTOR_REPO = default_detector_repo(CURRENT_MODEL)
ASSIGNMENT_MAP = {"M": 0, "V": 1, "B": 2, "U": 3, "F": 3}
ASSIGNMENT_COLORS = {
    "M": (230, 57, 70),
    "V": (37, 99, 235),
    "B": (30, 41, 59),
    "U": (107, 114, 128),
}


def main() -> int:
    args = parse_args()
    detector_repo = resolve_detector_repo(args.detector_repo)
    sys.path.insert(0, str(detector_repo))

    from src.vectorization.metrics import evaluate_graph, metrics_from_results  # noqa: WPS433
    from src.vectorization.planar_graph_builder import PlanarGraphResult  # noqa: WPS433

    pack_path = args.pack.resolve()
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    pack_root = pack_path.parent
    python_run = json.loads(args.python_run.resolve().read_text(encoding="utf-8"))
    browser_run = json.loads(args.browser_run.resolve().read_text(encoding="utf-8"))
    python_root = args.python_run.resolve().parent
    browser_root = args.browser_run.resolve().parent
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    per_sample: list[dict[str, Any]] = []
    metrics_by_impl: dict[str, list[Any]] = {"python": [], "browser": []}
    grouped_metrics: dict[str, dict[str, dict[str, list[Any]]]] = {
        "profile": {"python": defaultdict(list), "browser": defaultdict(list)},
        "family": {"python": defaultdict(list), "browser": defaultdict(list)},
        "edge_bucket": {"python": defaultdict(list), "browser": defaultdict(list)},
    }

    python_index = {row["id"]: row for row in python_run["samples"]}
    browser_index = {row["id"]: row for row in browser_run["samples"]}
    for sample in pack["samples"]:
        gt_graph = load_gt_graph(pack_root / sample["gt_graph"])
        gt_vertices = np.asarray(gt_graph["vertices_px"], dtype=np.float32)
        gt_edges = np.asarray(gt_graph["edges_vertices"], dtype=np.int64)
        gt_assignments = np.asarray(gt_graph["edges_assignment"], dtype=np.int8)
        frame = load_sample_frame(pack_root, sample, int(gt_graph["image_size"]))
        row: dict[str, Any] = {
            "id": sample["id"],
            "profile": sample["profile"],
            "family": sample.get("family", ""),
            "edge_count": int(sample.get("edge_count", len(gt_edges))),
            "edge_bucket": edge_bucket(int(sample.get("edge_count", len(gt_edges)))),
        }
        sample_metrics: dict[str, Any] = {}
        for name, run_root, run_index in [
            ("python", python_root, python_index),
            ("browser", browser_root, browser_index),
        ]:
            run_sample = run_index.get(sample["id"])
            if not run_sample or not run_sample.get("ok") or not run_sample.get("fold"):
                metric_payload = failed_metric_payload(len(gt_vertices), len(gt_edges))
                row[name] = {
                    "ok": False,
                    "status": None if not run_sample else run_sample.get("status"),
                    "metrics": metric_payload,
                    "error": None if not run_sample else run_sample.get("error"),
                }
                sample_metrics[name] = metric_payload
                continue
            fold = json.loads((run_root / run_sample["fold"]).read_text(encoding="utf-8"))
            pred = fold_to_graph_result(
                fold,
                image_size=int(gt_graph["image_size"]),
                frame=frame,
                result_cls=PlanarGraphResult,
            )
            metrics = evaluate_graph(
                pred,
                gt_vertices,
                gt_edges,
                gt_assignments,
                vertex_tolerance_px=args.vertex_tolerance_px
                if args.vertex_tolerance_px is not None
                else max(5.0, float(gt_graph["image_size"]) * 5.0 / 1024.0),
            )
            metrics_by_impl[name].append(metrics)
            grouped_metrics["profile"][name][sample["profile"]].append(metrics)
            grouped_metrics["family"][name][sample.get("family", "")].append(metrics)
            grouped_metrics["edge_bucket"][name][row["edge_bucket"]].append(metrics)
            metric_payload = with_f1(metrics.to_dict())
            row[name] = {
                "ok": True,
                "status": run_sample.get("status"),
                "metrics": metric_payload,
            }
            sample_metrics[name] = metric_payload

        row["delta_browser_minus_python"] = metric_delta(
            sample_metrics.get("browser", {}),
            sample_metrics.get("python", {}),
        )
        per_sample.append(row)

    summary = {
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pack": str(pack_path),
        "python_run": str(args.python_run.resolve()),
        "browser_run": str(args.browser_run.resolve()),
        "sample_count": len(per_sample),
        "vertex_tolerance_px": args.vertex_tolerance_px,
        "implementations": {
            "python": with_f1(metrics_from_results(metrics_by_impl["python"])),
            "browser": with_f1(metrics_from_results(metrics_by_impl["browser"])),
        },
    }
    summary["delta_browser_minus_python"] = metric_delta(
        summary["implementations"]["browser"],
        summary["implementations"]["python"],
    )
    summary["by_profile"] = summarize_groups(grouped_metrics["profile"], metrics_from_results)
    summary["by_family"] = summarize_groups(grouped_metrics["family"], metrics_from_results)
    summary["by_edge_bucket"] = summarize_groups(grouped_metrics["edge_bucket"], metrics_from_results)

    regressions = sorted(
        per_sample,
        key=lambda row: row["delta_browser_minus_python"].get("edge_f1", 0.0),
    )
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (out_dir / "per_sample.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in per_sample),
        encoding="utf-8",
    )
    (out_dir / "regressions.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in regressions),
        encoding="utf-8",
    )
    write_summary_md(summary, out_dir / "summary.md")
    write_contact_sheet(
        pack=pack,
        pack_root=pack_root,
        python_root=python_root,
        browser_root=browser_root,
        python_index=python_index,
        browser_index=browser_index,
        rows=regressions[: min(args.contact_sheet_limit, len(regressions))],
        out_path=out_dir / "contact_sheet.png",
    )
    print(json.dumps(summary["delta_browser_minus_python"], indent=2, sort_keys=True))
    print(f"wrote {out_dir}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--detector-repo", type=Path, default=DEFAULT_DETECTOR_REPO)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--python-run", type=Path, required=True)
    parser.add_argument("--browser-run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--vertex-tolerance-px", type=float)
    parser.add_argument("--contact-sheet-limit", type=int, default=8)
    return parser.parse_args()


def load_gt_graph(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_sample_frame(pack_root: Path, sample: dict[str, Any], image_size: int) -> dict[str, float]:
    metadata_path = sample.get("render_metadata")
    if metadata_path:
        metadata = json.loads((pack_root / metadata_path).read_text(encoding="utf-8"))
        frame = metadata.get("v2_boundary", {}).get("frame")
        if frame:
            return {
                "x_min": float(frame["x_min"]),
                "y_min": float(frame["y_min"]),
                "x_max": float(frame["x_max"]),
                "y_max": float(frame["y_max"]),
            }
    return {
        "x_min": 0.0,
        "y_min": 0.0,
        "x_max": float(image_size - 1),
        "y_max": float(image_size - 1),
    }


def fold_to_graph_result(
    fold: dict[str, Any],
    *,
    image_size: int,
    frame: dict[str, float],
    result_cls: Any,
) -> Any:
    vertices_raw = np.asarray(fold.get("vertices_coords", []), dtype=np.float32)
    if vertices_raw.size == 0:
        vertices_raw = np.empty((0, 2), dtype=np.float32)
    if len(vertices_raw) > 0 and float(np.max(np.abs(vertices_raw))) <= 2.0:
        span_x = max(1.0, frame["x_max"] - frame["x_min"])
        span_y = max(1.0, frame["y_max"] - frame["y_min"])
        pixel_vertices = np.empty_like(vertices_raw, dtype=np.float32)
        pixel_vertices[:, 0] = frame["x_min"] + vertices_raw[:, 0] * span_x
        pixel_vertices[:, 1] = frame["y_min"] + vertices_raw[:, 1] * span_y
        vertices_unit = pixel_vertices / max(1.0, float(image_size - 1))
    else:
        pixel_vertices = vertices_raw
        vertices_unit = pixel_vertices / max(1.0, float(image_size - 1))
    edges = np.asarray(fold.get("edges_vertices", []), dtype=np.int64)
    if edges.size == 0:
        edges = np.empty((0, 2), dtype=np.int64)
    assignments = np.asarray(
        [ASSIGNMENT_MAP.get(str(value), 3) for value in fold.get("edges_assignment", [])],
        dtype=np.int8,
    )
    if len(assignments) != len(edges):
        assignments = np.full(len(edges), 3, dtype=np.int8)
    return result_cls(
        vertices_coords=vertices_unit.astype(np.float32),
        edges_vertices=edges,
        edges_assignment=assignments,
        edge_support=np.ones(len(edges), dtype=np.float32),
        vertex_support=np.ones(len(vertices_unit), dtype=np.float32),
        pixel_vertices=pixel_vertices.astype(np.float32),
        debug={},
    )


def failed_metric_payload(gt_vertices: int, gt_edges: int) -> dict[str, Any]:
    return {
        "vertex_precision": 0.0,
        "vertex_recall": 0.0,
        "vertex_f1": 0.0,
        "edge_precision": 0.0,
        "edge_recall": 0.0,
        "edge_f1": 0.0,
        "assignment_accuracy": 0.0,
        "border_precision": 0.0,
        "border_recall": 0.0,
        "border_f1": 0.0,
        "gt_vertices": gt_vertices,
        "pred_vertices": 0,
        "gt_edges": gt_edges,
        "pred_edges": 0,
    }


def with_f1(metrics: dict[str, Any]) -> dict[str, Any]:
    if not metrics:
        return {}
    payload = dict(metrics)
    payload["vertex_f1"] = f1(payload.get("vertex_precision", 0.0), payload.get("vertex_recall", 0.0))
    payload["edge_f1"] = f1(payload.get("edge_precision", 0.0), payload.get("edge_recall", 0.0))
    if "border_f1" not in payload:
        payload["border_f1"] = f1(payload.get("border_precision", 0.0), payload.get("border_recall", 0.0))
    return payload


def f1(precision: float, recall: float) -> float:
    precision = float(precision)
    recall = float(recall)
    return 2.0 * precision * recall / (precision + recall) if precision + recall else 0.0


def metric_delta(left: dict[str, Any], right: dict[str, Any]) -> dict[str, float]:
    keys = [
        "vertex_precision",
        "vertex_recall",
        "vertex_f1",
        "edge_precision",
        "edge_recall",
        "edge_f1",
        "assignment_accuracy",
        "border_precision",
        "border_recall",
        "border_f1",
        "structural_validity_rate",
    ]
    return {
        key: float(left.get(key, 0.0)) - float(right.get(key, 0.0))
        for key in keys
        if key in left or key in right
    }


def summarize_groups(grouped: dict[str, dict[str, list[Any]]], metrics_from_results: Any) -> dict[str, Any]:
    keys = sorted(set(grouped["python"]) | set(grouped["browser"]))
    result: dict[str, Any] = {}
    for key in keys:
        python_summary = with_f1(metrics_from_results(grouped["python"].get(key, [])))
        browser_summary = with_f1(metrics_from_results(grouped["browser"].get(key, [])))
        result[key] = {
            "python": python_summary,
            "browser": browser_summary,
            "delta_browser_minus_python": metric_delta(browser_summary, python_summary),
        }
    return result


def edge_bucket(edge_count: int) -> str:
    if edge_count < 80:
        return "low"
    if edge_count < 180:
        return "medium"
    return "high"


def write_summary_md(summary: dict[str, Any], path: Path) -> None:
    lines = [
        "# CP Detector Correctness Benchmark Summary",
        "",
        f"- Generated: `{summary['generated_at']}`",
        f"- Samples: `{summary['sample_count']}`",
        f"- Pack: `{summary['pack']}`",
        "",
        "| implementation | vertex F1 | edge F1 | border F1 | assignment | structural |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name in ["python", "browser"]:
        metrics = summary["implementations"].get(name, {})
        lines.append(
            "| {name} | {vertex:.4f} | {edge:.4f} | {border:.4f} | {assignment:.4f} | {structural:.4f} |".format(
                name=name,
                vertex=float(metrics.get("vertex_f1", 0.0)),
                edge=float(metrics.get("edge_f1", 0.0)),
                border=float(metrics.get("border_f1", 0.0)),
                assignment=float(metrics.get("assignment_accuracy", 0.0)),
                structural=float(metrics.get("structural_validity_rate", 0.0)),
            )
        )
    delta = summary["delta_browser_minus_python"]
    lines.extend(
        [
            "",
            "## Browser Minus Python",
            "",
            f"- Vertex F1: `{delta.get('vertex_f1', 0.0):+.4f}`",
            f"- Edge F1: `{delta.get('edge_f1', 0.0):+.4f}`",
            f"- Border F1: `{delta.get('border_f1', 0.0):+.4f}`",
            f"- Assignment accuracy: `{delta.get('assignment_accuracy', 0.0):+.4f}`",
            f"- Structural validity rate: `{delta.get('structural_validity_rate', 0.0):+.4f}`",
            "",
            "## By Profile",
            "",
            "| profile | python edge F1 | browser edge F1 | delta edge F1 | python border F1 | browser border F1 | delta border F1 |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for profile, payload in sorted(summary["by_profile"].items()):
        python_metrics = payload["python"]
        browser_metrics = payload["browser"]
        profile_delta = payload["delta_browser_minus_python"]
        lines.append(
            "| {profile} | {py_edge:.4f} | {br_edge:.4f} | {d_edge:+.4f} | {py_border:.4f} | {br_border:.4f} | {d_border:+.4f} |".format(
                profile=profile,
                py_edge=float(python_metrics.get("edge_f1", 0.0)),
                br_edge=float(browser_metrics.get("edge_f1", 0.0)),
                d_edge=float(profile_delta.get("edge_f1", 0.0)),
                py_border=float(python_metrics.get("border_f1", 0.0)),
                br_border=float(browser_metrics.get("border_f1", 0.0)),
                d_border=float(profile_delta.get("border_f1", 0.0)),
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_contact_sheet(
    *,
    pack: dict[str, Any],
    pack_root: Path,
    python_root: Path,
    browser_root: Path,
    python_index: dict[str, Any],
    browser_index: dict[str, Any],
    rows: list[dict[str, Any]],
    out_path: Path,
) -> None:
    sample_index = {sample["id"]: sample for sample in pack["samples"]}
    cell = 260
    label_h = 44
    cols = 4
    width = cols * cell
    height = max(1, len(rows)) * (cell + label_h)
    sheet = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for row_index, row in enumerate(rows):
        sample = sample_index[row["id"]]
        y = row_index * (cell + label_h)
        draw.text((6, y + 4), f"{row['profile']} {row['id'][:38]}", fill=(20, 20, 20), font=font)
        draw.text(
            (6, y + 20),
            "edge F1 py={:.2f} br={:.2f} d={:+.2f}".format(
                row["python"]["metrics"].get("edge_f1", 0.0),
                row["browser"]["metrics"].get("edge_f1", 0.0),
                row["delta_browser_minus_python"].get("edge_f1", 0.0),
            ),
            fill=(20, 20, 20),
            font=font,
        )
        panels = [
            ("input", pack_root / sample["input_png"]),
            ("gt", pack_root / sample["gt_fold"]),
            ("python", python_root / python_index[row["id"]]["fold"] if python_index.get(row["id"], {}).get("fold") else None),
            ("browser", browser_root / browser_index[row["id"]]["fold"] if browser_index.get(row["id"], {}).get("fold") else None),
        ]
        for col, (title, path) in enumerate(panels):
            x = col * cell
            draw.text((x + 6, y + label_h - 14), title, fill=(20, 20, 20), font=font)
            if path is None:
                draw.rectangle((x + 8, y + label_h + 8, x + cell - 8, y + label_h + cell - 8), outline=(180, 180, 180))
                draw.text((x + 60, y + label_h + 120), "missing", fill=(120, 120, 120), font=font)
                continue
            if str(path).endswith(".png"):
                image = Image.open(path).convert("RGB")
            else:
                image = render_fold_preview(json.loads(path.read_text(encoding="utf-8")), cell - 18)
            image.thumbnail((cell - 18, cell - 18), Image.Resampling.LANCZOS)
            sheet.paste(image, (x + 9, y + label_h + 9))
            draw.rectangle((x + 8, y + label_h + 8, x + cell - 8, y + label_h + cell - 8), outline=(210, 210, 210))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)


def render_fold_preview(fold: dict[str, Any], size: int) -> Image.Image:
    image = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(image)
    vertices = fold.get("vertices_coords", [])
    edges = fold.get("edges_vertices", [])
    assignments = fold.get("edges_assignment", [])
    for index, edge in enumerate(edges):
        try:
            a = vertices[int(edge[0])]
            b = vertices[int(edge[1])]
        except (IndexError, TypeError, ValueError):
            continue
        label = str(assignments[index]) if index < len(assignments) else "U"
        color = ASSIGNMENT_COLORS.get(label, ASSIGNMENT_COLORS["U"])
        width = 3 if label == "B" else 2
        draw.line(
            (
                int(round(float(a[0]) * (size - 1))),
                int(round(float(a[1]) * (size - 1))),
                int(round(float(b[0]) * (size - 1))),
                int(round(float(b[1]) * (size - 1))),
            ),
            fill=color,
            width=width,
        )
    return image


def resolve_detector_repo(path: Path) -> Path:
    repo = path.expanduser().resolve()
    if not (repo / "src/vectorization/metrics.py").exists():
        raise SystemExit(f"Not a create-pattern-detector checkout: {repo}")
    return repo


if __name__ == "__main__":
    raise SystemExit(main())
