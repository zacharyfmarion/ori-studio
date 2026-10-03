import { describe, expect, it } from 'vitest';

import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import {
  createDiagram,
  createStep,
  duplicateStep,
  insertSteps,
  setPageSetup,
  setStepText,
  type DiagramIdFactory,
} from './diagramDocument';
import { readDiagram, writeDiagram } from './diagramFile';
import { SVG_STORED_MAX_BYTES, sanitizeSvg } from '../upload/svgSanitize';
import { insertPictureSteps, setStepText as setText, type KnownDiagramAsset } from './diagramDocument';
import {
  cpStep,
  fixedPicture,
  FIXED_SVG,
  referencesStep,
  scenePicture,
  stepDiagramPicture,
} from './diagramSteps.fixtures';
import { markup, sceneOf, sheetWithCrease } from '../../lib/paper/paperScene.fixtures';

function sequentialIds(): DiagramIdFactory {
  let next = 0;
  return (prefix) => `${prefix}-${++next}`;
}

/** What `serializeNativeProjectFile` does to the value, and back. */
const throughJson = (value: unknown) => JSON.parse(JSON.stringify(value, null, 2));

function sampleDiagram() {
  const ids = sequentialIds();
  let diagram = createDiagram({ title: 'Crane · 千纸鹤', hanStyle: 'sc', newId: ids });
  diagram = insertSteps(diagram, [createStep(ids), createStep(ids)], 0);
  diagram = setStepText(diagram, diagram.steps[0].id, 'Fold the corner up.');
  diagram = setStepText(diagram, diagram.steps[1].id, '将底角向上折至顶角。');
  return setPageSetup(diagram, { layout: 'flow', columns: 4, pageNumbers: { enabled: true, first: 3 } });
}

describe('writeDiagram / readDiagram', () => {
  it('round-trips every field a Phase 1 diagram holds', () => {
    const diagram = sampleDiagram();
    const read = readDiagram(throughJson(writeDiagram(diagram)));
    expect(read).not.toBeNull();
    expect(read!.readOnly).toBe(false);
    expect(read!.document).toEqual(diagram);
  });

  it('round-trips a resolved paper style', () => {
    const diagram = { ...sampleDiagram(), style: { style: DEFAULT_PAPER_STYLE } };
    expect(readDiagram(throughJson(writeDiagram(diagram)))!.document.style).toEqual({
      style: DEFAULT_PAPER_STYLE,
    });
  });

  it('reads nothing that is not a diagram', () => {
    expect(readDiagram(null)).toBeNull();
    expect(readDiagram([])).toBeNull();
    expect(readDiagram('diagram')).toBeNull();
  });

  it('drops malformed steps and keeps the rest', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.steps.splice(1, 0, 'not a step', { text: 'no id' }, { ...written.steps[0] });
    const read = readDiagram(written)!;
    // The id-less step and the string are malformed; the repeated id is a copy.
    expect(read.document.steps.map((step) => step.text)).toEqual([
      'Fold the corner up.',
      '将底角向上折至顶角。',
    ]);
  });

  it('falls back field by field for damaged top-level fields', () => {
    const read = readDiagram(
      { id: 7, title: 9, hanStyle: 4, style: { preset: 5 }, page: 'big', steps: 'many' },
      { newId: sequentialIds() }
    )!;
    // Wrong types are damage, not a newer build's news: still editable.
    expect(read.readOnly).toBe(false);
    expect(read.document).toMatchObject({
      id: 'diagram-1',
      title: '',
      hanStyle: 'sc',
      style: { preset: 'diagram' },
      steps: [],
    });
  });

  it('removes characters XML cannot hold from stored text', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.title = 'Crane\u0001';
    written.steps[0].text = 'Fold\u000C up';
    const read = readDiagram(written)!;
    expect(read.document.title).toBe('Crane');
    expect(read.document.steps[0].text).toBe('Fold up');
  });
});

