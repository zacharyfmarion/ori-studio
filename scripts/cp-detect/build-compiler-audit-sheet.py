#!/usr/bin/env python3
"""Build a visual audit sheet for constraint-compiler candidates.

The sheet is intentionally simple: input image, legacy browser output, raw
compiler candidate, and final emitted output. It is for human review before
promoting compiler repairs.
"""

from __future__ import annotations

import argparse
import json
import textwrap
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ASSIGNMENT_COLORS = {
    "M": (238, 78, 88),
    "V": (79, 127, 238),
    "B": (48, 48, 48),
    "F": (155, 155, 155),
    "U": (130, 138, 148),
}
RENDER_SCALE = 8
RENDER_PADDING = 8
ASSIGNMENT_WIDTHS = {
    "B": 1.15,
    "M": 0.7,
    "V": 0.7,
    "F": 0.65,
    "U": 0.65,
}
DIFF_COLORS = {
    "same": (188, 196, 208),
    "removed": (242, 133, 68),
    "added": (153, 81, 230),
    "changed": (226, 180, 35),
}
EDGE_MATCH_TOLERANCE = 0.03


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", required=True, type=Path)
    parser.add_argument("--legacy-run", required=True, type=Path)
    parser.add_argument("--candidate-run", required=True, type=Path)
    parser.add_argument("--final-run", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--cell", type=int, default=260)
    args = parser.parse_args()

    pack_path = args.pack.resolve()
    pack_root = pack_path.parent
    pack = load_json(pack_path)
    legacy_manifest = load_json(args.legacy_run)
    candidate_manifest = load_json(args.candidate_run)
    final_manifest = load_json(args.final_run)
    legacy_root = args.legacy_run.resolve().parent
    candidate_root = args.candidate_run.resolve().parent
    final_root = args.final_run.resolve().parent

    legacy_index = index_samples(legacy_manifest)
    candidate_index = index_samples(candidate_manifest)
    final_index = index_samples(final_manifest)
    samples = pack.get("samples", [])
    if args.limit is not None:
        samples = samples[: args.limit]

    rows = [
        build_row(
            sample=sample,
            pack_root=pack_root,
            legacy_root=legacy_root,
            candidate_root=candidate_root,
            final_root=final_root,
            legacy=legacy_index.get(sample["id"]),
            candidate=candidate_index.get(sample["id"]),
            final=final_index.get(sample["id"]),
        )
        for sample in samples
    ]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_sheet(rows=rows, out_path=args.out_dir / "compiler_audit_sheet.png", cell=args.cell)
    write_delta_sheet(rows=rows, out_path=args.out_dir / "compiler_delta_sheet.png", cell=args.cell)
    write_sheet(
        rows=rows,
        out_path=args.out_dir / "compiler_audit_sheet_thin.png",
        cell=args.cell,
    )
    write_delta_sheet(
        rows=rows,
        out_path=args.out_dir / "compiler_delta_sheet_thin.png",
        cell=args.cell,
    )
    write_fourup_sheet(
        rows=rows,
        out_path=args.out_dir / "compiler_fourup_sheet_thin.png",
        cell=args.cell,
    )
    write_json(args.out_dir / "compiler_audit.json", {"samples": rows})
    write_markdown(args.out_dir / "compiler_audit.md", rows)
    return 0


def build_row(
    *,
    sample: dict[str, Any],
    pack_root: Path,
    legacy_root: Path,
    candidate_root: Path,
    final_root: Path,
    legacy: dict[str, Any] | None,
    candidate: dict[str, Any] | None,
    final: dict[str, Any] | None,
) -> dict[str, Any]:
    sample_id = sample["id"]
    candidate_report = load_report(candidate_root, candidate)
    final_report = load_report(final_root, final)
    candidate_compiler = compiler_report(candidate_report)
    final_compiler = compiler_report(final_report)
    candidate_classes = candidate_compiler.get("candidate_verification", {}).get(
        "classifications"
    ) or candidate_compiler.get("final_verification", {}).get("classifications", [])
    final_output = final_compiler.get("output", {})
    return {
        "id": sample_id,
        "profile": sample.get("profile"),
        "family": sample.get("family"),
        "input_png": str(pack_root / sample["input_png"]),
        "gt_fold": str(pack_root / sample["gt_fold"]),
        "legacy_fold": run_path(legacy_root, legacy, "fold"),
        "candidate_fold": run_path(candidate_root, candidate, "fold"),
        "final_fold": run_path(final_root, final, "fold"),
        "legacy_status": legacy.get("status") if legacy else "missing",
        "candidate_status": candidate.get("status") if candidate else "missing",
        "final_status": final.get("status") if final else "missing",
        "candidate_classes": candidate_classes,
        "final_selected": final_output.get("selected", "unknown"),
        "topology_moves": len(final_compiler.get("topology", {}).get("accepted_moves", [])),
        "assignment_decisions": len(
            final_compiler.get("assignments", {}).get("decisions", [])
        ),
        "diff": fold_diff(run_path(legacy_root, legacy, "fold"), run_path(candidate_root, candidate, "fold")),
    }


def write_sheet(*, rows: list[dict[str, Any]], out_path: Path, cell: int) -> None:
    cols = 5
    header_h = 78
    row_h = header_h + cell + 18
    label_h = 34
    width = cols * cell
    height = label_h + max(1, len(rows)) * row_h
    sheet = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    bold = ImageFont.load_default()
    titles = [
        "Input image",
        "Ground truth",
        "Legacy emitted",
        "Compiler candidate",
        "Final emitted",
    ]
    for col, title in enumerate(titles):
        x = col * cell
        draw.rectangle((x, 0, x + cell, label_h), fill=(245, 247, 250))
        draw.text((x + 10, 11), title, fill=(20, 24, 32), font=bold)

    for row_index, row in enumerate(rows):
        y = label_h + row_index * row_h
        draw.rectangle((0, y, width, y + row_h), fill=(255, 255, 255))
        if row_index % 2:
            draw.rectangle((0, y, width, y + row_h), fill=(250, 251, 253))
        draw.text(
            (10, y + 8),
            f"{row['profile']} | {row['family']} | {short_id(row['id'])}",
            fill=(18, 24, 38),
            font=bold,
        )
        status = (
            f"legacy={row['legacy_status']}   candidate={row['candidate_status']}   "
            f"final={row['final_status']} / {row['final_selected']}"
        )
        draw.text((10, y + 25), status, fill=(55, 65, 81), font=font)
        classes = ", ".join(str(item) for item in row["candidate_classes"]) or "none"
        detail = (
            f"candidate verification: {classes}   "
            f"moves={row['topology_moves']} assignments={row['assignment_decisions']}"
        )
        draw.text((10, y + 42), detail[:150], fill=(90, 99, 112), font=font)
        if row["final_selected"] == "legacy_fallback":
            draw.text(
                (10, y + 59),
                "Final output intentionally preserves legacy geometry.",
                fill=(155, 92, 0),
                font=font,
            )

        panels = [
            row["input_png"],
            row["gt_fold"],
            row["legacy_fold"],
            row["candidate_fold"],
            row["final_fold"],
        ]
        for col, panel_path in enumerate(panels):
            x = col * cell
            image = load_panel_image(panel_path, cell - 20)
            px = x + (cell - image.width) // 2
            py = y + header_h + (cell - image.height) // 2
            sheet.paste(image, (px, py))
            draw.rectangle(
                (x + 8, y + header_h + 8, x + cell - 8, y + header_h + cell - 8),
                outline=(205, 212, 222),
                width=1,
            )
        draw.line((0, y + row_h - 1, width, y + row_h - 1), fill=(225, 229, 235))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)


