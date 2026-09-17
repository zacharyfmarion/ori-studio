#!/usr/bin/env python3
"""Project saved solutions onto inferred exact directions; no truth is read.

Research prototype only: product acceptance, budget and ambiguity checks are
separate. Scores from this probe are candidate counts, not shipping results.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsmr


def read(path):
    return json.loads(path.read_text())


def constraints(fold, tolerance=1e-6):
    points = np.array(fold['vertices_coords'], dtype=float)[:, :2]
    edges = np.array(fold['edges_vertices'])
    labels = fold['edges_assignment']
    boundary = {v for e, a in zip(edges, labels) if a == 'B' for v in e}
    fixed = {}
    for v in boundary:
        for d in range(2):
            if abs(points[v, d]) < 1e-9 or abs(points[v, d] - 1) < 1e-9:
                fixed[2*v+d] = round(points[v, d])
    # Build exact line equations directly in coordinates, avoiding soft
    # incidence penalties and carrier-angle parameterization roundoff.
    rows, cols, values, rhs = [], [], [], []
    directions = []
    angles = sorted({math.radians(n*step) for step in fold.get('cp_research_direction_steps',[22.5])
                     for n in range(round(360/step))})
    for theta in angles:
        # Explicit cardinals eliminate trig noise on horizontal/vertical lines.
        x, y = math.cos(theta), math.sin(theta)
        directions.append((0. if abs(x) < 1e-15 else x, 0. if abs(y) < 1e-15 else y))
    for a, b in edges:
        delta = points[b] - points[a]
        if np.linalg.norm(delta) < 1e-12:
            continue
        dx,dy = min(directions,key=lambda v:abs(v[0]*delta[1]-v[1]*delta[0]))
        if abs(dx*delta[1] - dy*delta[0]) > tolerance * np.linalg.norm(delta):
            continue
        row = len(rhs)
        for c, value in [(2*a, -dy), (2*a+1, dx), (2*b, dy), (2*b+1, -dx)]:
            rows.append(row); cols.append(c); values.append(value)
        rhs.append(0.)
    equations = len(rhs)
    for c, value in fixed.items():
        rows.append(len(rhs)); cols.append(c); values.append(1.); rhs.append(value)
    if fold.get('cp_research_preserve_symmetry'):
        ids=fold.get('cp_detector',{}).get('vertex_original_ids',list(range(len(points))))
        remap={v:i for i,v in enumerate(ids)}
        report=fold.get('cp_detector',{}).get('exact_solve',{}).get('movement_report',{})
        transforms={'vertical':(np.array([[-1,0],[0,1]]),[1,0]),
                    'horizontal':(np.array([[1,0],[0,-1]]),[0,1]),
                    'diagonal':(np.array([[0,1],[1,0]]),[0,0]),
                    'anti_diagonal':(np.array([[0,-1],[-1,0]]),[1,1])}
        for symmetry in report.get('symmetry',[]):
            if not symmetry.get('held') or symmetry['axis'] not in transforms:
                continue
            mat,offset=transforms[symmetry['axis']]
            pairs=symmetry['pairs']+[[v,v] for v in symmetry['on_axis']]
            for old_a,old_b in pairs:
                if old_a not in remap or old_b not in remap:continue
                a,b=remap[old_a],remap[old_b]
                if np.linalg.norm(mat@points[a]+offset-points[b])>1e-7:continue
                for axis in range(2):
                    row=len(rhs)
                    for d in range(2):
                        rows.append(row);cols.append(2*a+d);values.append(float(mat[axis,d]))
                    rows.append(row);cols.append(2*b+axis);values.append(-1.)
                    rhs.append(-float(offset[axis]))
    matrix = coo_matrix((values, (rows, cols)), shape=(len(rhs), points.size)).tocsr()
    target = np.array(rhs)
    return points, matrix, target, equations, len(fixed)


def project(fold, tolerance=1e-6, max_move=1e-5):
    points, matrix, target, equations, fixed_count = constraints(fold, tolerance)
    x = points.flatten().copy()
    iterations = []
    for _ in range(3):
        error = target - matrix @ x
        answer = lsmr(matrix, error, atol=1e-14, btol=1e-14, conlim=1e12, maxiter=10000)
        x += answer[0]
        iterations.append(int(answer[2]))
        if np.max(np.abs(target - matrix @ x)) < 1e-15:
            break
    proposed = x.reshape(points.shape)
    movement = float(np.max(np.linalg.norm(proposed-points, axis=1)))
    adopted = movement <= max_move
    return (proposed if adopted else points), {
        'equations': equations, 'fixed_coordinates': fixed_count, 'iterations': iterations,
        'max_movement': movement, 'adopted': adopted,
        'max_residual': float(np.max(np.abs(target-matrix@x)))}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--split', choices=['development', 'holdout', 'all'], default='development')
    p.add_argument('--tolerance', type=float, default=1e-6)
    p.add_argument('--max-move', type=float, default=1e-5)
    p.add_argument('--angle-steps', type=float, nargs='+', default=[22.5])
    p.add_argument('--preserve-symmetry',action='store_true')
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    records = []
    for r in read(a.study/'runs.json'):
        if a.split != 'all' and r['split'] != a.split:
            continue
        if not r.get('detected_topology_exact'):
            continue
        directory = a.out / r['key'].replace('/', '__')
        directory.mkdir(exist_ok=True)
        record = dict(r)
        fold = read(Path(r['prediction']))
        fold['cp_research_direction_steps'] = a.angle_steps
        fold['cp_research_preserve_symmetry'] = a.preserve_symmetry
        start = time.monotonic()
        points, report = project(fold, a.tolerance, a.max_move)
        report['seconds'] = time.monotonic()-start
        fold['vertices_coords'] = points.tolist()
        (directory/'placed.fold').write_text(json.dumps(fold))
        (directory/'proposal.json').write_text(json.dumps(report,indent=2))
        record['prediction'] = str(directory/'placed.fold')
        record['seconds'] += report['seconds']
        record['solved_25s'] = record['solved_25s'] and record['seconds'] <= 25
        records.append(record)
        print(json.dumps({'key':r['key'], **report}),flush=True)
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'source_protocol_sha256': hashlib.sha256((a.study/'protocol.json').read_bytes()).hexdigest(),
        'options':vars(a)},default=str,indent=2))


if __name__ == '__main__':
    main()
