import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const quantile = (values, p) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.max(0, Math.ceil(a.length * p) - 1)] : null;
};
export const median = (values) => quantile(values, 0.5);
export async function report(directory) {
  const run = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'));
  const records = (await readFile(path.join(directory, 'results.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const rows = [...new Map(records.map(r => [r.id, r])).values()];
  const successful = rows.filter(r => r.fold.status === 'ok' && r.trials.length === run.repeats && r.trials.every(t => t.status === 'ok'));
  const fields = ['totalPrepMs', 'topologyMs', 'solveAndProbeMs', 'paintMs', 'relationsMs'];
  const summary = { attempted: rows.length, total: run.models.length, prepared: successful.length,
    foldFailures: rows.filter(r => r.fold.status !== 'ok').length,
    prepFailures: rows.filter(r => r.fold.status === 'ok' && !successful.includes(r)).length,
    metrics: Object.fromEntries(fields.map(f => { const v = successful.map(r => median(r.trials.map(t => t.timings[f]))); return [f, {p50:quantile(v,.5),p90:quantile(v,.9),p95:quantile(v,.95),p99:quantile(v,.99),max:quantile(v,1)}]; })) };
  await writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  const csvFields = ['id','status','faces','edges','foldMs',...fields,'minPrepMs','maxPrepMs','meshSha256'];
  const csv = [csvFields.join(',')];
  const scored = rows.map(r => { const ok = r.trials.filter(t => t.status === 'ok'); const values=Object.fromEntries(fields.map(f=>[f,median(ok.map(t=>t.timings[f]))]));
    const status=r.fold.status !== 'ok' ? `fold-${r.fold.status}` : ok.length===run.repeats ? 'ok' : 'prep-incomplete';
    const entry={id:r.id,status,faces:r.fold.counts?.faces,edges:r.edges,foldMs:r.fold.timings?.foldMs,...values,
      minPrepMs:quantile(ok.map(t=>t.timings.totalPrepMs),0),maxPrepMs:quantile(ok.map(t=>t.timings.totalPrepMs),1),meshSha256:ok[0]?.meshSha256};
    csv.push(csvFields.map(f=>'\"'+String(entry[f]??'').replaceAll('\"','\"\"')+'\"').join(',')); return entry; });
  await writeFile(path.join(directory,'results.csv'),csv.join('\n')+'\n');
  scored.sort((a,b)=>(b.totalPrepMs??-1)-(a.totalPrepMs??-1));
  const sec = n => n==null?'—':(n/1000).toFixed(3);
  const top=scored.slice(0,20).map(r=>`| ${r.id} | ${r.faces??'—'} | ${sec(r.foldMs)} | ${sec(r.totalPrepMs)} | ${sec(r.solveAndProbeMs)} | ${sec(r.paintMs)} | ${sec(r.relationsMs)} |`).join('\n');
  await writeFile(path.join(directory,'README.md'),`# Camera spread cold preparation baseline\n\nCode: ${run.git.head}. Captured ${run.startedAt}.\n\n${rows.length}/${run.models.length} attempted; ${successful.length} fully prepared; ${summary.foldFailures} fold failures/timeouts; ${summary.prepFailures} preparation failures/incomplete. Each preparation median uses ${run.repeats} fresh-process trials. Sequential, no benchmark parallelism.\n\nCPU preparation excludes folding, module import, file reads, worker transfer, GPU setup, first frame and settled vector capture. Fold time is separate. Solve diagnostic includes matrix compilation and final probes. Failures and timeouts are **not** zero-time successes; distributions exclude them. Per-model input SHA, geometry SHA, memory and raw timings are in results.jsonl; run.json pins the manifest, code, bundles, WASM and machine.\n\n| Stage | p50 s | p95 s | p99 s | max s |\n| --- | ---: | ---: | ---: | ---: |\n${fields.map(f=>{const m=summary.metrics[f];return '| '+f+' | '+[m.p50,m.p95,m.p99,m.max].map(sec).join(' | ')+' |';}).join('\n')}\n\n## Slowest models\n\n| Model | Faces | Fold s | Prep s | Solve/probes s | Paint s | Relations s |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${top}\n\nSee results.csv for all models and browser-results.json for the separate browser run, when present. Do not compare CPU and browser wall clocks as if they were the same metric.\n`);
  return summary;
}
if (process.argv[1] === import.meta.filename) console.log(await report(path.resolve(process.argv[2])));
