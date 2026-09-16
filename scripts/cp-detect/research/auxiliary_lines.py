#!/usr/bin/env python3
"""E008 research vectorization of the separate AUX probability plane.

Uses straight-line extraction and support fits, not foldability constraints.
Returns F assignments, Oriedita's FOLD spelling for auxiliary lines. No real
pattern or truth is used. Browser implementation would use the existing Rust
Hough/thinning primitives after this prototype has quantitative coverage.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from skimage.morphology import skeletonize


def segment_fit(points, weights):
    center = np.average(points, axis=0, weights=weights)
    covariance = ((points - center) * weights[:, None]).T @ (points - center)
    _, axes = np.linalg.eigh(covariance)
    direction = axes[:, -1]
    projection = (points - center) @ direction
    return np.stack([center + direction * projection.min(), center + direction * projection.max()])


def mergeable(a, b):
    direction = a[1] - a[0]
    length = np.linalg.norm(direction)
    direction /= max(length, 1e-8)
    other = b[1] - b[0]
    other /= max(np.linalg.norm(other), 1e-8)
    if abs(direction @ other) < np.cos(np.deg2rad(2.0)):
        return False
    normal = np.array([-direction[1], direction[0]])
    if max(abs((b - a[0]) @ normal)) > 1.5:
        return False
    projection = (b - a[0]) @ direction
    return projection.min() <= length + 6 and projection.max() >= -6


def extract_segments(probability, inset=32, rgb=None):
    p = np.asarray(probability, np.float32).copy()
    h, w = p.shape
    if rgb is not None:
        # The requested AUX convention is Oriedita cyan. Preserve a neutral
        # gray crease or editor grid as such even if the learned AUX head is
        # uncertain. A one-pixel neighborhood tolerates raster center phase.
        color = np.asarray(rgb, np.float32)
        cyan_chroma = np.minimum(color[..., 1] - color[..., 0], color[..., 2] - color[..., 0])
        cyan = (cyan_chroma > 12) & (abs(color[..., 1] - color[..., 2]) <= 12 + 0.25 * cyan_chroma)
        p *= cv2.dilate(cyan.astype(np.float32), np.ones((3, 3), np.uint8))
    if inset:
        p[:inset] = p[h-inset+1:] = 0
        p[:, :inset] = p[:, w-inset+1:] = 0
    skeleton = skeletonize(p >= 0.45)
    proposals = cv2.HoughLinesP(skeleton.astype(np.uint8) * 255, 1, np.pi / 720,
                                10, minLineLength=8, maxLineGap=4)
    if proposals is None:
        return []
    proposals = proposals[:, 0].reshape(-1, 2, 2).astype(float)
    order = sorted(range(len(proposals)), key=lambda i: -np.linalg.norm(proposals[i, 1] - proposals[i, 0]))
    groups = []
    for i in order:
        segment = proposals[i]
        for group in groups:
            fitted = segment_fit(np.concatenate(group), np.ones(2 * len(group)))
            if mergeable(fitted, segment):
                group.append(segment)
                break
        else:
            groups.append([segment])
    yy, xx = np.nonzero(p >= 0.30)
    points = np.column_stack([xx, yy]).astype(float)
    weights = p[yy, xx]
    result = []
    for group in groups:
        segment = segment_fit(np.concatenate(group), np.ones(2 * len(group)))
        direction = segment[1] - segment[0]
        length = np.linalg.norm(direction)
        direction /= max(length, 1e-8)
        normal = np.array([-direction[1], direction[0]])
        relative = points - segment[0]
        projected = relative @ direction
        near = (abs(relative @ normal) <= 1.5) & (projected >= -3) & (projected <= length + 3)
        if near.sum() >= 6:
            segment = segment_fit(points[near], weights[near])
        if np.linalg.norm(segment[1] - segment[0]) >= 8:
            result.append(segment.tolist())
    return result


def append_aux(fold, segments, size, inset=32):
    # Physical graph connectivity is intentionally untouched. An AUX crossing
    # is not a fold junction and must never enter M/V theorem completion.
    result = dict(fold)
    result["vertices_coords"] = list(fold["vertices_coords"])
    result["edges_vertices"] = list(fold["edges_vertices"])
    result["edges_assignment"] = list(fold["edges_assignment"])
    # This research helper accepts only the unit-paper graph from our probe.
    for a, b in segments:
        u = len(result["vertices_coords"])
        result["vertices_coords"].extend([[(v - inset) / (size - 2 * inset) for v in point] for point in (a, b)])
        result["edges_vertices"].append([u, u + 1])
        result["edges_assignment"].append("F")
    # Other per-edge arrays would now describe the original graph only. Keep
    # the essential FOLD arrays; product integration must extend all metadata.
    return {k: result[k] for k in ("vertices_coords", "edges_vertices", "edges_assignment")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probability", type=Path, required=True)
    parser.add_argument("--size", type=int, required=True)
    parser.add_argument("--physical-fold", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image", type=Path)
    args = parser.parse_args()
    p = np.fromfile(args.probability, dtype="<f4").reshape(args.size, args.size)
    rgb = cv2.cvtColor(cv2.imread(str(args.image)), cv2.COLOR_BGR2RGB) if args.image else None
    segments = extract_segments(p, rgb=rgb)
    fold = append_aux(json.loads(args.physical_fold.read_text()), segments, args.size)
    args.out.write_text(json.dumps(fold))
    print(json.dumps({"aux_segments": len(segments)}))


if __name__ == "__main__":
    main()
