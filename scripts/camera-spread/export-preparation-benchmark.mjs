/** Export numerical observations only. Never export corpus paths, coordinates or scenes. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { quantile, median } from './benchmark-preparation-report.mjs';
const [directory,destination]=process.argv.slice(2);
if(!directory||!destination)throw new Error('Usage: node scripts/camera-spread/export-preparation-benchmark.mjs ARTIFACT_DIRECTORY NUMERICAL_BASELINE.json');
const run=JSON.parse(await readFile(path.join(directory,'run.json'),'utf8'));
const raw=(await readFile(path.join(directory,'results.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const browser=await readFile(path.join(directory,'browser-results.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const browserFields=['status','stage','prepareMs','topologyMs','solveAndProbeMs','firstBitmapMs','workerStartupMs','totalWallMs','loadAndBitmapRpcMs','loadAndPresentMs','bitmapWidth','bitmapHeight','deadlineMs'];
const rows=raw.map(row=>{
 const web=browser?.rows.find(r=>r.id===row.id);
 return {id:row.id,inputSha256:row.inputSha256,edges:row.edges,
   fold:pick(row.fold,['status','stage','timings','counts','sceneSha256','maxRssKiB','wallMs','deadlineMs']),
   trials:row.trials.map(t=>pick(t,['status','stage','timings','counts','meshSha256','maxRssKiB','wallMs','deadlineMs'])),
   ...(web?{browserTrials:web.trials.map(t=>pick(t,browserFields))}:{}),
   ...(row.nondeterministic?{nondeterministic:true}:{})};
});
const good=rows.filter(r=>r.fold.status==='ok'&&r.trials.length===run.repeats&&r.trials.every(t=>t.status==='ok'));
const metric=values=>Object.fromEntries([['p50',.5],['p90',.9],['p95',.95],['p99',.99],['max',1]].map(([k,p])=>[k,quantile(values,p)]));
const summary={total:run.models.length,attempted:rows.length,cpuPrepared:good.length,foldFailures:rows.filter(r=>r.fold.status!=='ok').length,
 prepFailures:rows.filter(r=>r.fold.status==='ok'&&!good.includes(r)).length,nondeterministic:rows.filter(r=>r.nondeterministic).length,
 cpu:Object.fromEntries(['totalPrepMs','topologyMs','solveAndProbeMs','paintMs','relationsMs'].map(f=>[f,metric(good.map(r=>median(r.trials.map(t=>t.timings[f]))))])),
 foldMs:metric(rows.filter(r=>r.fold.status==='ok').map(r=>r.fold.timings.foldMs))};
if(browser){const ok=rows.filter(r=>r.browserTrials?.length===browser.config.repeats&&r.browserTrials.every(t=>t.status==='ok'));
 summary.browserPrepared=ok.length;summary.browserAttempted=browser.rows.length;
 summary.browser=Object.fromEntries(['prepareMs','workerStartupMs','firstBitmapMs','totalWallMs'].map(f=>[f,metric(ok.map(r=>median(r.browserTrials.map(t=>t[f]))))]));}
const baseline={schema:1,description:'Numerical cold-geometry-cache preparation baseline; contains no input or solved geometry.',startedAt:run.startedAt,
 provenance:{...pick(run,['git','node','wasmSha256','bundleSha256','harnessSha256','workerSha256','machine','dependencies','provenanceNote']),
   ...(browser?{browser:{environment:browser.environment,...pick(browser.config,['surface','repeats','workerBundleSha256','runnerSha256','identity'])}}:{})},
 methodology:{cpuRepeats:run.repeats,foldTimeoutMs:run.foldTimeoutMs,prepTimeoutMs:run.prepTimeoutMs,
   selection:'Every cpoogle */truth.fold; edge count then ID; fold case 1; no exactization',
   isolation:'Sequential; fresh Node process or browser worker per preparation trial; cold geometry, warm filesystem/HTTP caches',
   excluded:'Vector capture; CPU timings also exclude folding, imports, scene read/decode, worker transport and graphics setup',
   percentiles:'Nearest rank across per-model trial medians; incomplete models excluded, failures counted explicitly'},summary,rows};