def write_delta_sheet(*, rows: list[dict[str, Any]], out_path: Path, cell: int) -> None:
    cols = 3
    header_h = 88
    row_h = header_h + cell + 18
    label_h = 44
    width = cols * cell
    height = label_h + max(1, len(rows)) * row_h
    sheet = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    bold = ImageFont.load_default()
    titles = [
        "Input image",
        "Ground truth",
        "Legacy -> candidate diff",
    ]
    subtitles = [
        "",
        "",
        "gray=same  orange=removed  purple=added  yellow=M/V changed",
    ]
    for col, title in enumerate(titles):
        x = col * cell
        draw.rectangle((x, 0, x + cell, label_h), fill=(245, 247, 250))
        draw.text((x + 10, 8), title, fill=(20, 24, 32), font=bold)
        if subtitles[col]:
            draw.text((x + 10, 25), subtitles[col], fill=(90, 99, 112), font=font)

    for row_index, row in enumerate(rows):
        y = label_h + row_index * row_h
        if row_index % 2:
            draw.rectangle((0, y, width, y + row_h), fill=(250, 251, 253))
        diff = row["diff"]
        draw.text(
            (10, y + 8),
            f"{row['profile']} | {row['family']} | {short_id(row['id'])}",
            fill=(18, 24, 38),
            font=bold,
        )
        draw.text(
            (10, y + 25),
            f"removed={diff['removed']} added={diff['added']} assignment_changed={diff['assignment_changed']} final={row['final_selected']}",
            fill=(55, 65, 81),
            font=font,
        )
        classes = ", ".join(str(item) for item in row["candidate_classes"]) or "none"
        draw.text(
            (10, y + 42),
            f"candidate verification: {classes}"[:130],
            fill=(90, 99, 112),
            font=font,
        )
        if diff["removed"] == 0 and diff["added"] == 0 and diff["assignment_changed"] == 0:
            draw.text(
                (10, y + 59),
                "No visible graph delta; candidate differs only in metadata or tiny numeric values.",
                fill=(95, 105, 120),
                font=font,
            )

        panels = [
            load_panel_image(row["input_png"], cell - 20),
            load_panel_image(row["gt_fold"], cell - 20),
            render_diff_panel(row["legacy_fold"], row["candidate_fold"], cell - 20),
        ]
        for col, image in enumerate(panels):
            x = col * cell
            px = x + (cell - image.width) // 2
            py = y + header_h + (cell - image.height) // 2
            sheet.paste(image, (px, py))
            draw.rectangle(
                (x + 8, y + header_h + 8, x + cell - 8, y + header_h + cell - 8),
                outline=(205, 212, 222),
                width=1,
            )
        draw.line((0, y + row_h - 1, width, y + row_h - 1), fill=(225, 229, 235))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)


