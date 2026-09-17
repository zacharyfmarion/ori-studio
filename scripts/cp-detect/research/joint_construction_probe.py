#!/usr/bin/env python3
"""Choose construction anchors by the simplicity of the entire resulting graph.

Candidate values and costs come from bounded integer expressions, not training
or reference geometry. Each candidate must later pass separate product checks.
"""
import argparse
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np

from affine_construction_probe import eliminate
from anchor_construction_probe import anchor, substitute
from constructible_recovery_probe import dictionary
from linear_recovery_probe import constraints


def catalog(height, radicands, rational_denominator=0):
    entries = {}
    for denominator in range(1, rational_denominator+1):
        for numerator in range(denominator+1):
            fraction = Fraction(numerator, denominator)
            value = float(fraction)
            cost = fraction.denominator + min(fraction.numerator, fraction.denominator-fraction.numerator)
            key = round(value, 14)
            if key not in entries or entries[key][1] > cost: entries[key] = (value, cost)
    for radicand in radicands:
        root = math.sqrt(radicand)
        for r in range(1, height+1):
            for q in range(-height, height+1):
                for p in range(-height, height+1):
                    cost = abs(p)+abs(q)+r
                    if cost > height: continue
                    value = (p+q*root)/r
                    if not 0 <= value <= 1: continue
                    for v in [value, 1-value]:
                        key = round(v, 14)
                        if key not in entries or entries[key][1] > cost: entries[key] = (v, cost)
    pairs = sorted(entries.values())
    return np.array([v for v, _ in pairs]), np.array([math.log2(1+c) for _, c in pairs])


def simplicity(x, values, costs):
    i = np.searchsorted(values, x)
    left, right = np.maximum(i-1, 0), np.minimum(i, len(values)-1)
    nearest = np.where(abs(x-values[left]) <= abs(x-values[right]), left, right)
    return float(np.where(abs(x-values[nearest]) < 1e-9, costs[nearest], 8.).sum())


