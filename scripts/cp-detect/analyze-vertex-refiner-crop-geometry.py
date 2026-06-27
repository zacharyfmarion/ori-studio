#!/usr/bin/env python3
"""Analyze vertex-refiner misses against the crop proposal geometry."""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class Frame:
    x_min: float
    y_min: float
    x_max: float
    y_max: float


def main() -> int:
    args = parse_args()
    pack_path = args.pack.resolve()
    debug_manifest_path = args.debug_run.resolve()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    overlay_dir = out_dir / "sample_overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)

    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    pack_root = pack_path.parent
    debug_manifest = json.loads(debug_manifest_path.read_text(encoding="utf-8"))
    debug_root = debug_manifest_path.parent
    debug_index = {row["id"]: row for row in debug_manifest["samples"]}

    gt_rows: list[dict[str, Any]] = []
    pred_rows: list[dict[str, Any]] = []
    sample_summaries: list[dict[str, Any]] = []
    overlay_paths: list[Path] = []

    for sample in pack["samples"]:
        debug_row = debug_index.get(sample["id"])
        if not debug_row or not debug_row.get("ok") or not debug_row.get("debug"):
            continue
        debug = json.loads((debug_root / debug_row["debug"]).read_text(encoding="utf-8"))
        gt_graph = json.loads((pack_root / sample["gt_graph"]).read_text(encoding="utf-8"))
        frame = load_frame(debug, pack_root, sample)
        proposals = [proposal_point(row) for row in debug["proposals"]]
        merged_vertices = prediction_points(debug["mergedVertices"], frame)
        gt_vertices = [Point(float(x), float(y)) for x, y in gt_graph["vertices_px"]]
        gt_degrees = vertex_degrees(len(gt_vertices), gt_graph.get("edges_vertices", []))
        matches, pred_matches = greedy_match(gt_vertices, merged_vertices, args.match_tolerance_px)

        sample_rows = []
        for vertex_id, gt in enumerate(gt_vertices):
            crop_stats = crop_geometry_stats(gt, proposals, args.crop_size)
            frame_distance = distance_to_frame(gt, frame)
            match = matches.get(vertex_id)
            row = {
                "sample_id": sample["id"],
                "vertex_id": vertex_id,
                "x": gt.x,
                "y": gt.y,
                "degree": gt_degrees[vertex_id],
                "gt_location": "boundary" if frame_distance <= args.boundary_tolerance_px else "interior",
                "distance_to_frame_px": frame_distance,
                "matched": match is not None,
                "match_pred_id": None if match is None else match[0],
                "match_distance_px": None if match is None else match[1],
                **crop_stats,
            }
            gt_rows.append(row)
            sample_rows.append(row)

        for pred_id, pred in enumerate(merged_vertices):
            crop_stats = crop_geometry_stats(pred, proposals, args.crop_size)
            frame_distance = distance_to_frame(pred, frame)
            match = pred_matches.get(pred_id)
            pred_rows.append({
                "sample_id": sample["id"],
                "pred_id": pred_id,
                "x": pred.x,
                "y": pred.y,
                "pred_location": "boundary" if frame_distance <= args.boundary_tolerance_px else "interior",
                "distance_to_frame_px": frame_distance,
                "matched": match is not None,
                "match_gt_id": None if match is None else match[0],
                "match_distance_px": None if match is None else match[1],
                **crop_stats,
            })

        matched_count = sum(1 for row in sample_rows if row["matched"])
        sample_summaries.append({
            "sample_id": sample["id"],
            "gt_vertices": len(gt_vertices),
            "pred_vertices": len(merged_vertices),
            "matched_vertices": matched_count,
            "recall": safe_div(matched_count, len(gt_vertices)),
            "precision": safe_div(sum(1 for pred_id in range(len(merged_vertices)) if pred_id in pred_matches), len(merged_vertices)),
            "proposal_count": len(proposals),
        })
        overlay_path = overlay_dir / f"{sample['id']}.png"
        draw_overlay(
            image_path=pack_root / sample["input_png"],
            out_path=overlay_path,
            proposals=debug["proposals"],
            crop_size=args.crop_size,
            gt_rows=sample_rows,
            pred_points=merged_vertices,
            pred_matches=pred_matches,
        )
        overlay_paths.append(overlay_path)

    write_csv(out_dir / "gt_vertices.csv", gt_rows)
    write_csv(out_dir / "pred_vertices.csv", pred_rows)
    write_csv(out_dir / "samples.csv", sample_summaries)
    contact_sheet_path = out_dir / "crop_geometry_contact_sheet.png"
    write_contact_sheet(overlay_paths, contact_sheet_path)

    summary = build_summary(
        gt_rows=gt_rows,
        pred_rows=pred_rows,
        sample_summaries=sample_summaries,
        pack_path=pack_path,
        debug_manifest_path=debug_manifest_path,
        out_dir=out_dir,
        match_tolerance_px=args.match_tolerance_px,
    )
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    write_summary_md(summary, out_dir / "summary.md")
    print(json.dumps(summary["overall"], indent=2, sort_keys=True))
    print(f"wrote {out_dir}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--debug-run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--crop-size", type=float, default=96.0)
    parser.add_argument("--match-tolerance-px", type=float, default=5.0)
    parser.add_argument("--boundary-tolerance-px", type=float, default=3.0)
    return parser.parse_args()


