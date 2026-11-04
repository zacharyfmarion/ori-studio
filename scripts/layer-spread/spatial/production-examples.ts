import {
  ensureSpatialSpread,
  posedSpatialMesh,
} from '../../../apps/web/src/cp-workspace/folded/folded3dSpread';
import { folded3dMesh } from '../../../apps/web/src/cp-workspace/folded/folded3dMesh';
import { spatialSpreadFromPercent, spatialSpreadPercent } from '../../../apps/web/src/cp-workspace/folded/spatialSpreadSettings';
import {
  folded3dSceneCamera,
  folded3dPaperScene,
} from '../../../apps/web/src/cp-workspace/folded/folded3dScene';
import {
  folded3dMeshPayload,
  folded3dWindowRenderSettings,
} from '../../../apps/web/src/cp-workspace/folded/folded3dWindow';
import { FoldedMeshSource } from '../../../apps/web/src/simulator/foldedMeshSource';
import { captureSpatialScene } from '../../../apps/web/src/layer-spread/spatialCapture';
import {
  surfacePaperStyle,
  PAPER_STYLE_POLICIES,
} from '../../../apps/web/src/lib/paper/paperStyleResolve';
import { DEFAULT_PAPER_STYLE } from '../../../apps/web/src/lib/paper/paperStyle';
import { paperSceneSvgBody } from '../../../apps/web/src/lib/paper/paperSvg';
import {
  DEFAULT_FOLDED_3D_CAMERA,
  antipodalCamera,
} from '../../../apps/web/src/cp-workspace/folded/folded3dCamera';
import type { OristudioCpFold3dStepResult } from '../../../apps/web/src/engine/oristudioCpTypes';
import type { Folded3dMesh } from '../../../apps/web/src/cp-workspace/folded/folded3dMesh';

const params = new URLSearchParams(location.search);
const size = Math.max(128, Math.min(1600, Number(params.get('size')) || 480));
const canvas = document.querySelector<HTMLCanvasElement>('#live')!;
canvas.width = canvas.height = size;
const buffer = new OffscreenCanvas(size, size);
const result = document.querySelector('#result')!;
const style = surfacePaperStyle(
  DEFAULT_PAPER_STYLE,
  PAPER_STYLE_POLICIES['folded-3d']
);
let source: FoldedMeshSource | null = null,
  opened: Folded3dMesh,
  legacy: Folded3dMesh;
let data: Pick<OristudioCpFold3dStepResult, 'render' | 'snapshot'>;
let loadedName: string | null = null;
const initialCamera = {
  ...DEFAULT_FOLDED_3D_CAMERA,
  yaw: Number(params.get('yaw') ?? DEFAULT_FOLDED_3D_CAMERA.yaw),
  pitch: Number(params.get('pitch') ?? DEFAULT_FOLDED_3D_CAMERA.pitch),
  zoom: Number(params.get('zoom') ?? 0.82),
};
let camera = { ...initialCamera },
  amount = 1,
  serial = 0;
