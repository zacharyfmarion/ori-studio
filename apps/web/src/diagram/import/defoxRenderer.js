// The pinned upstream renderer is consumed unchanged. Only its DOM and IO boundary is adapted.
import { PAGE } from '../../../../../third_party/step-folder/src/defox/page.js';
import { DIST } from '../../../../../third_party/step-folder/src/distortionfolder/distortion.js';
import { DRAW } from '../../../../../third_party/step-folder/src/defox/draw.js';
import { SYM } from '../../../../../third_party/step-folder/src/defox/symbol.js';
import { PRJ } from '../../../../../third_party/step-folder/src/defox/project.js';
import { Y } from '../../../../../third_party/step-folder/src/defox/y.js';
import defs from '../../../../../third_party/step-folder/resources/defs.xml?raw';

const escape = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const tags = new Set([
  'svg',
  'g',
  'path',
  'line',
  'polygon',
  'polyline',
  'circle',
  'rect',
  'ellipse',
  'text',
  'clipPath',
  'mask',
  'defs',
  'marker',
]);
class SvgNode {
  constructor(tag) {
    if (!tags.has(tag)) throw new Error(`Unsupported SVG element: ${tag}`);
    this.tag = tag;
    this.attributes = new Map();
    this.children = [];
    this.text = '';
  }
  get id() {
    return this.attributes.get('id') ?? '';
  }
  setAttribute(key, value) {
    if (/^on/i.test(key)) throw new Error('Invalid SVG attribute');
    this.attributes.set(key, String(value));
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  // Upstream uses innerHTML for numeric labels only. Never interpret it as markup.
  set innerHTML(value) {
    this.text = String(value);
  }
  serialize() {
    return `<${this.tag} ${[...this.attributes].map(([k, v]) => `${k}="${escape(v)}"`).join(' ')}>${escape(this.text)}${this.children.map((c) => c.serialize()).join('')}</${this.tag}>`;
  }
}
const originalColors = globalThis.structuredClone(DRAW.color);
const originalSymbolColors = globalThis.structuredClone(SYM.color);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function checkTree(value, depth = 0) {
  if (depth > 32) throw new Error('Defox data is nested too deeply');
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Defox contains non-finite numbers');
  if (Array.isArray(value)) {
    if (value.length > 200000) throw new Error('Defox array is too large');
    for (const v of value) checkTree(v, depth + 1);
  } else if (isObject(value))
    for (const [key, v] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid Defox property');
      checkTree(v, depth + 1);
    }
}
function checkFold(fold) {
  if (!isObject(fold)) throw new Error('Missing Defox fold');
  for (const name of ['V', 'Vf', 'FV', 'EV', 'FE', 'Ff', 'EA', 'UV', 'FU', 'UA'])
    if (!Array.isArray(fold[name])) throw new Error(`Missing Defox ${name}`);
  const n = fold.V.length;
  if (!n || fold.Vf.length !== n || fold.FV.length > 50000)
    throw new Error('Invalid Defox vertex/face count');
  for (const points of [fold.V, fold.Vf])
    for (const p of points)
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
        throw new Error('Invalid Defox point');
  const indices = (rows, limit) => {
    for (const row of rows)
      if (!Array.isArray(row) || !row.every((i) => Number.isInteger(i) && i >= 0 && i < limit))
        throw new Error('Invalid Defox topology index');
  };
  indices(fold.FV, n);
  indices(fold.EV, n);
  indices(fold.UV, n);
  indices(fold.FE, fold.EV.length);
  indices(fold.FU, fold.UV.length);
  if (
    fold.FE.length !== fold.FV.length ||
    fold.FU.length !== fold.FV.length ||
    fold.Ff.length !== fold.FV.length ||
    fold.EA.length !== fold.EV.length ||
    fold.UA.length !== fold.UV.length
  )
    throw new Error('Inconsistent Defox topology');
}
function colors(base, saved) {
  const out = globalThis.structuredClone(base);
  if (!isObject(saved)) return out;
  for (const key of Object.keys(out)) {
    if (isObject(out[key])) out[key] = colors(out[key], saved[key]);
    else if (
      typeof saved[key] === 'string' &&
      /^(#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i.test(saved[key])
    )
      out[key] = saved[key];
  }
  return out;
}
/** Called only in the disposable Defox worker (or the isolated oracle test). */
export function renderDefox(text) {
  if (new globalThis.TextEncoder().encode(text).length > 64 * 1024 * 1024)
    throw new Error('Defox file exceeds 64 MiB');
  const entries = JSON.parse(text);
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000)
    throw new Error('Expected a Defox array of 1–1000 steps');
  checkTree(entries);
  const previous = globalThis.document;
  globalThis.document = {
    createElementNS: (_ns, tag) => new SvgNode(tag),
    createElement: (tag) => {
      if (tag !== 'canvas' || typeof globalThis.OffscreenCanvas === 'undefined')
        throw new Error('This environment cannot measure Defox repeat labels');
      return new globalThis.OffscreenCanvas(1, 1);
    },
  };
  DRAW.color = colors(originalColors, entries[0]?.color);
  SYM.color = colors(originalSymbolColors, entries[0]?.symcolor);
  PRJ.steps = entries;
  let outputBytes = 0;
  try {
    return entries.map((step, index) => {
      try {
        if (outputBytes > 128 * 1024 * 1024) throw new Error('Prepared Defox views exceed 128 MiB');
        checkFold(step.fold_cp);
        checkFold(step.fold);
        const defaults = {
          flip0: false,
          rotate: 0.5,
          scale: 1,
          clip: 0,
          cx: 0.5,
          cy: 0.5,
          depth: 0,
          p0: 0,
          p1: 0.5,
          p2: 0,
        };
        step.params = { ...defaults, ...step.params };
        for (const key of Object.keys(defaults).filter((k) => k !== 'flip0'))
          if (!Number.isFinite(step.params[key])) throw new Error(`Invalid Defox parameter ${key}`);
        const stack = step.lin?.S;
        if (
          !step.cell_d &&
          (!Array.isArray(stack) ||
            !stack.length ||
            !stack.every((i) => Number.isInteger(i) && i >= 0 && i < step.fold.FV.length) ||
            new Set(stack).size !== stack.length)
        )
          throw new Error('Invalid Defox face stack');
        for (const symbol of step.symbols ?? []) {
          if (
            !Number.isInteger(symbol.type) ||
            symbol.type < 0 ||
            symbol.type > 15 ||
            !isObject(symbol.params) ||
            !Number.isInteger(symbol.depth) ||
            symbol.depth < 0 ||
            symbol.depth >= step.fold.FV.length
          )
            throw new Error('Unsupported Defox symbol');
        }
        DIST.p0 = step.params.p0;
        DIST.p1 = step.params.p1;
        DIST.p2 = step.params.p2;
        const distorted = DIST.FOLD_2_VD(step.fold.Vf, step.catalyst?.Vf ?? step.fold.V);
        if (!distorted.every((v) => v.every(Number.isFinite))) throw new Error('Invalid Defox distortion');
        step.fold_d = { ...step.fold, Vf: distorted };
        const root = new SvgNode('svg');
        root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        root.setAttribute('width', 1100);
        root.setAttribute('height', 1100);
        root.setAttribute('viewBox', '-50 -50 1100 1100');
        root.setAttribute('id', `defox-${index}`);
        PAGE.draw_step(root, step, index, false, true);
        const serialized = root
          .serialize()
          .replace('>', `>${defs.replaceAll('black', escape(SYM.color.arrow))}`);
        if (/(?:NaN|Infinity)/.test(serialized)) throw new Error('Defox drawing contains invalid geometry');
        // DEFOX's CP exporter uses M=3/V=2; Ori Studio's CP reader follows M=2/V=3.
        const cp = Y.FOLD_2_CP(step.fold_cp).replace(/^[23](?= )/gm, (code) => (code === '2' ? '3' : '2'));
        const saved = { ...step, color: DRAW.color, symcolor: SYM.color };
        delete saved.fold_d;
        const snapshot = JSON.stringify(saved);
        if (snapshot.length > 2 * 1024 * 1024)
          throw new Error('Defox step exceeds the 2 MiB saved-state limit');
        outputBytes += 2 * (cp.length + serialized.length + snapshot.length);
        if (outputBytes > 128 * 1024 * 1024) throw new Error('Prepared Defox views exceed 128 MiB');
        return { ok: true, index, cp, svg: serialized, snapshot };
      } catch (error) {
        return { ok: false, index, error: error instanceof Error ? error.message : String(error) };
      }
    });
  } finally {
    globalThis.document = previous;
    PRJ.steps = [];
    DRAW.color = globalThis.structuredClone(originalColors);
    SYM.color = globalThis.structuredClone(originalSymbolColors);
  }
}
