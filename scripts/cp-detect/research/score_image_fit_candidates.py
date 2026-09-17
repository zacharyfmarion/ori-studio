#!/usr/bin/env python3
"""Compare generated answers by source ink alone; never open reference geometry."""
import argparse,copy,json,time
from pathlib import Path
import cv2
import numpy as np
from score_image_alignment import fields,score


def read(p):return json.loads(Path(p).read_text())
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('study',type=Path);a=p.parse_args()
 inventory={r['key']:r for r in read('artifacts/cp-recognition/frozen/inventory.json')['cases']};rows=[]
 for r in read(a.study/'runs.json'):
  name=r['key'].replace('/','__');out=a.study/name
  if (out/'image-scores.json').exists():rows.append(read(out/'image-scores.json'));continue
  if not r.get('prediction'):continue
  start=time.monotonic();rgb=cv2.cvtColor(cv2.imread(inventory[r['key']]['source']),cv2.COLOR_BGR2RGB).astype(float)/255;maps=fields(rgb);quad=np.array(read(out/'fit-report.json')['quad']);fits=read(out/'fits.json')
  row={'key':r['key']}
  for label,path in [('baseline',Path('artifacts/cp-solver/S093-browser-validation/browser')/name/'solved.fold'),('candidate',r['prediction'])]:
   f=read(path);points=np.array(f['vertices_coords']);f['vertices_coords']=(points*1024).tolist();s=score(f,maps,quad)
   report=read(Path(path).parent/'result.json')
   raw_points=report['solved']['vertices_exact']
   points=np.array([[v['x'],v['y']] for v in raw_points])
   total=mass=0.
   for fit in fits:
    errors=[float(np.array(fit['normal'])@points[v]-fit['rho'])for v in fit['vertices']];weight=min(fit['length_px'],100);total+=weight*sum(e*e for e in errors);mass+=2*weight
   s['fit_mse_px']=total/max(mass,1e-15)*np.mean(np.linalg.norm(np.roll(quad,-1,axis=0)-quad,axis=1))**2
   row[label]=s
  row['ink_advantage']=row['candidate']['mean_ink']-row['baseline']['mean_ink'];row['fit_mse_improvement']=row['baseline']['fit_mse_px']-row['candidate']['fit_mse_px'];row['seconds']=time.monotonic()-start
  (out/'image-scores.json').write_text(json.dumps(row,indent=2));rows.append(row)
 (a.study/'image-scores.json').write_text(json.dumps(rows,indent=2))
 print(json.dumps({'cases':len(rows),'ink_favors_candidate':int(sum(r['ink_advantage']>1e-4 for r in rows)),'fit_favors_candidate':int(sum(r['fit_mse_improvement']>1e-3 for r in rows))}))
if __name__=='__main__':main()
