#!/usr/bin/env python3
"""Replay a frozen, image-derived starting-point study with another solver.

No reference input. Reuse fitting evidence but account for its recorded cost.
"""
import argparse,json,hashlib,subprocess
from pathlib import Path


def read(p):return json.loads(Path(p).read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--binary',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
 rows=read(a.source/'runs.json');options={'recognition_fallback':True,'polish':True,'construction_recovery':'constructions'}
 protocol={'source':str(a.source),'source_sha256':sha(a.source/'runs.json'),'binary_sha256':sha(a.binary),'script_sha256':sha(__file__),'options':options};f=a.out/'protocol.json'
 if f.exists()and read(f)!=protocol:raise ValueError('Protocol changed')
 f.write_text(json.dumps(protocol,indent=2));result=[]
 for i,row in enumerate(rows):
  name=row['key'].replace('/','__');src=a.source/name;out=a.out/name;out.mkdir(exist_ok=True)
  if (out/'complete.json').exists():result.append(read(out/'complete.json'));continue
  for file in ['fits.json','fit-report.json','fitted-input.json','original-input.json']:(out/file).write_bytes((src/file).read_bytes())
  r={k:row[k]for k in ['key','split','complexity','detected_topology_exact','detected_assignments_exact','fit_seconds']};opts={**options,'timeout_seconds':max(.1,25-r['fit_seconds'])}
  try:
   with (out/'solve.log').open('w')as log:subprocess.run([str(a.binary.resolve()),str(out/'fitted-input.json'),str(out),json.dumps(opts)],stdout=log,stderr=log,check=True,timeout=32)
   data=read(out/'result.json');s=data['solved'];r.update(seconds=r['fit_seconds']+data['seconds'],status=s['status'],accepted=s['movement_report'].get('accepted',False),prediction=str(out/'solved.fold'));r['solved_25s']=r['seconds']<=25 and r['status']=='solved'and r['accepted']
  except (subprocess.TimeoutExpired,subprocess.CalledProcessError)as error:r.update(error=type(error).__name__,solved_25s=False)
  (out/'complete.json').write_text(json.dumps(r,indent=2));result.append(r);print(json.dumps({'done':i+1,'total':len(rows),**r}),flush=True)
 (a.out/'runs.json').write_text(json.dumps(result,indent=2))
if __name__=='__main__':main()
