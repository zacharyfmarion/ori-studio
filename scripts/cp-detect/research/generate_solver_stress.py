#!/usr/bin/env python3
"""Independent procedural solver stress cases. No real patterns are read.

Nonuniform orthogonal grids have four equal sectors and 3M/1V at each
interior vertex. Perturb only free coordinates; retain the exact paper edge.
The known solution is for evaluation only and never supplied to the solver.
"""
import argparse
import hashlib
import json
import math
import random
from pathlib import Path


def grid(cells, seed, noise):
    rng = random.Random(seed)
    def axis():
        weights = [rng.uniform(.7, 1.3) for _ in range(cells)]
        total = sum(weights)
        result = [0.]
        for w in weights:
            result.append(result[-1] + w / total)
        result[-1] = 1.
        return result
    xs, ys = axis(), axis()
    points = [[x, y] for y in ys for x in xs]
    noisy = [[x + (rng.uniform(-noise, noise) if i % (cells+1) not in (0, cells) else 0),
              y + (rng.uniform(-noise, noise) if i // (cells+1) not in (0, cells) else 0)]
             for i, (x, y) in enumerate(points)]
    edges, assignments = [], []
    for j in range(cells+1):
        for i in range(cells):
            a = j*(cells+1)+i
            edges.append([a, a+1])
            assignments.append('B' if j in (0, cells) else 'M')
    for j in range(cells):
        for i in range(cells+1):
            a = j*(cells+1)+i
            edges.append([a, a+cells+1])
            assignments.append('B' if i in (0, cells) else ('M' if j % 2 else 'V'))
    fold = dict(file_spec=1.2, vertices_coords=points, edges_vertices=edges,
                edges_assignment=assignments)
    return {**fold, 'vertices_coords': noisy}, fold


def fan(seed, noise):
    rng = random.Random(seed)
    alpha, beta = math.radians(rng.uniform(20, 40)), math.radians(rng.uniform(60, 100))
    offset = rng.uniform(0, 2*math.pi)
    bearings = [offset, offset+alpha, offset+alpha+beta, offset+math.pi+beta]
    center = [rng.uniform(.35, .65), rng.uniform(.35, .65)]
    points = [[0., 0.], [1., 0.], [1., 1.], [0., 1.], center]
    for angle in bearings:
        direction = [math.cos(angle), math.sin(angle)]
        limits = [((1 if d > 0 else 0)-v)/d for v, d in zip(center, direction)]
        side = min(range(2), key=lambda d: limits[d])
        endpoint = [v + limits[side]*d for v, d in zip(center, direction)]
        endpoint[side] = float(direction[side] > 0)
        points.append(endpoint)
    def perimeter(v):
        x, y = points[v]
        if y == 0: return x
        if x == 1: return 1+y
        if y == 1: return 3-x
        return 4-y
    boundary = sorted([0, 1, 2, 3, 5, 6, 7, 8], key=perimeter)
    edges = [[boundary[i], boundary[(i+1) % len(boundary)]] for i in range(len(boundary))]
    edges.extend([[4, v] for v in range(5, 9)])
    truth = dict(file_spec=1.2, vertices_coords=points, edges_vertices=edges,
                 edges_assignment=['B']*8+['V', 'M', 'M', 'M'])
    noisy = [[v + (rng.uniform(-noise, noise) if v not in (0, 1) else 0) for v in p] for p in points]
    return {**truth, 'vertices_coords': noisy}, truth


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--sizes', type=int, nargs='+', default=[8, 24, 40, 64])
    p.add_argument('--seeds', type=int, nargs='+', default=[917, 2027, 4099])
    p.add_argument('--noise', type=float, default=.0005)
    p.add_argument('--family', choices=['grid', 'fan'], default='grid')
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    cases = []
    for cells in (a.sizes if a.family == 'grid' else [0]):
        for seed in a.seeds:
            noisy, truth = grid(cells, seed, a.noise) if a.family == 'grid' else fan(seed, a.noise)
            name = f'{a.family}-{cells}-seed-{seed}'
            directory = a.out/name
            directory.mkdir(exist_ok=True)
            for filename, value in [('topology.fold', noisy), ('truth.fold', truth)]:
                (directory/filename).write_text(json.dumps(value))
            cases.append(dict(key=name, cells=cells, seed=seed, noise=a.noise,
                              vertices=len(noisy['vertices_coords']), edges=len(noisy['edges_vertices'])))
    (a.out/'cases.json').write_text(json.dumps(cases, indent=2))
    inventory = []
    for case in cases:
        directory = a.out/case['key']
        digest = lambda name: hashlib.sha256((directory/name).read_bytes()).hexdigest()
        inventory.append({**case, 'split': 'development',
                          'complexity': 'giant' if case['edges'] > 2500 else 'large' if case['edges'] > 1000 else 'small',
                          'source': str((directory/'topology.fold').resolve()),
                          'topology_sha256': digest('topology.fold'), 'truth_sha256': digest('truth.fold')})
    (a.out/'inventory.json').write_text(json.dumps({'procedural_only': True, 'cases': inventory}, indent=2))


if __name__ == '__main__':
    main()
