/** Built into an ignored, self-contained module worker by prepare-browser-benchmark.mjs. */
import { createCameraSpreadSession } from '../../apps/web/src/cp-workspace/folded/cameraSpreadSession.ts';
import { cameraSpreadInitialView } from '../../apps/web/src/cp-workspace/folded/cameraSpreadView.ts';
import { cameraSpreadLift } from '../../apps/web/src/cp-workspace/folded/cameraSpreadLift.ts';
self.postMessage({kind:'ready'});
self.onmessage = ({data:{scene,width,height,dpr}}) => {
  const session=createCameraSpreadSession();
  let stage='load',begin=performance.now();
  try {
    session.load(1,scene);
    const prepareMs=performance.now()-begin;
    const mesh=cameraSpreadLift(scene);
    const {prepareMs:topologyMs,solveMs:solveAndProbeMs}=mesh.diagnostics;
    stage='first-bitmap';begin=performance.now();
    const pose={directionDeg:247,inclinationDeg:45};
    const spread={kind:'camera',amount:.06,projection:'diagram',...pose,camera:cameraSpreadInitialView(pose)};
    const bitmap=session.render({key:1,spread,rotationDeg:0,surface:{width,height,dpr}});
    const firstBitmapMs=performance.now()-begin;
    if(!bitmap)throw new Error('No initial bitmap');
    self.postMessage({kind:'result',status:'ok',prepareMs,topologyMs,solveAndProbeMs,firstBitmapMs,
      bitmapWidth:bitmap.width,bitmapHeight:bitmap.height,bitmap},[bitmap]);
  } catch(error) { self.postMessage({kind:'result',status:'error',stage,stageElapsedMs:performance.now()-begin,error:String(error)}); }
  finally {session.release(1);}
};
