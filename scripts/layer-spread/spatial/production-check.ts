import { FoldedMeshSource } from '../../../apps/web/src/simulator/foldedMeshSource';
import {
  folded3dMeshPayload,
  folded3dWindowRenderSettings,
} from '../../../apps/web/src/cp-workspace/folded/folded3dWindow';
import { projectSpatialMesh, spatialPaperScene } from '../../../apps/web/src/cp-workspace/folded/folded3dSpatialScene';
import { pickSpread, type SpatialPlane } from '@oristudio/layer-spread';
import { DEFAULT_PAPER_STYLE } from '../../../apps/web/src/lib/paper/paperStyle';
import type { Folded3dMesh } from '../../../apps/web/src/cp-workspace/folded/folded3dMesh';
import type { CameraUniforms } from '@treemaker/origami-simulator';

const plane = (faces: number[], orders: [number, number][]): SpatialPlane => ({
  faces,
  orders,
  groups: faces,
  normal: [0, 0, 1],
  origin: [0, 0, 0],
  witnesses: [],
});
const cases = [
  {
    name: 'known order overrides depth',
    depths: [0.5, 0],
    planes: [plane([0, 1], [[0, 1]])],
  },
  {
    name: 'unrelated foreground',
    depths: [0.5, 0, 0.2],
    planes: [plane([0, 1], [[0, 1]]), plane([2], [])],
  },
  {
    name: 'unrelated background',
    depths: [0.5, 0, -0.2],
    planes: [plane([0, 1], [[0, 1]]), plane([2], [])],
  },
  {
    name: 'local cycle in front of other plane',
    depths: [0.5, 0, 0.2],
    planes: [
      plane(
        [0, 1],
        [
          [0, 1],
          [1, 0],
        ]
      ),
      plane([2], []),
    ],
  },
  {
    name: 'local cycle behind other plane',
    depths: [0.5, 0, 0.7],
    planes: [
      plane(
        [0, 1],
        [
          [0, 1],
          [1, 0],
        ]
      ),
      plane([2], []),
    ],
  },
  {
    name: 'survivor occluded by another plane',
    depths: [0.5, 0, -0.2, 0.2],
    planes: [
      plane(
        [0, 1, 2],
        [
          [0, 1],
          [1, 0],
          [0, 2],
        ]
      ),
      plane([3], []),
    ],
  },
  {
    name: 'back side reverses order',
    depths: [0.5, 0],
    planes: [
      {
        ...plane([0, 1], [[0, 1]]),
        origin: [0, 0, 5] as [number, number, number],
      },
    ],
  },
  {
    name: 'absent intermediate face',
    depths: [0.5, 0, 0.2],
    planes: [
      plane(
        [0, 1, 2],
        [
          [0, 1],
          [1, 2],
        ]
      ),
    ],
    absent: 1,
  },
  {
    name: 'material-owned hidden crease',
    depths: [0.5, 0],
    planes: [plane([0, 1], [[0, 1]])],
    ink: 0,
  },
  {
    name: 'buried hinge cannot escape through its adjoining plane',
    depths: [0.5, 0, 0.5],
    planes: [plane([0, 1], [[0, 1]]), plane([2], [])],
    hinge: true,
    ink: 0,
  },
  {
    name: 'exposed hinge retains its outline',
    depths: [0.5, 0, 0.5],
    planes: [plane([0, 1], [[1, 0]]), plane([2], [])],
    hinge: true,
    ink: 0,
    inkVisible: true,
  },
  {
    name: 'shared hinge retains local cycle physical fallback',
    depths: [0.5, 0, 0.5],
    planes: [plane([0, 1], [[0, 1], [1, 0]]), plane([2], [])],
    hinge: true,
    ink: 0,
    inkVisible: true,
  },
];
const camera: CameraUniforms = {
  center: [0, 0, 0],
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  width: 128,
  height: 128,
  scale: 50,
  camDist: 3.2,
  depthRange: 2,
};
const colors = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
] as [number, number, number][];
const result = [];
try {
  for (const test of cases) {
    const positions = test.depths.flatMap((z, f) => {
      const x = test.absent === f ? 8 : 0;
      return [-0.8 + x, -0.8, z, 0.8 + x, -0.8, z, x, 0.8, z];
    });
    const n = test.depths.length;
    const mesh: Folded3dMesh = {
      positions: Float32Array.from(positions),
      topology: {
        faceIndices: Uint32Array.from(
          Array.from({ length: n * 3 }, (_, i) => i)
        ),
        edgeIndices: new Uint32Array(),
        edgeAssignments: new Uint8Array(),
        textureDim: Math.ceil(Math.sqrt(n * 3)),
      },
      center: [0, 0, 0],
      radius: 1,
      sheet: 2,
      maxStackDepth: n,
      skins: [],
      translucent: {
        faceIndexStart: 0,
        faceIndexCount: 3 * n,
        edgeStart: 0,
        edgeCount: 0,
      },
      undetermined: {
        faceIndexStart: 0,
        faceIndexCount: 0,
        edgeStart: 0,
        edgeCount: 0,
      },
      fallbackEdgeCount: 0,
      slots: {
        count: 0,
        cell: new Int32Array(),
        face: new Int32Array(),
        depth: new Int32Array(),
        indexStart: new Uint32Array(),
        vertexStart: new Uint32Array(),
      },
      hinges: { partnerPlane: new Int32Array(), requiredSide: new Int8Array() },
      spatial: {
        planes: test.planes,
        ranges: test.depths.map((_, f) => ({
          faceIndexStart: 3 * f,
          faceIndexCount: 3,
          edgeStart: 0,
          edgeCount: 0,
        })),
        triangleFaces: test.depths.map((_, f) => f),
        edgeFaces: [],
      },
    };
    if (test.ink !== undefined) {
      // A horizontal crease across the centre of a locally hidden face.
      mesh.positions = Float32Array.from([
        ...positions,
        -0.4,
        0,
        0.5,
        0.4,
        0,
        0.5,
      ]);
      mesh.topology.textureDim = Math.ceil(
        Math.sqrt(mesh.positions.length / 3)
      );
      mesh.topology.edgeIndices = Uint32Array.from([n * 3, n * 3 + 1]);
      mesh.topology.edgeAssignments = Uint8Array.from([0]);
      mesh.spatial!.ranges[test.ink]!.edgeCount = 1;
      mesh.spatial!.edgeFaces = [test.ink];
      if (test.hinge) {
        // A second material face meeting the buried edge, edge-on to this
        // camera. Its old, separately masked crease copy leaked through.
        mesh.positions.set([-0.4, 0, 0.5, 0.4, 0, 0.5, 0, 0, 0.9], 18);
        mesh.topology.edgeIndices = Uint32Array.from([n * 3, n * 3 + 1, n * 3, n * 3 + 1]);
        mesh.topology.edgeAssignments = Uint8Array.from([0, 0]);
        mesh.spatial!.ranges[2]!.edgeStart = 1;
        mesh.spatial!.ranges[2]!.edgeCount = 1;
        mesh.spatial!.edgeFaces = [test.ink, 2];
      }
    }
    const canvas = new OffscreenCanvas(128, 128);
    const { payload } = folded3dMeshPayload(mesh);
    const source = FoldedMeshSource.create(canvas, payload);
    if (!source) throw new Error('WebGL2/stencil unavailable');
    // Diagnostic ID colours use the production draw calls, geometry and shaders.
    const renderer = (source as unknown as { mesh: { render: Function } }).mesh;
    const render = renderer.render.bind(renderer);
    renderer.render = (c: any, s: any, t: any, o: any) => {
      const face = Math.floor((o?.faceRange?.start ?? 0) / 3);
      return render(
        c,
        { ...s, frontColor: colors[face], backColor: colors[face] },
        t,
        o
      );
    };
    source.render(camera, {
      ...folded3dWindowRenderSettings({
        style: DEFAULT_PAPER_STYLE,
        displayStyle: 'Paper5',
        devicePixelRatio: 1,
      }),
      lighting: false,
      edgeWidthPx: 3,
    });
    const gl = canvas.getContext('webgl2')!;
    const pixel = new Uint8Array(4);
    gl.readPixels(64, 64, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const expected = pickSpread(
      projectSpatialMesh(mesh, camera).projected,
      [64.5, 63.5]
    )?.face;
    const sceneInk = test.ink === undefined ? undefined : spatialPaperScene(mesh, camera, DEFAULT_PAPER_STYLE).items.some(item => {
      if (item.kind !== 'line' || item.hidden) return false;
      return Math.abs(item.a[1] - 64) < 1e-6 && Math.abs(item.b[1] - 64) < 1e-6 &&
        Math.min(item.a[0], item.b[0]) < 64 && Math.max(item.a[0], item.b[0]) > 64;
    });
    const passed =
      expected !== undefined &&
      (sceneInk === undefined || sceneInk === !!test.inkVisible) &&
      (test.inkVisible ? [0, 1, 2].every(i => pixel[i]! < 3)
        : colors[expected]!.every((v, i) => Math.abs(pixel[i]! - v * 255) < 3)) &&
      gl.getError() === gl.NO_ERROR;
    result.push({ name: test.name, expected, pixel: [...pixel], sceneInk, passed });
    const figure = document.createElement('figure'),
      label = document.createElement('figcaption'),
      shown = document.createElement('canvas');
    shown.width = 128;
    shown.height = 128;
    const pixels = new Uint8Array(128 * 128 * 4);
    gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const flipped = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < 128; y++)
      flipped.set(pixels.subarray(y * 512, (y + 1) * 512), (127 - y) * 512);
    shown
      .getContext('2d')!
      .putImageData(new ImageData(flipped, 128, 128), 0, 0);
    label.textContent = `${passed ? 'PASS' : 'FAIL'}: ${test.name}`;
    figure.append(shown, label);
    document.querySelector('#tiles')!.append(figure);
    source.dispose();
  }
  document.querySelector('#result')!.textContent = JSON.stringify(
    { passed: result.every((r) => r.passed), result },
    null,
    2
  );
} catch (error) {
  document.querySelector('#result')!.textContent = JSON.stringify(
    { passed: false, error: String(error), result },
    null,
    2
  );
}
