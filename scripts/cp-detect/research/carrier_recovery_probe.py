#!/usr/bin/env python3
"""Recover arbitrary carrier intersections from already-recognized endpoints.

No reference input. A straight carrier with two independently recognizable
endpoint coordinates supplies a line equation even at a non-family angle.
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


def read(p):return json.loads(p.read_text())


def propose(fold,values):
    points,matrix,rhs,_,_=constraints(fold);edges=fold['edges_vertices'];parent=list(range(len(edges)))
    incident=[[] for _ in points]
    for i,(a,b) in enumerate(edges):incident[a].append((i,b));incident[b].append((i,a))
    def root(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return i
    for v,rays in enumerate(incident):
        for i,(a,x) in enumerate(rays):
            left=points[x]-points[v];ln=np.linalg.norm(left)
            if ln<1e-12:continue
            for b,y in rays[i+1:]:
                right=points[y]-points[v];rn=np.linalg.norm(right)
                if rn<1e-12:continue
                if np.dot(left,right)<0 and abs(left[0]*right[1]-left[1]*right[0])<1e-6*ln*rn:
                    ra,rb=root(a),root(b)
                    if ra!=rb:parent[max(ra,rb)]=min(ra,rb)
    groups={}
    for i,e in enumerate(edges):groups.setdefault(root(i),set()).update(e)
    exact=points.copy();known=np.zeros(len(points),dtype=bool)
    for i,p in enumerate(points):
        errors=[]
        for d,value in enumerate(p):
            k=int(np.searchsorted(values,value));nearest=min(values[max(0,k-1):k+1],key=lambda v:abs(v-value))
            rational=float(Fraction(float(value)).limit_denominator(256));target=min([nearest,rational],key=lambda v:abs(v-value))
            errors.append(abs(target-value));exact[i,d]=target
        known[i]=max(errors)<1e-9
    rr=[];cc=[];vv=[];target=[];carriers=0
    for vertices in groups.values():
        seeds=sorted(v for v in vertices if known[v])
        if len(seeds)<2:continue
        a,b=max(((a,b) for i,a in enumerate(seeds) for b in seeds[i+1:]),key=lambda ab:np.linalg.norm(exact[ab[1]]-exact[ab[0]]))
        direction=exact[b]-exact[a];length=np.linalg.norm(direction)
        if length<1e-5:continue
        normal=np.array([-direction[1],direction[0]])/length;rho=np.dot(normal,exact[a])
        if max(abs(np.dot(normal,points[v])-rho) for v in vertices)>1e-5:continue
        carriers+=1
        for v in vertices:
            for d in range(2):rr.append(len(target));cc.append(2*v+d);vv.append(normal[d])
            target.append(rho)
    if not target:return points,{'reason':'no_seed_carriers'}
    extra=coo_matrix((vv,(rr,cc)),shape=(len(target),points.size)).tocsr()
    matrix=vstack([matrix,extra],format='csr');rhs=np.r_[rhs,target]
    x=points.flatten().copy()
    for _ in range(3):
        result=lsmr(matrix,rhs-matrix@x,atol=1e-14,btol=1e-14,conlim=1e12,maxiter=10000);x+=result[0]
        if np.max(np.abs(rhs-matrix@x))<1e-15:break
    residual=float(np.max(np.abs(rhs-matrix@x)));movement=float(np.max(np.linalg.norm(x.reshape(points.shape)-points,axis=1)))
    adopted=residual<1e-10 and movement<5e-4
    return (x.reshape(points.shape) if adopted else points),{'carriers':carriers,'known_points':int(known.sum()),
        'max_residual':residual,'max_movement':movement,'adopted_linear':adopted}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);records=[];values=dictionary(64)
    for r in read(a.study/'runs.json'):
        fold=read(Path(r['prediction']));out=a.out/r['key'].replace('/','__');out.mkdir(exist_ok=True)
        start=time.monotonic();points,report=propose(fold,values);report['seconds']=time.monotonic()-start
        fold['vertices_coords']=points.tolist();(out/'placed.fold').write_text(json.dumps(fold));(out/'proposal.json').write_text(json.dumps(report))
        rec=dict(r);rec['prediction']=str(out/'placed.fold');rec['seconds']+=report['seconds']
        rec['solved_25s']=rec['solved_25s'] and rec['seconds']<=25;records.append(rec)
        print(json.dumps({'key':r['key'],**report}),flush=True)
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'options':vars(a),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},default=str,indent=2))


if __name__=='__main__':main()
