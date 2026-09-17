#!/usr/bin/env python3
"""Evaluation-only check: is the frozen reference admissible without moving it?

Results diagnose a possible conflict between exact-reference recovery and the
product's local acceptance rules. No result supplies geometry to inference.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--keys',type=Path,required=True);p.add_argument('--binary',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--inventory',type=Path,default=Path('artifacts/cp-recognition/frozen/inventory.json'))
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    inventory={r['key']:r for r in read(a.inventory)['cases']};results=[]
    keys=read(a.keys)
    for key in keys:
        row=inventory[key];truth=Path(row['source']).parent/'truth.fold'
        assert sha(truth)==row['truth_sha256']
        out=a.out/key.replace('/','__');out.mkdir(exist_ok=True)
        if not (out/'result.json').exists():
            with (out/'oracle.log').open('w') as log:
                completed=subprocess.run([str(a.binary.resolve()),str(truth),str(out),'{"timeout_seconds":25}',
                                'validate-fixed'],stdout=log,stderr=log,timeout=35)
            if completed.returncode:
                record={'key':key,'status':'reference_import_error','accepted':False,
                        'error':(out/'oracle.log').read_text()[:2000]}
                results.append(record);print(json.dumps(record),flush=True)
                continue
        r=read(out/'result.json');input=read(out/'input.json');s=r['solved']
        max_movement=max((((v['point']['x']-p['x'])**2+(v['point']['y']-p['y'])**2)**.5
                          for v,p in zip(input['vertices'],s['vertices_exact'],strict=True)),default=0)
        record={'key':key,'status':s['status'],'accepted':s['movement_report'].get('accepted',False),
                'max_movement':max_movement,'seconds':r['seconds'],'rejections':s['movement_report'].get('rejection_reasons'),
                'after':{k:v for k,v in s['theorem_residual_report'].get('after',{}).items() if k not in ['vertices','vertex_diagnostics']}}
        results.append(record);print(json.dumps(record),flush=True)
    (a.out/'runs.json').write_text(json.dumps(results,indent=2))
    (a.out/'protocol.json').write_text(json.dumps({'script_sha256':sha(Path(__file__)),
       'binary_sha256':sha(a.binary),'inventory_sha256':sha(a.inventory),'keys':keys,
       'purpose':'Evaluation-only reference admissibility; never inference input.'},indent=2))


if __name__=='__main__':main()