def load_frame(debug: dict[str, Any], pack_root: Path, sample: dict[str, Any]) -> Frame:
    frame = debug.get("frame")
    if not frame and sample.get("render_metadata"):
        metadata = json.loads((pack_root / sample["render_metadata"]).read_text(encoding="utf-8"))
        frame = metadata.get("v2_boundary", {}).get("frame")
    if not frame:
        raise ValueError(f"Missing frame for {sample['id']}")
    if isinstance(frame, list):
        if len(frame) != 4:
            raise ValueError(f"Unsupported frame for {sample['id']}: {frame}")
        if all(isinstance(value, (int, float)) for value in frame):
            x_min, y_min, x_max, y_max = map(float, frame)
        else:
            points = [(float(point[0]), float(point[1])) for point in frame]
            x_min = min(point[0] for point in points)
            y_min = min(point[1] for point in points)
            x_max = max(point[0] for point in points)
            y_max = max(point[1] for point in points)
    else:
        x_min = float(frame["x_min"])
        y_min = float(frame["y_min"])
        x_max = float(frame["x_max"])
        y_max = float(frame["y_max"])
    return Frame(x_min=x_min, y_min=y_min, x_max=x_max, y_max=y_max)


def proposal_point(row: dict[str, Any]) -> Point:
    return Point(float(row["x"]), float(row["y"]))


def prediction_points(rows: list[dict[str, Any]], frame: Frame) -> list[Point]:
    points = [Point(float(row["x"]), float(row["y"])) for row in rows]
    if points and max(max(abs(point.x), abs(point.y)) for point in points) <= 2.0:
        width = frame.x_max - frame.x_min
        height = frame.y_max - frame.y_min
        return [Point(frame.x_min + point.x * width, frame.y_min + point.y * height) for point in points]
    return points


def vertex_degrees(vertex_count: int, edges: list[list[int]]) -> list[int]:
    degrees = [0] * vertex_count
    for edge in edges:
        if len(edge) != 2:
            continue
        a, b = int(edge[0]), int(edge[1])
        if 0 <= a < vertex_count:
            degrees[a] += 1
        if 0 <= b < vertex_count:
            degrees[b] += 1
    return degrees


def greedy_match(
    gt_vertices: list[Point],
    pred_vertices: list[Point],
    tolerance_px: float,
) -> tuple[dict[int, tuple[int, float]], dict[int, tuple[int, float]]]:
    candidates: list[tuple[float, int, int]] = []
    for gt_id, gt in enumerate(gt_vertices):
        for pred_id, pred in enumerate(pred_vertices):
            dist = distance(gt, pred)
            if dist <= tolerance_px:
                candidates.append((dist, gt_id, pred_id))
    matches: dict[int, tuple[int, float]] = {}
    pred_matches: dict[int, tuple[int, float]] = {}
    for dist, gt_id, pred_id in sorted(candidates):
        if gt_id in matches or pred_id in pred_matches:
            continue
        matches[gt_id] = (pred_id, dist)
        pred_matches[pred_id] = (gt_id, dist)
    return matches, pred_matches