describe('a newer build’s work', () => {
  it('carries a step whose source it cannot read, locked and verbatim', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    const newer = {
      ...written.steps[0],
      source: { kind: 'hologram', depth: 3 },
      picture: { kind: 'hologram-scene', data: 'abc' },
      futureField: [1, 2],
    };
    written.steps[0] = newer;
    const read = readDiagram(written)!;
    expect(read.document.steps[0].unknown).toEqual(newer);
    // Written back exactly as read.
    expect(throughJson(writeDiagram(read.document)).steps[0]).toEqual(newer);
  });

  it('carries annotations and assets it cannot read, verbatim', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    const annotation = { id: 'ann-1', kind: 'spiral-arrow', from: [0, 0], to: [1, 1] };
    const asset = { id: 'asset-1', kind: 'video', bytes: 3 };
    written.steps[1].annotations = [annotation, { kind: 'no id' }];
    written.assets = { 'asset-1': asset, broken: 'not an asset' };
    const read = readDiagram(written)!;
    expect(read.document.steps[1].unknown).toBeUndefined();
    expect(read.document.steps[1].annotations).toEqual([{ id: 'ann-1', unknown: annotation }]);
    const again = throughJson(writeDiagram(read.document));
    expect(again.steps[1].annotations).toEqual([annotation]);
    expect(again.assets).toEqual({ 'asset-1': asset });
  });

  it.each([
    ['a document key it does not know', { fonts: { han: 'sc' } }],
    ['a Han style it does not know', { hanStyle: 'vi' }],
    ['a preset it does not know', { style: { preset: 'future' } }],
    ['a page size it does not know', { page: { size: 'a3' } }],
    ['a page key it does not know', { page: { bleedMm: 3 } }],
  ])('opens read-only, and writes back unchanged, a diagram with %s', (_label, patch) => {
    const written = { ...throughJson(writeDiagram(sampleDiagram())), ...patch };
    if ('page' in patch) written.page = { ...throughJson(writeDiagram(sampleDiagram())).page, ...patch.page };
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(true);
    expect(writeDiagram(read.document, read.raw)).toBe(written);
  });

  it('gives a duplicated step’s carried annotations ids of their own in the file', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.steps[0].annotations = [{ id: 'ann-1', kind: 'spiral-arrow' }];
    const read = readDiagram(written)!;
    const copied = duplicateStep(read.document, read.document.steps[0].id, sequentialIds())!;
    const ids = throughJson(writeDiagram(copied.document)).steps.map(
      (step: { annotations: { id: string }[] }) => step.annotations.map((annotation) => annotation.id)
    );
    expect(ids[0]).toEqual(['ann-1']);
    // The copy's own id, in memory and in the file alike.
    expect(ids[1]).toEqual([copied.document.steps[1].annotations[0].id]);
    expect(ids[1]).not.toEqual(['ann-1']);
  });

  it('opens a newer format read-only and writes it back unchanged', () => {
    const written = { ...throughJson(writeDiagram(sampleDiagram())), formatVersion: 2, layers: [1] };
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(true);
    expect(read.document.steps).toHaveLength(2);
    expect(writeDiagram(read.document, read.raw)).toBe(written);
  });
});

/** A PNG's signature and IHDR: all the header check reads. */
function pngDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

function rasterAsset(id: string, width: number, height: number): KnownDiagramAsset {
  const src = pngDataUrl(width, height);
  return { id, kind: 'raster', src, widthPx: width, heightPx: height, bytes: src.length };
}

/** An SVG as an upload stores it: sanitized at import, with the asset's id as its prefix. */
function svgAsset(id: string, markup: string): KnownDiagramAsset {
  const result = sanitizeSvg(markup, { idPrefix: id, mode: 'import' });
  if (!result.ok) throw new Error(result.error);
  return {
    id,
    kind: 'svg',
    svg: result.svg,
    widthPx: result.widthPx,
    heightPx: result.heightPx,
    bytes: result.svg.length,
  };
}

const ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
  <path d="M0 0 L40 30" stroke="url(#g)"/>