def write_fourup_sheet(*, rows: list[dict[str, Any]], out_path: Path, cell: int) -> None:
    cols = 4
    header_h = 72
    row_h = header_h + cell + 18
    label_h = 40
    width = cols * cell
    height = label_h + max(1, len(rows)) * row_h
    sheet = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    bold = ImageFont.load_default()
    titles = [
        "Ground truth",
        "Legacy prediction",
        "Compiler candidate",
        "Legacy -> compiler diff",
    ]
    subtitles = [
        "",
        "",
        "",
        "gray=same  orange=removed  purple=added  yellow=M/V changed",
    ]
    for col, title in enumerate(titles):
        x = col * cell
        draw.rectangle((x, 0, x + cell, label_h), fill=(245, 247, 250))
        draw.text((x + 10, 7), title, fill=(20, 24, 32), font=bold)
        if subtitles[col]:
            draw.text((x + 10, 24), subtitles[col], fill=(90, 99, 112), font=font)

    for row_index, row in enumerate(rows):
        y = label_h + row_index * row_h
        if row_index % 2:
            draw.rectangle((0, y, width, y + row_h), fill=(250, 251, 253))
        diff = row["diff"]
        draw.text(
            (10, y + 8),
            f"{row['profile']} | {row['family']} | {short_id(row['id'])}",
            fill=(18, 24, 38),
            font=bold,
        )
        draw.text(
            (10, y + 25),
            f"legacy={row['legacy_status']}  compiler={row['candidate_status']}  removed={diff['removed']} added={diff['added']} assignment_changed={diff['assignment_changed']}",
            fill=(55, 65, 81),
            font=font,
        )
        classes = ", ".join(str(item) for item in row["candidate_classes"]) or "none"
        draw.text(
            (10, y + 42),
            f"compiler verification: {classes}"[:160],
            fill=(90, 99, 112),
            font=font,
        )

        panels = [
            load_panel_image(row["gt_fold"], cell - 20),
            load_panel_image(row["legacy_fold"], cell - 20),
            load_panel_image(row["candidate_fold"], cell - 20),
            render_diff_panel(row["legacy_fold"], row["candidate_fold"], cell - 20),
        ]
        for col, image in enumerate(panels):
            x = col * cell
            px = x + (cell - image.width) // 2
            py = y + header_h + (cell - image.height) // 2
            sheet.paste(image, (px, py))
            draw.rectangle(
                (x + 8, y + header_h + 8, x + cell - 8, y + header_h + cell - 8),
                outline=(205, 212, 222),
                width=1,
            )
        draw.line((0, y + row_h - 1, width, y + row_h - 1), fill=(225, 229, 235))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)


