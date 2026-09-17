#!/usr/bin/env python3
"""Recover remaining grid coordinates when the solved graph establishes a grid.

Grid evidence is numerical agreement of >=95% of coordinates before snapping,
not merely proximity to a sufficiently fine grid. No truth is read.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from linear_recovery_probe import constraints


def read(p):return json.loads(p.read_text())


def propose(fold):
    points,matrix,rhs,_,_=constraints(fold)
    for cells in range(2,513):
        snapped=np.round(points*cells)/cells
        known=np.abs(points-snapped)<1e-9
        if np.mean(known)<.95 or len(set(np.round(points[known],9)))<8:continue
        close=np.abs(points-snapped)<=5e-4
        candidate=np.where(close,snapped,points)
        movement=float(np.max(np.linalg.norm(candidate-points,axis=1)))
        if movement<1e-12:continue
        residual=float(np.max(np.abs(matrix@candidate.flatten()-rhs)))
        if residual>1e-10:continue
        return candidate,{'cells':cells,'known_fraction':float(np.mean(known)),
                          'max_movement':movement,'residual':residual,'adopted_linear':True}
    return points,{'reason':'no_supported_grid_change'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);records=[]
    for r in read(a.study/'runs.json'):
        fold=read(Path(r['prediction']));out=a.out/r['key'].replace('/','__');out.mkdir(exist_ok=True)
        start=time.monotonic();points,report=propose(fold);report['seconds']=time.monotonic()-start
        fold['vertices_coords']=points.tolist();(out/'placed.fold').write_text(json.dumps(fold));(out/'proposal.json').write_text(json.dumps(report))
        rec=dict(r);rec['prediction']=str(out/'placed.fold');rec['seconds']+=report['seconds']
        rec['solved_25s']=rec['solved_25s'] and rec['seconds']<=25;records.append(rec)
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'options':vars(a),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},default=str,indent=2))


if __name__=='__main__':main()
