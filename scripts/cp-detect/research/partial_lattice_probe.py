#!/usr/bin/env python3
"""E026: propose a well-supported partial lattice, then let exact solving judge.

Research only. Unlike forcing every point onto a finer grid, vertices off the
dominant lattice remain free. Reads recognition input only, never truth. The
downstream solver must accept the complete pattern before this is useful.
"""
import argparse
import copy
import json
from pathlib import Path

import numpy as np

from project_directions import project


def propose(value, noise_px=1.5, fraction=.95, projection_degrees=None):
    value = copy.deepcopy(value)
    original = np.array([[v['point']['x'], v['point']['y']] for v in value['vertices']])
    projection = None
    if projection_degrees is not None:
        value, projection = project(value, 45, projection_degrees)
    points = np.array([[v['point']['x'], v['point']['y']] for v in value['vertices']])
    pixels = value.get('image_size', 1024) - 64
    tolerance = noise_px / pixels
    chosen = None
    for cells in range(4, 513):
        band = 2 * tolerance * cells
        if band >= .5:
            break
        snap = np.rint(points * cells) / cells
        residual = abs(points - snap)
        on_grid = residual <= tolerance
        distinct = len(np.unique(np.round(points[on_grid], 6)))
        if float(on_grid.mean()) < fraction or distinct < 8 or band ** distinct > 1e-6:
            continue
        chosen = (cells, snap, np.all(on_grid, axis=1), float(on_grid.mean()))
        break
    if chosen is None:
        return value, {'proposed': False, 'projection': projection}
    cells, snap, lock, support = chosen
    # The projection is only a proposal; bound total movement from recognition,
    # including both projection and snapping, before trusting a fixed point.
    lock &= np.linalg.norm(snap - original, axis=1) * pixels <= noise_px * 2
    moved = points.copy(); moved[lock] = snap[lock]
    for i, vertex in enumerate(value['vertices']):
        vertex['point'] = dict(zip(['x', 'y'], moved[i]))
        if lock[i]:
            vertex['movement_policy'] = 'locked'
    for span in value['selected_spans']:
        a, b = span['vertices']; delta = moved[b] - moved[a]
        delta /= max(float(np.linalg.norm(delta)), 1e-15)
        normal = np.array([-delta[1], delta[0]])
        span['carrier'] = {'direction': dict(zip(['x', 'y'], delta)),
                           'normal': dict(zip(['x', 'y'], normal)),
                           'rho': float(normal @ moved[a])}
    return value, {'proposed': True, 'cells': cells, 'coordinate_support': support,
                   'locked_vertices': int(lock.sum()), 'vertices': len(points),
                   'max_proposal_movement_px': float(np.linalg.norm(moved-original, axis=1).max() * pixels),
                   'projection': projection}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--noise-px', type=float, default=1.5)
    p.add_argument('--fraction', type=float, default=.95)
    p.add_argument('--projection-degrees', type=float)
    args = p.parse_args()
    value, report = propose(json.loads(args.input.read_text()), args.noise_px,
                            args.fraction, args.projection_degrees)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value))
    args.output.with_suffix('.proposal.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    main()
