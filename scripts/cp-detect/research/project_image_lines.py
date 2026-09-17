"""Experimental line-fit projection with exact, already-supported directions.

The continuous proposal uses no reference coordinates or learned parameters.
It must still pass the product's nonlinear folding/topology/pin checks.
"""
import math
import numpy as np
from scipy.linalg import null_space


def project(input_, points, fits):
    points=np.array(points);flat=points.flatten();n=len(flat);rows=[];targets=[]
    def constrain(entries,rhs):
        row=np.zeros(n)
        for index,value in entries:row[index]+=value
        rows.append(row);targets.append(rhs)
    for v in input_['vertices']:
        i=v['id'];side=v.get('boundary_side')
        for axis in range(2):
            if v['movement_policy']=='locked'or i in input_['boundary']['corners']or(side in ['top','bottom']and axis==1)or(side in ['left','right']and axis==0):
                constrain([(2*i+axis,1.)],flat[2*i+axis])
    for span in input_['selected_spans']:
        a,b=span['vertices'];d=points[b]-points[a];length=np.linalg.norm(d)
        if length<1e-12:continue
        angle=math.atan2(d[1],d[0]);targets_=[round(angle/(math.pi/k))*(math.pi/k)for k in [8,16,12]];theta=min(targets_,key=lambda t:abs(t-angle))
        if abs(math.sin(theta-angle))>1e-6:continue
        dx,dy=math.cos(theta),math.sin(theta)
        if abs(dx)<1e-15:dx=0.
        if abs(dy)<1e-15:dy=0.
        constrain([(2*a,-dy),(2*a+1,dx),(2*b,dy),(2*b+1,-dx)],0.)
    matrix=np.array(rows);rhs=np.array(targets)
    # An orthonormal nullspace parameterizes exactly the remaining freedom.
    basis=null_space(matrix,rcond=1e-10)
    corrected=flat+np.linalg.lstsq(matrix,rhs-matrix@flat,rcond=1e-10)[0]
    observed=[];values=[]
    for fit in fits:
        weight=np.sqrt(min(fit['length_px'],100.))
        for v in fit['vertices']:
            row=np.zeros(n);row[2*v:2*v+2]=np.array(fit['normal'])*weight;observed.append(row);values.append(fit['rho']*weight)
    observed=np.array(observed);values=np.array(values)
    if len(observed)==0:return points,{'reason':'no_fits'}
    reduced=observed@basis;residual=values-observed@corrected
    # Weak regularization keeps unobserved freedoms near the accepted solution.
    augmented=np.vstack([reduced,basis]);y=np.concatenate([residual,flat-corrected]);step=np.linalg.lstsq(augmented,y,rcond=1e-12)[0]
    answer=corrected+basis@step
    # Dense arithmetic must not perturb hard coordinates even by one ulp.
    # The product correctly requires literal equality for an explicit pin.
    for v in input_['vertices']:
        i=v['id'];side=v.get('boundary_side')
        for axis in range(2):
            if v['movement_policy']=='locked'or i in input_['boundary']['corners']or(side in ['top','bottom']and axis==1)or(side in ['left','right']and axis==0):
                answer[2*i+axis]=v['point']['x'if axis==0 else'y']
    return answer.reshape(-1,2),{'variables':n,'nullity':basis.shape[1],'equations':len(rows),'max_movement':float(np.linalg.norm(answer.reshape(-1,2)-points,axis=1).max()),'max_equation_error':float(np.max(abs(matrix@answer-rhs)))}
