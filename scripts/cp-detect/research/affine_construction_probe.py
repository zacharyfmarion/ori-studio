#!/usr/bin/env python3
"""Sparse elimination and simple free-coordinate hypotheses, with no truth.

The nullity measured here is for the inferred linear direction system only,
not for all origami constraints, and is not a theoretical recovery ceiling.
"""
import argparse
import bisect
import hashlib
import json
from pathlib import Path
import time
from fractions import Fraction

import numpy as np

from constructible_recovery_probe import dictionary
from linear_recovery_probe import constraints


def read(p):
    return json.loads(p.read_text())


def eliminate(matrix, target, deadline):
    basis = {}
    order = []
    for i, value in enumerate(target):
        if time.monotonic() > deadline:
            return None
        start, end = matrix.indptr[i:i+2]
        row = {int(c):float(v) for c,v in zip(matrix.indices[start:end],matrix.data[start:end]) if abs(v)>1e-12}
        while True:
            common = row.keys() & basis.keys()
            if not common:
                break
            c = min(common, key=lambda c:basis[c][2])
            coefficient = row.pop(c)
            pivot, rhs, _ = basis[c]
            value -= coefficient*rhs
            for d,v in pivot.items():
                updated = row.get(d,0.)-coefficient*v
                if abs(updated)>1e-12:
                    row[d]=updated
                else:
                    row.pop(d,None)
        if not row:
            if abs(value)>1e-9:
                return None
            continue
        c=max(row,key=lambda c:abs(row[c]));coefficient=row.pop(c)
        row={d:v/coefficient for d,v in row.items()}
        basis[c]=(row,float(value/coefficient),len(order));order.append(c)
    return basis,order


def propose(fold, values, tolerance, budget):
    points,matrix,target,_,_=constraints(fold)
    start=time.monotonic()
    answer=eliminate(matrix,target,start+budget)
    if answer is None:
        return points,{'reason':'budget_or_inconsistent'}
    basis,order=answer
    free=sorted(set(range(points.size))-basis.keys())
    x=points.flatten().copy();snapped=[]
    for c in free:
        # A coordinate already explained by an exact rational construction is
        # stronger evidence than a different nearby low-height surd. Preserve
        # it even when its numerator makes it absent from the small dictionary.
        rational=float(Fraction(float(x[c])).limit_denominator(256))
        if abs(x[c]-rational)<1e-9:
            continue
        k=bisect.bisect_left(values,x[c])
        nearest=min(values[max(0,k-1):k+1],key=lambda v:abs(x[c]-v))
        if abs(x[c]-nearest)<=tolerance:
            snapped.append({'coordinate':c,'before':float(x[c]),'after':float(nearest)})
            x[c]=nearest
    for c in reversed(order):
        row,rhs,_=basis[c];x[c]=rhs-sum(v*x[d] for d,v in row.items())
    proposed=x.reshape(points.shape)
    movement=float(np.max(np.linalg.norm(proposed-points,axis=1)))
    residual=float(np.max(np.abs(matrix@x-target)))
    accept=movement<4*tolerance and residual<1e-10
    return (proposed if accept else points),{'linear_nullity':len(free),'equations':matrix.shape[0],
       'free_snaps':snapped,'max_movement':movement,'max_residual':residual,'accepted_linear':accept}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--height',type=int,default=16)
    p.add_argument('--tolerance',type=float,default=5e-4)
    p.add_argument('--budget',type=float,default=5.)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    values=dictionary(a.height);records=[]
    for r in read(a.study/'runs.json'):
        fold=read(Path(r['prediction']));out=a.out/r['key'].replace('/','__');out.mkdir(exist_ok=True)
        started=time.monotonic();points,report=propose(fold,values,a.tolerance,a.budget)
        report['seconds']=time.monotonic()-started
        fold['vertices_coords']=points.tolist();(out/'placed.fold').write_text(json.dumps(fold))
        (out/'proposal.json').write_text(json.dumps(report,indent=2))
        rec=dict(r);rec['prediction']=str(out/'placed.fold');rec['seconds']+=report['seconds']
        rec['solved_25s']=rec['solved_25s'] and rec['seconds']<=25;records.append(rec)
        print(json.dumps({'key':r['key'],**{k:v for k,v in report.items() if k!='free_snaps'}}),flush=True)
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'options':vars(a),
      'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'dictionary_sha256':hashlib.sha256(values.tobytes()).hexdigest()},default=str,indent=2))


if __name__=='__main__':
    main()