def crop_geometry_stats(point: Point, proposals: list[Point], crop_size: float) -> dict[str, Any]:
    half = crop_size / 2.0
    coverage_count = 0
    best_center_distance = math.inf
    best_edge_margin = -math.inf
    nearest_vertical_edge = math.inf
    nearest_horizontal_edge = math.inf
    nearest_any_edge = math.inf
    for proposal in proposals:
        dx = abs(point.x - proposal.x)
        dy = abs(point.y - proposal.y)
        nearest_vertical_edge = min(nearest_vertical_edge, abs(dx - half))
        nearest_horizontal_edge = min(nearest_horizontal_edge, abs(dy - half))
        nearest_any_edge = min(nearest_any_edge, abs(dx - half), abs(dy - half))
        if dx <= half and dy <= half:
            coverage_count += 1
            best_center_distance = min(best_center_distance, math.hypot(dx, dy))
            best_edge_margin = max(best_edge_margin, min(half - dx, half - dy))
    if not math.isfinite(best_center_distance):
        best_center_distance = None
    if not math.isfinite(best_edge_margin):
        best_edge_margin = None
    intersection_linf = max(nearest_vertical_edge, nearest_horizontal_edge)
    intersection_l2 = math.hypot(nearest_vertical_edge, nearest_horizontal_edge)
    return {
        "coverage_count": coverage_count,
        "best_crop_center_distance_px": best_center_distance,
        "best_crop_edge_margin_px": best_edge_margin,
        "nearest_crop_vertical_edge_px": nearest_vertical_edge,
        "nearest_crop_horizontal_edge_px": nearest_horizontal_edge,
        "nearest_crop_any_edge_px": nearest_any_edge,
        "nearest_crop_edge_intersection_linf_px": intersection_linf,
        "nearest_crop_edge_intersection_l2_px": intersection_l2,
        "near_crop_edge_intersection_2px": intersection_linf <= 2.0,
        "near_crop_edge_intersection_4px": intersection_linf <= 4.0,
        "near_crop_edge_intersection_8px": intersection_linf <= 8.0,
        "best_crop_margin_le_4px": best_edge_margin is not None and best_edge_margin <= 4.0,
        "best_crop_margin_le_8px": best_edge_margin is not None and best_edge_margin <= 8.0,
    }


def distance_to_frame(point: Point, frame: Frame) -> float:
    return min(
        abs(point.x - frame.x_min),
        abs(point.x - frame.x_max),
        abs(point.y - frame.y_min),
        abs(point.y - frame.y_max),
    )


def build_summary(
    *,
    gt_rows: list[dict[str, Any]],
    pred_rows: list[dict[str, Any]],
    sample_summaries: list[dict[str, Any]],
    pack_path: Path,
    debug_manifest_path: Path,
    out_dir: Path,
    match_tolerance_px: float,
) -> dict[str, Any]:
    matched_gt = sum(1 for row in gt_rows if row["matched"])
    matched_pred = sum(1 for row in pred_rows if row["matched"])
    precision = safe_div(matched_pred, len(pred_rows))
    recall = safe_div(matched_gt, len(gt_rows))
    summary = {
        "schema": "oristudio/cp-vertex-refiner-crop-geometry-analysis/v1",
        "pack": str(pack_path),
        "debug_run": str(debug_manifest_path),
        "out_dir": str(out_dir),
        "match_tolerance_px": match_tolerance_px,
        "overall": {
            "samples": len(sample_summaries),
            "gt_vertices": len(gt_rows),
            "pred_vertices": len(pred_rows),
            "matched_gt_vertices": matched_gt,
            "matched_pred_vertices": matched_pred,
            "recall": recall,
            "precision": precision,
            "f1": f1(precision, recall),
        },
        "gt_buckets": {
            "location": summarize_bucket(gt_rows, lambda row: row["gt_location"]),
            "coverage_count": summarize_bucket(gt_rows, coverage_bucket),
            "best_crop_margin": summarize_bucket(gt_rows, best_margin_bucket),
            "best_center_distance": summarize_bucket(gt_rows, center_distance_bucket),
            "crop_edge_intersection_2px": summarize_bucket(gt_rows, lambda row: bool_bucket(row["near_crop_edge_intersection_2px"])),
            "crop_edge_intersection_4px": summarize_bucket(gt_rows, lambda row: bool_bucket(row["near_crop_edge_intersection_4px"])),
            "crop_edge_intersection_8px": summarize_bucket(gt_rows, lambda row: bool_bucket(row["near_crop_edge_intersection_8px"])),
            "degree": summarize_bucket(gt_rows, degree_bucket),
        },
        "pred_buckets": {
            "location": summarize_pred_bucket(pred_rows, lambda row: row["pred_location"]),
            "coverage_count": summarize_pred_bucket(pred_rows, coverage_bucket),
            "best_crop_margin": summarize_pred_bucket(pred_rows, best_margin_bucket),
            "crop_edge_intersection_4px": summarize_pred_bucket(pred_rows, lambda row: bool_bucket(row["near_crop_edge_intersection_4px"])),
        },
        "sample_summaries": sample_summaries,
    }
    summary["intersection_readout"] = intersection_readout(gt_rows)
    summary["prediction_intersection_readout"] = prediction_intersection_readout(pred_rows)
    return summary