</svg>`;

function uploadDiagram() {
  const ids = sequentialIds();
  const diagram = createDiagram({ title: 'Crane', newId: ids });
  const { document, stepIds } = insertPictureSteps(
    diagram,
    [svgAsset('asset-a', ARROW), rasterAsset('asset-b', 64, 48)],
    0,
    ids
  );
  return { document: setText(document, stepIds[0], 'Valley fold.'), stepIds };
}

describe('annotations in the file', () => {
  const every = [
    { id: 'a-1', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.5, 0.2], bend: 0.134 },
    { id: 'a-2', kind: 'mountain-arrow', from: [0.1, 0.3], to: [0.5, 0.3], bend: -0.2 },
    { id: 'a-3', kind: 'fold-unfold-arrow', from: [0.1, 0.4], to: [0.5, 0.4], bend: 0.5 },
    { id: 'a-4', kind: 'push-arrow', from: [0.9, 0.9], to: [0.7, 0.7] },
    { id: 'a-5', kind: 'turn-over', from: [0.5, 0.5], to: [0.5, 0.5], axis: 'horizontal' },
    { id: 'a-6', kind: 'rotate', from: [0.2, 0.8], to: [0.2, 0.8], rotate: { amount: 'eighth', direction: 'ccw' } },
    { id: 'a-7', kind: 'valley-line', from: [-0.2, 0.5], to: [1.2, 0.5] },
    { id: 'a-8', kind: 'mountain-line', from: [0, 0], to: [1, 1] },
    { id: 'a-9', kind: 'hidden-line', from: [0, 1], to: [1, 0] },
    { id: 'a-10', kind: 'label', from: [0.3, 0.3], to: [0.3, 0.3], text: 'A 谷折り' },
  ];

  function withAnnotations(annotations: unknown[]) {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.steps[0].annotations = annotations;
    return readDiagram(written)!.document.steps[0]!.annotations;
  }

  it('round-trips every kind it draws, field for field', () => {
    const read = withAnnotations(every);
    expect(read).toEqual(every);
    const document = { ...sampleDiagram() };
    document.steps = [{ ...document.steps[0]!, annotations: read }, document.steps[1]!];
    expect(throughJson(writeDiagram(document)).steps[0].annotations).toEqual(every);
  });

  it('carries what a newer build might write: a kind, a field, a value or a range it does not know', () => {
    const newer = [
      { id: 'n-1', kind: 'spiral-arrow', from: [0, 0], to: [1, 1] },
      { id: 'n-2', kind: 'valley-arrow', from: [0, 0], to: [1, 1], bend: 0.1, colour: 'red' },
      { id: 'n-3', kind: 'rotate', from: [0, 0], to: [0, 0], rotate: { amount: 'third', direction: 'cw' } },
      { id: 'n-4', kind: 'turn-over', from: [0, 0], to: [0, 0], axis: 'diagonal' },
      { id: 'n-5', kind: 'valley-arrow', from: [0, 0], to: [1, 1], bend: 0.9 },
      { id: 'n-6', kind: 'push-arrow', from: [0, 0], to: [9, 1] },
      { id: 'n-7', kind: 'label', from: [0, 0], to: [0, 0], text: 'x'.repeat(200) },
    ];
    expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
  });

  it('drops one that does not read, and a second with an id already read', () => {
    const read = withAnnotations([
      { id: 'd-1', kind: 'valley-line', from: [0, 0] },
      { id: 'd-2', kind: 'label', from: [0, 0], to: [0, 0], text: 7 },
      { id: 'd-3', kind: 'valley-arrow', from: [0, 0], to: [1, 1], bend: 0 },
      { id: 'd-4', kind: 7 },
      { id: 'd-5', kind: 'hidden-line', from: [0, 0], to: [1, Number.NaN] },
      { id: 'd-6', kind: 'hidden-line', from: [0, 0], to: [1, 1] },
      { id: 'd-6', kind: 'valley-line', from: [0, 0], to: [1, 1] },
    ]);
    expect(read).toEqual([{ id: 'd-6', kind: 'hidden-line', from: [0, 0], to: [1, 1] }]);
  });

  it('fills what a kind may leave out, puts a sign where it is, and cleans a label', () => {
    const read = withAnnotations([
      { id: 'f-1', kind: 'valley-arrow', from: [0, 0], to: [1, 0] },
      { id: 'f-2', kind: 'turn-over', from: [0.5, 0.5], to: [0.9, 0.9] },
      { id: 'f-3', kind: 'rotate', from: [0.5, 0.5], to: [0.5, 0.5] },
      { id: 'f-4', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A\u0000B' },
    ]);
    expect(read).toEqual([
      { id: 'f-1', kind: 'valley-arrow', from: [0, 0], to: [1, 0], bend: 1 - Math.cos(Math.PI / 6) },
      { id: 'f-2', kind: 'turn-over', from: [0.5, 0.5], to: [0.5, 0.5], axis: 'vertical' },
      { id: 'f-3', kind: 'rotate', from: [0.5, 0.5], to: [0.5, 0.5], rotate: { amount: 'quarter', direction: 'cw' } },
      { id: 'f-4', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'AB' },
    ]);
  });

  it('keeps at most a step’s worth', () => {
    const many = Array.from({ length: 600 }, (_, index) => ({
      id: `m-${index}`,
      kind: 'valley-line',
      from: [0, 0],
      to: [1, 1],
    }));
    expect(withAnnotations(many)).toHaveLength(500);
  });
});

describe('uploaded pictures in the file', () => {
  it('round-trips upload steps and their assets unchanged', () => {
    const { document } = uploadDiagram();
    const read = readDiagram(throughJson(writeDiagram(document)))!;
    expect(read.readOnly).toBe(false);
    expect(read.document).toEqual(document);
    // And again: what a load writes is what it read.
    expect(throughJson(writeDiagram(read.document))).toEqual(throughJson(writeDiagram(document)));
  });

  it('sanitizes an SVG again on the way in, so a hand-edited file is held to the rules', () => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    written.assets['asset-a'].svg = written.assets['asset-a'].svg.replace(
      '</svg>',
      '<script>alert(1)</script><rect width="5" height="5" onclick="alert(2)"/></svg>'
    );
    const asset = readDiagram(written)!.document.assets['asset-a'];
    expect(asset).toMatchObject({ kind: 'svg' });
    const svg = (asset as { svg: string }).svg;
    expect(svg).not.toContain('script');
    expect(svg).not.toContain('onclick');
    expect(svg).toContain('<rect');
  });

  it('drops an asset that does not read, and the step that showed it keeps its words', () => {
    const { document, stepIds } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    written.assets['asset-a'].svg = '<html><body>not a picture</body></html>';
    const read = readDiagram(written)!.document;
    expect(read.assets['asset-a']).toBeUndefined();
    const step = read.steps.find((entry) => entry.id === stepIds[0])!;
    expect(step).toMatchObject({ source: null, picture: null, text: 'Valley fold.' });
    expect(step.unknown).toBeUndefined();
  });

  it.each([
    ['a size that disagrees with its header', { widthPx: 65 }],
    ['a format other than PNG or JPEG', { src: pngDataUrl(64, 48).replace('image/png', 'image/gif') }],
    ['bytes that are not the format named', { src: 'data:image/png;base64,AAAA' }],
    ['more than 2048 px a side', { src: pngDataUrl(4096, 48), widthPx: 4096 }],
    ['a link rather than data', { src: 'https://example.com/a.png' }],
  ])('drops a bitmap with %s', (_label, patch) => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    Object.assign(written.assets['asset-b'], patch);
    const read = readDiagram(written)!.document;
    expect(read.assets['asset-b']).toBeUndefined();
    expect(read.steps[1].picture).toBeNull();
  });

  it('carries an asset of a kind it does not know, and writes it back as it came', () => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    written.assets['asset-v'] = { id: 'asset-v', kind: 'video', frames: 3 };
    written.steps.push({ id: 'step-later', source: { kind: 'video', assetId: 'asset-v' }, text: '' });
    const read = readDiagram(written)!;
    expect(read.document.assets['asset-v']).toEqual({ id: 'asset-v', unknown: written.assets['asset-v'] });
    expect(read.document.steps.at(-1)?.unknown).toEqual(written.steps.at(-1));
    const again = throughJson(writeDiagram(read.document));
    expect(again.assets['asset-v']).toEqual(written.assets['asset-v']);
    expect(again.steps.at(-1)).toEqual(written.steps.at(-1));
  });

  it('carries, locked, an upload step whose asset is of a kind it does not know', () => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    written.assets['asset-pdf'] = { id: 'asset-pdf', kind: 'pdf', pages: 2 };
    written.steps[0].source.assetId = 'asset-pdf';
    written.steps[0].picture.assetId = 'asset-pdf';
    written.steps[0].picture.key = 'asset:asset-pdf';
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(read.document.steps[0].unknown).toEqual(written.steps[0]);
    // Written back as it came, with the asset it names.
    const again = throughJson(writeDiagram(read.document));
    expect(again.steps[0]).toEqual(written.steps[0]);
    expect(again.assets['asset-pdf']).toEqual(written.assets['asset-pdf']);
  });

  it('reads a picture whose source names another asset, or none, as no picture', () => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    written.steps[0].source.assetId = 'asset-b';
    written.steps[1].source = null;
    const read = readDiagram(written)!.document;
    expect(read.steps.map((step) => step.picture)).toEqual([null, null]);
  });

  it('reads a pose it does not understand as upright', () => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    written.steps[0].source.rotationQuarterTurns = 5;
    written.steps[0].source.mirrored = 'yes';
    expect(readDiagram(written)!.document.steps[0].source).toMatchObject({
      rotationQuarterTurns: 0,
      mirrored: false,
    });
  });

  it('leaves out an asset nothing refers to', () => {
    const { document, stepIds } = uploadDiagram();
    const trimmed = { ...document, steps: document.steps.filter((step) => step.id !== stepIds[1]) };
    expect(Object.keys(throughJson(writeDiagram(trimmed)).assets)).toEqual(['asset-a']);
  });
});

/** A linked step's source as `throughJson` gives it back: any shape, for damaging. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a file read back, damaged on purpose
type WrittenSource = Record<string, any>;

/** A linked step of each render mode, with each kind of captured picture. */
function linkedDiagram() {
  const ids = sequentialIds();
  const stored = sanitizeSvg(FIXED_SVG, { idPrefix: 'fixed-1', mode: 'import' });
  if (!stored.ok) throw new Error(stored.error);
  const steps = [
    cpStep('step-cp', { mode: 'crease-pattern', rotationDeg: 45 }),
    cpStep('step-flat', { mode: 'folded-flat', side: 'back', rotationDeg: 90, foldCase: 2 }),
    cpStep(
      'step-3d',
      { mode: 'folded-3d', camera: { yaw: 0.5, pitch: -0.4, zoom: 1.2 }, side: 'front' },
      { ...scenePicture('scene-3d'), styleKey: 'light-1' }
    ),
    cpStep('step-fixed', { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 }, {
      ...fixedPicture('fixed-1', stored.svg),
      widthPx: stored.widthPx,
      heightPx: stored.heightPx,
    }),
    cpStep('step-unposed', undefined, null),
  ];
  const diagram = createDiagram({ title: 'Crane', newId: ids });
  return insertSteps(diagram, steps, 0);
}

describe('linked steps in the file', () => {
  it('round-trips every render mode and captured picture unchanged', () => {
    const document = linkedDiagram();
    const read = readDiagram(throughJson(writeDiagram(document)))!;
    expect(read.readOnly).toBe(false);
    expect(read.document).toEqual(document);
    expect(throughJson(writeDiagram(read.document))).toEqual(throughJson(writeDiagram(document)));
  });

  it('keeps a stored scene as one string, so the file is not a line per coordinate', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    expect(typeof written.steps[0].picture.sceneJson).toBe('string');
  });

  it('takes the markup out of a stored scene, and keeps the rest', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    const withMarkup = sceneOf([...sheetWithCrease().items, markup('<script>alert(1)</script>')]);
    written.steps[0].picture.sceneJson = JSON.stringify(withMarkup);
    const picture = readDiagram(written)!.document.steps[0].picture;
    expect(picture?.kind).toBe('scene');
    const scene = JSON.parse((picture as { sceneJson: string }).sceneJson);
    expect(scene.items.map((item: { kind: string }) => item.kind)).toEqual(['face', 'line']);
  });

  it('sanitizes a fixed picture again on the way in', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[3].picture.svg = written.steps[3].picture.svg.replace(
      '</svg>',
      '<script>alert(1)</script><a href="javascript:alert(2)"><rect width="5" height="5"/></a></svg>'
    );
    const picture = readDiagram(written)!.document.steps[3].picture as { kind: string; svg: string };
    expect(picture.kind).toBe('fixed');
    expect(picture.svg).not.toContain('script');
    expect(picture.svg).not.toContain('javascript');
    expect(picture.svg).toContain('<rect');
  });

  // Prefixing every id lengthens a picture as it is sanitized. One that only
  // fits before then would load once, be saved longer, and be dropped by the
  // next load: so the cap is held to what is kept.
  it('drops a fixed picture that sanitizing makes too long to load again', () => {
    // A long key prefixes every id with itself: a few thousand ids are enough.
    const key = `fixed-${'k'.repeat(500)}`;
    const rects = Array.from({ length: 5_000 }, (_, index) => `<rect id="r${index}"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${rects}</svg>`;
    expect(svg.length).toBeLessThan(SVG_STORED_MAX_BYTES);
    expect(svg.length + 5_000 * key.length).toBeGreaterThan(SVG_STORED_MAX_BYTES);
    const written = throughJson(writeDiagram(linkedDiagram()));
    Object.assign(written.steps[3].picture, { svg, key });
    expect(readDiagram(written)!.document.steps[3].picture).toBeNull();
  });

  it.each([
    ['a scene that is not JSON', 0, { sceneJson: '{nope' }],
    ['a scene that is not a scene', 0, { sceneJson: '{"items":3}' }],
    ['a fixed picture that is not an SVG', 3, { svg: '<html/>' }],
    ['a fixed picture whose key cannot prefix an id', 3, { key: '1 bad' }],
    ['a picture with no key', 0, { key: '' }],
  ])('drops %s, and the step keeps its link and words', (_label, index, patch) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[index].text = 'Fold it.';
    Object.assign(written.steps[index].picture, patch);
    const step = readDiagram(written)!.document.steps[index];
    expect(step.picture).toBeNull();
    expect(step.source?.kind).toBe('cp');
    expect(step.text).toBe('Fold it.');
    expect(step.unknown).toBeUndefined();
  });

  it.each([
    ['a scope with no rim', (source: WrittenSource) => (source.scope.region.boundary = [])],
    ['no fingerprint', (source: WrittenSource) => (source.fingerprint = '')],
    ['a thumbnail of an unknown role', (source: WrittenSource) => (source.thumbnail.strokes[0].role = 'cut')],
    ['a fold case of zero', (source: WrittenSource) => (source.render.foldCase = 0)],
    ['no side', (source: WrittenSource) => delete source.render.side],
  ])('drops a link with %s, and the picture with it; the words stay', (_label, damage) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[1].text = 'Fold it.';
    damage(written.steps[1].source);
    const step = readDiagram(written)!.document.steps[1];
    expect(step).toMatchObject({ source: null, picture: null, text: 'Fold it.' });
    expect(step.unknown).toBeUndefined();
  });

  it('drops a 3D camera that is not one, and the link with it', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[2].source.render.camera.zoom = -1;
    expect(readDiagram(written)!.document.steps[2].source).toBeNull();
  });

  it('writes a rotation one way: within a turn, never negative', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[0].source.render.rotationDeg = -45;
    written.steps[1].source.render.rotationDeg = 810;
    const steps = readDiagram(written)!.document.steps;
    expect(steps[0].source).toMatchObject({ render: { rotationDeg: 315 } });
    expect(steps[1].source).toMatchObject({ render: { rotationDeg: 90 } });
  });

  it.each([
    ['a scope it does not know', (source: WrittenSource) => (source.scope = { kind: 'lasso', path: [1] })],
    ['a render mode it does not know', (source: WrittenSource) => (source.render = { mode: 'simulated', percent: 40 })],
  ])('carries, locked and verbatim, a linked step with %s', (_label, newer) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    newer(written.steps[1].source);
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(read.document.steps[1].unknown).toEqual(written.steps[1]);
    expect(throughJson(writeDiagram(read.document)).steps[1]).toEqual(written.steps[1]);
  });

  it('keeps a capture held as a bitmap, and drops a scene with no link to say what it is', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    const raster = rasterAsset('asset-r', 64, 48);
    written.assets = { 'asset-r': raster };
    written.steps[0].picture = { kind: 'asset', assetId: 'asset-r', paperScale: 3, styleKey: 'pens-1', key: 'raster-1' };
    written.steps[1].source = null;
    const read = readDiagram(written)!.document;
    // With the style it was drawn in, so a change of style says it is out of date.
    expect(read.steps[0].picture).toEqual({
      kind: 'asset',
      assetId: 'asset-r',
      paperScale: 3,
      styleKey: 'pens-1',
      key: 'raster-1',
    });
    expect(throughJson(writeDiagram(read)).steps[0].picture).toEqual(written.steps[0].picture);
    expect(read.assets['asset-r']).toEqual(raster);
    expect(read.steps[1].picture).toBeNull();
  });
});

/** A sequence card, a Find step of the back, and a card no region matched. */
function sentDiagram() {
  const steps = [
    referencesStep('step-seq'),
    referencesStep('step-find', { mode: 'find', settings: null, line: null, card: 1, side: 'back' }),
    referencesStep('step-turn', { card: null, line: null, fingerprint: null }),
  ];
  return insertSteps(createDiagram({ title: 'Crane', newId: sequentialIds() }), steps, 0);
}

describe('steps sent from References in the file', () => {
  it('round-trips every one unchanged, byte for byte', () => {
    const document = sentDiagram();
    const read = readDiagram(throughJson(writeDiagram(document)))!;
    expect(read.document).toEqual(document);
    expect(JSON.stringify(writeDiagram(read.document))).toBe(JSON.stringify(writeDiagram(document)));
  });

  it('keeps a card drawn with a primitive this build does not draw, locked and verbatim', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[0].picture.model.primitives.push({ kind: 'hinge', at: [0.5, 0.5] });
    const read = readDiagram(written)!;
    expect(read.document.steps[0].unknown).toEqual(written.steps[0]);
    expect(throughJson(writeDiagram(read.document)).steps[0]).toEqual(written.steps[0]);
  });

  it('drops a card whose drawing does not read, and keeps the link and the words', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[0].picture.model.primitives[1].to = [1, 'a'];
    const step = readDiagram(written)!.document.steps[0];
    expect(step).toMatchObject({ source: { kind: 'references-step' }, picture: null });
    expect(step.text).toBe('Fold the bottom edge to the top.');
  });

  it.each([
    ['no rim', (source: WrittenSource) => (source.region.boundary = [])],
    ['an empty fingerprint', (source: WrittenSource) => (source.fingerprint = '')],
    ['a mode it does not know', (source: WrittenSource) => (source.mode = 'guess')],
    ['a setting that is not a switch', (source: WrittenSource) => (source.settings.precreaseGrid = 'yes')],
    ['a card numbered zero', (source: WrittenSource) => (source.card = 0)],
    ['a line whose normal is not a unit', (source: WrittenSource) => (source.line.n = [3, 4])],
    ['no side', (source: WrittenSource) => delete source.side],
  ])('drops a source with %s, and the picture with it; the words stay', (_label, damage) => {
    const written = throughJson(writeDiagram(sentDiagram()));
    damage(written.steps[0].source);
    const step = readDiagram(written)!.document.steps[0];
    expect(step).toMatchObject({ source: null, picture: null, text: 'Fold the bottom edge to the top.' });
  });

  it('keeps a card only as a References step’s picture, and a step diagram only there', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[0].picture = scenePicture();
    written.steps[1].source = throughJson(cpStep('x').source);
    written.steps[1].picture = stepDiagramPicture();
    const steps = readDiagram(written)!.document.steps;
    expect(steps[0].picture).toBeNull();
    expect(steps[1]).toMatchObject({ source: { kind: 'cp' }, picture: null });
  });
});
