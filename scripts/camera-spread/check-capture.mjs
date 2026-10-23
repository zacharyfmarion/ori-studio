/** Private-corpus vector-capture coverage; no corpus data is written to Git. */
import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  root: 'apps/web',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
const results = [];
try {
  const { captureCameraSpread } = await server.ssrLoadModule('/src/diagram/capture/cameraSpreadCapture.ts');
  const { storeScene } = await server.ssrLoadModule('/src/diagram/capture/captureFolded.ts');
  const { readPaperFaces } = await server.ssrLoadModule('/src/diagram/document/paperFacesFile.ts');
  const { cameraSpreadInitialView } = await server.ssrLoadModule('/src/cp-workspace/folded/cameraSpreadView.ts');
  const manifest = JSON.parse(await readFile('artifacts/camera-spread/manifest.json', 'utf8'));
  const filter = process.env.CAMERA_SPREAD_MODEL;
  for (const model of manifest.models.filter((m) => m.status === 'solved' && (!filter || m.id.includes(filter)))) {
    const { scene } = JSON.parse(await readFile(`artifacts/camera-spread/${model.id}.json`, 'utf8'));
    const started = performance.now();
    try {
      const captured = captureCameraSpread(
        scene,
        {
          kind: 'camera',
          amount: 0.18,
          projection: 'diagram',
          directionDeg: 192,
          inclinationDeg: 29,
          camera: cameraSpreadInitialView({ directionDeg: 192, inclinationDeg: 29 }),
        },
        0
      );
      const stored = storeScene(captured.scene, captured.paperScale, null, captured.paperFaces);
      if (stored.kind !== 'picture')
        throw new Error(
          `Vector scene exceeds storage budget: ${JSON.stringify(stored.scene).length} bytes, ${stored.scene.items.length} items, ${JSON.stringify(captured.paperFaces).length} anchor bytes`
        );
      if (!stored.picture.paperFaces || !readPaperFaces(stored.picture.paperFaces))
        throw new Error('Anchor map did not survive storage');
      const picture = JSON.parse(stored.picture.sceneJson);
      results.push({
        id: model.id,
        faces: scene.faces.length,
        items: picture.items.length,
        bytes: stored.picture.sceneJson.length,
        anchorBytes: stored.picture.paperFaces.length,
        ms: performance.now() - started,
      });
    } catch (error) {
      results.push({ id: model.id, error: String(error), ms: performance.now() - started });
    }
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile('artifacts/camera-spread/production-capture-check.json', JSON.stringify(results, null, 2));
  if (results.some((r) => r.error)) process.exitCode = 1;
} finally {
  await server.close();
}