def summarize_bucket(rows: list[dict[str, Any]], key_fn: Any) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(key_fn(row))].append(row)
    return [
        {
            "bucket": bucket,
            "gt_vertices": len(bucket_rows),
            "matched": sum(1 for row in bucket_rows if row["matched"]),
            "missed": sum(1 for row in bucket_rows if not row["matched"]),
            "recall": safe_div(sum(1 for row in bucket_rows if row["matched"]), len(bucket_rows)),
            "miss_rate": safe_div(sum(1 for row in bucket_rows if not row["matched"]), len(bucket_rows)),
        }
        for bucket, bucket_rows in sorted(groups.items(), key=lambda item: bucket_sort_key(item[0]))
    ]


def summarize_pred_bucket(rows: list[dict[str, Any]], key_fn: Any) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(key_fn(row))].append(row)
    return [
        {
            "bucket": bucket,
            "pred_vertices": len(bucket_rows),
            "matched": sum(1 for row in bucket_rows if row["matched"]),
            "unmatched": sum(1 for row in bucket_rows if not row["matched"]),
            "precision": safe_div(sum(1 for row in bucket_rows if row["matched"]), len(bucket_rows)),
            "false_positive_rate": safe_div(sum(1 for row in bucket_rows if not row["matched"]), len(bucket_rows)),
        }
        for bucket, bucket_rows in sorted(groups.items(), key=lambda item: bucket_sort_key(item[0]))
    ]


