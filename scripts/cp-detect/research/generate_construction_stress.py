#!/usr/bin/env python3
"""Fresh procedural recovery checks; no real crease-pattern files are read.

Orthogonal crosses have a continuously free position. The rational/surd cases
test the construction prior, not uniqueness from folding equations. Rotations
and shuffled vertex IDs check orientation and ordering sensitivity. Continuous
controls expose how much a prior changes a valid, otherwise unspecified input.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random


def cross(t, middle, aux):
    return dict(
        file_spec=1.2,
        vertices_coords=[[0., 0.], [1., 0.], [1., 1.], [0., 1.],
                         [t, 0.], [1., middle], [t, 1.], [0., middle],
                         [t, middle], [0., aux], [1., aux], [t, aux]],
        edges_vertices=[[0, 4], [4, 1], [1, 10], [10, 5], [5, 2], [2, 6],
                        [6, 3], [3, 7], [7, 9], [9, 0], [4, 11], [11, 8],
                        [8, 6], [7, 8], [8, 5], [9, 11], [11, 10]],
        edges_assignment=['B'] * 10 + ['M', 'M', 'M', 'M', 'V', 'F', 'F'],
    )


def transform(fold, turns, order):
    points = fold['vertices_coords']
    for _ in range(turns):
        points = [[1 - y, x] for x, y in points]
    inverse = {old: new for new, old in enumerate(order)}
    return {**fold, 'vertices_coords': [points[i] for i in order],
            'edges_vertices': [[inverse[a], inverse[b]] for a, b in fold['edges_vertices']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--seed', type=int, default=763019)
    args = parser.parse_args()
    rng = random.Random(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    records = []
    values = [1 / 3, 5 / 12, 7 / 16, 11 / 32, math.sqrt(2) - 1, 2 - math.sqrt(2)]
    for label, t in [(f'construction-{i}', t) for i, t in enumerate(values)] + [
        ('continuous', math.pi / 10), ('continuous-two', math.e / 8)
    ]:
        continuous = label.startswith('continuous')
        for turns in range(4):
            delta = 0. if continuous else rng.uniform(-8e-5, 8e-5)
            truth, observed = cross(t, .5, .25), cross(t + delta, .5, .25)
            order = list(range(12))
            rng.shuffle(order)
            name = f'{label}-rotation-{turns}'
            directory = args.out / name
            directory.mkdir(exist_ok=True)
            for filename, fold in [('truth.fold', truth), ('topology.fold', observed)]:
                (directory / filename).write_text(json.dumps(transform(fold, turns, order)))
            digest = lambda filename: hashlib.sha256((directory / filename).read_bytes()).hexdigest()
            records.append(dict(key=name, split='development', complexity='small',
                kind='continuous-control' if continuous else 'construction-prior',
                source=str((directory / 'topology.fold').resolve()),
                topology_sha256=digest('topology.fold'), truth_sha256=digest('truth.fold'),
                noise=delta, rotation=turns, vertex_order=order))
    (args.out / 'inventory.json').write_text(json.dumps(dict(
        procedural_only=True, seed=args.seed, cases=records), indent=2))


if __name__ == '__main__':
    main()
