#!/usr/bin/env python3
"""Produce nearby alternate graphs with every edge direction held constant.

This is a diagnostic, never a recovery proposal. A checked nonzero displacement
demonstrates ambiguity of these geometric constraints, not an upper bound for
all possible construction priors or information obtainable from the image.
No reference files are read.
"""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsmr

from constructible_recovery_probe import dictionary


def witness(fold, values, protect_known):
    points = np.array(fold['vertices_coords'])[:, :2]
    rows, cols, coefficients = [], [], []
    count = 0
    def equation(entries):
        nonlocal count
        for c, value in entries:
            rows.append(count); cols.append(c); coefficients.append(value)
        count += 1
    boundary = set()
    for (a, b), assignment in zip(fold['edges_vertices'], fold['edges_assignment']):
        delta = points[b]-points[a]; length = np.linalg.norm(delta)
        if length < 1e-12: continue
        normal = np.array([-delta[1], delta[0]])/length
        equation([(2*a, normal[0]), (2*a+1, normal[1]), (2*b, -normal[0]), (2*b+1, -normal[1])])
        if assignment == 'B': boundary.update([a, b])
    fixed = set()
    for v in boundary:
        for d in range(2):
            if min(abs(points[v, d]), abs(points[v, d]-1)) < 1e-9: fixed.add(2*v+d)
    if protect_known:
        for c, value in enumerate(points.flatten()):
            k = int(np.searchsorted(values, value))
            nearest = min(values[max(0, k-1):k+1], key=lambda v: abs(value-v))
            rational = float(Fraction(float(value)).limit_denominator(256))
            if min(abs(value-nearest), abs(value-rational)) < 1e-9: fixed.add(c)
    for c in sorted(fixed): equation([(c, 1.)])
    matrix = coo_matrix((coefficients, (rows, cols)), shape=(count, points.size)).tocsr()
    random = np.random.default_rng(81723).normal(size=points.size)
    for _ in range(3):
        random -= lsmr(matrix, matrix@random, atol=1e-14, btol=1e-14, conlim=1e12, maxiter=10000)[0]
    amplitude = float(np.max(np.linalg.norm(random.reshape(points.shape), axis=1)))
    if amplitude < 1e-5: return points, {'witness': False, 'reason': 'no_resolved_null_direction'}
    displacement = random/amplitude*1e-5
    residual = float(np.max(np.abs(matrix@displacement)))
    if residual > 1e-13: return points, {'witness': False, 'reason': 'projection_precision', 'residual': residual}
    candidate = points+displacement.reshape(points.shape)
    return candidate, {'witness': True, 'max_constraint_residual': residual,
                       'max_movement': 1e-5, 'fixed_coordinates': len(fixed)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study', type=Path, required=True); p.add_argument('--out', type=Path, required=True)
    p.add_argument('--protect-known', action='store_true')
    a = p.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    records, values = [], dictionary(64)
    for r in json.loads((a.study/'runs.json').read_text()):
        fold = json.loads(Path(r['prediction']).read_text())
        out = a.out/r['key'].replace('/', '__'); out.mkdir(exist_ok=True)
        start = time.monotonic(); points, report = witness(fold, values, a.protect_known)
        report['seconds'] = time.monotonic()-start
        fold['vertices_coords'] = points.tolist()
        (out/'placed.fold').write_text(json.dumps(fold)); (out/'proposal.json').write_text(json.dumps(report))
        record = dict(r); record['prediction'] = str(out/'placed.fold'); records.append(record)
        print(json.dumps({'key': r['key'], **report}), flush=True)
    (a.out/'runs.json').write_text(json.dumps(records, indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'diagnostic_only': True, 'options': vars(a),
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, default=str, indent=2))


if __name__ == '__main__': main()