def propose(fold, values, costs, known_values, budget, noise, observation_weight=.05, nonlinear=False):
    points, matrix, rhs, _, _ = constraints(fold)
    original = points.flatten(); deadline = time.monotonic()+budget
    if nonlinear:
        from nonlinear_precision_probe import angle_rows
        from scipy.sparse import vstack, diags
        boundary, neighbors = set(), [[] for _ in points]
        for (left, right), assignment in zip(fold['edges_vertices'], fold['edges_assignment']):
            if assignment == 'B': boundary.update([left, right])
            if assignment in ['M','V','U']:
                neighbors[left].append(right); neighbors[right].append(left)
        fans = []
        for v, adjacent in enumerate(neighbors):
            if v in boundary or len(adjacent)<2 or len(adjacent)%2: continue
            if min(np.linalg.norm(points[u]-points[v]) for u in adjacent)<1e-8: continue
            fans.append((v, sorted(adjacent,key=lambda u: math.atan2(*(points[u]-points[v])[::-1]))))
        jacobian, residual = angle_rows(points, fans)
        scale = diags(1/np.maximum(np.asarray(abs(jacobian).max(axis=1).toarray()).ravel(),1e-12))
        matrix = vstack([matrix, scale@jacobian], format='csr')
        rhs = np.r_[rhs, scale@(jacobian@original-residual)]
    eliminated = eliminate(matrix, rhs, deadline)
    if eliminated is None: return points, {'reason': 'basis_budget'}
    basis, order = eliminated
    for c, value in enumerate(original):
        rational = float(Fraction(float(value)).limit_denominator(256))
        k = int(np.searchsorted(known_values, value))
        known = min(known_values[max(0, k-1):k+1], key=lambda v: abs(value-v))
        if min(abs(value-rational), abs(value-known)) < 1e-9: anchor(basis, order, c, float(value))
    nullity = original.size-len(order); reports = []; evaluations = 0
    def objective(x):
        # A soft observation prior breaks equal-complexity choices; it is not
        # allowed to substitute for the explicit movement and product checks.
        return simplicity(x, values, costs) + observation_weight*np.sum(((x-original)/noise)**2)
    for _ in range(min(nullity, 12)):
        if time.monotonic() > deadline: break
        current = substitute(basis, order, original)
        current_score = objective(current); best = None
        seen = set()
        for c, value in enumerate(original):
            if time.monotonic() > deadline: break
            if not anchor(basis, order, c, float(current[c]+1)): continue
            direction = substitute(basis, order, original)-current
            del basis[order.pop()]
            lo, hi = np.searchsorted(values, [value-noise, value+noise])
            for target in values[lo:hi]:
                proposed = current+direction*(target-current[c])
                if np.max(np.linalg.norm((proposed-original).reshape(points.shape), axis=1)) > 4*noise: continue
                fingerprint = np.round(proposed, 10).tobytes()
                if fingerprint in seen: continue
                seen.add(fingerprint); evaluations += 1
                score = objective(proposed)
                if score < current_score-1e-6 and (best is None or score < best[0]):
                    best = (score, c, float(target))
        if best is None: break
        score, c, target = best
        anchor(basis, order, c, target)
        reports.append({'coordinate': c, 'target': target, 'before_cost': current_score, 'cost': score})
    x = substitute(basis, order, original)
    residual = float(np.max(np.abs(matrix@x-rhs)))
    movement = float(np.max(np.linalg.norm((x-original).reshape(points.shape), axis=1)))
    adopted = residual < 1e-10 and movement < 4*noise
    return (x.reshape(points.shape) if adopted else points), {
        'adopted_linear': adopted, 'anchors': reports, 'evaluations': evaluations,
        'nullity_before': nullity, 'nullity_after': original.size-len(order),
        'max_movement': movement, 'max_residual': residual,
        'timed_out': time.monotonic() > deadline}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study', type=Path, required=True); p.add_argument('--out', type=Path, required=True)
    p.add_argument('--height', type=int, default=24); p.add_argument('--radicands', type=int, nargs='+', default=[2,3])
    p.add_argument('--budget', type=float, default=4.); p.add_argument('--noise', type=float, default=.002)
    p.add_argument('--rational-denominator', type=int, default=0)
    p.add_argument('--auto-radicals', action='store_true')
    p.add_argument('--observation-weight', type=float, default=.05)
    p.add_argument('--nonlinear', action='store_true')
    a = p.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    catalogs = {tuple(a.radicands): catalog(a.height, a.radicands, a.rational_denominator)}
    if a.auto_radicals: catalogs[(2,)] = catalog(a.height, [2], a.rational_denominator)
    known = dictionary(64, a.radicands); records = []
    for r in json.loads((a.study/'runs.json').read_text()):
        fold = json.loads(Path(r['prediction']).read_text())
        radical_key = tuple(a.radicands)
        if a.auto_radicals:
            points = np.array(fold['vertices_coords'])[:, :2]
            exclusive = 0
            for left, right in fold['edges_vertices']:
                delta = points[right]-points[left]
                theta = math.atan2(delta[1], delta[0])
                if abs(theta-round(theta/(math.pi/12))*(math.pi/12)) < 1e-6 and abs(theta-round(theta/(math.pi/16))*(math.pi/16)) > 1e-6:
                    exclusive += 1
            if exclusive < 2: radical_key = (2,)
        values, costs = catalogs[radical_key]
        out = a.out/r['key'].replace('/', '__'); out.mkdir(exist_ok=True)
        start = time.monotonic(); points, report = propose(fold, values, costs, known, a.budget, a.noise, a.observation_weight, a.nonlinear)
        if a.nonlinear and report.get('adopted_linear'):
            from nonlinear_precision_probe import propose as polish
            candidate = dict(fold); candidate['vertices_coords'] = points.tolist()
            points, report['nonlinear_polish'] = polish(candidate, known, max(.01, a.budget-(time.monotonic()-start)))
        report['seconds'] = time.monotonic()-start; report['radicands'] = radical_key
        fold['vertices_coords'] = points.tolist()
        (out/'placed.fold').write_text(json.dumps(fold)); (out/'proposal.json').write_text(json.dumps(report))
        rec = dict(r); rec['prediction'] = str(out/'placed.fold'); rec['seconds'] += report['seconds']
        rec['solved_25s'] = rec['solved_25s'] and rec['seconds'] <= 25; records.append(rec)
        print(json.dumps({'key': r['key'], **report}), flush=True)
    (a.out/'runs.json').write_text(json.dumps(records, indent=2))
    paths = [Path(__file__), *[Path(__file__).with_name(n+'_probe.py') for n in
        ['affine_construction','anchor_construction','constructible_recovery','linear_recovery']]]
    (a.out/'protocol.json').write_text(json.dumps({'options': vars(a), 'source_hashes':
        {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}}, default=str, indent=2))


if __name__ == '__main__': main()
