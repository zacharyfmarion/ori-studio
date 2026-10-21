import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  root: 'apps/web',
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { cameraSpreadLift, cameraSpreadStrain } = await server.ssrLoadModule(
  '/src/cp-workspace/folded/cameraSpreadLift.ts'
);
const manifest = JSON.parse(await readFile('artifacts/camera-spread/manifest.json', 'utf8'));
const results = [];
for (const model of manifest.models.filter((m) => m.status === 'solved')) {
  const { scene } = JSON.parse(await readFile(`artifacts/camera-spread/${model.id}.json`, 'utf8'));
  try {
    const mesh = cameraSpreadLift(scene);
    const result = {
      id: model.id,
      faces: scene.faces.length,
      meshVertices: mesh.xy.length,
      triangles: mesh.triangles.length,
      ...mesh.diagnostics,
      strainAt3Percent: cameraSpreadStrain(mesh, 0.03),
      strainAt6Percent: cameraSpreadStrain(mesh, 0.06),
    };
    results.push(result);
    console.log(model.id, JSON.stringify(result));
  } catch (error) {
    results.push({ id: model.id, error: String(error) });
    console.log(model.id, String(error));
  }
  await writeFile('artifacts/camera-spread/evaluation.json', JSON.stringify(results, null, 2));
}
await server.close();