def load_panel_image(path: str | None, size: int) -> Image.Image:
    if path is None:
        return missing_panel(size)
    panel_path = Path(path)
    if not panel_path.exists():
        return missing_panel(size)
    if panel_path.suffix.lower() == ".png":
        image = Image.open(panel_path).convert("RGB")
    else:
        image = render_fold(load_json(panel_path), size)
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), (255, 255, 255))
    canvas.paste(image, ((size - image.width) // 2, (size - image.height) // 2))
    return canvas


def render_fold(fold: dict[str, Any], size: int) -> Image.Image:
    hi_size = size * RENDER_SCALE
    image = Image.new("RGB", (hi_size, hi_size), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    vertices = fold.get("vertices_coords", [])
    edges = fold.get("edges_vertices", [])
    assignments = fold.get("edges_assignment", [])
    for index, edge in enumerate(edges):
        try:
            a = vertices[int(edge[0])]
            b = vertices[int(edge[1])]
            ax = float(a[0])
            ay = float(a[1])
            bx = float(b[0])
            by = float(b[1])
        except (IndexError, TypeError, ValueError):
            continue
        if not all(-0.2 <= value <= 1.2 for value in (ax, ay, bx, by)):
            continue
        label = str(assignments[index]) if index < len(assignments) else "U"
        color = ASSIGNMENT_COLORS.get(label, ASSIGNMENT_COLORS["U"])
        width = stroke_width(ASSIGNMENT_WIDTHS.get(label, ASSIGNMENT_WIDTHS["U"]))
        draw.line(
            (
                coord_to_pixel(ax, hi_size),
                coord_to_pixel(ay, hi_size),
                coord_to_pixel(bx, hi_size),
                coord_to_pixel(by, hi_size),
            ),
            fill=color,
            width=width,
        )
    return downsample(image, size)


def render_diff_panel(legacy_path: str | None, candidate_path: str | None, size: int) -> Image.Image:
    if legacy_path is None or candidate_path is None:
        return missing_panel(size)
    legacy_file = Path(legacy_path)
    candidate_file = Path(candidate_path)
    if not legacy_file.exists() or not candidate_file.exists():
        return missing_panel(size)
    legacy = load_json(legacy_file)
    candidate = load_json(candidate_file)
    diff = diff_edges(legacy, candidate)
    hi_size = size * RENDER_SCALE
    image = Image.new("RGB", (hi_size, hi_size), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    for legacy_edge, _candidate_edge in diff["same"]:
        draw_segment(
            draw,
            legacy_edge["segment"],
            hi_size,
            DIFF_COLORS["same"],
            stroke_width(0.9),
        )
    for _legacy_edge, candidate_edge in diff["changed"]:
        draw_segment(
            draw,
            candidate_edge["segment"],
            hi_size,
            DIFF_COLORS["changed"],
            stroke_width(2.0),
        )
    for legacy_edge in diff["removed"]:
        draw_segment(
            draw,
            legacy_edge["segment"],
            hi_size,
            DIFF_COLORS["removed"],
            stroke_width(2.0),
        )
    for candidate_edge in diff["added"]:
        draw_segment(
            draw,
            candidate_edge["segment"],
            hi_size,
            DIFF_COLORS["added"],
            stroke_width(2.0),
        )
    return downsample(image, size)


def diff_edges(legacy: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    legacy_edges = edge_records(legacy)
    candidate_edges = edge_records(candidate)
    candidate_by_index = {edge["index"]: edge for edge in candidate_edges}
    unmatched_legacy = {edge["index"]: edge for edge in legacy_edges}
    unmatched_candidate = {edge["index"]: edge for edge in candidate_edges}
    possible_matches = []
    for legacy_edge in legacy_edges:
        for candidate_edge in candidate_edges:
            distance = segment_endpoint_distance(legacy_edge["segment"], candidate_edge["segment"])
            if distance <= EDGE_MATCH_TOLERANCE:
                possible_matches.append((distance, legacy_edge["index"], candidate_edge["index"]))
    possible_matches.sort()

    same = []
    changed = []
    for _distance, legacy_index, candidate_index in possible_matches:
        legacy_edge = unmatched_legacy.get(legacy_index)
        candidate_edge = unmatched_candidate.get(candidate_index)
        if legacy_edge is None or candidate_edge is None:
            continue
        del unmatched_legacy[legacy_index]
        del unmatched_candidate[candidate_index]
        if legacy_edge["assignment"] == candidate_edge["assignment"]:
            same.append((legacy_edge, candidate_edge))
        else:
            changed.append((legacy_edge, candidate_edge))

    return {
        "same": same,
        "changed": changed,
        "removed": list(unmatched_legacy.values()),
        "added": list(unmatched_candidate.values()),
        "candidate_by_index": candidate_by_index,
    }


def segment_endpoint_distance(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> float:
    ax, ay, bx, by = left
    cx, cy, dx, dy = right
    forward = ((ax - cx) ** 2 + (ay - cy) ** 2) ** 0.5 + (
        (bx - dx) ** 2 + (by - dy) ** 2
    ) ** 0.5
    reversed_distance = ((ax - dx) ** 2 + (ay - dy) ** 2) ** 0.5 + (
        (bx - cx) ** 2 + (by - cy) ** 2
    ) ** 0.5
    return min(forward, reversed_distance)


def edge_records(fold: dict[str, Any]) -> list[dict[str, Any]]:
    vertices = fold.get("vertices_coords", [])
    edges = fold.get("edges_vertices", [])
    assignments = fold.get("edges_assignment", [])
    result = []
    for index, edge in enumerate(edges):
        try:
            a = vertices[int(edge[0])]
            b = vertices[int(edge[1])]
            ax = float(a[0])
            ay = float(a[1])
            bx = float(b[0])
            by = float(b[1])
        except (IndexError, TypeError, ValueError):
            continue
        if not all(-0.2 <= value <= 1.2 for value in (ax, ay, bx, by)):
            continue
        result.append(
            {
                "index": index,
                "assignment": str(assignments[index]) if index < len(assignments) else "U",
                "segment": (ax, ay, bx, by),
            }
        )
    return result


def draw_segment(
    draw: ImageDraw.ImageDraw,
    segment: tuple[float, float, float, float],
    size: int,
    color: tuple[int, int, int],
    width: int,
) -> None:
    ax, ay, bx, by = segment
    draw.line(
        (
            coord_to_pixel(ax, size),
            coord_to_pixel(ay, size),
            coord_to_pixel(bx, size),
            coord_to_pixel(by, size),
        ),
        fill=color,
        width=width,
    )


def coord_to_pixel(value: float, size: int) -> int:
    padding = RENDER_PADDING * RENDER_SCALE
    span = size - 1 - 2 * padding
    return int(round(padding + value * span))


def stroke_width(width_px: float) -> int:
    return max(1, int(round(width_px * RENDER_SCALE)))


def downsample(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def fold_diff(legacy_path: str | None, candidate_path: str | None) -> dict[str, int]:
    if legacy_path is None or candidate_path is None:
        return {"removed": 0, "added": 0, "assignment_changed": 0}
    legacy_file = Path(legacy_path)
    candidate_file = Path(candidate_path)
    if not legacy_file.exists() or not candidate_file.exists():
        return {"removed": 0, "added": 0, "assignment_changed": 0}
    diff = diff_edges(load_json(legacy_file), load_json(candidate_file))
    return {
        "removed": len(diff["removed"]),
        "added": len(diff["added"]),
        "assignment_changed": len(diff["changed"]),
    }


def missing_panel(size: int) -> Image.Image:
    image = Image.new("RGB", (size, size), (248, 250, 252))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, size - 1, size - 1), outline=(205, 212, 222))
    draw.text((size // 2 - 25, size // 2 - 5), "missing", fill=(120, 128, 140))
    return image


def write_markdown(path: Path, rows: list[dict[str, Any]]) -> None:
    lines = [
        "# Constraint Compiler Visual Audit",
        "",
        "Columns: input image, ground truth, legacy browser output, raw compiler candidate, final emitted output.",
        "",
        "`compiler_delta_sheet.png` highlights tolerance-matched legacy-vs-candidate graph deltas: gray unchanged, orange removed, purple added, yellow assignment changed.",
        "",
        "| sample | statuses | candidate verification | final |",
        "| --- | --- | --- | --- |",
    ]
    for row in rows:
        classes = ", ".join(str(item) for item in row["candidate_classes"]) or "none"
        lines.append(
            "| {sample} | legacy `{legacy}`, candidate `{candidate}`, final `{final}` | {classes} | `{selected}` |".format(
                sample=row["id"],
                legacy=row["legacy_status"],
                candidate=row["candidate_status"],
                final=row["final_status"],
                classes=classes,
                selected=row["final_selected"],
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def load_report(root: Path, sample: dict[str, Any] | None) -> dict[str, Any]:
    report_path = run_path(root, sample, "report")
    if report_path is None:
        return {}
    path = Path(report_path)
    if not path.exists():
        return {}
    return load_json(path)


def compiler_report(report: dict[str, Any]) -> dict[str, Any]:
    value = report.get("quality_report", {}).get("compiler_report")
    return value if isinstance(value, dict) else {}


def run_path(root: Path, sample: dict[str, Any] | None, key: str) -> str | None:
    if not sample or not sample.get(key):
        return None
    return str(root / sample[key])


def index_samples(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {sample["id"]: sample for sample in manifest.get("samples", [])}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def short_id(sample_id: str) -> str:
    wrapped = textwrap.shorten(sample_id, width=54, placeholder="...")
    return wrapped


if __name__ == "__main__":
    raise SystemExit(main())
