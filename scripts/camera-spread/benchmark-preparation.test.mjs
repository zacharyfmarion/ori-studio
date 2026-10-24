import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quantile, report } from './benchmark-preparation-report.mjs';

test('nearest-rank quantiles keep a censored/missing value out of the distribution', () => {
  assert.equal(quantile([10, 30, 20, NaN, Infinity], .5), 20);
  assert.equal(quantile([10, 30, 20], .95), 30);
  assert.equal(quantile([], .95), null);
});
test('summary counts every attempt but excludes timeouts and incomplete trials from prep percentiles', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'spread-benchmark-'));
  const trial=n=>({status:'ok',timings:{totalPrepMs:n,topologyMs:n/4,solveAndProbeMs:n/2,paintMs:n/8,relationsMs:n/8},meshSha256:'same'});
  const rows=[{id:'success',edges:10,fold:{status:'ok',counts:{faces:5},timings:{foldMs:4}},trials:[trial(10),trial(30),trial(20)]},
    {id:'fold-timeout',edges:20,fold:{status:'timeout'},trials:[]},
    {id:'prep-timeout',edges:30,fold:{status:'ok',counts:{faces:10}},trials:[{status:'timeout'}]}];
  try{
    await writeFile(path.join(dir,'run.json'),JSON.stringify({repeats:3,models:rows,git:{head:'test'},startedAt:'test'}));
    await writeFile(path.join(dir,'results.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
    const result=await report(dir);
    assert.equal(result.attempted,3);assert.equal(result.prepared,1);assert.equal(result.foldFailures,1);assert.equal(result.prepFailures,1);
    assert.equal(result.metrics.totalPrepMs.p50,20);assert.equal(result.metrics.totalPrepMs.max,20);
    const csv=await readFile(path.join(dir,'results.csv'),'utf8');
    assert.match(csv,/fold-timeout/);assert.match(csv,/prep-incomplete/);
    assert.equal(csv.trim().split('\n').length,4);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('versioned export includes numbers and hashes but excludes source geometry and private paths', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir=await mkdtemp(path.join(os.tmpdir(),'spread-export-'));
  try {
    const timings={totalPrepMs:5,topologyMs:1,solveAndProbeMs:3,paintMs:.5,relationsMs:.5};
    const row={id:'test-model',edges:3,file:'/private/corpus/truth.fold',inputSha256:'input',
      fold:{status:'ok',counts:{faces:1},timings:{foldMs:4},sceneSha256:'scene',scene:{vertices_coords:[[1,2]]},error:'/private/corpus'},
      trials:[{status:'ok',timings,meshSha256:'mesh',geometry:{outline:[[1,2]]}}]};
    await writeFile(path.join(dir,'run.json'),JSON.stringify({models:[row],repeats:1,git:{head:'test'},machine:{cpu:'test'},corpus:'/private/corpus'}));
    await writeFile(path.join(dir,'results.jsonl'),JSON.stringify(row)+'\n');
    const output=path.join(dir,'baseline.json');
    execFileSync(process.execPath,[path.join(import.meta.dirname,'export-preparation-benchmark.mjs'),dir,output]);
    const text=await readFile(output,'utf8'),saved=JSON.parse(text);
    assert.equal(saved.rows[0].trials[0].meshSha256,'mesh');
    assert.equal(saved.summary.cpu.totalPrepMs.p50,5);
    assert.doesNotMatch(text,/\/private\/corpus|vertices_coords|"outline"|"geometry"/);
    assert.ok((await readFile(path.join(dir,'index.html'),'utf8')).includes('test-model'));
  } finally {await rm(dir,{recursive:true,force:true});}
});
