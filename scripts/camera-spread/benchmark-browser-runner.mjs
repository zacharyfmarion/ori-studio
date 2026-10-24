/** Normal standalone benchmark page: start/stop/export with visible controls. */
const config=await fetch('./browser-config.json').then(r=>r.json());
const key=`camera-preparation:${config.identity}`;
const saved=JSON.parse(localStorage.getItem(key)||'null');
const rows=saved?.rows??[];
const canvas=document.querySelector('canvas');
const context=canvas.getContext('bitmaprenderer');
const status=document.querySelector('#status');
const list=document.querySelector('#results');
let running=false,stop=false,fatalError=null;
const gl=new OffscreenCanvas(1,1).getContext('webgl2');
const debug=gl?.getExtension('WEBGL_debug_renderer_info');
const environment={userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,
 deviceMemoryGiB:navigator.deviceMemory??null,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null};
gl?.getExtension('WEBGL_lose_context')?.loseContext();
const result=()=>({schema:1,config,environment,updatedAt:new Date().toISOString(),rows});
function save(){localStorage.setItem(key,JSON.stringify(result()));}
function show(){
 status.textContent=fatalError??`${rows.length}/${config.models.length} models recorded${running?' · running':''}`;
 list.textContent=rows.slice(-12).map(r=>`${r.id}: ${r.trials.map(t=>t.status==='ok'?Math.round(t.prepareMs)+' ms':t.status).join(', ')}`).join('\n');
}
async function trial(scene){
 const start=performance.now();
 const worker=new Worker('./browser-worker.mjs',{type:'module'});
 return await new Promise(resolve=>{
  let started,startupMs,done=false;
  const timer=setTimeout(()=>finish({status:'timeout',stage:started?'load-or-bitmap':'startup',deadlineMs:config.timeoutMs}),config.timeoutMs);
  function finish(row){if(done)return;done=true;clearTimeout(timer);worker.terminate();resolve({...row,workerStartupMs:startupMs,totalWallMs:performance.now()-start});}
  worker.onerror=e=>finish({status:'error',error:e.message});
  worker.onmessage=async({data})=>{
   if(data.kind==='ready'){startupMs=performance.now()-start;started=performance.now();worker.postMessage({scene,...config.surface});}
   else if(data.kind==='result'){
    const {bitmap,...row}=data;
    row.loadAndBitmapRpcMs=performance.now()-started;
    if(bitmap){canvas.width=bitmap.width;canvas.height=bitmap.height;context.transferFromImageBitmap(bitmap);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      row.loadAndPresentMs=performance.now()-started;
    }
    finish(row);
   }
  };
 });
}
document.querySelector('#start').onclick=async()=>{
 if(running)return;running=true;stop=false;fatalError=null;show();
 document.querySelector('#start').disabled=true;
 try{
 const done=new Set(rows.map(r=>r.id));
 for(const model of config.models){
  if(stop)break;if(done.has(model.id))continue;
  status.textContent=`${rows.length}/${config.models.length} · ${model.id}`;
  const start=performance.now();
  const response=await fetch(`./scenes/${encodeURIComponent(model.id)}.json`);
  if(!response.ok)throw new Error(`Scene fetch failed: ${response.status}`);
  const text=await response.text();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==model.sceneSha256)throw new Error('Scene hash differs from the CPU baseline');
  const scene=JSON.parse(text),fetchParseHashMs=performance.now()-start,trials=[];
  for(let n=0;n<config.repeats;n++){
    status.textContent=`${rows.length}/${config.models.length} · ${model.id} · trial ${n+1}/${config.repeats}`;
    trials.push(await trial(scene));
    if(trials.at(-1).status!=='ok')break;
  }
  rows.push({id:model.id,faces:model.faces,sceneSha256:digest,fetchParseHashMs,trials});save();show();
 }
 }catch(error){fatalError=String(error);}
 finally{running=false;document.querySelector('#start').disabled=false;show();}
};
document.querySelector('#stop').onclick=()=>{stop=true;};
document.querySelector('#download').onclick=()=>{
 const url=URL.createObjectURL(new Blob([JSON.stringify(result(),null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='browser-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
show();
