#!/usr/bin/env python3
"""S001 research: minimum-norm Newton projection in vertex coordinates.

No real truth, fitting, learned parameters or model. The existing Rust solver
checks a locked placement afterwards; this proposal alone claims no validity.
"""
import argparse
import copy
import json
from pathlib import Path
import time

import numpy as np
from scipy.sparse import coo_matrix, diags
from scipy.sparse.linalg import lsmr


def crimp_ties(angles, colors):
    """Propose equalities at an otherwise illegal crimp; Rust remains the judge."""
    n=len(angles)
    sectors=(np.roll(angles,-1)-angles)%(2*np.pi)
    coeff=np.roll(np.eye(n),-1,axis=0)-np.eye(n)
    constant=sectors-coeff@angles
    colors=list(colors)
    ties=[]
    while len(colors)>2:
        values=coeff@angles+constant
        opposite=[i for i in range(len(colors)) if colors[i]!=colors[(i+1)%len(colors)]]
        if not opposite:break
        selected=min(opposite,key=lambda i:values[i])
        smallest=int(np.argmin(values))
        if values[selected]>values[smallest]+1e-10:
            ties.append((coeff[selected]-coeff[smallest],constant[selected]-constant[smallest]))
        # Rotate the selected pair to 0,1; new final sector merges the wrap,
        # the crimp, and the following sector. Original-angle affine forms stay.
        order=np.roll(np.arange(len(colors)),-selected)
        coeff=coeff[order];constant=constant[order];colors=[colors[i] for i in order]
        coeff=np.concatenate([coeff[2:-1],(coeff[-1]-coeff[0]+coeff[1])[None]])
        constant=np.concatenate([constant[2:-1],(constant[-1]-constant[0]+constant[1])[None]])
        colors=colors[2:]
    return ties


