#!/usr/bin/env python3
"""Fit source-only stroke centers around a supplied recognition graph.

No reference geometry. Experimental proposals require independent product
validation against the original input; timing here is not a browser claim.
"""
import argparse, json, math, time
from pathlib import Path
import cv2
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsmr
from score_image_alignment import fields, sample, refine_border


def fit(input_, rgb, quad):
    pts=np.array([[v['point']['x'],v['point']['y']]for v in input_['vertices']])
    transform=cv2.getPerspectiveTransform(np.array([[0,0],[1,0],[1,1],[0,1]],np.float32),quad.astype(np.float32))
    inverse=np.linalg.inv(transform)
    def apply(p,m):
        q=np.column_stack([p,np.ones(len(p))])@m.T
        return q[:,:2]/q[:,2:]
    pixel=apply(pts,transform);maps=fields(rgb);fits=[]
    for edge in input_['selected_spans']:
        if edge['kind']=='border_span':continue
        a,b=edge['vertices'];first,last=pixel[[a,b]];vec=last-first;length=np.linalg.norm(vec)
        if length<6:continue
        tangent=vec/length;normal=np.array([-tangent[1],tangent[0]])
        label=edge['assignment_evidence']['observed_label']
        label={'mountain':'M','valley':'V','flat':'F','auxiliary':'F','unknown':'U'}.get(label,label)
        evidence=maps.get(label,maps['U'])
        along=np.linspace(min(4,length*.25),length-min(4,length*.25),max(5,int(length/2)))
        centers=first+along[:,None]*tangent
        shifts=np.linspace(-3,3,25)
        profiles=sample(evidence,(centers[:,None,:]+shifts[None,:,None]*normal).reshape(-1,2)).reshape(-1,len(shifts))
        # Subtract local background; disregard weak/no ink and profiles whose
        # peak sits at the search boundary (possibly another crease).
        weights=np.maximum(profiles-np.quantile(profiles,.15,axis=1)[:,None],0)
        peak=profiles.argmax(axis=1);mass=weights.sum(axis=1)
        good=(profiles.max(axis=1)>.08)&(mass>1e-6)&(peak>1)&(peak<len(shifts)-2)
        if good.sum()<max(4,len(good)*.6):continue
        offset=(weights[good]@shifts)/mass[good]
        x=(along[good]-length/2);y=offset
        for _ in range(3):
            c=np.polyfit(x,y,1);res=y-np.polyval(c,x);keep=abs(res)<max(.15,2.5*np.median(abs(res)))
            if keep.sum()<4:break
            x=x[keep];y=y[keep]
        if len(x)<4:continue
        c=np.polyfit(x,y,1);res=y-np.polyval(c,x);sigma=float(np.sqrt(np.mean(res**2)))
        if sigma>.4:continue
        endpoints=np.array([first+normal*(c[1]-c[0]*length/2),last+normal*(c[1]+c[0]*length/2)])
        ends=apply(endpoints,inverse);direction=ends[1]-ends[0];direction/=np.linalg.norm(direction);n=np.array([-direction[1],direction[0]])
        angle=float(math.atan2(direction[1],direction[0]));rho=float(n@ends[0]);support=float(good.mean())
        fits.append({'edge':edge['id'],'vertices':[a,b],'normal':n.tolist(),'rho':rho,'length_px':float(length),'sigma_px':sigma,'offset_px':float(c[1]),'angle':angle,'angle_sigma':float(max(.025,sigma)/max(np.sqrt(np.sum(x*x)),1)),'support':support})
    rr=[];cc=[];vv=[];rhs=[];fixed_columns=[]
    def add(entries,value,weight):
        row=len(rhs)
        for col,v in entries:rr.append(row);cc.append(col);vv.append(v*weight)
        rhs.append(value*weight)
    for f in fits:
        weight=np.sqrt(min(f['length_px'],100))
        for v in f['vertices']:add([(2*v,f['normal'][0]),(2*v+1,f['normal'][1])],f['rho'],weight)
    for i,p in enumerate(pts):
        vertex=input_['vertices'][i]
        for axis in range(2):
            fixed=vertex['movement_policy']=='locked' or i in input_['boundary']['corners'] or (vertex.get('boundary_side') in ['top','bottom'] and axis==1)or(vertex.get('boundary_side')in ['left','right']and axis==0)
            if fixed:fixed_columns.append(2*i+axis)
            add([(2*i+axis,1)],p[axis],1.)
    matrix=coo_matrix((vv,(rr,cc)),shape=(len(rhs),pts.size)).tocsr();flat=pts.flatten();free=np.ones(pts.size,dtype=bool);free[fixed_columns]=False
    answer=flat.copy();answer[free]+=lsmr(matrix[:,free],np.array(rhs)-matrix@flat,atol=1e-12,btol=1e-12,maxiter=3000)[0]
    return answer.reshape(pts.shape),fits


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input',type=Path);p.add_argument('image',type=Path);p.add_argument('quad',help='JSON array TL TR BR BL');p.add_argument('out',type=Path);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    raw=json.loads(a.input.read_text());rgb=cv2.cvtColor(cv2.imread(str(a.image)),cv2.COLOR_BGR2RGB).astype(float)/255;quad=np.array(json.loads(a.quad));quad,border=refine_border(rgb,quad)
    start=time.monotonic();pts,fits=fit(raw,rgb,quad);original=np.array([[v['point']['x'],v['point']['y']]for v in raw['vertices']]);moves=np.linalg.norm(pts-original,axis=1)
    for vertex,pt in zip(raw['vertices'],pts):vertex['point']={'x':float(pt[0]),'y':float(pt[1])}
    for s in raw['selected_spans']:
        va,vb=pts[s['vertices']];d=vb-va;length=np.linalg.norm(d);d/=max(length,1e-15);n=np.array([d[1],-d[0]]);rho=float(n@va)
        if rho<0:n=-n;rho=-rho
        s['carrier']={'direction':{'x':float(d[0]),'y':float(d[1])},'normal':{'x':float(n[0]),'y':float(n[1])},'rho':rho};s['t_interval']=sorted([float(d@va),float(d@vb)])
    (a.out/'input.json').write_text(json.dumps(raw));(a.out/'fits.json').write_text(json.dumps(fits,indent=2));report={'seconds':time.monotonic()-start,'fitted_edges':len(fits),'max_movement':float(moves.max()),'p95_movement':float(np.quantile(moves,.95)),'quad':quad.tolist(),'border':border}
    (a.out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
if __name__=='__main__':main()
