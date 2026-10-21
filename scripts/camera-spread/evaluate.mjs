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
const { cameraPaintPlans } = await server.ssrLoadModule('/src/cp-workspace/folded/cameraSpreadVisibility.ts');
const manifest = JSON.parse(await readFile('artifacts/camera-spread/manifest.json', 'utf8'));
const results = [];
for (const model of manifest.models.filter((m) => m.status === 'solved')) {
  const { scene } = JSON.parse(await readFile(`artifacts/camera-spread/${model.id}.json`, 'utf8'));
  try {
    const mesh = cameraSpreadLift(scene);
    const paintStart = performance.now();
    const plans = cameraPaintPlans(mesh, scene);
    let nonfinitePoints = 0;
    let outOfRangeHeights = 0;
    const low = Math.min(...mesh.heights),
      high = Math.max(...mesh.heights);
    for (const plan of [plans.front, plans.back])
      for (const piece of plan.pieces)
        for (const point of piece.points) {
          if (!point.every(Number.isFinite)) nonfinitePoints++;
          if (point[2] < low - 1e-6 || point[2] > high + 1e-6) outOfRangeHeights++;
        }
    const result = {
      id: model.id,
      faces: scene.faces.length,
      meshVertices: mesh.xy.length,
      triangles: mesh.triangles.length,
      paintPrepareMs: performance.now() - paintStart,
      frontPaintPieces: plans.front.pieces.length,
      backPaintPieces: plans.back.pieces.length,
      wovenPatchTriangles: plans.front.pieces.filter((p) => p.patch && p.kind === 'face').length,
      nonfinitePoints,
      outOfRangeHeights,
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
