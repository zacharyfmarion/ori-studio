#!/usr/bin/env python3
"""Test a fixed, synthetic Q(sqrt(2)) construction dictionary; never read truth.

This is an intentionally falsifiable proposal, not a trained model. Every value
is generated from bounded integer coefficients. Product checks are required
before any result from this prototype can ship.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np


def read(path):
    return json.loads(path.read_text())


def dictionary(height, radicands=(2,)):
    values = {0., 1.}
    for radicand in radicands:
        root = math.sqrt(radicand)
        for r in range(1, height + 1):
            for q in range(-height, height + 1):
                for p in range(-height, height + 1):
                    if abs(p) + abs(q) + r > height:
                        continue
                    value = (p + q*root) / r
                    if 0 <= value <= 1:
                        values.add(value)
                        # The opposite edge has the same construction prior.
                        values.add(1-value)
    return np.array(sorted(values))


def propose(fold, values, tolerance):
    points = np.array(fold['vertices_coords'])[:, :2]
    candidate = points.copy()
    hits = 0
    for v, point in enumerate(points):
        for d, x in enumerate(point):
            k = bisect.bisect_left(values, x)
            nearest = min(values[max(0, k-1):k+1], key=lambda v:abs(x-v))
            if abs(x-nearest) <= tolerance:
                candidate[v, d] = nearest
                hits += 1
    residual = 0.
    for a, b in fold['edges_vertices']:
        delta = points[b]-points[a]
        length = np.linalg.norm(delta)
        if length < 1e-12:
            continue
        angle = math.atan2(delta[1], delta[0])
        theta = round(angle/(math.pi/8))*(math.pi/8)
        dx, dy = math.cos(theta), math.sin(theta)
        if abs(dx*delta[1]-dy*delta[0]) > 1e-6*length:
            continue
        delta = candidate[b]-candidate[a]
        residual = max(residual, abs(dx*delta[1]-dy*delta[0]))
    accepted = bool(residual < 1e-11)
    movement = float(np.max(np.linalg.norm(candidate-points,axis=1)))
    return (candidate if accepted else points), {'accepted_linear_constraints':accepted,
             'coordinate_hits':hits, 'coordinates':points.size, 'residual':float(residual),
             'max_movement':movement}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--height',type=int,default=16)
    p.add_argument('--tolerance',type=float,default=5e-4)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    values=dictionary(a.height)
    records=[]
    for row in read(a.study/'runs.json'):
        r=dict(row);source=Path(r['prediction']);fold=read(source)
        started=time.monotonic();points,report=propose(fold,values,a.tolerance)
        report['seconds']=time.monotonic()-started
        out=a.out/r['key'].replace('/','__');out.mkdir(exist_ok=True)
        fold['vertices_coords']=points.tolist()
        (out/'placed.fold').write_text(json.dumps(fold))
        (out/'proposal.json').write_text(json.dumps(report,indent=2))
        r['prediction']=str(out/'placed.fold');r['seconds']+=report['seconds']
        r['solved_25s']=r['solved_25s'] and r['seconds']<=25
        records.append(r)
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'options':vars(a),'dictionary_size':len(values),
        'dictionary_sha256':hashlib.sha256(values.tobytes()).hexdigest()},default=str,indent=2))
    print(json.dumps({'cases':len(records),'dictionary_size':len(values)}))


if __name__ == '__main__':
    main()
