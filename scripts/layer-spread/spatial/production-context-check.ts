import { wrap } from 'comlink';
import type { SimulatorWorkerApi } from '../../../apps/web/src/simulator/simulatorSession';
import type { Folded3dMesh } from '../../../apps/web/src/cp-workspace/folded/folded3dMesh';
import { folded3dMeshPayload, folded3dWindowRenderSettings } from '../../../apps/web/src/cp-workspace/folded/folded3dWindow';
import { DEFAULT_PAPER_STYLE } from '../../../apps/web/src/lib/paper/paperStyle';

/** Exercise ordinary and spatial meshes on the real worker's shared context,
 * including ordinary rendering before spread is enabled and after release. */
export async function checkWorkerContexts(mesh: Folded3dMesh) {
  const results = [];
  for (const spatialFirst of [false, true]) {
    const worker = new Worker(new URL('../../../apps/web/src/workers/simulatorWorker.ts', import.meta.url), { type: 'module' });
    const api = wrap<SimulatorWorkerApi>(worker);
    try {
      await api.attachBitmapOutput(128, 128);
      const load = async (spatial: boolean) => {
        const { payload } = folded3dMeshPayload(spatial ? mesh : { ...mesh, spatial: undefined, displacement: undefined });
        const result = await api.loadFolded3dMesh(payload);
        if (!result) throw new Error(`Could not create ${spatial ? 'spatial' : 'ordinary'} mesh`);
        return result.token;
      };
      const paint = async (token: number, spatial: boolean) => {
        const frame = await api.setFolded3dMeshCamera(token, {
          view: { yaw: 0.3, pitch: 0.6, zoom: 1 }, width: 128, height: 128,
        }, {
          ...folded3dWindowRenderSettings({ style: DEFAULT_PAPER_STYLE, displayStyle: 'Paper5', devicePixelRatio: 1 }),
          backgroundAlpha: 0,
          // Synthetic meshes carry a full translucent range rather than skins.
          faceAlpha: spatial ? 1 : 0.8,
        });
        if (!frame?.bitmap) throw new Error('Worker did not return a bitmap');
        try {
          const canvas = new OffscreenCanvas(frame.bitmap.width, frame.bitmap.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(frame.bitmap, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          if (!pixels.some((value, i) => i % 4 === 3 && value > 0)) throw new Error('Worker returned an empty frame');
        } finally {
          frame.bitmap.close();
        }
      };
      const first = await load(spatialFirst);
      await paint(first, spatialFirst);
      const second = await load(!spatialFirst);
      const ordinary = spatialFirst ? second : first;
      const spatial = spatialFirst ? first : second;
      const shared = await load(true);
      await paint(ordinary, false);
      await paint(spatial, true);
      await api.releaseFolded3dMesh(spatial);
      await paint(shared, true);
      await api.releaseFolded3dMesh(shared);
      // Repeated last-release/reopen must not leak contexts and evict ordinary
      // rendering. More iterations than the browser's worker context budget.
      for (let i = 0; i < 6; i++) {
        const reopened = await load(true);
        await paint(reopened, true);
        await api.releaseFolded3dMesh(reopened);
        await paint(ordinary, false);
      }
      results.push({ name: `shared worker context: ${spatialFirst ? 'spatial' : 'ordinary'} first`, passed: true });
    } finally {
      await api.dispose();
      worker.terminate();
    }
  }
  return results;
}
