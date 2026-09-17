#!/usr/bin/env python3
"""Source-only fitting pilot. References are scored by a separate command.

This exploratory runner changes the solver observation input. Product adoption
also needs validation against the original request; successes here are candidate
recoveries, not release claims. Fitting time is included in the solve budget.
"""
import argparse, copy, hashlib, json, subprocess, time
from pathlib import Path
import cv2
import numpy as np
from fit_image_lines import fit
from score_image_alignment import quad_points, refine_border


def read(path): return json.loads(Path(path).read_text())
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--max-vertices',type=int,default=150)
    parser.add_argument('--keys',type=Path)
    parser.add_argument('--seed',choices=['recognition','solved'],default='recognition')
    parser.add_argument('--project-directions',action='store_true')
    args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    baseline=Path('artifacts/cp-solver/S095-ink-recovery-baseline')
    binary=(baseline/'solver_research').resolve()
    cases=read(baseline/'cases.json');allowed=set(read(args.keys))if args.keys else None
    cases=[c for c in cases if c['vertices']<=args.max_vertices and (allowed is None or c['key']in allowed)]
    inventory={r['key']:r for r in read('artifacts/cp-recognition/frozen/inventory.json')['cases']}
    options={'timeout_seconds':25,'recognition_fallback':True,'polish':True,'construction_recovery':'constructions'}
    protocol={'script_sha256':sha(__file__),'fit_script_sha256':sha(Path(__file__).with_name('fit_image_lines.py')),'binary_sha256':sha(binary),'keys':[r['key']for r in cases],'options':options,'seed':args.seed,'project_directions':args.project_directions}
    path=args.out/'protocol.json'
    if path.exists()and read(path)!=protocol:raise ValueError('Protocol changed')
    path.write_text(json.dumps(protocol,indent=2));rows=[]
    for i,c in enumerate(cases):
        key=c['key'];name=key.replace('/','__');out=args.out/name;out.mkdir(exist_ok=True)
        if (out/'complete.json').exists():rows.append(read(out/'complete.json'));continue
        entry=inventory[key];source=Path(entry['source']);assert sha(source)==entry['source_sha256']
        cached=Path('artifacts/cp-recognition')/('E013-development'if entry['split']=='development'else'E017-holdout')/name
        crop=sorted(cached.glob('*/rectification.json'))[0]
        original=read(c['input']);raw=copy.deepcopy(original)
        if args.seed=='solved':
            seed=read(Path('artifacts/cp-solver/S093-browser-validation/browser')/name/'solved.fold')['vertices_coords']
            for vertex,point in zip(raw['vertices'],seed):
                if vertex['movement_policy']!='locked':vertex['point']={'x':point[0],'y':point[1]}
        start=time.monotonic();rgb=cv2.cvtColor(cv2.imread(str(source)),cv2.COLOR_BGR2RGB).astype(float)/255
        quad,border=refine_border(rgb,quad_points(read(crop)))
        points,fits=fit(raw,rgb,quad)
        projection_report=None
        if args.project_directions:
            from project_image_lines import project
            seed=read(Path('artifacts/cp-solver/S093-browser-validation/browser')/name/'solved.fold')['vertices_coords']
            points,projection_report=project(original,seed,fits)
        # Preserve explicit pins and boundary constraints when forming proposals.
        before=np.array([[v['point']['x'],v['point']['y']]for v in raw['vertices']])
        for vertex,point in zip(raw['vertices'],points):vertex['point']={'x':float(point[0]),'y':float(point[1])}
        for span in raw['selected_spans']:
            va,vb=points[span['vertices']];direction=vb-va;direction/=max(np.linalg.norm(direction),1e-15)
            normal=np.array([direction[1],-direction[0]]);rho=float(normal@va)
            if rho<0:normal=-normal;rho=-rho
            span['carrier']={'direction':{'x':float(direction[0]),'y':float(direction[1])},'normal':{'x':float(normal[0]),'y':float(normal[1])},'rho':rho}
            span['t_interval']=sorted([float(direction@va),float(direction@vb)])
        fit_seconds=time.monotonic()-start
        (out/'original-input.json').write_text(json.dumps(original));(out/'fitted-input.json').write_text(json.dumps(raw))
        (out/'fits.json').write_text(json.dumps(fits));(out/'fit-report.json').write_text(json.dumps({'seconds':fit_seconds,'quad':quad.tolist(),'border':border,'max_movement':float(np.linalg.norm(points-before,axis=1).max()),'fitted_edges':len(fits),'projection':projection_report},indent=2))
        r={k:entry[k]for k in ['key','split','complexity']};r.update(detected_topology_exact=True,detected_assignments_exact=True,fit_seconds=fit_seconds)
        run_options={**options,'timeout_seconds':max(.1,25-fit_seconds)}
        try:
            with (out/'solve.log').open('w')as log:
                subprocess.run([str(binary),str(out/'fitted-input.json'),str(out),json.dumps(run_options)],check=True,stdout=log,stderr=log,timeout=32)
            result=read(out/'result.json');solved=result['solved']
            r.update(seconds=fit_seconds+result['seconds'],status=solved['status'],accepted=solved['movement_report'].get('accepted',False),prediction=str(out/'solved.fold'))
            r['solved_25s']=r['seconds']<=25 and r['status']=='solved'and r['accepted']
        except (subprocess.TimeoutExpired,subprocess.CalledProcessError)as error:r.update(error=type(error).__name__,solved_25s=False)
        (out/'complete.json').write_text(json.dumps(r,indent=2));rows.append(r)
        print(json.dumps({'done':i+1,'total':len(cases),**r}),flush=True)
    (args.out/'runs.json').write_text(json.dumps(rows,indent=2))

if __name__=='__main__':main()