await mkdir(path.dirname(destination),{recursive:true});
const {rows:observations,...metadata}=baseline;
await writeFile(destination,JSON.stringify(metadata,null,2).slice(0,-2)+',\n  \"rows\": [\n'+observations.map(r=>'    '+JSON.stringify(r)).join(',\n')+'\n  ]\n}\n');
// Self-contained local comparison surface. Identifiers go through textContent, never HTML.
const data=JSON.stringify(baseline).replaceAll('<','\\u003c');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>cpoogle · preparation benchmark</title><style>body{font:15px system-ui;margin:32px;color:#203040;background:#f4f6f8}h1{font-size:26px}p{max-width:1050px;line-height:1.5}.cards{display:flex;gap:18px;flex-wrap:wrap;margin:24px 0}.card{padding:18px;background:white;border:1px solid #d6dde5;border-radius:8px}.card b{display:block;font-size:26px}input,select{font:inherit;padding:8px;margin:8px 12px 16px 0}table{width:100%;min-width:1000px;table-layout:fixed;background:white;border-collapse:collapse;font-size:13px}th,td{padding:10px;text-align:right;border-bottom:1px solid #e5e8ec}th:first-child,td:first-child{text-align:left;width:33%;overflow-wrap:anywhere}th{position:sticky;top:0;background:#e6ecf2}progress{width:100px;margin-left:12px;accent-color:#327c91}small{color:#526474}</style><h1>cpoogle · Default spread cold preparation</h1><p id="description"></p><div class="cards" id="cards"></div><p>CPU preparation = lift topology + matrix/solve/probes + paint plans + layer relations. Browser preparation = actual production render-session load, including graphics initialization. Folding and first bitmap are separate. All values are milliseconds; preparation columns show per-model medians.</p><input id="search" placeholder="Find a model" aria-label="Find a model"><select id="sort" aria-label="Sort models"><option value="browser">Slowest browser preparation</option><option value="cpu">Slowest CPU preparation</option><option value="fold">Slowest fold</option><option value="faces">Most faces</option><option value="contacts">Most contacts</option></select><table><thead><tr><th>Model</th><th>Faces</th><th>Contacts</th><th>Fold</th><th>CPU prep</th><th>Solve / probes</th><th>Paint</th><th>Relations</th><th>Browser prep</th><th>First bitmap</th></tr></thead><tbody id="rows"></tbody></table><p><small>Original files and solved scenes are excluded from this report. Geometry hashes and all numerical trials are in the saved JSON baseline. Timings are hardware-specific; failures are counted, not treated as fast cases.</small></p><script type="application/json" id="data">${data}</script><script>
const b=JSON.parse(document.querySelector('#data').textContent),s=b.summary;
const median=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[Math.ceil(a.length*.5)-1]:null};
const number=x=>x==null?'—':x.toLocaleString(undefined,{maximumFractionDigits:1});
document.querySelector('#description').textContent=s.attempted+'/'+s.total+' corpus models attempted; '+s.cpuPrepared+' CPU successes; '+(s.browserPrepared??0)+' browser successes. '+b.methodology.cpuRepeats+' fresh CPU trials per model. '+b.provenance.machine.cpu+'.';
for(const [label,n] of [['CPU median',s.cpu.totalPrepMs.p50],['CPU p95',s.cpu.totalPrepMs.p95],['CPU maximum',s.cpu.totalPrepMs.max],['Browser p95',s.browser?.prepareMs.p95],['Browser maximum',s.browser?.prepareMs.max]]){const c=document.createElement('div');c.className='card';const t=document.createElement('b');t.textContent=number(n)+' ms';c.append(t,document.createTextNode(label));document.querySelector('#cards').append(c)}
const rows=b.rows.map(r=>{const ok=r.trials.filter(t=>t.status==='ok'),web=(r.browserTrials??[]).filter(t=>t.status==='ok');return {id:r.id,faces:r.fold.counts?.faces,contacts:ok[0]?.counts?.contacts,fold:r.fold.timings?.foldMs,cpu:median(ok.map(t=>t.timings.totalPrepMs)),solve:median(ok.map(t=>t.timings.solveAndProbeMs)),paint:median(ok.map(t=>t.timings.paintMs)),relations:median(ok.map(t=>t.timings.relationsMs)),browser:median(web.map(t=>t.prepareMs)),bitmap:median(web.map(t=>t.firstBitmapMs))}});
function render(){const target=document.querySelector('#rows');target.replaceChildren();const q=document.querySelector('#search').value.toLowerCase(),sort=document.querySelector('#sort').value;for(const r of rows.filter(r=>r.id.includes(q)).sort((a,b)=>(b[sort]??-1)-(a[sort]??-1))){const tr=document.createElement('tr');for(const key of ['id','faces','contacts','fold','cpu','solve','paint','relations','browser','bitmap']){const td=document.createElement('td');td.textContent=key==='id'?r[key]:number(r[key]);tr.append(td)}target.append(tr)}}document.querySelector('#search').oninput=render;document.querySelector('#sort').onchange=render;render();</script></html>`;
await writeFile(path.join(directory,'index.html'),html);
console.log(JSON.stringify(summary,null,2));
