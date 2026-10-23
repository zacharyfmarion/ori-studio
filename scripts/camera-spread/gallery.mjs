/** Local-only review artifact. All images come from compare.mjs, never generated illustrations. */
import { readFile, writeFile } from 'node:fs/promises';
const root = 'artifacts/camera-spread/comparison';
const before = JSON.parse(await readFile(`${root}/before.json`, 'utf8'));
const after = JSON.parse(await readFile(`${root}/after.json`, 'utf8'));
if (before.results.length !== 70 || after.results.length !== 70)
  throw new Error('Expected 70 complete pairs');
if (
  JSON.stringify(before.views) !== JSON.stringify(after.views) ||
  JSON.stringify(before.models) !== JSON.stringify(after.models)
)
  throw new Error('Capture settings do not match');
const data = JSON.stringify({ before, after }).replaceAll('<', '\\u003c');
await writeFile(
  `${root}/index.html`,
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Layer visibility · 70 before & after comparisons</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#202b35;font:15px/1.5 system-ui,sans-serif}
header{background:#fff;border-bottom:1px solid #dce2e7;padding:28px 4vw 20px}h1{margin:4px 0 10px;font-size:30px;letter-spacing:-.8px}p{margin:6px 0;color:#5b6c79}.eyebrow{font-size:12px;color:#307c76;font-weight:750;letter-spacing:1.5px}
.toolbar{position:sticky;top:0;z-index:5;display:flex;align-items:end;gap:14px;flex-wrap:wrap;background:#ffffffed;backdrop-filter:blur(10px);padding:14px 4vw;border-bottom:1px solid #dce2e7}
label{display:grid;gap:5px;font-size:12px;font-weight:700;color:#566773}select,button,a.button{font:inherit;color:#253845;background:#fff;border:1px solid #bdcad4;border-radius:8px;padding:10px 12px;min-height:42px}select{max-width:100%;font-size:14px}button,a.button{cursor:pointer;text-decoration:none}button:hover,a.button:hover{background:#edf5f4}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #4b979d;outline-offset:2px}
.count{margin-left:auto;color:#52716d;font-size:13px}main{padding:24px 4vw 64px;max-width:1900px;margin:auto}section{margin-bottom:44px}h2{margin:0;font-size:23px}.modelhead{margin-bottom:15px;display:flex;justify-content:space-between;align-items:center;gap:15px}
article{background:white;border:1px solid #d8e1e6;border-radius:8px;overflow:hidden;margin-bottom:20px}.caption{padding:15px 20px;border-bottom:1px solid #e3e9ed;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.caption strong{font-size:16px}.settings{font-size:13px;color:#60717d}.pairs{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#e3e9ed}.pane{position:relative;background:white}.pane img{width:100%;display:block}.tag{position:absolute;top:12px;left:14px;padding:4px 9px;background:#f2f4f6eb;color:#52616e;border-radius:5px;font-size:12px;font-weight:700}.tag.after{background:#e7f5efeb;color:#237956}
.links{font-size:12px;display:flex;gap:14px}.links a{color:#326f84}.wipe{position:relative;background:#fff;max-width:1100px;margin:auto}.wipe img{display:block;width:100%}.wipe .old{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--cut)) 0 0)}.wipe .divider{position:absolute;left:var(--cut);top:0;bottom:0;width:2px;background:#327d8f;pointer-events:none}.wipe .tag.after{left:auto;right:14px}.scrub{display:flex;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid #e3e9ed;font-size:12px;color:#52616e}.scrub input{flex:1;accent-color:#327d8f}body[data-mode="pairs"] .wipe,body[data-mode="pairs"] .scrub{display:none}body[data-mode="wipe"] .pairs{display:none}.note{padding:12px 16px;background:#eaf2f4;border-radius:8px;margin-bottom:24px;font-size:13px;color:#49616e}footer{padding:20px 4vw;color:#71808a;font-size:12px}
@media(max-width:650px){h1{font-size:25px}.toolbar{gap:9px}.toolbar label:first-child{width:100%}.toolbar label:first-child select{width:100%}.pairs{grid-template-columns:1fr}.count{margin-left:0}.modelhead{align-items:start;flex-direction:column}}
</style></head><body data-mode="pairs">
<header><div class="eyebrow">ORI STUDIO · CAMERA SPREAD REVIEW</div><h1>Layer visibility, before & after</h1><p>10 models × 7 views = 70 matched comparisons. Same folded geometry, bending, camera, amount and framing.</p><p>Before: flat paint priorities. After: protect known stacks, then compare unrelated surfaces by depth at each overlap.</p></header>
<div class="toolbar"><label>Model<select id="model"></select></label><label>View / settings<select id="view"><option value="all">All seven views</option></select></label><label>Comparison<select id="mode"><option value="pairs">Side by side</option><option value="wipe">Wipe slider</option></select></label><button id="prev" aria-label="Previous model">←</button><button id="next" aria-label="Next model">→</button><span class="count" id="count"></span></div>
<main><div class="note">Start with the crane’s “Reported crane view” to inspect the restored left flap. Top-down views check layer protection; the frog near-side and underside views check local reversal. The lift itself can still stretch or intersect paper. Images are actual WebGL captures. After images use lighter strokes (1.1 px outlines, 0.65 px auxiliary lines); antialiasing also differs from the baseline. Open a PNG for full resolution.</div><div id="gallery"></div></main>
<footer>Baseline revision ${before.revision.slice(0, 8)} · captured ${before.capturedAt} · after ${after.capturedAt}. Private local review; nothing uploaded.</footer>
<script>
const data=${data};
const model=document.querySelector('#model'),view=document.querySelector('#view'),mode=document.querySelector('#mode');
const nice=id=>id==='ldm-layer-issue'?'LDM layer issue':id.replaceAll('-',' ').replace(' by ',' · ');
for(const id of data.after.models){const o=new Option(nice(id),id);model.add(o)}model.add(new Option('All ten models · 70 comparisons','all'));
for(const v of data.after.views)view.add(new Option(v.label,v.id));
const params=new URLSearchParams(location.search);if(params.get('model')==='all'||data.after.models.includes(params.get('model')))model.value=params.get('model');
if(data.after.views.some(v=>v.id===params.get('view')))view.value=params.get('view');
function render(){
 const chosen=model.value==='all'?data.after.models:[model.value],views=data.after.views.filter(v=>view.value==='all'||v.id===view.value);
 document.querySelector('#count').textContent=(chosen.length*views.length)+' of 70 pairs';
 document.querySelector('#gallery').innerHTML=chosen.map(id=>{
  const faces=data.after.results.find(r=>r.model===id).faces;
  return '<section><div class="modelhead"><div><h2>'+nice(id)+'</h2><p>'+faces+' folded faces · '+views.length+' comparisons</p></div><a class="button" href="/camera-spread.html?model='+encodeURIComponent(id)+'" target="_blank">Open live explorer ↗</a></div>'+views.map(v=>{
    const b='before/'+id+'--'+v.id+'.png',a='after/'+id+'--'+v.id+'.png';
    const settings=v.projection+' · '+Math.round(v.amount*100)+'% amount · '+v.directionDeg+'° direction · '+v.inclinationDeg+'° inclination · '+Math.round(v.zoom*100)+'% zoom';
    return '<article><div class="caption"><div><strong>'+v.label+'</strong><div class="settings">'+settings+'</div></div><div class="links"><a href="'+b+'" target="_blank">Before PNG ↗</a><a href="'+a+'" target="_blank">After PNG ↗</a></div></div><div class="pairs"><div class="pane"><span class="tag">BEFORE</span><img loading="lazy" src="'+b+'" alt="Before: '+nice(id)+', '+v.label+'"></div><div class="pane"><span class="tag after">AFTER</span><img loading="lazy" src="'+a+'" alt="After: '+nice(id)+', '+v.label+'"></div></div><div class="wipe" style="--cut:50%"><img loading="lazy" src="'+a+'" alt="After"><img loading="lazy" class="old" src="'+b+'" alt="Before"><i class="divider"></i><span class="tag">BEFORE</span><span class="tag after">AFTER</span></div><label class="scrub">Before<input aria-label="Before and after split for '+v.label+'" type="range" min="0" max="100" value="50">After</label></article>';
  }).join('')+'</section>';
 }).join('');
 document.querySelectorAll('.scrub input').forEach(input=>input.oninput=()=>input.closest('article').querySelector('.wipe').style.setProperty('--cut',input.value+'%'));
 history.replaceState(null,'','?model='+encodeURIComponent(model.value)+'&view='+view.value);
}
model.onchange=view.onchange=render;mode.onchange=()=>document.body.dataset.mode=mode.value;
for(const [id,step] of [['prev',-1],['next',1]])document.getElementById(id).onclick=()=>{model.selectedIndex=(model.selectedIndex+step+data.after.models.length)%data.after.models.length;render();window.scrollTo({top:0,behavior:'smooth'})};
render();
</script></body></html>`
);
console.log(`Gallery: http://localhost:5281/src/generated/camera-spread/comparison/index.html`);
