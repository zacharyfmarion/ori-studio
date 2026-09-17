#!/usr/bin/env python3
"""Bounded beam search over independent construction anchors; no truth input."""
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
from joint_construction_probe import catalog, simplicity
from linear_recovery_probe import constraints


def propose(fold, values, costs, known, budget, width):
    points,matrix,rhs,_,_=constraints(fold);original=points.flatten();deadline=time.monotonic()+budget
    eliminated=eliminate(matrix,rhs,deadline)
    if eliminated is None:return [points],{'reason':'basis_budget'}
    basis,order=eliminated
    for c,value in enumerate(original):
        rational=float(Fraction(float(value)).limit_denominator(256));k=int(np.searchsorted(known,value))
        nearest=min(known[max(0,k-1):k+1],key=lambda v:abs(value-v))
        if min(abs(value-rational),abs(value-nearest))<1e-9:anchor(basis,order,c,float(value))
    nullity=original.size-len(order);evaluations=0;depth=0;exhausted=False
    def objective(x):return simplicity(x,values,costs)+8.*np.sum(((x-original)/.002)**2)
    current=substitute(basis,order,original)
    beam=[(objective(current),basis,order,current)]
    for depth in range(min(nullity,12)):
        if time.monotonic()>deadline:exhausted=True;break
        options=[];seen=set()
        for parent_cost,basis,order,current in beam:
            for c,observed in enumerate(original):
                if time.monotonic()>deadline:exhausted=True;break
                if not anchor(basis,order,c,float(current[c]+1)):continue
                direction=substitute(basis,order,original)-current;del basis[order.pop()]
                lo,hi=np.searchsorted(values,[observed-.002,observed+.002])
                for target in values[lo:hi]:
                    proposal=current+direction*(target-current[c])
                    if np.max(np.linalg.norm((proposal-original).reshape(points.shape),axis=1))>.008:continue
                    fingerprint=np.round(proposal,10).tobytes()
                    if fingerprint in seen:continue
                    seen.add(fingerprint);evaluations+=1;cost=objective(proposal)
                    if cost>=parent_cost-1e-6:continue
                    options.append((cost,basis,order,c,float(target),proposal))
            if exhausted:break
        if exhausted or not options:break
        beam=[]
        for cost,basis,order,c,target,proposal in sorted(options,key=lambda r:r[0])[:width]:
            selected_basis,selected_order=basis.copy(),order.copy()
            anchor(selected_basis,selected_order,c,target)
            beam.append((cost,selected_basis,selected_order,proposal))
    candidates=[];residuals=[]
    for _,basis,order,_ in beam:
        x=substitute(basis,order,original);residual=float(np.max(abs(matrix@x-rhs)))
        movement=float(np.max(np.linalg.norm((x-original).reshape(points.shape),axis=1)))
        if residual<1e-10 and movement<.008:candidates.append(x.reshape(points.shape));residuals.append(residual)
    return candidates or [points],{'nullity':nullity,'depth':depth,'evaluations':evaluations,
        'alternatives':len(candidates),'timed_out':exhausted,'max_residuals':residuals}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--budget',type=float,default=4.);p.add_argument('--width',type=int,default=4)
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
        started=time.monotonic();candidates,report=propose(fold,values,costs,known,a.budget,a.width)
        report['seconds']=time.monotonic()-started;paths=[]
        for i,points in enumerate(candidates):
            fold['vertices_coords']=points.tolist();path=out/f'candidate-{i}.fold';path.write_text(json.dumps(fold));paths.append(str(path))
        (out/'proposal.json').write_text(json.dumps(report))
        rec=dict(r);rec['prediction']=paths[0];rec['alternatives']=paths;rec['seconds']+=report['seconds']
        rec['solved_25s']=rec['solved_25s'] and rec['seconds']<=25;records.append(rec)
        print(json.dumps({'key':r['key'],**report}),flush=True)
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'options':vars(a),
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},default=str,indent=2))


if __name__=='__main__':main()
