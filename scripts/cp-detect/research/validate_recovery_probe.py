#!/usr/bin/env python3
"""Check research proposals with the unchanged product solver, coordinates fixed.

No truth is read. This is an offline diagnostic, not a shipping integration:
final integration must rejudge movement/pins against the original request and
share the entire solve deadline. Rejected proposals retain the prior output.
"""
import argparse
import copy
import json
import math
from pathlib import Path
import subprocess
import time


def read(p):
    return json.loads(p.read_text())


def validate(fold, raw, out, binary):
    out.mkdir(exist_ok=True)
    request=copy.deepcopy(raw)
    ids=fold['cp_detector']['vertex_original_ids']
    for v,coord in zip(ids,fold['vertices_coords'],strict=True):
        request['vertices'][v]['point']={'x':coord[0],'y':coord[1]}
    for v in request['vertices']:
        v['movement_policy']='locked'
    for s in request['selected_spans']:
        va,vb=[request['vertices'][v]['point'] for v in s['vertices']]
        dx,dy=vb['x']-va['x'],vb['y']-va['y'];length=math.hypot(dx,dy)
        if length:
            dx/=length;dy/=length
        s['carrier']={'direction':{'x':dx,'y':dy},'normal':{'x':-dy,'y':dx},'rho':-dy*va['x']+dx*va['y']}
        s['t_interval']=sorted([dx*v['x']+dy*v['y'] for v in [va,vb]])
    inp=out/'input.json';inp.write_text(json.dumps(request));start=time.monotonic()
    with (out/'judge.log').open('w') as log:
        subprocess.run([str(binary.resolve()),str(inp),str(out/'judge'),
            '{"recognition_fallback":false,"polish":false,"timeout_seconds":25}'],stdout=log,stderr=log,check=True,timeout=35)
    result=read(out/'judge/result.json');solved=result['solved']
    accepted=bool(solved['status']=='solved' and solved['movement_report'].get('accepted'))
    return {'seconds':time.monotonic()-start,'accepted':accepted,'status':solved['status'],
            'rejections':solved['movement_report'].get('rejection_reasons'),
            'max_kawasaki':solved['theorem_residual_report'].get('after',{}).get('max_kawasaki_residual_degrees')}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--proposals',type=Path,required=True)
    p.add_argument('--fallback',type=Path,required=True)
    p.add_argument('--binary',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    fallbacks={r['key']:r for r in read(a.fallback/'runs.json')}
    records=[]
    for r in read(a.proposals/'runs.json'):
        key=r['key'];name=key.replace('/','__');out=a.out/name;out.mkdir(exist_ok=True)
        before=read(Path(fallbacks[key]['prediction']))
        chosen=dict(r);accepted=False
        history=[]
        paths=r.get('alternatives',[r['prediction']])
        for i,path in enumerate(paths):
            fold=read(Path(path))
            if before['vertices_coords']==fold['vertices_coords']:
                report={'unchanged':True,'accepted':True,'seconds':0.}
            else:
                group='E027-development' if r['split']=='development' else 'E027-holdout'
                raw=read(Path('artifacts/cp-recognition')/group/name/'input.json')
                destination=out/f'alternative-{i}' if len(paths)>1 else out
                report=validate(fold,raw,destination,a.binary)
            history.append(report);accepted=report['accepted']
            if accepted:break
        report=dict(report)
        if len(paths)>1:
            report['alternatives_checked']=len(history);report['checks']=history
            report['seconds']=sum(r['seconds'] for r in history)
        if not accepted:
            fold=before;chosen=dict(fallbacks[key])
        (out/'placed.fold').write_text(json.dumps(fold));(out/'validation.json').write_text(json.dumps(report,indent=2))
        chosen['prediction']=str(out/'placed.fold');records.append(chosen)
        chosen.pop('alternatives',None)
        print(json.dumps({'key':key,**report}),flush=True)
    (a.out/'runs.json').write_text(json.dumps(records,indent=2))


if __name__=='__main__':
    main()
