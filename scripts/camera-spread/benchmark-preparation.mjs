/** Full external truth.fold corpus; sequential, resumable, explicit censored outcomes. */
import { readdir, readFile, writeFile, mkdir, appendFile, rename } from 'node:fs/promises';
import { fork, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { build, version as esbuildVersion } from 'esbuild';
import { createRequire } from 'node:module';
import { report } from './benchmark-preparation-report.mjs';
const root=path.resolve(import.meta.dirname,'../..');
process.chdir(root);
const [corpusArg, outputArg] = process.argv.slice(2);
if (!corpusArg || !outputArg) throw new Error('Usage: node scripts/camera-spread/benchmark-preparation.mjs CORPUS IGNORED_OUTPUT [--resume] [--limit=N] [--repeats=3] [--fold-timeout=30000] [--prep-timeout=120000]');
const value=(name,fallback)=>Number(process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1]??fallback);
const repeats=value('repeats',3), foldTimeoutMs=value('fold-timeout',30000), prepTimeoutMs=value('prep-timeout',120000), limit=value('limit',Infinity);
if (![repeats,foldTimeoutMs,prepTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>0) || !(limit===Infinity||(Number.isSafeInteger(limit)&&limit>0))) throw new Error('Invalid benchmark options');
const corpus=path.resolve(corpusArg),out=path.resolve(outputArg);
const relative=path.relative(root,out);
if (!relative.startsWith(`artifacts${path.sep}`)) throw new Error('Output must be under ignored artifacts/');
execFileSync('git',['check-ignore',out],{cwd:root});
const hash=data=>createHash('sha256').update(data).digest('hex');
const runPath=path.join(out,'run.json');
const existing=await readFile(runPath,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
if (existing && !process.argv.includes('--resume')) throw new Error('Output exists; choose a new label or use --resume');
await mkdir(path.join(out,'scenes'),{recursive:true});
const models=[];
for(const entry of await readdir(corpus,{withFileTypes:true})) {
 if(!entry.isDirectory())continue;
 const file=path.join(corpus,entry.name,'truth.fold');
 try {const bytes=await readFile(file); const data=JSON.parse(bytes); models.push({id:entry.name,file,sha256:hash(bytes),edges:data.edges_vertices?.length??0,vertices:data.vertices_coords?.length??0});}
 catch(e){if(e.code!=='ENOENT')throw new Error(`Cannot catalog ${file}: ${e.message}`);}
}
models.sort((a,b)=>a.edges-b.edges||a.id.localeCompare(b.id));
const selected=models.slice(0,limit);
const git={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),diffSha256:hash(execFileSync('git',['diff','HEAD']))};
const require=createRequire(import.meta.url);
const dependencies={esbuildVersion,packageLockSha256:hash(await readFile('package-lock.json')),earcutSha256:hash(await readFile(require.resolve('earcut')))};
const wasmSha256=hash(await readFile('apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm'));
const bundle=path.join(out,'prepare-bundle.mjs');
const built=await build({stdin:{contents:`export {cameraSpreadLift} from './apps/web/src/cp-workspace/folded/cameraSpreadLift.ts';export {cameraPaintPlans} from './apps/web/src/cp-workspace/folded/cameraSpreadVisibility.ts';export {cameraLayerRelations} from './apps/web/src/cp-workspace/folded/cameraSpreadRelations.ts';`,resolveDir:root},bundle:true,platform:'node',format:'esm',packages:'external',write:false,logLevel:'silent'});
const bundleBytes=built.outputFiles[0].contents,bundleSha256=hash(bundleBytes);
const harnessSha256=hash(await readFile(import.meta.filename));
const workerSha256=hash(await readFile(path.join(import.meta.dirname,'benchmark-preparation-worker.mjs')));
const identity={models:selected, repeats, foldTimeoutMs, prepTimeoutMs, wasmSha256,bundleSha256,harnessSha256,workerSha256,dependencies,node:process.version};
if(existing && JSON.stringify(existing.identity)!==JSON.stringify(identity))throw new Error('Resume input/code/runtime/options differ; choose a new output directory');
await writeFile(bundle,bundleBytes);
const run=existing??{schema:1,startedAt:new Date().toISOString(),git,identity,...identity,corpus,discovered:models.length,models:selected,
 machine:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem()},
 methodology:'One fold per model, then fresh Node process per preparation trial; sequential. Topology/solve, paint plans and relations are production functions. No cached geometry reused across trials.'};
await writeFile(runPath,JSON.stringify(run,null,2));
const resultsFile=path.join(out,'results.jsonl');
// Atomic per-model files are authoritative after an interrupted journal write.
const prior=[];
if(existing)for(const model of selected){
 const row=await readFile(path.join(out,`${model.id}.result.json`),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(row){if(row.inputSha256!==model.sha256)throw new Error('Stored input hash differs');prior.push(row);}
}
await writeFile(resultsFile,prior.map(r=>JSON.stringify(r)+'\n').join(''));
const completed=new Set(prior.map(r=>r.id));
function isolated(mode,input,output,timeoutMs) {
 return new Promise(resolve=>{
  const started=performance.now();let stage='startup',timings={},result=null,stderr='',timeout=false;
  const child=fork(path.join(import.meta.dirname,'benchmark-preparation-worker.mjs'),[mode,input,output,bundle],{cwd:root,execArgv:['--max-old-space-size=4096'],stdio:['ignore','ignore','pipe','ipc']});
  const timer=setTimeout(()=>{timeout=true;child.kill('SIGKILL');},timeoutMs);
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-3000);});
  child.on('message',m=>{if(m.kind==='stage'){stage=m.stage;timings=m.timings;}else if(m.kind==='result')result=m;});
  child.on('error',error=>{result={status:'error',stage,error:String(error)};});
  child.on('close',(code,signal)=>{clearTimeout(timer);resolve({...result,status:timeout?'timeout':result?.status??'crash',stage:result?.stage??stage,timings:result?.timings??timings,wallMs:performance.now()-started,exitCode:code,signal,...(stderr?{stderr}:{}),...(timeout?{deadlineMs:timeoutMs}:{} )});});
 });
}
for(const model of selected) {
 if(completed.has(model.id))continue;
 const sceneFile=path.join(out,'scenes',`${model.id}.json`);
 const fold=await isolated('fold',model.file,sceneFile,foldTimeoutMs);
 const trials=[];
 if(fold.status==='ok')for(let trial=0;trial<repeats;trial++){
  const sample=await isolated('prepare',sceneFile,'',prepTimeoutMs);trials.push(sample);
  if(sample.status!=='ok')break;
 }
 const row={id:model.id,completedAt:new Date().toISOString(),edges:model.edges,inputSha256:model.sha256,fold,trials};
 if(new Set(trials.filter(t=>t.status==='ok').map(t=>t.meshSha256)).size>1)row.nondeterministic=true;
 // Persist a complete per-model record atomically, then append the journal.
 const record=path.join(out,`${model.id}.result.json`);
 await writeFile(record+'.tmp',JSON.stringify(row));await rename(record+'.tmp',record);
 await appendFile(resultsFile,JSON.stringify(row)+'\n');completed.add(model.id);
 console.log(`${completed.size}/${selected.length} ${model.id}: ${fold.status} ${trials.map(t=>t.status==='ok'?`${Math.round(t.timings.totalPrepMs)}ms`:t.status).join(', ')}`);
 if(completed.size%10===0)await report(out);
}
console.log(JSON.stringify(await report(out),null,2));
await writeFile(path.join(out,'complete.json'),JSON.stringify({completedAt:new Date().toISOString(),attempted:completed.size}));
