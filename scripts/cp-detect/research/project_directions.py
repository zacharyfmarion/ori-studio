#!/usr/bin/env python3
"""E019: linear projection onto a source-observed angle family, no truth input.

Research only. The product's exact solver still judges foldability afterwards.
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsmr


def project(value, requested_degrees=None, max_angle_error_degrees=None):
    start = time.perf_counter()
    points = np.array([[v['point']['x'], v['point']['y']] for v in value['vertices']])
    edges = np.array([s['vertices'] for s in value['selected_spans']])
    delta = points[edges[:, 1]] - points[edges[:, 0]]
    lengths = np.linalg.norm(delta, axis=1)
    angles = np.arctan2(delta[:, 1], delta[:, 0])
    long = lengths > 20 / 1024
    families = []
    for degrees in [45, 22.5, 11.25]:
        step = np.deg2rad(degrees)
        distance = abs((angles + step / 2) % step - step / 2)
        fraction = np.mean(distance[long] < np.deg2rad(2)) if long.any() else 0
        families.append((fraction, degrees))
    fraction, degrees = max(families)
    if requested_degrees is not None:
        fraction, degrees = next(v for v in families if v[1] == requested_degrees)
    if fraction < 0.9:
        return value, {'accepted_family': False, 'families': families}
    step = np.deg2rad(degrees)
    target = np.rint(angles / step) * step
    normals = np.column_stack([-np.sin(target), np.cos(target)])
    distance = abs((angles - target + np.pi) % (2*np.pi) - np.pi)
    eligible = distance <= np.minimum(step * 0.35, np.arctan2(2 / 1024, lengths) + np.deg2rad(2))
    if max_angle_error_degrees is not None:
        eligible &= distance <= np.deg2rad(max_angle_error_degrees)
    row, col, data, rhs = [], [], [], []

    def constraint(entries, target):
        for c, v in entries:
            row.append(len(rhs)); col.append(c); data.append(v)
        rhs.append(target)

    for (a, b), normal in zip(edges[eligible], normals[eligible]):
        constraint([(2*a, normal[0]), (2*a+1, normal[1]),
                    (2*b, -normal[0]), (2*b+1, -normal[1])], 0)
    for i, v in enumerate(value['vertices']):
        if v['kind'] == 'corner':
            constraint([(2*i, 1)], points[i, 0]); constraint([(2*i+1, 1)], points[i, 1])
        elif v.get('boundary_side') in ['top', 'bottom']:
            constraint([(2*i+1, 1)], points[i, 1])
        elif v.get('boundary_side') in ['left', 'right']:
            constraint([(2*i, 1)], points[i, 0])
    matrix = coo_matrix((data, (row, col)), shape=(len(rhs), points.size)).tocsr()
    correction = lsmr(matrix, np.array(rhs) - matrix @ points.ravel(), atol=1e-13, btol=1e-13, maxiter=20000)
    projected = points + correction[0].reshape(-1, 2)
    movement = np.linalg.norm(projected - points, axis=1) * 1024
    for vertex, point in zip(value['vertices'], projected):
        vertex['point'] = dict(zip(['x', 'y'], point))
    for span, (a, b) in zip(value['selected_spans'], edges):
        d = projected[b] - projected[a]
        d /= max(np.linalg.norm(d), 1e-15)
        n = np.array([-d[1], d[0]])
        span['carrier'] = {'direction': dict(zip(['x', 'y'], d)), 'normal': dict(zip(['x', 'y'], n)), 'rho': float(n @ projected[a])}
    return value, {'accepted_family': True, 'degrees': degrees, 'max_angle_error_degrees': max_angle_error_degrees,
                   'fraction': float(fraction), 'constrained_edges': int(eligible.sum()),
                   'max_movement_px': float(movement.max()), 'mean_movement_px': float(movement.mean()),
                   'max_constraint_error': float(abs(matrix @ projected.ravel() - rhs).max()),
                   'iterations': correction[2], 'seconds': time.perf_counter() - start}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--degrees', type=float, choices=[45, 22.5, 11.25])
    p.add_argument('--max-angle-error-degrees', type=float)
    args = p.parse_args()
    value, report = project(json.loads(args.input.read_text()), args.degrees, args.max_angle_error_degrees)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value))
    args.output.with_suffix('.projection.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    main()
