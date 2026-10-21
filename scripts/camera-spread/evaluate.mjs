import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  root: 'apps/web',
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { cameraSpreadLift, cameraSpreadStrain, liftWeights } = await server.ssrLoadModule(
  '/src/cp-workspace/folded/cameraSpreadLift.ts'
);
const { cameraPaintPlans } = await server.ssrLoadModule('/src/cp-workspace/folded/cameraSpreadVisibility.ts');
const manifest = JSON.parse(await readFile('artifacts/camera-spread/manifest.json', 'utf8'));
const results = [];
// Sample departure from each aux line's lifted endpoint chord. This measures
// within-face bow, independently of the camera direction and layer visibility.
function auxBow(mesh, scene, amount) {
  const bows = [];
  for (const line of scene.aux_lines) {
    const normalize = (p) => ({ x: (p.x - mesh.origin.x) / mesh.size, y: (p.y - mesh.origin.y) / mesh.size });
    const a = normalize(line.from),
      b = normalize(line.to);
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    if (length < 1e-6) continue;
    const height = (p) => {
      const weights = liftWeights(mesh, line.face, p);
      return weights ? weights.reduce((s, [v, w]) => s + w * mesh.heights[v], 0) : null;
    };
    const ha = height(a),
      hb = height(b);
    if (ha === null || hb === null) continue;
    let bow = 0;
    for (let i = 1; i < 20; i++) {
      const t = i / 20;
      const h = height({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      if (h !== null) bow = Math.max(bow, (amount * Math.abs(h - (ha + t * (hb - ha)))) / length);
    }
    bows.push(bow);
  }
  bows.sort((a, b) => a - b);
  return { lines: bows.length, p95: bows[Math.floor(bows.length * 0.95)] ?? 0, max: bows.at(-1) ?? 0 };
}
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
      sampledAuxBowAt6Percent: auxBow(mesh, scene, 0.06),
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
