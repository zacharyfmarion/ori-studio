// External corpus only. No CP or solved geometry is copied into the checkout.
// Usage: node scripts/layer-spread/evaluate.mjs /absolute/layer-study/sweep [report.json]
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {initSync,solve_layer_spread} from '../../apps/web/src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm.js';
const sweep=process.argv[2];
if(!sweep || !path.isAbsolute(sweep))throw new Error('Pass the absolute external sweep directory');
const wasm=fs.readFileSync(new URL('../../apps/web/src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm_bg.wasm',import.meta.url));
initSync({module:wasm});
const rows=[];
for(const filename of fs.readdirSync(path.join(sweep,'bottlenecks/results'))) {
  const baseline=path.join(sweep,'bottlenecks/results',filename,'normalized-50.json');
  const source=path.join(sweep,'inputs',filename+'.json');
  if(!fs.existsSync(baseline)||!fs.existsSync(source))continue;
  const input=JSON.parse(fs.readFileSync(source));const old=JSON.parse(fs.readFileSync(baseline));
  const start=performance.now();
  try {
    const result=solve_layer_spread(input);const ms=performance.now()-start;
    const errors=old.heights?.map((z,v)=>z/old.diagnostics.opening_scale-result.heights[v]/result.diagnostics.opening_scale);
    const row={model:filename,ms,...result.diagnostics,raw_rms:errors?Math.sqrt(errors.reduce((s,x)=>s+x*x,0)/errors.length):null};
    rows.push(row);console.log(JSON.stringify(row));
  } catch(error){const row={model:filename,ms:performance.now()-start,error:String(error)};rows.push(row);console.log(JSON.stringify(row));}
}
const times=rows.filter(r=>!r.error).map(r=>r.ms).sort((a,b)=>a-b);
const summary={wasm_bytes:wasm.length,count:rows.length,failed:rows.filter(r=>r.error).length,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],worst:times.at(-1)};
console.log(JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({summary,rows},null,2)+'\n');