def intersection_readout(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    readout = []
    for threshold in [2, 4, 8]:
        key = f"near_crop_edge_intersection_{threshold}px"
        near = [row for row in rows if row[key]]
        far = [row for row in rows if not row[key]]
        near_miss = safe_div(sum(1 for row in near if not row["matched"]), len(near))
        far_miss = safe_div(sum(1 for row in far if not row["matched"]), len(far))
        readout.append({
            "threshold_px": threshold,
            "near_vertices": len(near),
            "near_miss_rate": near_miss,
            "far_vertices": len(far),
            "far_miss_rate": far_miss,
            "miss_rate_delta_near_minus_far": near_miss - far_miss,
        })
    return readout


def prediction_intersection_readout(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    readout = []
    for threshold in [2, 4, 8]:
        key = f"near_crop_edge_intersection_{threshold}px"
        near = [row for row in rows if row[key]]
        far = [row for row in rows if not row[key]]
        near_fp = safe_div(sum(1 for row in near if not row["matched"]), len(near))
        far_fp = safe_div(sum(1 for row in far if not row["matched"]), len(far))
        readout.append({
            "threshold_px": threshold,
            "near_predictions": len(near),
            "near_false_positive_rate": near_fp,
            "far_predictions": len(far),
            "far_false_positive_rate": far_fp,
            "false_positive_rate_delta_near_minus_far": near_fp - far_fp,
        })
    return readout


def coverage_bucket(row: dict[str, Any]) -> str:
    count = int(row["coverage_count"])
    if count <= 0:
        return "0"
    if count == 1:
        return "1"
    if count == 2:
        return "2"
    if count <= 4:
        return "3-4"
    if count <= 8:
        return "5-8"
    return "9+"


def best_margin_bucket(row: dict[str, Any]) -> str:
    margin = row["best_crop_edge_margin_px"]
    if margin is None:
        return "uncovered"
    if margin <= 2:
        return "00-02"
    if margin <= 4:
        return "02-04"
    if margin <= 8:
        return "04-08"
    if margin <= 16:
        return "08-16"
    if margin <= 24:
        return "16-24"
    return "24+"


def center_distance_bucket(row: dict[str, Any]) -> str:
    distance_px = row["best_crop_center_distance_px"]
    if distance_px is None:
        return "uncovered"
    if distance_px <= 16:
        return "00-16"
    if distance_px <= 32:
        return "16-32"
    if distance_px <= 48:
        return "32-48"
    if distance_px <= 68:
        return "48-68"
    return "68+"


def degree_bucket(row: dict[str, Any]) -> str:
    degree = int(row["degree"])
    if degree <= 1:
        return "0-1"
    if degree <= 4:
        return str(degree)
    return "5+"


def bool_bucket(value: bool) -> str:
    return "near" if value else "far"


def bucket_sort_key(bucket: str) -> tuple[int, str]:
    order = {
        "interior": 0,
        "boundary": 1,
        "0": 0,
        "1": 1,
        "2": 2,
        "3-4": 3,
        "5-8": 4,
        "9+": 5,
        "00-02": 0,
        "02-04": 1,
        "04-08": 2,
        "08-16": 3,
        "16-24": 4,
        "24+": 5,
        "00-16": 0,
        "16-32": 1,
        "32-48": 2,
        "48-68": 3,
        "68+": 4,
        "near": 0,
        "far": 1,
    }
    return (order.get(bucket, 99), bucket)


def draw_overlay(
    *,
    image_path: Path,
    out_path: Path,
    proposals: list[dict[str, Any]],
    crop_size: float,
    gt_rows: list[dict[str, Any]],
    pred_points: list[Point],
    pred_matches: dict[int, tuple[int, float]],
) -> None:
    image = Image.open(image_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    half = crop_size / 2.0
    for proposal in proposals:
        x = float(proposal["x"])
        y = float(proposal["y"])
        provenance = proposal.get("provenance", [])
        color = (245, 158, 11, 38) if any(str(item).startswith("boundary") or str(item) == "square_frame_corner" for item in provenance) else (37, 99, 235, 24)
        draw.rectangle((x - half, y - half, x + half, y + half), outline=color, width=1)
    image = Image.alpha_composite(image, overlay)
    draw = ImageDraw.Draw(image)
    for pred_id, pred in enumerate(pred_points):
        color = (14, 165, 233, 175) if pred_id not in pred_matches else (16, 185, 129, 120)
        draw.ellipse((pred.x - 2, pred.y - 2, pred.x + 2, pred.y + 2), outline=color, width=1)
    for row in gt_rows:
        x = float(row["x"])
        y = float(row["y"])
        if row["matched"]:
            draw.ellipse((x - 3, y - 3, x + 3, y + 3), outline=(22, 163, 74, 255), width=2)
        else:
            draw.line((x - 5, y - 5, x + 5, y + 5), fill=(220, 38, 38, 255), width=2)
            draw.line((x - 5, y + 5, x + 5, y - 5), fill=(220, 38, 38, 255), width=2)
    image.convert("RGB").save(out_path)


def write_contact_sheet(paths: list[Path], out_path: Path) -> None:
    if not paths:
        return
    thumbs = []
    font = ImageFont.load_default()
    thumb_size = 320
    label_height = 28
    for path in paths:
        image = Image.open(path).convert("RGB")
        image.thumbnail((thumb_size, thumb_size), Image.Resampling.LANCZOS)
        tile = Image.new("RGB", (thumb_size, thumb_size + label_height), "white")
        x = (thumb_size - image.width) // 2
        tile.paste(image, (x, label_height))
        draw = ImageDraw.Draw(tile)
        draw.text((6, 6), path.stem[:42], fill=(17, 24, 39), font=font)
        thumbs.append(tile)
    columns = min(3, len(thumbs))
    rows = math.ceil(len(thumbs) / columns)
    sheet = Image.new("RGB", (columns * thumb_size, rows * (thumb_size + label_height)), "white")
    for index, tile in enumerate(thumbs):
        sheet.paste(tile, ((index % columns) * thumb_size, (index // columns) * (thumb_size + label_height)))
    sheet.save(out_path)


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_summary_md(summary: dict[str, Any], path: Path) -> None:
    lines = [
        "# Vertex Refiner Crop Geometry Analysis",
        "",
        f"- Pack: `{summary['pack']}`",
        f"- Debug run: `{summary['debug_run']}`",
        f"- Match tolerance: `{summary['match_tolerance_px']}` px",
        "",
        "## Overall",
        "",
        markdown_table(
            ["gt", "pred", "matched_gt", "precision", "recall", "f1"],
            [[
                summary["overall"]["gt_vertices"],
                summary["overall"]["pred_vertices"],
                summary["overall"]["matched_gt_vertices"],
                fmt(summary["overall"]["precision"]),
                fmt(summary["overall"]["recall"]),
                fmt(summary["overall"]["f1"]),
            ]],
        ),
        "",
        "## Crop-Edge Intersections",
        "",
        "GT miss rates:",
        "",
        markdown_table(
            ["threshold", "near_n", "near_miss", "far_n", "far_miss", "delta"],
            [
                [
                    row["threshold_px"],
                    row["near_vertices"],
                    fmt(row["near_miss_rate"]),
                    row["far_vertices"],
                    fmt(row["far_miss_rate"]),
                    fmt(row["miss_rate_delta_near_minus_far"]),
                ]
                for row in summary["intersection_readout"]
            ],
        ),
        "",
        "Prediction false-positive rates:",
        "",
        markdown_table(
            ["threshold", "near_n", "near_fp", "far_n", "far_fp", "delta"],
            [
                [
                    row["threshold_px"],
                    row["near_predictions"],
                    fmt(row["near_false_positive_rate"]),
                    row["far_predictions"],
                    fmt(row["far_false_positive_rate"]),
                    fmt(row["false_positive_rate_delta_near_minus_far"]),
                ]
                for row in summary["prediction_intersection_readout"]
            ],
        ),
        "",
        "## Worst Samples By Recall",
        "",
        markdown_table(
            ["sample", "gt", "pred", "matched", "precision", "recall"],
            [
                [
                    row["sample_id"],
                    row["gt_vertices"],
                    row["pred_vertices"],
                    row["matched_vertices"],
                    fmt(row["precision"]),
                    fmt(row["recall"]),
                ]
                for row in sorted(summary["sample_summaries"], key=lambda item: item["recall"])[:8]
            ],
        ),
        "",
        "## GT Buckets",
        "",
    ]
    for name, rows in summary["gt_buckets"].items():
        lines.extend([
            f"### {name}",
            "",
            markdown_table(
                ["bucket", "gt", "matched", "missed", "recall", "miss_rate"],
                [
                    [
                        row["bucket"],
                        row["gt_vertices"],
                        row["matched"],
                        row["missed"],
                        fmt(row["recall"]),
                        fmt(row["miss_rate"]),
                    ]
                    for row in rows
                ],
            ),
            "",
        ])
    lines.extend([
        "## Prediction Buckets",
        "",
    ])
    for name, rows in summary["pred_buckets"].items():
        lines.extend([
            f"### {name}",
            "",
            markdown_table(
                ["bucket", "pred", "matched", "unmatched", "precision", "fp_rate"],
                [
                    [
                        row["bucket"],
                        row["pred_vertices"],
                        row["matched"],
                        row["unmatched"],
                        fmt(row["precision"]),
                        fmt(row["false_positive_rate"]),
                    ]
                    for row in rows
                ],
            ),
            "",
        ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def markdown_table(headers: list[str], rows: list[list[Any]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(value) for value in row) + " |")
    return "\n".join(lines)


def distance(a: Point, b: Point) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def safe_div(numerator: float, denominator: float) -> float:
    return float(numerator) / float(denominator) if denominator else 0.0


def f1(precision: float, recall: float) -> float:
    return 2.0 * precision * recall / (precision + recall) if precision + recall else 0.0


def fmt(value: float) -> str:
    return f"{float(value):.4f}"


if __name__ == "__main__":
    raise SystemExit(main())