const figure = () => ({
  displayStyle: 'Paper5' as const,
  spread: { kind: 'spatial' as const, version: 1 as const, amount },
});
let lastMesh: Folded3dMesh | null = null;
function draw() {
  const mesh = amount > 0 ? opened : legacy;
  if (mesh !== lastMesh) {
    source?.dispose();
    source = FoldedMeshSource.create(buffer, folded3dMeshPayload(mesh).payload);
    lastMesh = mesh;
  }
  if (!source) throw new Error('Graphics unavailable');
  const view = folded3dSceneCamera(camera, mesh, size);
  source.render(view, {
    ...folded3dWindowRenderSettings({
      style,
      displayStyle: 'Paper5',
      devicePixelRatio: 1,
    }),
    displacementScale: amount,
  });
  canvas.getContext('2d')!.clearRect(0, 0, size, size);
  canvas.getContext('2d')!.drawImage(buffer, 0, 0);
}
async function capture() {
  const revision = serial;
  const mesh =
    amount > 0 ? posedSpatialMesh(figure(), data.render, null)! : legacy;
  const view = folded3dSceneCamera(camera, mesh, size);
  const started = performance.now();
  const scene =
    amount > 0
      ? await captureSpatialScene(mesh, view, style)
      : folded3dPaperScene(mesh, data.render, view, {
          style,
          markHidden: true,
          tolerances: data.snapshot.diagnostics.tolerances,
        });
  if (serial !== revision) return;
  const body = paperSceneSvgBody(scene, style, {
    unitsPerPt: 4 / 3,
    project: (p) => p,
    keepHiddenFaces: false,
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
  (document.querySelector('#captured') as HTMLImageElement).src =
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  result.textContent = JSON.stringify(
    {
      status: 'ready',
      amount,
      faces: data.render.face_count,
      vertices: data.render.material?.positions.length,
      captureMs: Math.round(performance.now() - started),
      items: scene.items.length,
    },
    null,
    2
  );
  return { scene, svg };
}
async function load(name: string) {
  ++serial;
  result.textContent = 'Preparing…';
  source?.dispose();
  source = null;
  lastMesh = null;
  // Retain source identity across amount/camera samples, as the app does, so
  // sweeps exercise the cached solve instead of solving a fresh JSON object.
  if (loadedName !== name) {
    data = await (
      await fetch(
        new URL(
          `../../../artifacts/spatial-production/${name}.json`,
          import.meta.url
        )
      )
    ).json();
    loadedName = name;
  }
  if (data.snapshot.verdict.verdict !== 'folded')
    throw new Error(`Spread refused: ${data.snapshot.verdict.verdict}`);
  opened = await ensureSpatialSpread(data.render);
  const built = folded3dMesh(data.render);
  if (built.kind !== 'mesh') throw new Error('Mesh unavailable');
  legacy = built.mesh;
  camera = { ...initialCamera };
  draw();
  await capture();
}
const safely = (task: Promise<unknown>) =>
  task.catch((error) => {
    result.textContent = JSON.stringify({
      status: 'refused',
      error: String(error),
    });
  });
(document.querySelector('#model') as HTMLSelectElement).onchange = (e) =>
  safely(load((e.target as HTMLSelectElement).value));
(document.querySelector('#amount') as HTMLInputElement).oninput = (e) => {
  ++serial;
  amount = spatialSpreadFromPercent(Number((e.target as HTMLInputElement).value));
  document.querySelector('#amount-label')!.textContent =
    `${Math.round(spatialSpreadPercent(amount))}%`;
  draw();
};
(document.querySelector('#amount') as HTMLInputElement).onchange = () =>
  safely(capture());
document
  .querySelector('#capture')!
  .addEventListener('click', () => safely(capture()));
document.querySelector('#front')!.addEventListener('click', () => {
  ++serial;
  camera = { ...initialCamera };
  draw();
  safely(capture());
});
document.querySelector('#back')!.addEventListener('click', () => {
  ++serial;
  camera = antipodalCamera(camera);
  draw();
  safely(capture());
});
let drag: { x: number; y: number } | null = null;
canvas.onpointerdown = (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  camera = {
    ...camera,
    yaw: camera.yaw + (e.clientX - drag.x) * 0.01,
    pitch: camera.pitch + (e.clientY - drag.y) * 0.01,
  };
  drag = { x: e.clientX, y: e.clientY };
  ++serial;
  draw();
};
canvas.onpointerup = () => {
  drag = null;
  safely(capture());
};
Object.assign(window, {
  runSpatialCase: async (name: string, value = 1, back = false) => {
    amount = value;
    (document.querySelector('#model') as HTMLSelectElement).value = name;
    (document.querySelector('#amount') as HTMLInputElement).value = String(
      spatialSpreadPercent(value)
    );
    document.querySelector('#amount-label')!.textContent =
      `${Math.round(spatialSpreadPercent(value))}%`;
    await load(name);
    if (back) {
      camera = antipodalCamera(camera);
      draw();
      await capture();
    }
    return JSON.parse(result.textContent!);
  },
});
const initialModel = params.get('model') ?? 'strip';
(document.querySelector('#model') as HTMLSelectElement).value = initialModel;
safely(load(initialModel));

// Independent picking checks sample away from projected boundaries, where
// coverage antialiasing is not a material-selection question.
Object.assign(window, {
  checkSpatialPixels: async () => {
    const { projectSpatialMesh } =
      await import('../../../apps/web/src/cp-workspace/folded/folded3dSpatialScene');
    const { pickSpread, barycentric } = await import('@oristudio/layer-spread');
    const mesh = posedSpatialMesh(figure(), data.render, null)!;
    const view = folded3dSceneCamera(camera, mesh, size);
    const projected = projectSpatialMesh(mesh, view).projected;
    const offscreen = new OffscreenCanvas(size, size);
    offscreen.getContext('webgl2', {
      antialias: false,
      alpha: true,
      stencil: true,
      premultipliedAlpha: true,
    });
    const gpu = FoldedMeshSource.create(
      offscreen,
      folded3dMeshPayload({ ...mesh, displacement: undefined }).payload
    )!;
    const renderer = (gpu as unknown as { mesh: { render: Function } }).mesh;
    const original = renderer.render.bind(renderer);
    renderer.render = (c: any, s: any, t: any, o: any) => {
      const f = mesh.spatial!.ranges.findIndex(
        (r) => r.faceIndexStart === (o?.faceRange?.start ?? 0)
      );
      const id = f + 1,
        color = [(id & 255) / 255, ((id >> 8) & 255) / 255, 0];
      return original(c, { ...s, frontColor: color, backColor: color }, t, o);
    };
    gpu.render(view, {
      ...folded3dWindowRenderSettings({
        style,
        displayStyle: 'Paper5',
        devicePixelRatio: 1,
      }),
      lighting: false,
      showEdges: false,
    });
    const gl = offscreen.getContext('webgl2')!,
      pixel = new Uint8Array(4);
    let checked = 0;
    const mismatches = [];
    for (let y = 16; y < size - 16; y += 7)
      for (let x = 16; x < size - 16; x += 7) {
        const point: [number, number] = [x + 0.5, size - y - 0.5];
        const picks = [
          [0, 0],
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ].map(
          ([dx, dy]) =>
            pickSpread(projected, [point[0] + dx!, point[1] + dy!])?.face
        );
        if (picks[0] === undefined || picks.some((p) => p !== picks[0]))
          continue;
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const actual = pixel[0]! + 256 * pixel[1]! - 1;
        checked++;
        if (actual !== picks[0]) {
          const candidates = projected.triangles
            .flatMap((ids, t) => {
              const ps = ids.map((v) => projected.positions[v]!);
              const weights = barycentric(ps[0]!, ps[1]!, ps[2]!, point);
              if (!weights || weights.some((w) => w < -1e-8)) return [];
              return [
                {
                  face: projected.triangleFaces[t],
                  depth: weights.reduce((s, w, k) => s + w * ps[k]![2], 0),
                  weights,
                },
              ];
            })
            .sort((a, b) => b.depth - a.depth);
          mismatches.push({
            x,
            y,
            expected: picks[0],
            actual,
            pixel: [...pixel],
            candidates,
            above: projected.visibility.above[picks[0]!],
          });
        }
      }
    const depthBits = gpu.depthBits;
    // Ordinary fixed-function raster depth can differ around near-coincident
    // independent surfaces. Report these separately; never excuse a violated
    // known blocker, and never change the production winner to pass a test.
    const near = view.camDist * 0.1,
      far = view.camDist + 2 * view.depthRange;
    const contactTies = mismatches.filter((m) => {
      if (
        projected.visibility.above[m.expected!]?.includes(m.actual) ||
        projected.visibility.above[m.actual]?.includes(m.expected!)
      )
        return false;
      const a = m.candidates.find((c) => c.face === m.expected),
        b = m.candidates.find((c) => c.face === m.actual);
      return (
        a &&
        b &&
        (Math.abs(a.depth - b.depth) * far * near) / (far - near) < 2e-5
      );
    });
    gpu.dispose();
    return {
      checked,
      mismatches: mismatches.filter((m) => !contactTies.includes(m)),
      contactTies,
      depthBits,
      view,
    };
  },
  captureSpatialRaster: async () => {
    const mesh = posedSpatialMesh(figure(), data.render, null)!;
    const view = folded3dSceneCamera(camera, mesh, size);
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL(
          '../../../apps/web/src/layer-spread/spatialCapture.worker.ts',
          import.meta.url
        ),
        { type: 'module' }
      );
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if (data.kind !== 'scene') {
          reject(data);
          return;
        }
        const scene = data.scene,
          body = paperSceneSvgBody(scene, style, {
            unitsPerPt: 4 / 3,
            project: (p) => p,
            keepHiddenFaces: false,
          });
        (document.querySelector('#captured') as HTMLImageElement).src =
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`)}`;
        resolve({
          items: scene.items.length,
          markup: scene.items.filter((i: any) => i.kind === 'markup').length,
        });
      };
      worker.postMessage({ mesh, camera: view, style, raster: true, mm: 80 });
    });
  },
});
