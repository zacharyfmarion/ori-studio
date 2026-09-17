#!/usr/bin/env python3
"""Infer simple displacements between connected vertices, not only coordinates.

The construction catalog is generated from integer expressions. No reference
geometry is read; all outputs require separate product validation and scoring.
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
from anchor_construction_probe import substitute
from constructible_recovery_probe import dictionary
from joint_construction_probe import catalog, simplicity
from linear_recovery_probe import constraints


def insert(basis, order, entries, rhs):
    row = dict(entries)
    while True:
        common = row.keys() & basis.keys()
        if not common: break
        c = min(common, key=lambda c:basis[c][2]); coefficient = row.pop(c)
        pivot, value, _ = basis[c]; rhs -= coefficient*value
        for d, v in pivot.items():
            updated = row.get(d,0.)-coefficient*v
            if abs(updated)>1e-12: row[d]=updated
            else: row.pop(d,None)
    if not row: return False
    c = max(row,key=lambda c:abs(row[c])); coefficient = row.pop(c)
    basis[c] = ({d:v/coefficient for d,v in row.items()},rhs/coefficient,len(order))
    order.append(c)
    return True


def propose(fold, values, costs, known, budget, relative_weight):
    points,matrix,rhs,_,_ = constraints(fold)
    original = points.flatten(); deadline = time.monotonic()+budget
    eliminated = eliminate(matrix,rhs,deadline)
    if eliminated is None: return points, {'reason':'basis_budget'}
    basis,order = eliminated
    for c,value in enumerate(original):
        rational = float(Fraction(float(value)).limit_denominator(256)); k=int(np.searchsorted(known,value))
        candidate=min(known[max(0,k-1):k+1],key=lambda v:abs(value-v))
        if min(abs(value-rational),abs(value-candidate))<1e-9: insert(basis,order,[(c,1.)],value)
    pairs = sorted({tuple(sorted((2*a+d,2*b+d))) for a,b in fold['edges_vertices']
                    for d in range(2) if abs(points[a,d]-points[b,d])>1e-6})
    left = np.array([a for a,_ in pairs],dtype=int); right=np.array([b for _,b in pairs],dtype=int)
    expressions = [[(c,1.)] for c in range(original.size)] + [[(a,1.),(b,-1.)] for a,b in pairs]
    nullity = original.size-len(order); history=[]; evaluations=0
    def objective(x):
        return simplicity(x,values,costs) + relative_weight*simplicity(abs(x[left]-x[right]),values,costs) + 8.*np.sum(((x-original)/.002)**2)
    for _ in range(min(nullity,12)):
        if time.monotonic()>deadline: break
        current=substitute(basis,order,original);score=objective(current);best=None;seen=set();exhausted=False
        for expression in expressions:
            if time.monotonic()>deadline: exhausted=True;break
            at=sum(current[c]*v for c,v in expression);observed=sum(original[c]*v for c,v in expression)
            if not insert(basis,order,expression,at+1.):continue
            direction=substitute(basis,order,original)-current;del basis[order.pop()]
            sign=1. if observed>=0 else -1.
            lo,hi=np.searchsorted(values,[abs(observed)-.002,abs(observed)+.002])
            for target in values[lo:hi]*sign:
                proposal=current+direction*(target-at)
                if np.max(np.linalg.norm((proposal-original).reshape(points.shape),axis=1))>.008:continue
                fingerprint=np.round(proposal,10).tobytes()
                if fingerprint in seen:continue
                seen.add(fingerprint);evaluations+=1;cost=objective(proposal)
                if cost<score-1e-6 and (best is None or cost<best[0]):best=(cost,expression,float(target))
        if exhausted or best is None:break
        cost,expression,target=best;insert(basis,order,expression,target)
        history.append({'expression':expression,'target':target,'cost':cost,'before_cost':score})
    answer=substitute(basis,order,original);residual=float(np.max(np.abs(matrix@answer-rhs)))
    movement=float(np.max(np.linalg.norm((answer-original).reshape(points.shape),axis=1)))
    adopted=residual<1e-10 and movement<.008
    return (answer.reshape(points.shape) if adopted else points),{'adopted_linear':adopted,
        'anchors':history,'evaluations':evaluations,'nullity_before':nullity,'nullity_after':original.size-len(order),
        'max_residual':residual,'max_movement':movement,'timed_out':time.monotonic()>deadline}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--budget',type=float,default=4.);p.add_argument('--relative-weight',type=float,default=.5)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    catalogs={key:catalog(24,key,64) for key in [(2,),(2,3)]}
    known=np.unique(np.r_[dictionary(128),dictionary(64,[3])]);records=[]
    for r in json.loads((a.study/'runs.json').read_text()):
        fold=json.loads(Path(r['prediction']).read_text());points=np.array(fold['vertices_coords']);exclusive=0
        for left,right in fold['edges_vertices']:
            delta=points[right]-points[left];theta=math.atan2(delta[1],delta[0])
            if abs(theta-round(theta/(math.pi/12))*(math.pi/12))<1e-6 and abs(theta-round(theta/(math.pi/16))*(math.pi/16))>1e-6:exclusive+=1
        values,costs=catalogs[(2,3) if exclusive>=2 else (2,)]
        out=a.out/r['key'].replace('/','__');out.mkdir(exist_ok=True)
        start=time.monotonic();points,report=propose(fold,values,costs,known,a.budget,a.relative_weight)
        report['seconds']=time.monotonic()-start;fold['vertices_coords']=points.tolist()
        (out/'placed.fold').write_text(json.dumps(fold));(out/'proposal.json').write_text(json.dumps(report))
        rec=dict(r);rec['prediction']=str(out/'placed.fold');rec['seconds']+=report['seconds']
        rec['solved_25s']=rec['solved_25s'] and rec['seconds']<=25;records.append(rec)
        print(json.dumps({'key':r['key'],**report}),flush=True)
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'options':vars(a),
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},default=str,indent=2))


if __name__=='__main__':main()
