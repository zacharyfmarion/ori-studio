#!/usr/bin/env python3
"""E002: model-free skeleton graph, with line-intersection junction placement.

Prototype, not a production decoder. Takes a rectified image only. Does not read
FOLD truth, model predictions, or benchmark identities. Emits the unit-square
FOLD frame used by the product. Failures are part of the experiment.
"""
import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize


def trace_graph(rgb, threshold=0.32, junction_radius=0):
    size = rgb.shape[0]
    background = np.median(rgb.reshape(-1, 3), axis=0)
    contrast = np.sqrt(np.mean((rgb.astype(float) - background) ** 2, axis=2))
    scale = max(float(np.quantile(contrast, 0.99)), 0.18 * 255)
    mask = contrast > threshold * scale
    mask[:31] = mask[-31:] = False
    mask[:, :31] = mask[:, -31:] = False
    skeleton = skeletonize(mask)
    ys, xs = np.nonzero(skeleton)
    pixels = np.column_stack([xs, ys])
    index = np.full(skeleton.shape, -1, np.int32)
    index[ys, xs] = np.arange(len(xs))
    neighbors = []
    for x, y in pixels:
        adjacent = []
        for dx, dy in [(0, -1), (1, 0), (0, 1), (-1, 0), (-1, -1), (1, -1), (1, 1), (-1, 1)]:
            nx, ny = x + dx, y + dy
            if not (0 <= nx < size and 0 <= ny < size) or index[ny, nx] < 0:
                continue
            # Diagonal edges only when no orthogonal pixel bridges them.
            if dx and dy and (index[y, nx] >= 0 or index[ny, x] >= 0):
                continue
            adjacent.append(int(index[ny, nx]))
        neighbors.append(adjacent)
    critical = np.zeros_like(mask)
    degree = np.array([len(ns) for ns in neighbors])
    critical[ys[degree != 2], xs[degree != 2]] = True
    if junction_radius:
        yy, xx = np.mgrid[-junction_radius:junction_radius+1, -junction_radius:junction_radius+1]
        critical = ndimage.binary_dilation(critical, structure=xx * xx + yy * yy <= junction_radius ** 2)
    labels, count = ndimage.label(critical, structure=np.ones((3, 3)))
    node_of = labels[ys, xs] - 1
    points = [pixels[node_of == i].mean(axis=0) for i in range(count)]
    visited = set()
    paths = []
    for start in np.flatnonzero(node_of >= 0):
        for neighbor in neighbors[start]:
            if node_of[neighbor] == node_of[start]:
                continue
            link = tuple(sorted((int(start), neighbor)))
            if link in visited:
                continue
            chain = [int(start), neighbor]
            visited.add(link)
            while node_of[chain[-1]] < 0:
                prev, cur = chain[-2:]
                nxt = [v for v in neighbors[cur] if v != prev]
                if len(nxt) != 1:
                    break
                link = tuple(sorted((cur, nxt[0])))
                if link in visited:
                    break
                visited.add(link)
                chain.append(nxt[0])
            end = int(node_of[chain[-1]])
            begin = int(node_of[start])
            if end >= 0 and begin != end:
                paths.append((begin, end, pixels[chain].astype(float)))

    # Estimate each intersection from the straight portions of its arms.
    arms = [[] for _ in points]
    for a, b, path in paths:
        arms[a].append(path)
        arms[b].append(path[::-1])
    for i, incident in enumerate(arms):
        normals, offsets = [], []
        center = points[i]
        for arm in incident:
            distances = np.linalg.norm(arm - center, axis=1)
            q = arm[(distances >= 3) & (distances <= 16)]
            if len(q) < 4:
                continue
            mean = q.mean(axis=0)
            _, _, vt = np.linalg.svd(q - mean, full_matrices=False)
            normal = vt[1]
            if np.sqrt(np.mean(((q - mean) @ normal) ** 2)) > 0.8:
                continue
            normals.append(normal)
            offsets.append(mean @ normal)
        if len(normals) >= 2:
            fit, _, rank, _ = np.linalg.lstsq(normals, offsets, rcond=0.1)
            if rank == 2 and np.linalg.norm(fit - center) <= 5:
                points[i] = fit

    # Preserve corners in degree-two chains, rather than replacing a bent
    # chain with its chord. Border coordinates come from rectification alone.
    edges, assignments = [], []
    for a, b, path in paths:
        path = path.copy()
        path[0], path[-1] = points[a], points[b]
        simple = cv2.approxPolyDP(path.astype(np.float32), 1.5, False).reshape(-1, 2)
        ids = [a]
        for p in simple[1:-1]:
            ids.append(len(points))
            points.append(p.astype(float))
        ids.append(b)
        colors = rgb[path[:, 1].round().astype(int).clip(0, size - 1),
                     path[:, 0].round().astype(int).clip(0, size - 1)].astype(float)
        red_blue = np.median(colors[:, 0] - colors[:, 2])
        assignment = "M" if red_blue > 25 else "V" if red_blue < -25 else "U"
        for u, v in zip(ids, ids[1:]):
            if u != v:
                edges.append([u, v])
                assignments.append(assignment)
    points = np.array(points)
    for p in points:
        for d in range(2):
            if abs(p[d] - 32) <= 3:
                p[d] = 32
            elif abs(p[d] - (size - 32)) <= 3:
                p[d] = size - 32
    for i, (a, b) in enumerate(edges):
        if any(points[a, d] == points[b, d] and points[a, d] in (32, size - 32) for d in range(2)):
            assignments[i] = "B"
    points = ((points - 32) / (size - 64)).clip(0, 1)
    return {"file_spec": 1.2, "file_creator": "Ori Studio E002 raster prototype",
            "vertices_coords": points.tolist(), "edges_vertices": edges,
            "edges_assignment": assignments}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--threshold", type=float, default=0.32)
    parser.add_argument("--junction-radius", type=int, default=0)
    args = parser.parse_args()
    started = time.perf_counter()
    im = cv2.imread(str(args.image))
    if im is None or im.shape[0] != im.shape[1]:
        raise SystemExit("Expected a readable square rectified image")
    fold = trace_graph(cv2.cvtColor(im, cv2.COLOR_BGR2RGB), args.threshold, args.junction_radius)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(fold))
    print(json.dumps({"seconds": time.perf_counter() - started,
                      "vertices": len(fold["vertices_coords"]), "edges": len(fold["edges_vertices"])}))


if __name__ == "__main__":
    main()
