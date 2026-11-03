import { Renderer } from './renderer.mjs';
import { prepareOrder, orientOrder, orderedWinner } from './order.mjs';

const canvas = document.getElementById('test'),
  output = document.getElementById('results');
const renderer = new Renderer(canvas, () => {}, true),
  gl = renderer.gl;
const triangle = (z) => [
  [-1, -1, z],
  [1, -1, z],
  [0, 1, z],
];
const plane = (id, faces, orders) => ({
  id,
  normal: [0, -1, 0],
  origin: [0, 0, 0],
  faces,
  groups: faces,
  orders,
});
const checks = [];
function check(
  name,
  triangles,
  planes,
  expected,
  { back = false, ink = false, correctOrder = true, centerFaces = null } = {}
) {
  const fills = [],
    lines = [],
    ranges = new Map();
  triangles.forEach((points, face) => {
    const first = fills.length / 7,
      lineFirst = lines.length / 7;
    for (const point of points) fills.push(...point, 0, 0, 1, 1);
    points.forEach((point, i) =>
      lines.push(...point, 0, 0, 0, 1, ...points[(i + 1) % 3], 0, 0, 0, 1)
    );
    ranges.set(face, { first, count: 3, lineFirst, lineCount: 6 });
  });
  renderer.upload(fills, lines, false, ranges);
  renderer.configureOrder(planes);
  const eye = [0, 0, back ? -4 : 4];
  renderer.draw(eye, { edges: ink, correctOrder });
  const pixel = new Uint8Array(4);
  gl.readPixels(
    Math.floor(canvas.width / 2),
    Math.floor(canvas.height / 2),
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixel
  );
  // Wide colour steps also catch a partially exposed antialiased buried line.
  const actual = pixel[0] / 32 - 1;
  const meshPlanes = planes.map((p) => ({ ...p, normal: [0, 0, 1] }));
  const candidates = (centerFaces ?? triangles.map((_, face) => face)).map(
    (face) => ({
      face,
      triangle: face,
      plane: planes.find((p) => p.faces.includes(face)).id,
      depth: triangles[face][0][2] * (back ? -1 : 1),
    })
  );
  const reference = correctOrder
    ? orderedWinner(candidates, orientOrder(prepareOrder(meshPlanes), eye)).face
    : [...candidates].sort(
        (a, b) => b.depth - a.depth || b.triangle - a.triangle
      )[0].face;
  const error = gl.getError(),
    pass =
      actual === expected && reference === expected && error === gl.NO_ERROR;
  checks.push(
    `${pass ? 'PASS' : 'FAIL'} ${name} — GPU ${actual}, CPU ${reference}, expected ${expected}, GL ${error}`
  );
}
try {
  check(
    'correct inverted stack',
    [triangle(0.25), triangle(0)],
    [plane(0, [0, 1], [[0, 1]])],
    1
  );
  check(
    'physical toggle',
    [triangle(0.25), triangle(0)],
    [plane(0, [0, 1], [[0, 1]])],
    0,
    { correctOrder: false }
  );
  check(
    'reverse order from the back',
    [triangle(0.25), triangle(0)],
    [plane(0, [0, 1], [[0, 1]])],
    0,
    { back: true }
  );
  check(
    'unrelated foreground survives',
    [triangle(0.25), triangle(0), triangle(0.15)],
    [plane(0, [0, 1], [[0, 1]]), plane(1, [2], [])],
    2
  );
  check(
    'unrelated background stays behind',
    [triangle(0.25), triangle(0), triangle(-0.15)],
    [plane(0, [0, 1], [[0, 1]]), plane(1, [2], [])],
    1
  );
  const cycle = plane(
    0,
    [0, 1, 2],
    [
      [0, 1],
      [1, 2],
      [2, 0],
    ]
  );
  check(
    'all-masked cycle keeps physical baseline',
    [triangle(0), triangle(0.2), triangle(0.4)],
    [cycle],
    2
  );
  check(
    'cycle fallback respects other planes',
    [triangle(0), triangle(0.2), triangle(0.4), triangle(0.6)],
    [cycle, plane(1, [3], [])],
    3
  );
  const absent = triangle(0.4).map(([x, y, z]) => [x + 3, y, z]);
  check(
    'partial cycle uses its surviving layer',
    [triangle(0.25), triangle(0), absent],
    [cycle],
    1,
    { centerFaces: [0, 1] }
  );
  check(
    'occluded survivor prevents cycle fallback leaking forward',
    [triangle(0.25), triangle(0), absent, triangle(0.15)],
    [plane(1, [3], []), cycle],
    3,
    { centerFaces: [0, 1, 3] }
  );
  check(
    'uncovered lower face remains visible',
    [triangle(0.25), absent],
    [plane(0, [0, 1], [[0, 1]])],
    0,
    { centerFaces: [0] }
  );
  const inkTriangle = [
    [-0.6, 0, 0.25],
    [0.6, 0, 0.25],
    [0, 0.6, 0.25],
  ];
  check(
    'buried crease uses the same order mask',
    [inkTriangle, triangle(0)],
    [plane(0, [0, 1], [[0, 1]])],
    1,
    { ink: true }
  );
  const successes = checks.filter((s) => s.startsWith('PASS')).length;
  output.textContent = `${successes}/${checks.length} checks passed\n\n${checks.join('\n')}`;
} catch (error) {
  output.textContent = `${checks.join('\n')}\nFAILED: ${error.stack}`;
  console.error(error);
}
