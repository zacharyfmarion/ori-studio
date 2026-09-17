#!/usr/bin/env python3
"""Audit reference precision separately from recovery; never modify inference.

An edge whose normal residual from an assumed exact angle is R requires at
least one endpoint to move R/2 in Euclidean distance. This is a bound for that
angle assumption, NOT a universal recovery ceiling or permission to exclude it.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

from audit_exact_recovery import normalize


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, default=Path('artifacts/cp-recognition/frozen/inventory.json'))
    p.add_argument('--audit', type=Path, required=True); p.add_argument('--out', type=Path, required=True)
    a = p.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    inventory = {r['key']: r for r in json.loads(a.inventory.read_text())['cases']}
    records = []
    for result in json.loads((a.audit/'runs.json').read_text()):
        if not result['detected_assignments_exact']: continue
        row = inventory[result['key']]; source = Path(row['source']).parent/'truth.fold'
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest != row['truth_sha256']: raise ValueError('Reference changed')
        fold = normalize(json.loads(source.read_text()), True)
        points = [[p/1024 for p in point] for point in fold['vertices_coords']]
        residuals = []
        for edge, (left, right) in enumerate(fold['edges_vertices']):
            dx, dy = [points[right][d]-points[left][d] for d in range(2)]
            length = math.hypot(dx, dy)
            if length < 1e-12: continue
            angle = math.atan2(dy, dx)
            candidates = [round(angle/(math.pi/n))*(math.pi/n) for n in [8,16,12]]
            theta = min(candidates, key=lambda t: abs(math.cos(t)*dy-math.sin(t)*dx))
            residual = abs(math.cos(theta)*dy-math.sin(theta)*dx)
            if residual < 1e-6*length: residuals.append((residual, edge))
        worst = max(residuals, default=(0.,None))
        records.append({'key':row['key'], 'split':row['split'], 'truth_sha256':digest,
            'assumed_family_edges':len(residuals), 'worst_edge':worst[1],
            'minimum_endpoint_displacement':worst[0]/2,
            'primary_recovered':result['scores']['with_aux']['1e-09']['recovered_within_25s']})
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))
    summary = {str(e): {'cases_exceeding_endpoint_bound':sum(r['minimum_endpoint_displacement']>e for r in records),
        'among_primary_failures':sum(r['minimum_endpoint_displacement']>e and not r['primary_recovered'] for r in records)}
        for e in [1e-12,1e-9,1e-6]}
    (a.out/'summary.json').write_text(json.dumps(summary,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'options':vars(a), 'diagnostic_only':True,
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},default=str,indent=2))
    print(json.dumps(summary))


if __name__ == '__main__': main()
