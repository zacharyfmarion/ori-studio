#!/usr/bin/env python3
"""Evaluate fixed candidate/reference geometry against original source ink.

References enter scoring only. Border registration is estimated from the image
and cached automatic crop, identically for both answers. Scores are diagnostics,
not exact recovery claims; missing edges require a separate recall measure.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates


def read(path):
    return json.loads(path.read_text())


def sample(field, points):
    return map_coordinates(field, [points[:, 1], points[:, 0]], order=1, mode='nearest')


def quad_points(report):
    q = report.get('report', report)['source_quad']
    return np.array([[q[k]['x'], q[k]['y']] for k in
                     ['top_left', 'top_right', 'bottom_right', 'bottom_left']], dtype=float)


def refine_border(rgb, quad):
    # Neutral dark ink selects the paper outline, excluding saturated folds.
    neutral = np.clip(1-rgb.max(axis=2)-(rgb.max(axis=2)-rgb.min(axis=2)), 0, 1)
    neutral = gaussian_filter(neutral, .4)
    lines = []
    offsets = np.linspace(-3., 3., 121)
    reports = []
    for a, b in zip(quad, np.roll(quad, -1, axis=0)):
        tangent = (b-a)/np.linalg.norm(b-a)
        normal = np.array([-tangent[1], tangent[0]])
        along = a+(b-a)*np.linspace(.03, .97, 400)[:, None]
        profile = np.array([sample(neutral, along+offset*normal).mean() for offset in offsets])
        # Weight the full stroke cross-section; a thick stroke has no unique
        # darkest pixel, whereas its weighted center remains well-defined.
        weights = np.maximum(profile-np.quantile(profile, .2), 0.)
        shift = float(weights@offsets/weights.sum()) if weights.sum() > 1e-6 else 0.
        lines.append((normal, float(normal@(a+shift*normal))))
        reports.append({'offset':shift,'contrast':float(profile.max()-profile.min())})
    corners = []
    for i in range(4):
        n1,r1=lines[i-1];n2,r2=lines[i]
        corners.append(np.linalg.solve(np.array([n1,n2]),[r1,r2]))
    return np.array(corners), reports


def fields(rgb):
    r,g,b=np.moveaxis(rgb,2,0)
    evidence={'M':np.clip(r-(g+b)/2,0,1),
              'V':np.clip(b-np.maximum(r,g),0,1),
              'F':np.clip(np.minimum(g,b)-r-1.5*abs(g-b),0,1),
              'U':np.clip(1-np.mean(rgb,axis=2),0,1)}
    return {k:gaussian_filter(v,.6) for k,v in evidence.items()}


def score(fold, maps, quad):
    transform=cv2.getPerspectiveTransform(np.array([[0,0],[1,0],[1,1],[0,1]],np.float32),quad.astype(np.float32))
    points=np.array(fold['vertices_coords'])[:,:2]/1024
    homogeneous=np.column_stack([points,np.ones(len(points))])@transform.T
    points=homogeneous[:,:2]/homogeneous[:,2:]
    total=weight=0.;by_label={}
    for (a,b),label in zip(fold['edges_vertices'],fold['edges_assignment']):
        if label=='B':continue
        length=np.linalg.norm(points[b]-points[a])
        if length<1e-8:continue
        margin=min(.2,2/length)
        t=np.linspace(margin,1-margin,max(3,int(length/2)))
        positions=points[a]+t[:,None]*(points[b]-points[a])
        value=float(sample(maps.get(label,maps['U']),positions).mean())
        total+=length*value;weight+=length
        row=by_label.setdefault(label,{'sum':0.,'length':0.})
        row['sum']+=length*value;row['length']+=length
    return {'mean_ink':total/max(weight,1e-20),'by_label':{k:v['sum']/v['length'] for k,v in by_label.items()}}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--audit',type=Path,required=True)
    p.add_argument('--inventory',type=Path,default=Path('artifacts/cp-recognition/frozen/inventory.json'))
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    inventory={r['key']:r for r in read(a.inventory)['cases']};rows=[]
    for r in read(a.audit/'runs.json'):
        if not r['detected_assignments_exact']:continue
        entry=inventory[r['key']];source=Path(entry['source']);name=r['key'].replace('/','__')
        if hashlib.sha256(source.read_bytes()).hexdigest()!=entry['source_sha256']:raise ValueError('Source changed')
        directory=Path('artifacts/cp-recognition')/('E013-development' if entry['split']=='development' else 'E017-holdout')/name
        crops=sorted(directory.glob('*/rectification.json'))
        if not crops:
            rows.append({'key':r['key'],'error':'no_cached_crop'});continue
        image=cv2.imread(str(source));rgb=cv2.cvtColor(image,cv2.COLOR_BGR2RGB).astype(float)/255
        quad=quad_points(read(crops[0]));refined,border=refine_border(rgb,quad);maps=fields(rgb)
        d=a.audit/'with_aux'/name
        result={'key':r['key'],'exact':r['scores']['with_aux']['1e-09']['recovered_within_25s'],'source_sha256':entry['source_sha256'],'crop':str(crops[0]),'quad':quad.tolist(),'refined_quad':refined.tolist(),'border':border}
        for label,q in [('original',quad),('refined',refined)]:
            pred=score(read(d/'prediction.fold'),maps,q);truth=score(read(d/'truth.fold'),maps,q)
            result[label]={'prediction':pred,'reference':truth,'reference_advantage':truth['mean_ink']-pred['mean_ink']}
        rows.append(result)
        if len(rows)%50==0:print(json.dumps({'done':len(rows)}),flush=True)
    summary={'cases':len(rows),'errors':sum('error'in r for r in rows),'unmatched':{}}
    for label in ['original','refined']:
        selected=[r[label]['reference_advantage'] for r in rows if 'error'not in r and not r['exact']]
        summary['unmatched'][label]={'cases':len(selected),'reference_better':int(sum(v>1e-5 for v in selected)),'candidate_better':int(sum(v< -1e-5 for v in selected)),'near_tie':int(sum(abs(v)<=1e-5 for v in selected)),'median_advantage':float(np.median(selected))}
    (a.out/'cases.json').write_text(json.dumps(rows,indent=2)+'\n');(a.out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    (a.out/'protocol.json').write_text(json.dumps({'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'audit':str(a.audit),'audit_sha256':hashlib.sha256((a.audit/'runs.json').read_bytes()).hexdigest(),'notes':__doc__},indent=2)+'\n')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
