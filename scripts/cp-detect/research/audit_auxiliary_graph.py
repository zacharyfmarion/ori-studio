#!/usr/bin/env python3
"""Compare two inference outputs; no truth, fitting, or dataset mutation.

Checks AUX connectivity and that splitting edges did not change the physical
geometry/assignments. Inputs are FOLD files, not a training/validation corpus.
"""
import argparse
import json
import math
from pathlib import Path


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def sub(a, b):
    return [a[0] - b[0], a[1] - b[1]]


def geometry(fold):
    vertices = fold['vertices_coords']
    return [(vertices[a], vertices[b], kind, [a, b]) for (a, b), kind in zip(fold['edges_vertices'], fold['edges_assignment'])]


def contained(a, b, c, d):
    direction = sub(d, c)
    length = math.dist(c, d)
    if length < 1e-10:
        return False
    for p in (a, b):
        delta = sub(p, c)
        t = sum(x * y for x, y in zip(delta, direction)) / length**2
        if abs(cross(delta, direction)) / length > 1e-8 or not -1e-8 <= t <= 1 + 1e-8:
            return False
    return True


def audit(before, after):
    old = [s for s in geometry(before) if s[2] != 'F']
    new = geometry(after)
    physical = [s for s in new if s[2] != 'F']
    unsupported = [i for i, (a, b, kind, _) in enumerate(physical)
                   if not any(kind == k and contained(a, b, c, d) for c, d, k, _ in old)]
    missing = []
    for i, (a, b, kind, _) in enumerate(old):
        coverage = sum(math.dist(c, d) for c, d, k, _ in physical if k == kind and contained(c, d, a, b))
        if abs(coverage - math.dist(a, b)) > 1e-8:
            missing.append(i)
    degree = [0] * len(after['vertices_coords'])
    physical_degree = degree.copy()
    for _, _, kind, edge in new:
        for v in edge:
            degree[v] += 1
            physical_degree[v] += kind != 'F'
    crossings = []
    for i, (a, b, kind, edge) in enumerate(new):
        for j, (c, d, other, other_edge) in enumerate(new[:i]):
            if 'F' not in (kind, other) or set(edge) & set(other_edge):
                continue
            ab, cd = sub(b, a), sub(d, c)
            denominator = cross(ab, cd)
            if abs(denominator) < 1e-12:
                continue
            delta = sub(c, a)
            t, u = cross(delta, cd) / denominator, cross(delta, ab) / denominator
            if -1e-8 <= t <= 1 + 1e-8 and -1e-8 <= u <= 1 + 1e-8:
                crossings.append([i, j])
    return dict(physical_geometry_and_assignments_preserved=not unsupported and not missing,
                unsupported_physical_edges=unsupported, missing_physical_edges=missing,
                auxiliary_edges=sum(s[2] == 'F' for s in new),
                shared_aux_physical_vertices=sum(0 < p < d for p, d in zip(physical_degree, degree)),
                loose_aux_endpoints=[i for i, (p, d) in enumerate(zip(physical_degree, degree)) if p == 0 and d == 1],
                isolated_vertices=[i for i, d in enumerate(degree) if d == 0],
                unmodeled_aux_crossings=crossings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    result = audit(json.loads(args.before.read_text()), json.loads(args.after.read_text()))
    text = json.dumps(result, indent=2)
    if args.out:
        args.out.write_text(text + '\n')
    print(text)
    if not result['physical_geometry_and_assignments_preserved'] or result['unmodeled_aux_crossings']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
