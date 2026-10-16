import { afterEach, expect, it, vi } from 'vitest';
import { renderDefox } from './defoxRenderer.js';
import { PAGE } from '../../../../../third_party/step-folder/src/defox/page.js';
import { DIST } from '../../../../../third_party/step-folder/src/distortionfolder/distortion.js';
import { PRJ } from '../../../../../third_party/step-folder/src/defox/project.js';
import { Y } from '../../../../../third_party/step-folder/src/defox/y.js';

const square = () => ({
  V: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  Vf: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  FV: [[0, 1, 2, 3]],
  EV: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ],
  FE: [[0, 1, 2, 3]],
  EF: [[0], [0], [0], [0]],
  Ff: [false],
  EA: ['B', 'B', 'B', 'B'],
  UV: [],
  FU: [[]],
  UA: [],
  Vc: [0, 0, 0, 0],
  VV: [
    [1, 3],
    [0, 2],
    [1, 3],
    [0, 2],
  ],
});
const fixture = () => ({
  id: 1,
  fold_cp: square(),
  fold: square(),
  params: {
    flip0: true,
    rotate: 0.125,
    scale: 0.8,
    clip: 0.2,
    cx: 0.4,
    cy: 0.6,
    depth: 0,
    p0: 0.1,
    p1: 0.5,
    p2: 0.1,
  },
  lin: { S: [0], cycle: [0] },
  symbols: [],
});
const shape = (node) => ({
  tag: node.tagName.toLowerCase(),
  attrs: Object.fromEntries(
    [...node.attributes]
      .filter((a) => a.name !== 'xmlns')
      .map((a) => [a.name, a.value])
      .sort(),
  ),
  text: node.children.length ? '' : node.textContent,
  children: [...node.children].map(shape),
});
afterEach(() => {
  PRJ.steps = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function compare(entry) {
  const result = renderDefox(JSON.stringify([entry]))[0];
  expect(result.ok, result.error).toBe(true);
  const native = JSON.parse(result.snapshot);
  DIST.p0 = native.params.p0;
  DIST.p1 = native.params.p1;
  DIST.p2 = native.params.p2;
  native.fold_d = { ...native.fold, Vf: DIST.FOLD_2_VD(native.fold.Vf, native.fold.V) };
  PRJ.steps = [native];
  const root = globalThis.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root.setAttribute('id', 'defox-0');
  PAGE.draw_step(root, native, 0, false, true);
  const imported = new globalThis.DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement;
  expect([...imported.children].filter((n) => n.tagName !== 'defs').map(shape)).toEqual(
    [...root.children].map(shape),
  );
  expect(result.cp).toBe(Y.FOLD_2_CP(native.fold_cp).replace(/^[23](?= )/gm, (c) => (c === '2' ? '3' : '2')));
}

it.each(Array.from({ length: 16 }, (_, i) => i))(
  'matches the unmodified renderer in a real DOM for symbol %i',
  (type) => {
    // Both DOM implementations receive identical font metrics. Browser smoke
    // coverage uses its actual canvas; this oracle isolates geometry/markup.
    const context = { font: '', measureText: (text) => ({ width: text.length * 60 }) };
    vi.spyOn(globalThis.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return context;
        }
      },
    );
    const entry = fixture();
    entry.symbols = [
      {
        type,
        depth: 0,
        params: {
          crease_index: 0,
          vertex_index: 0,
          vertex_index_1: 1,
          vertex_index_2: 3,
          length: 0.4,
          offset: 0.1,
          is_rev: false,
          is_clockwise: true,
          cx: 0.5,
          cy: 0.5,
          cp0: 1,
          cp1: 1,
        },
      },
    ];
    compare(entry);
  },
);

it('matches the saved-cell branch without searching for a different order', () => {
  const entry = fixture();
  entry.params = { ...entry.params, p0: 0, p2: 0 };
  entry.cell_d = Y.FOLD_2_CELL(entry.fold);
  entry.state = { Ctop: [0], Cbottom: [0], L: { S: [0] } };
  compare(entry);
});
