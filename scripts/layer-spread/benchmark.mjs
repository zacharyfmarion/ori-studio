#!/usr/bin/env node
/** External data stays in --out (an absolute directory outside the checkout).
 * Prepare with the current production WASM and baseline JS, then compare an
 * optimized bundle on the SAME projected meshes. One bounded worker at a time.
 *
 * node scripts/layer-spread/bundle-benchmark.mjs /tmp/baseline.mjs
 * node scripts/layer-spread/benchmark.mjs prepare --out /tmp/spread-bench \
 *   --bundle /tmp/baseline.mjs --cpoogle /absolute/cpoogle --cases /absolute/scoped-osf-cases
 * # After making the optimization:
 * node scripts/layer-spread/bundle-benchmark.mjs /tmp/candidate.mjs
 * node scripts/layer-spread/benchmark.mjs compare --out /tmp/spread-bench \
 *   --bundle /tmp/candidate.mjs --label candidate
 *
 * --cases contains external {document,step?} CP snapshots scoped to OSF steps,
 * as produced by the large-document benchmark. --filter restricts model IDs.
 * --resume 1 continues the same report after interruption. For offline diagnosis
 * only, --capture-timeout-ms overrides the default 12000 ms capture ceiling.
 * Stage times exclude worker startup, input parsing, transport and app UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
const root = fileURLToPath(new URL('../../', import.meta.url));
const [mode, ...flags] = process.argv.slice(2);
const args = Object.fromEntries(Array.from({length: flags.length / 2}, (_, i) => [flags[i * 2].replace(/^--/, ''), flags[i * 2 + 1]]));
if (!['prepare', 'compare'].includes(mode) || !path.isAbsolute(args.out ?? '') || !path.isAbsolute(args.bundle ?? ''))
  throw new Error('Pass prepare/compare, --out and --bundle absolute paths');
const relativeOut = path.relative(root, args.out);
if (!relativeOut.startsWith('..' + path.sep) && !path.isAbsolute(relativeOut))
  throw new Error('External benchmark output must be outside the checkout');
const captureTimeout = Number(args['capture-timeout-ms'] ?? 12_000);
if (!Number.isFinite(captureTimeout) || captureTimeout <= 0) throw new Error('Capture timeout must be positive');
fs.mkdirSync(path.join(args.out, 'cases'), {recursive: true});
const jobs = [];
if (mode === 'prepare') {
  if (args.cpoogle) for (const name of fs.readdirSync(args.cpoogle).sort()) {
    const file = path.join(args.cpoogle, name, 'truth.fold');
    if (fs.existsSync(file)) jobs.push({id: `cpoogle-${name}`, file, source: 'cpoogle'});
  }
  if (args.cases) for (const name of fs.readdirSync(args.cases).filter(n => n.endsWith('.json')).sort((a,b)=>parseInt(a)-parseInt(b)))
    jobs.push({id: `bodo-${path.basename(name,'.json')}`, file: path.join(args.cases,name), source: 'bodo'});
} else for (const name of fs.readdirSync(path.join(args.out, 'cases')).filter(n=>n.endsWith('.json')).sort())
  jobs.push({id: path.basename(name,'.json'), file:path.join(args.out,'cases',name), source:name.startsWith('bodo-')?'bodo':'cpoogle'});
const label = args.label ?? (mode === 'prepare' ? 'baseline' : 'candidate');
const report = path.join(args.out, `${label}.json`);
const rows = args.resume && fs.existsSync(report) ? JSON.parse(fs.readFileSync(report)).rows : [];
const completed = new Set(rows.map(r => r.id));
const selected = args.filter ? jobs.filter(j=>j.id.includes(args.filter)) : jobs;
if (!selected.length) throw new Error('No matching benchmark cases');
let progress = selected.filter(j => completed.has(j.id)).length;
for (const job of selected) {
  if (completed.has(job.id)) continue;
  const row = await new Promise(resolve => {
    const worker = new Worker(new URL('./benchmarkWorker.mjs', import.meta.url), {workerData:{...job,mode,root,out:args.out,bundle:args.bundle,label}});
    let last = {id:job.id,source:job.source}, phase = 'startup', finished = false, timer;
    const done = row => { if(finished)return; finished=true; clearTimeout(timer); void worker.terminate().then(()=>resolve(row)); };
    const arm = () => {clearTimeout(timer); timer=setTimeout(()=>done({...last,status:'timeout',phase}),phase==='fold'?12_000:phase==='solve'?15_000:phase==='capture'?captureTimeout:20_000);};
    arm();
    worker.on('message',message=>{ if(message.kind==='phase'){phase=message.phase;last=message.row;arm();}else done(message.row); });
    worker.on('error',e=>done({...last,status:'error',phase,error:e.message}));
    worker.on('exit',code=>{if(!finished)done({...last,status:'error',phase,error:`worker exited ${code}`});});
  });
  rows.push(row);
  progress++;
  fs.writeFileSync(report,JSON.stringify({mode,bundle:args.bundle,rows},null,2)+'\n');
  if(progress%20===0 || row.status!=='ok' || progress===selected.length)
    console.log(JSON.stringify({progress:`${progress}/${selected.length}`,...row}));
}
if (rows.some(r => r.status === 'different')) process.exitCode = 1;
