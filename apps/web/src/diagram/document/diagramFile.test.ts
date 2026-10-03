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
import { sanitizeSvg } from '../upload/svgSanitize';
import { insertPictureSteps, setStepText as setText, type KnownDiagramAsset } from './diagramDocument';

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
