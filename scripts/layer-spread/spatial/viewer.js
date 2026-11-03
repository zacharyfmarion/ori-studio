// Local WebGL study: physical depth, shared material positions, linked cameras.
// No production renderer, physics, remote assets, telemetry or source-file writes.
const $ = id => document.getElementById(id);
const maxAmount = Number($('amount').max)/100;
import {Renderer,basis} from './renderer.mjs';
const sub = (a,b) => a.map((x,i)=>x-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => {const n=Math.hypot(...a);return a.map(x=>x/Math.max(n,1e-20));};

let examples=[],selected=null,profile='balanced',amount=.6,animate=false;
let yaw=.65,pitch=.4,zoom=1,radius=1.5,pending=false,renderers=[],lastTime=0,animationPhase=0;
let baseFills=[],baseLines=[],displayPositions=[];
const notes={
  strip:'A small joined hinge: two stack planes open together while their shared crease stays attached.',
  waterbomb:'A simple opening with little face warping. Look from the side to see the two local stacks separate.',
  'three-plane':'Three differently oriented stacks constrain one another. The opening is modest because all shared creases stay joined.',
  spikes:'Many coupled stacks. Watch the narrow tips and compare shape preservation as you increase the amount.',
  penguin:'Deep stacks on many planes. Toggle layer order to see the visibility correction. Geometric crossings remain in the measurements below.',
  cylinder:'Stress case: the touching seam opens, but nearby panels acquire intersections. This needs cross-plane contact constraints before product use.',
  rectangles:'These surfaces are already separated in 3D. There are no touching layer stacks, so this experiment leaves the figure unchanged.',
};
function schedule(){if(!pending){pending=true;requestAnimationFrame(frame);}}
function frame(time){
  pending=false;
  if(animate&&selected?.status==='ready'){
    animationPhase+=(time-(lastTime||time))/2000;amount=maxAmount*(1-Math.cos(animationPhase))/2;
    $('amount').value=String(Math.round(amount*100));updateGeometry();updateMetrics();
  }
  lastTime=time;
  const distance=radius*3.8*zoom;
  const eye=[distance*Math.sin(yaw)*Math.cos(pitch),distance*Math.sin(pitch),distance*Math.cos(yaw)*Math.cos(pitch)];
  renderers.forEach(r=>r.draw(eye,{edges:$('edges').checked,correctOrder:$('ordering').checked}));
  if(animate)schedule();
}
function convertPacked(rows){return rows.flatMap(row=>[...basis(row.slice(0,3)),...basis(row.slice(3,6)),row[6]]);}
function updateGeometry(){
  if(selected?.status!=='ready')return;
  const original=selected.positions,d=selected.variants[profile].displacements;
  displayPositions=original.map((p,v)=>p.map((x,k)=>x+amount*d[v][k]));
  if(amount<1e-10||selected.depth===1){renderers[1].upload(baseFills,baseLines,true);schedule();return;}
  const positions=displayPositions.map(basis),fills=[],lines=[],ranges=new Map();
  selected.faces.forEach((ring,face)=>{
    const range={first:fills.length/7,lineFirst:lines.length/7};
    selected.triangles.forEach((ids,t)=>{
      if(selected.triangleFaces[t]!==face)return;
      const p=ids.map(v=>positions[v]),n=unit(cross(sub(p[1],p[0]),sub(p[2],p[0])));
      for(const v of p)fills.push(...v,...n,1);
    });
    // Source face boundaries only. Each incident layer owns its own copy so
    // its line is masked by exactly the same blockers as its fill.
    ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length];lines.push(...positions[a],0,0,0,1,...positions[b],0,0,0,1);});
    range.count=fills.length/7-range.first;range.lineCount=lines.length/7-range.lineFirst;ranges.set(face,range);
  });
  renderers[1].upload(fills,lines,false,ranges);schedule();
}
const percent=x=>`${x.toFixed(2)}%`;
function updateMetrics(){
  $('amount-value').textContent=$('amount-badge').textContent=`${Math.round(amount*100)}%`;
  if(selected?.status!=='ready')return;
  const variant=selected.variants[profile],full=variant.metrics.at(-1);
  let maxStrain=0;
  for(const [a,b] of selected.edges){const old=Math.hypot(...sub(selected.positions[b],selected.positions[a]));const now=Math.hypot(...sub(displayPositions[b],displayPositions[a]));if(old>1e-12)maxStrain=Math.max(maxStrain,Math.abs(now/old-1)*100);}
  $('gap').textContent=percent(full.mean_gap_percent*amount);
  $('strain').textContent=percent(maxStrain);
  $('movement').textContent=percent(full.max_displacement_percent*amount);
  $('order-error').textContent=percent(full.max_order_violation_percent*amount);
  $('order-error').style.color=full.max_order_violation_percent*amount>.01?'var(--warning)':'inherit';
  $('observation').textContent=notes[selected.id]||'';
  $('order-mode').textContent=$('ordering').checked?'Known layer order · reverses with the camera':'Geometric depth · correction off';
  const checks=variant.crossingSamples.map(s=>`${Math.round(s.amount*100)}%: ${s.new_face_pairs}`).join(' · ');
  $('diagnostics').textContent=`${selected.positions.length} shared material vertices · ${selected.triangles.length} triangles · ${variant.solve.status}. Preparation excluded; solve + assembly ${(variant.solve.seconds*1000).toFixed(0)} ms. New detected crossing face pairs at sampled amounts — ${checks}. Maximum face warp at 100%: ${percent(full.max_face_warp_percent)} of model width. Reversed triangles at 100%: ${full.reversed_triangles}.`;
}
function select(slug){
  selected=examples.find(c=>c.id===slug);if(!selected)return;
  for(const button of $('models').children){const active=button.dataset.model===slug;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  $('name').textContent=selected.name;
  const ready=selected.status==='ready';
  for(const id of ['views','controls','metrics'])$(id).hidden=!ready;
  document.querySelector('.notes').hidden=!ready;$('error').hidden=ready;
  if(!ready){$('error').textContent=selected.reason;$('model-stats').textContent='The existing fold pipeline cannot provide an ordered source for this example.';setAnimation(false);return;}
  $('model-stats').textContent=`${selected.faces.length} faces · ${selected.planeCount} planes · ${selected.depth===1?'no stacked layers':`up to ${selected.depth} layers`}`;
  baseFills=convertPacked(selected.baseTriangles);baseLines=convertPacked(selected.baseLines);
  renderers[0].upload(baseFills,baseLines,true);
  renderers[1].configureOrder(selected.orderPlanes);
  radius=Math.max(...selected.positions.map(p=>Math.hypot(...p)))+.18;
  preset('overview');updateGeometry();updateMetrics();
}
function preset(name){
  [yaw,pitch]=({overview:[.65,.4],front:[0,0],back:[Math.PI,0],side:[Math.PI/2,0],top:[0,Math.PI/2-.01]})[name];zoom=1;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));schedule();
}
function setAnimation(value){animate=value;lastTime=0;animationPhase=Math.acos(Math.max(-1,Math.min(1,1-2*amount/maxAmount)));$('animate').setAttribute('aria-pressed',String(animate));$('animate').textContent=animate?'Pause animation':'Animate spread';schedule();}
function attachOrbit(canvas){
  let drag=null;
  canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw-=(e.clientX-drag[0])*.007;pitch=Math.max(-1.55,Math.min(1.55,pitch+(e.clientY-drag[1])*.007));drag=[e.clientX,e.clientY];document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));schedule();});
  const stop=()=>{drag=null;};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*Math.exp(e.deltaY*.001)));schedule();},{passive:false});
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();yaw+=(e.key==='ArrowLeft'?.1:e.key==='ArrowRight'?-.1:0);pitch=Math.max(-1.55,Math.min(1.55,pitch+(e.key==='ArrowUp'?.1:e.key==='ArrowDown'?-.1:0)));schedule();});
}
try {
  renderers=[new Renderer($('before'),schedule),new Renderer($('after'),schedule)];
  renderers.forEach(r=>attachOrbit(r.canvas));
  const response=await fetch('./examples.json',{cache:'no-store'});if(!response.ok)throw new Error(`Examples failed to load (${response.status}).`);
  examples=(await response.json()).cases;
  for(const model of examples){const b=document.createElement('button');b.dataset.model=model.id;const label=document.createElement('span');label.textContent=model.name;const small=document.createElement('small');small.textContent=model.status==='ready'?(model.depth===1?'No-stack control':`${model.faces.length} faces · ${model.depth} layers`):'Unavailable source';b.append(label,small);b.addEventListener('click',()=>select(model.id));$('models').append(b);}
  $('amount').addEventListener('input',()=>{setAnimation(false);amount=Number($('amount').value)/100;updateGeometry();updateMetrics();});
  $('variant').addEventListener('change',()=>{profile=$('variant').value;updateGeometry();updateMetrics();});
  $('ordering').addEventListener('change',()=>{updateMetrics();schedule();});
  $('edges').addEventListener('change',schedule);$('animate').addEventListener('click',()=>setAnimation(!animate));
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>preset(b.dataset.view)));
  select(new URLSearchParams(location.search).get('example')||'waterbomb');
  // Paint again after the first canvas composition/layout has settled.
  requestAnimationFrame(()=>schedule());
  window.spatialSpreadStudy={inspect:()=>({example:selected.id,amount,profile,yaw,pitch,positions:displayPositions,triangles:selected.triangles?.length,errors:renderers.map(r=>r.gl.getError())})};
} catch(error){$('name').textContent='Could not open the study';$('error').hidden=false;$('error').textContent=String(error);console.error(error);}
