import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData as job } from 'node:worker_threads';
const H = await import(pathToFileURL(job.bundle));
const row = {id:job.id,source:job.source};
let phase;
const begin = name => {phase=name;parentPort.postMessage({kind:'phase',phase,row:{...row}});return performance.now();};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  let scene;
  if(job.mode === 'prepare') {
    let t=begin('initialize');
    const cp=await import(pathToFileURL(path.join(job.root,'apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm.js')));
    const sp=await import(pathToFileURL(path.join(job.root,'apps/web/src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm.js')));
    cp.initSync({module:fs.readFileSync(path.join(job.root,'apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm'))});
    sp.initSync({module:fs.readFileSync(path.join(job.root,'apps/web/src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm_bg.wasm'))});
    row.initMs=performance.now()-t;
    t=begin('fold');
    const data=job.source==='bodo'?JSON.parse(fs.readFileSync(job.file)):null;
    const handle=data?cp.load_document(data.document):cp.load_fold(fs.readFileSync(job.file,'utf8'),job.id);
    // OSF steps contain scoped creases in document coordinates. Fold that
    // selection, just as the app does, rather than the document operation frame.
    const selected=data?.document.crease_pattern.line_segments.flatMap((line,i)=>
      ['Black0','Red1','Blue2'].includes(line.color)?[i+1]:[]);
    const f=selected?cp.folded_figure_fold_selected(handle,selected,1,'Order5',undefined,0)
      :cp.folded_figure_fold(handle,1,'Order5',undefined,0);
    row.foldMs=performance.now()-t;
    t=begin('scene');
    const kernel=cp.folded_figure_paper_scene(f.handle,handle);
    row.sceneMs=performance.now()-t;
    if(!kernel?.faces.length)throw new Error('No ordered paper scene');
    row.faces=kernel.faces.length;
    t=begin('prepare');
    const source=H.connectedSpreadSource(kernel);
    row.prepareMs=performance.now()-t;
    t=begin('solve');
    const solution=sp.solve_layer_spread(source.input);
    row.solveMs=performance.now()-t;
    row.solveStatus=solution.diagnostics.status;
    t=begin('project');
    scene=H.posedSpreadScene({scene:kernel,prepared:{source,solution}},0,
      job.source==='bodo'?{kind:'connected',version:1,amount:1.03,reveal:[-1.7891637209195692,0.8938082455120017]}:{kind:'connected',version:1,amount:1,reveal:[0.8,0.6]},H.CAPTURE_PX_PER_UNIT);
    row.projectMs=performance.now()-t;
    if(!scene.connected)throw new Error('No connected drawing');
    fs.writeFileSync(path.join(job.out,'cases',job.id+'.json'),JSON.stringify({scene,view:{scene:kernel,prepared:{source,solution}}}));
    cp.free_folded_figure(f.handle);cp.free_document(handle);
  } else scene=JSON.parse(fs.readFileSync(job.file)).scene;
  const mesh=scene.connected.mesh;
  row.faces=scene.connected.rings.length;row.triangles=mesh.triangles.length;row.ink=scene.connected.ink.length;row.cyclic=!mesh.visibility.ranks;
  let t=begin('capture');
  const polygons=H.visibleFragments(mesh);
  row.polygonsMs=performance.now()-t;
  t=performance.now();
  const clip=H.createLineClipper(mesh);
  const lines=scene.connected.ink.map(e=>clip(e.face,e.a,e.b));
  row.inkMs=performance.now()-t;
  row.captureMs=row.polygonsMs+row.inkMs;
  row.polygonHash=hash(polygons);row.lineHash=hash(lines);
  row.fragments=polygons.length;row.intervals=lines.reduce((n,l)=>n+l.length,0);
  begin('verify');
  const signature=path.join(job.out,'cases',job.id+'.baseline');
  if(job.mode==='prepare')fs.writeFileSync(signature,JSON.stringify({polygons,lines}));
  else if(fs.existsSync(signature)){
    const previous=JSON.parse(fs.readFileSync(signature));
    row.polygonsIdentical=hash(previous.polygons)===row.polygonHash;
    row.linesIdentical=hash(previous.lines)===row.lineHash;
    if (!row.polygonsIdentical || !row.linesIdentical) row.status='different';
    if(!row.linesIdentical){
      let differences=0,maxError=0,lengthChanges=0;
      previous.lines.forEach((old,i)=>{const now=lines[i];if(JSON.stringify(old)!==JSON.stringify(now))differences++;if(old.length!==now.length)lengthChanges++;else old.forEach((r,j)=>r.forEach((v,k)=>maxError=Math.max(maxError,Math.abs(v-now[j][k]))));});
      row.differences={lines:differences,lengthChanges,maxError};
      fs.writeFileSync(path.join(job.out,job.id+'.difference.json'),JSON.stringify({previous:previous.lines,current:lines}));
    }
  }
  row.status ??= 'ok';
} catch(e){row.status='error';row.phase=phase;row.error=e instanceof Error?e.message:JSON.stringify(e);}
parentPort.postMessage({kind:'result',row});
