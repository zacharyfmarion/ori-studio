#!/usr/bin/env python3
"""Choose construction anchors from any independent coordinate, not only pivots.

The priority uses observation distance only; reference geometry is never read.
These candidates still need product checking and independent scoring.
"""
import argparse
import bisect
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import time

import numpy as np

from affine_construction_probe import eliminate
from constructible_recovery_probe import dictionary
from linear_recovery_probe import constraints


def read(p):
    return json.loads(p.read_text())


def anchor(basis, order, coordinate, target):
    row={coordinate:1.};rhs=target
    while True:
        common=row.keys() & basis.keys()
        if not common:
            break
        c=min(common,key=lambda c:basis[c][2]);coefficient=row.pop(c)
        pivot,value,_=basis[c];rhs-=coefficient*value
        for d,v in pivot.items():
            updated=row.get(d,0.)-coefficient*v
            if abs(updated)>1e-12:row[d]=updated
            else:row.pop(d,None)
    if not row:
        return False
    c=max(row,key=lambda c:abs(row[c]));coefficient=row.pop(c)
    basis[c]=({d:v/coefficient for d,v in row.items()},rhs/coefficient,len(order))
    order.append(c)
    return True


def substitute(basis,order,original):
    x=original.copy()
    for c in reversed(order):
        row,rhs,_=basis[c];x[c]=rhs-sum(v*x[d] for d,v in row.items())
    return x


def propose(fold,values,tolerance,budget,known_values):
    points,matrix,target,_,_=constraints(fold)
    deadline=time.monotonic()+budget
    answer=eliminate(matrix,target,deadline)
    if answer is None:return points,{'reason':'budget_or_inconsistent'}
    basis,order=answer;nullity=points.size-len(order);original=points.flatten();candidates=[]
    for c,value in enumerate(original):
        rational=float(Fraction(float(value)).limit_denominator(256))
        k=bisect.bisect_left(known_values,value)
        known=min(known_values[max(0,k-1):k+1],key=lambda v:abs(value-v))
        if min(abs(value-rational),abs(value-known))<1e-9:
            candidates.append((-1.,c,float(value)))
            continue
        k=bisect.bisect_left(values,value)
        nearest=min(values[max(0,k-1):k+1],key=lambda v:abs(value-v))
        if abs(value-nearest)<=tolerance:
            candidates.append((abs(value-nearest),c,float(nearest)))
    added=[];rejected=0
    for _,c,value in sorted(candidates):
        if time.monotonic()>deadline:break
        if not anchor(basis,order,c,value):continue
        x=substitute(basis,order,original)
        movement=np.max(np.linalg.norm((x-original).reshape(points.shape),axis=1))
        if movement>4*tolerance:
            del basis[order.pop()];rejected+=1
        else:added.append({'coordinate':c,'target':value,'observed':float(original[c])})
    x=substitute(basis,order,original)
    residual=float(np.max(np.abs(matrix@x-target)))
    adopted=residual<1e-10
    return (x.reshape(points.shape) if adopted else points),{'linear_nullity_before':nullity,
        'linear_nullity_after':points.size-len(order),'anchors':added,'rejected_movement':rejected,
        'max_residual':residual,'adopted':adopted}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--height',type=int,default=16);p.add_argument('--tolerance',type=float,default=5e-4)
    p.add_argument('--budget',type=float,default=5.)
    p.add_argument('--radicands',type=int,nargs='+',default=[2])
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    values=dictionary(a.height,a.radicands);known_values=dictionary(64,a.radicands);records=[]
    for r in read(a.study/'runs.json'):
        fold=read(Path(r['prediction']));out=a.out/r['key'].replace('/','__');out.mkdir(exist_ok=True)
        started=time.monotonic();points,report=propose(fold,values,a.tolerance,a.budget,known_values)
        report['seconds']=time.monotonic()-started;fold['vertices_coords']=points.tolist()
        (out/'placed.fold').write_text(json.dumps(fold));(out/'proposal.json').write_text(json.dumps(report,indent=2))
        rec=dict(r);rec['prediction']=str(out/'placed.fold');rec['seconds']+=report['seconds']
        rec['solved_25s']=rec['solved_25s'] and rec['seconds']<=25;records.append(rec)
        print(json.dumps({'key':r['key'],**{k:v for k,v in report.items() if k!='anchors'}}),flush=True)
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'options':vars(a),
       'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},default=str,indent=2))


if __name__=='__main__':main()