def project(value, degrees=0, tolerance=1.5, iterations=20, ties=False, carriers=True):
    start = time.monotonic()
    value = copy.deepcopy(value)
    points = np.array([[v['point']['x'], v['point']['y']] for v in value['vertices']])
    original = points.copy()
    edges = np.array([s['vertices'] for s in value['selected_spans']])
    labels = [s['assignment_evidence']['observed_label'] for s in value['selected_spans']]
    movable = np.ones(points.shape, dtype=bool)
    adjacent = [[] for _ in points]
    boundary = set(value['boundary']['corners'])
    for (a, b), label in zip(edges, labels):
        if label in ['B', 'boundary']:
            boundary.update([a,b])
        elif label not in ['F', 'flat', 'auxiliary']:
            adjacent[a].append(b); adjacent[b].append(a)
    for i,v in enumerate(value['vertices']):
        if v['id'] in value['boundary']['corners'] or v['movement_policy'] == 'locked':
            movable[i] = False
        elif v.get('boundary_side') in ['top','bottom']:
            movable[i,1] = False
        elif v.get('boundary_side') in ['left','right']:
            movable[i,0] = False
    columns = np.full(points.shape, -1)
    columns[movable] = np.arange(movable.sum())
    fans = []
    edge_labels={tuple(sorted(edge)):label for edge,label in zip(edges,labels)}
    for i, neighbors in enumerate(adjacent):
        if i in boundary or len(neighbors)<2 or len(neighbors)%2: continue
        d=points[neighbors]-points[i]
        neighbors = np.array(neighbors)[np.argsort(np.arctan2(d[:,1],d[:,0]))]
        fans.append((i,neighbors))
    carrier_constraints=[]
    if carriers:
        groups={}
        for s,edge in zip(value['selected_spans'],edges):
            ids=s['source_carrier_ids']
            if ids:groups.setdefault(ids[0],[]).append(edge)
        for group in groups.values():
            if len(group)<2:continue
            a,b=max(group,key=lambda e:np.linalg.norm(points[e[1]]-points[e[0]]))
            for v in sorted(set(np.array(group).ravel())-{a,b}):
                carrier_constraints.append((a,b,v))
    active_ties={}
    targets = []
    if degrees:
        step = np.deg2rad(degrees)
        for k,((a,b),label) in enumerate(zip(edges,labels)):
            if label in ['B','boundary','F','flat','auxiliary']:continue
            d=points[b]-points[a];angle=np.arctan2(d[1],d[0]);target=round(angle/step)*step
            if abs(angle-target)<=np.deg2rad(tolerance):targets.append((a,b,target))
    history=[]
    for iteration in range(iterations):
        ri,ci,values,residuals=[],[],[],[]
        def angle_row(a,b,scale):
            d=points[b]-points[a];r2=d@d
            derivative=np.array([-d[1],d[0]])*scale/max(r2,1e-20)
            for v,sign in [(a,-1),(b,1)]:
                for axis in [0,1]:
                    c=columns[v,axis]
                    if c>=0:
                        ri.append(len(residuals));ci.append(c);values.append(sign*derivative[axis])
        for center,neighbors in fans:
            d=points[neighbors]-points[center]
            angles=np.arctan2(d[:,1],d[:,0])
            sectors=(np.roll(angles,-1)-angles)%(2*np.pi)
            residual=float(sum(sectors[::2])-np.pi)
            for k,b in enumerate(neighbors):angle_row(center,b,(-1 if k%2==0 else 1))
            residuals.append(residual)
        for a,b,target in targets:
            d=points[b]-points[a]
            residual=(np.arctan2(d[1],d[0])-target+np.pi/2)%np.pi-np.pi/2
            angle_row(a,b,1)
            residuals.append(residual)
        for a,b,v in carrier_constraints:
            d=points[b]-points[a];q=points[v]-points[a]
            residual=(np.arctan2(q[1],q[0])-np.arctan2(d[1],d[0])+np.pi/2)%np.pi-np.pi/2
            angle_row(a,v,1);angle_row(a,b,-1);residuals.append(residual)
        for center,neighbors in fans:
            if not ties:break
            d=points[neighbors]-points[center]
            angles=np.arctan2(d[:,1],d[:,0])
            colors=[edge_labels[tuple(sorted([center,n]))] for n in neighbors]
            if any(c not in ['mountain','valley'] for c in colors):continue
            if iteration>=2:
                for coeff,constant in crimp_ties(angles,colors):
                    key=(center,tuple(coeff),round(float(constant),9))
                    active_ties[key]=(center,neighbors,coeff,constant)
        for center,neighbors,coeff,constant in active_ties.values():
            d=points[neighbors]-points[center];angles=np.arctan2(d[:,1],d[:,0])
            residual=float(coeff@angles+constant)
            # Wrap crossings do not change the affine angle relation.
            residual=(residual+np.pi)%(2*np.pi)-np.pi
            for k,b in enumerate(neighbors):
                if coeff[k]:angle_row(center,b,coeff[k])
            residuals.append(residual)
        residuals=np.array(residuals)
        maximum=float(abs(residuals).max(initial=0))
        if maximum<1e-11 and (not ties or iteration>=2):break
        j=coo_matrix((values,(ri,ci)),shape=(len(residuals),int(movable.sum()))).tocsr()
        scale=1/np.maximum(np.sqrt(np.array(j.multiply(j).sum(axis=1)).ravel()),1e-10)
        answer=lsmr(diags(scale)@j,-residuals*scale,atol=1e-12,btol=1e-12,maxiter=3000)
        correction=answer[0]
        limit=.005
        factor=min(1,limit/max(abs(correction).max(initial=0),1e-20))
        points[movable]+=factor*correction
        history.append({'max_radians':maximum,'lsmr_iterations':answer[2], 'step_scale':factor})
        if time.monotonic()-start>20:break
    for v,p in zip(value['vertices'],points):
        v['point']={'x':float(p[0]),'y':float(p[1])}
        v['movement_policy']='locked'
    for s,(a,b) in zip(value['selected_spans'],edges):
        d=points[b]-points[a];length=np.linalg.norm(d);d/=max(length,1e-20)
        n=np.array([-d[1],d[0]])
        s['carrier']={'direction':dict(zip(['x','y'],d)),'normal':dict(zip(['x','y'],n)),'rho':float(n@points[a])}
        s['t_interval']=[float(points[a]@d),float(points[b]@d)]
    report={'seconds':time.monotonic()-start,'max_movement':float(np.linalg.norm(points-original,axis=1).max()),
            'degrees':degrees,'tolerance':tolerance,'fans':len(fans),'directions':len(targets),'history':history,
            'carrier_constraints':len(carrier_constraints),'active_ties':len(active_ties),
            'max_radians':maximum}
    return value,report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('input',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--degrees',type=float,default=0)
    p.add_argument('--tolerance',type=float,default=1.5)
    p.add_argument('--ties',action='store_true')
    a=p.parse_args()
    value,report=project(json.loads(a.input.read_text()),a.degrees,a.tolerance,ties=a.ties)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(value))
    a.output.with_suffix('.projection.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))


if __name__=='__main__':main()
