/// <reference lib="webworker" />
import { SpreadComplexityError } from '@oristudio/layer-spread';
import type { PaperScene } from '@treemaker/origami-simulator';
import {
  projectSpatialMesh,
  spatialPaperScene,
} from '../cp-workspace/folded/folded3dSpatialScene';
import {
  folded3dMeshPayload,
  folded3dWindowRenderSettings,
} from '../cp-workspace/folded/folded3dWindow';
import { FoldedMeshSource } from '../simulator/foldedMeshSource';
import type { SpatialCaptureRequest } from './spatialCapture';

/** A bounded raster remains ordered paper, never a depth-only approximation.
 * Hidden material anchors survive so a saved diagram can still identify faces. */
async function rasterScene({
  mesh,
  camera,
  style,
  mm,
}: SpatialCaptureRequest): Promise<PaperScene> {
  const { projected } = projectSpatialMesh(mesh, camera);
  let dx = 1,
    dy = 1;
  for (const p of projected.positions) {
    dx = Math.max(dx, Math.abs(p[0] - camera.width / 2));
    dy = Math.max(dy, Math.abs(p[1] - camera.height / 2));
  }
  const span = 2 * Math.max(dx, dy);
  const scale = Math.min(4092 / span, (Math.max(1, mm) * 300) / 25.4 / span);
  const pad = 2 / scale;
  dx += pad;
  dy += pad;
  const width = Math.ceil(2 * dx * scale),
    height = Math.ceil(2 * dy * scale);
  const canvas = new OffscreenCanvas(width, height);
  // Positions are already posed. Do not apply the displacement a second time.
  const { payload } = folded3dMeshPayload({ ...mesh, displacement: undefined });
  const source = FoldedMeshSource.create(canvas, payload);
  if (!source) throw new Error('Spatial raster graphics unavailable');
  try {
    source.render(
      { ...camera, width, height, scale: camera.scale * scale },
      folded3dWindowRenderSettings({
        style,
        displayStyle: 'Paper5',
        devicePixelRatio: scale,
      })
    );
    if (
      source.drawingBufferSize.width !== width ||
      source.drawingBufferSize.height !== height
    )
      throw new Error('Spatial raster exceeds graphics budget');
    const png = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
    );
    let binary = '';
    for (let i = 0; i < png.length; i += 8192)
      binary += String.fromCharCode(...png.subarray(i, i + 8192));
    const x = camera.width / 2 - width / (2 * scale),
      y = camera.height / 2 - height / (2 * scale);
    const w = width / scale,
      h = height / scale;
    const bounds = { minX: x, minY: y, maxX: x + w, maxY: y + h };
    return {
      sheet: mesh.sheet * camera.scale,
      bounds,
      items: [
        ...projected.triangles.map((ids, t) => ({
          kind: 'face' as const,
          face: projected.triangleFaces[t]!,
          side: 'front' as const,
          shade: 1,
          rings: [
            ids.map(
              (v) => projected.positions[v]!.slice(0, 2) as [number, number]
            ),
          ],
          hidden: true,
        })),
        {
          kind: 'markup',
          hidden: false,
          bounds,
          svg: `<image x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/png;base64,${btoa(binary)}"/>`,
        },
      ],
    };
  } finally {
    source.dispose();
  }
}

self.onmessage = async ({ data }: MessageEvent<SpatialCaptureRequest>) => {
  try {
    const scene = data.raster
      ? await rasterScene(data)
      : spatialPaperScene(data.mesh, data.camera, data.style);
    self.postMessage({ kind: 'scene', scene });
  } catch (error) {
    self.postMessage({
      kind: error instanceof SpreadComplexityError ? 'budget' : 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
