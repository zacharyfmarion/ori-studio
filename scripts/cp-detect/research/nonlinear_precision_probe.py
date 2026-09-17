#!/usr/bin/env python3
"""Tighten Kawasaki with exact directions and known constructions held.

No reference geometry is read. This is an experimental sparse Newton projection;
its outputs require original product checks and separate reference scoring.
"""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from scipy.sparse import coo_matrix, vstack
from scipy.sparse.linalg import lsmr

from constructible_recovery_probe import dictionary
from linear_recovery_probe import constraints


def angle_rows(points, fans):
    rr, cc, vv, residuals = [], [], [], []
    for center, neighbors in fans:
        rays = points[neighbors] - points[center]
        angles = np.unwrap(np.arctan2(rays[:, 1], rays[:, 0]))
        signs = np.array([-1. if i % 2 == 0 else 1. for i in range(len(neighbors))])
        residual = float(signs @ angles - np.pi)
        residual = (residual + np.pi) % (2 * np.pi) - np.pi
        gradients = signs[:, None] * np.c_[-rays[:, 1], rays[:, 0]] / np.sum(rays*rays, axis=1)[:, None]
        row = len(residuals)
        for vertex, gradient in zip(neighbors, gradients):
            for axis in range(2):
                rr.append(row); cc.append(2*vertex+axis); vv.append(gradient[axis])
        for axis in range(2):
            rr.append(row); cc.append(2*center+axis); vv.append(-gradients[:, axis].sum())
        residuals.append(residual)
    return coo_matrix((vv, (rr, cc)), shape=(len(fans), points.size)).tocsr(), np.array(residuals)


def propose(fold, values, budget):
    points, linear, target, _, _ = constraints(fold)
    boundary, neighbors = set(), [[] for _ in points]
    for (a, b), assignment in zip(fold['edges_vertices'], fold['edges_assignment']):
        if assignment == 'B': boundary.update([a, b])
        if assignment in ['M', 'V', 'U']:
            neighbors[a].append(b); neighbors[b].append(a)
    fans = []
    for v, adjacent in enumerate(neighbors):
        if v in boundary or len(adjacent) < 2 or len(adjacent) % 2: continue
        if min(np.linalg.norm(points[u]-points[v]) for u in adjacent) < 1e-8: continue
        ordered = sorted(adjacent, key=lambda u: np.arctan2(*(points[u]-points[v])[::-1]))
        fans.append((v, ordered))
    if not fans: return points, {'reason': 'no_constrained_vertices'}
    fixed, fixed_values = [], []
    for c, value in enumerate(points.flatten()):
        k = int(np.searchsorted(values, value))
        nearest = min(values[max(0, k-1):k+1], key=lambda v: abs(v-value))
        rational = float(Fraction(float(value)).limit_denominator(256))
        known = min([nearest, rational], key=lambda v: abs(v-value))
        if abs(known-value) < 1e-9:
            fixed.append(c); fixed_values.append(known)
    anchor = coo_matrix((np.ones(len(fixed)), (np.arange(len(fixed)), fixed)),
                        shape=(len(fixed), points.size)).tocsr()
    linear = vstack([linear, anchor], format='csr'); target = np.r_[target, fixed_values]
    x = points.flatten().copy(); deadline = time.monotonic()+budget; history = []
    for iteration in range(8):
        if time.monotonic() > deadline: break
        jacobian, residual = angle_rows(x.reshape(points.shape), fans)
        matrix = vstack([linear, jacobian], format='csr')
        error = np.r_[target-linear@x, -residual]
        history.append(float(np.max(np.abs(error))))
        if history[-1] < 2e-14: break
        update = lsmr(matrix, error, atol=1e-14, btol=1e-14, conlim=1e12, maxiter=3000)[0]
        x += update
        if np.max(np.linalg.norm(x.reshape(points.shape)-points, axis=1)) > 5e-4:
            return points, {'reason': 'movement', 'history': history}
    _, residual = angle_rows(x.reshape(points.shape), fans)
    error = max(float(np.max(np.abs(target-linear@x))), float(np.max(np.abs(residual))))
    adopted = error < 1e-10
    return (x.reshape(points.shape) if adopted else points), {'adopted_linear': adopted,
        'known_coordinates': len(fixed), 'nonlinear_equations': len(fans), 'history': history,
        'final_residual': error}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study', type=Path, required=True); p.add_argument('--out', type=Path, required=True)
    p.add_argument('--budget', type=float, default=5.)
    a = p.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    values, records = dictionary(64), []
    for r in json.loads((a.study/'runs.json').read_text()):
        fold = json.loads(Path(r['prediction']).read_text())
        out = a.out/r['key'].replace('/', '__'); out.mkdir(exist_ok=True)
        started = time.monotonic(); points, report = propose(fold, values, a.budget)
        report['seconds'] = time.monotonic()-started
        fold['vertices_coords'] = points.tolist()
        (out/'placed.fold').write_text(json.dumps(fold)); (out/'proposal.json').write_text(json.dumps(report))
        record = dict(r); record['prediction'] = str(out/'placed.fold'); record['seconds'] += report['seconds']
        record['solved_25s'] = record['solved_25s'] and record['seconds'] <= 25; records.append(record)
        print(json.dumps({'key': r['key'], **report}), flush=True)
    (a.out/'runs.json').write_text(json.dumps(records, indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'options': vars(a),
        'source_hashes': {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
          for path in [Path(__file__), Path(__file__).with_name('linear_recovery_probe.py'),
                       Path(__file__).with_name('constructible_recovery_probe.py')]}}, default=str, indent=2))


if __name__ == '__main__': main()
