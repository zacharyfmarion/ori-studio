import { describe, expect, it } from 'vitest';

import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import {
  createDiagram,
  createStep,
  duplicateStep,
  insertSteps,
  setPageSetup,
  setStepText,
  createTurn,
  isLockedTurn,
  isTurn,
  stepNumber,
  type DiagramIdFactory,
  type DiagramCpSource,
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
  stepsIn,
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
  diagram = setStepText(diagram, stepsIn(diagram)[0].id, 'Fold the corner up.');
  diagram = setStepText(diagram, stepsIn(diagram)[1].id, '将底角向上折至顶角。');
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
    expect(stepsIn(read.document).map((step) => step.text)).toEqual([
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
    expect(stepsIn(read.document)[0].text).toBe('Fold up');
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
    expect(stepsIn(read.document)[0].unknown).toEqual(newer);
    // Written back exactly as read.
    expect(stepsIn(throughJson(writeDiagram(read.document)))[0]).toEqual(newer);
  });

  it('carries annotations and assets it cannot read, verbatim', () => {
    const written = throughJson(writeDiagram(sampleDiagram()));
    const annotation = { id: 'ann-1', kind: 'spiral-arrow', from: [0, 0], to: [1, 1] };
    const asset = { id: 'asset-1', kind: 'video', bytes: 3 };
    written.steps[1].annotations = [annotation, { kind: 'no id' }];
    written.assets = { 'asset-1': asset, broken: 'not an asset' };
    const read = readDiagram(written)!;
    expect(stepsIn(read.document)[1].unknown).toBeUndefined();
    expect(stepsIn(read.document)[1].annotations).toEqual([{ id: 'ann-1', unknown: annotation }]);
    const again = throughJson(writeDiagram(read.document));
    expect(stepsIn(again)[1].annotations).toEqual([annotation]);
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
    const copied = duplicateStep(read.document, stepsIn(read.document)[0].id, sequentialIds())!;
    const ids = stepsIn(throughJson(writeDiagram(copied.document))).map(
      (step: { annotations: { id: string }[] }) => step.annotations.map((annotation) => annotation.id)
    );
    expect(ids[0]).toEqual(['ann-1']);
    // The copy's own id, in memory and in the file alike.
    expect(ids[1]).toEqual([stepsIn(copied.document)[1].annotations[0].id]);
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
    {
      id: 'a-4w',
      kind: 'white-arrow',
      from: [0.1, 0.6],
      to: [0.5, 0.7],
      path: [{ at: [0.1, 0.6], out: [0.2, 0.4] }, { at: [0.5, 0.7], in: [0.4, 0.5] }],
      width: 'wide',
      tail: 'cleft',
    },
    { id: 'a-5', kind: 'turn-over', from: [0.5, 0.5], to: [0.5, 0.5], axis: 'horizontal' },
    { id: 'a-6', kind: 'rotate', from: [0.2, 0.8], to: [0.2, 0.8], rotate: { amount: 'eighth', direction: 'ccw' } },
    { id: 'a-7', kind: 'valley-line', from: [-0.2, 0.5], to: [1.2, 0.5] },
    { id: 'a-8', kind: 'mountain-line', from: [0, 0], to: [1, 1] },
    { id: 'a-9', kind: 'hidden-line', from: [0, 1], to: [1, 0] },
    { id: 'a-10', kind: 'label', from: [0.3, 0.3], to: [0.3, 0.3], text: 'A 谷折り' },
    { id: 'a-11', kind: 'circle', from: [0.25, 0.75], to: [0.25, 0.75] },
    { id: 'a-12', kind: 'callout', from: [0.4, 0.6], to: [1.3, -0.2], text: 'Repeat behind 裏も同様に' },
  ];

  function withAnnotations(annotations: unknown[]) {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.steps[0].annotations = annotations;
    return stepsIn(readDiagram(written)!.document)[0]!.annotations;
  }

  it('round-trips every kind it draws, field for field', () => {
    const read = withAnnotations(every);
    expect(read).toEqual(every);
    const document = { ...sampleDiagram() };
    document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
    expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual(every);
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
      // A circle with a letter, or out past reach: a later build's (decision 8 leaves the letter out).
      { id: 'n-8', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' },
      { id: 'n-9', kind: 'circle', from: [5, 0.5], to: [5, 0.5] },
      // A callout with a field it has no name for, words longer than a label's, or its box past reach.
      { id: 'n-10', kind: 'callout', from: [0.5, 0.5], to: [0.9, 0.1], text: 'Repeat behind', size: 2 },
      { id: 'n-11', kind: 'callout', from: [0.5, 0.5], to: [0.9, 0.1], text: 'x'.repeat(200) },
      { id: 'n-12', kind: 'callout', from: [0.5, 0.5], to: [9, 0.1], text: 'Repeat behind' },
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
      { id: 'd-7', kind: 'circle', to: [0.5, 0.5] },
      // A callout with no words, or words that are not text, or no box.
      { id: 'd-8', kind: 'callout', from: [0.5, 0.5], to: [0.9, 0.1] },
      { id: 'd-9', kind: 'callout', from: [0.5, 0.5], to: [0.9, 0.1], text: ['Repeat'] },
      { id: 'd-10', kind: 'callout', from: [0.5, 0.5], text: 'Repeat behind' },
    ]);
    expect(read).toEqual([{ id: 'd-6', kind: 'hidden-line', from: [0, 0], to: [1, 1] }]);
  });

  it('fills what a kind may leave out, puts a sign where it is, and cleans a label', () => {
    const read = withAnnotations([
      { id: 'f-1', kind: 'valley-arrow', from: [0, 0], to: [1, 0] },
      { id: 'f-2', kind: 'turn-over', from: [0.5, 0.5], to: [0.9, 0.9] },
      { id: 'f-3', kind: 'rotate', from: [0.5, 0.5], to: [0.5, 0.5] },
      { id: 'f-4', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A\u0000B' },
      { id: 'f-5', kind: 'circle', from: [0.4, 0.6], to: [0.9, 0.9] },
      { id: 'f-6', kind: 'callout', from: [0.4, 0.6], to: [0.9, 0.9], text: 'Repeat\u0000 behind' },
    ]);
    expect(read).toEqual([
      { id: 'f-1', kind: 'valley-arrow', from: [0, 0], to: [1, 0], bend: 1 - Math.cos(Math.PI / 6) },
      { id: 'f-2', kind: 'turn-over', from: [0.5, 0.5], to: [0.5, 0.5], axis: 'vertical' },
      { id: 'f-3', kind: 'rotate', from: [0.5, 0.5], to: [0.5, 0.5], rotate: { amount: 'quarter', direction: 'cw' } },
      { id: 'f-4', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'AB' },
      { id: 'f-5', kind: 'circle', from: [0.4, 0.6], to: [0.4, 0.6] },
      // Its box where it was put, not at its point: it is no sign.
      { id: 'f-6', kind: 'callout', from: [0.4, 0.6], to: [0.9, 0.9], text: 'Repeat behind' },
    ]);
  });

  it('carries a step with more than a step holds, locked and whole, rather than cutting it short', () => {
    const many = Array.from({ length: 600 }, (_, index) => ({
      id: `m-${index}`,
      kind: 'valley-line',
      from: [0, 0],
      to: [1, 1],
    }));
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.steps[0].annotations = many;
    const read = readDiagram(written)!.document;
    expect(stepsIn(read)[0]!.unknown).toBeDefined();
    expect(stepsIn(throughJson(writeDiagram(read)))[0].annotations).toHaveLength(600);
  });

  describe('a shaped arrow', () => {
    const path = [
      { at: [0.1, 0.5], out: [0.2, 0.3] },
      { at: [0.4, 0.5], in: [0.3, 0.6], out: [0.5, 0.4], type: 'corner' },
      { at: [0.7, 0.5], in: [0.6, 0.7] },
    ];
    const shaped = (more: Record<string, unknown> = {}, nodes: unknown = path) => ({
      id: 'p-1',
      kind: 'fold-unfold-arrow',
      from: [0.1, 0.5],
      to: [0.7, 0.5],
      path: nodes,
      ...more,
    });

    it('round-trips its path, node for node, and gets no bend', () => {
      const read = withAnnotations([shaped(), { ...shaped(), id: 'p-2', kind: 'valley-arrow' }]);
      expect(read).toEqual([shaped(), { ...shaped(), id: 'p-2', kind: 'valley-arrow' }]);
      expect(read[0]).not.toHaveProperty('bend');
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual([
        shaped(),
        { ...shaped(), id: 'p-2', kind: 'valley-arrow' },
      ]);
    });

    it('carries, verbatim, a path a newer build might write', () => {
      const [first, middle, last] = path;
      const newer = [
        shaped({ id: 'n-both', bend: 0.2 }),
        shaped({ id: 'n-field' }, [first, { ...middle, weight: 2 }, last]),
        shaped({ id: 'n-type' }, [first, { ...middle, type: 'symmetric' }, last]),
        shaped({ id: 'n-many', to: [0.1, 0.5] }, Array.from({ length: 25 }, () => ({ at: [0.1, 0.5] }))),
        shaped({ id: 'n-far' }, [first, { ...middle, at: [9, 0.5] }, last]),
        shaped({ id: 'n-handle' }, [first, { ...middle, out: [0.5, -4.5] }, last]),
        shaped({ id: 'n-tail-in' }, [{ ...first, in: [0, 0] }, middle, last]),
        shaped({ id: 'n-tip-out' }, [first, middle, { ...last, out: [1, 1] }]),
        // The kinds that stay straight have no path to read.
        shaped({ id: 'n-push', kind: 'push-arrow' }),
      ];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    });

    it('drops a path that does not read', () => {
      const [first, middle, last] = path;
      const read = withAnnotations([
        shaped({ id: 'd-one' }, [first]),
        shaped({ id: 'd-list' }, { at: [0, 0] }),
        shaped({ id: 'd-node' }, [first, 'middle', last]),
        shaped({ id: 'd-at' }, [first, { ...middle, at: [0.4] }, last]),
        shaped({ id: 'd-handle' }, [first, { ...middle, in: 'left' }, last]),
        shaped({ id: 'd-type' }, [first, { ...middle, type: 7 }, last]),
        shaped({ id: 'd-ends', to: [0.6, 0.5] }),
        shaped({ id: 'kept' }),
      ]);
      expect(read.map((annotation) => annotation.id)).toEqual(['kept']);
    });

    it('is kept, verbatim and undrawn, by a build that reads no path: as any field it has no name for', () => {
      // What a build before shaped arrows does with one: its reader names no
      // `path`, so the arrow is a newer build's (`colour` here stands for it).
      const older = shaped({ colour: 'red' });
      expect(withAnnotations([older])).toEqual([{ id: 'p-1', unknown: older }]);
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = [older];
      const again = throughJson(writeDiagram(readDiagram(written)!.document));
      expect(again.steps[0].annotations).toEqual([older]);
    });
  });

  describe('a white arrow', () => {
    const white = (more: Record<string, unknown> = {}) => ({
      id: 'w-1',
      kind: 'white-arrow',
      from: [0.1, 0.5],
      to: [0.7, 0.5],
      path: [
        { at: [0.1, 0.5], out: [0.2, 0.3] },
        { at: [0.4, 0.5], in: [0.3, 0.6], out: [0.5, 0.4], type: 'corner' },
        { at: [0.7, 0.5], in: [0.6, 0.7] },
      ],
      width: 'narrow',
      tail: 'square',
      ...more,
    });

    it('round-trips its path and its look, and gets the template’s look where it says none', () => {
      expect(withAnnotations([white()])).toEqual([white()]);
      const { width: _width, tail: _tail, ...unsaid } = white();
      expect(withAnnotations([unsaid])).toEqual([white({ width: 'regular', tail: 'pointed' })]);
    });

    it('carries, verbatim, what a newer build might write: a width or tail it has no name for, a bend, a point past reach', () => {
      const newer = [
        white({ id: 'n-width', width: 'huge' }),
        white({ id: 'n-tail', tail: 'feathered' }),
        white({ id: 'n-bend', bend: 0.2 }),
        white({ id: 'n-colour', colour: 'red' }),
        white({ id: 'n-far', to: [9, 0.5], path: [{ at: [0.1, 0.5] }, { at: [9, 0.5] }] }),
        // News before damage: a newer tail on a path that does not read is still a newer build's.
        white({ id: 'n-first', tail: 'feathered', path: 'no path' }),
      ];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    });

    it('drops one that does not read: no path, a path that does not, a look that is not a word, ends not the path’s', () => {
      const { path: _path, ...pathless } = white();
      const read = withAnnotations([
        { ...pathless, id: 'd-none' },
        white({ id: 'd-one', path: [{ at: [0.1, 0.5] }] }),
        white({ id: 'd-width', width: 2 }),
        white({ id: 'd-tail', tail: null }),
        white({ id: 'd-ends', to: [0.6, 0.5] }),
        white({ id: 'kept' }),
      ]);
      expect(read.map((annotation) => annotation.id)).toEqual(['kept']);
    });

    it('round-trips a solid one’s fill, and reads none as white, written as none (15d)', () => {
      const solid = white({ id: 's-1', fill: 'black' });
      expect(withAnnotations([solid, white()])).toEqual([solid, white()]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: withAnnotations([solid, white()]) }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual([solid, white()]);
    });

    it('carries a fill it has no name for as a newer build’s, and drops one that is not a word (15d)', () => {
      const newer = white({ id: 'n-fill', fill: 'grey' });
      expect(withAnnotations([newer])).toEqual([{ id: 'n-fill', unknown: newer }]);
      expect(withAnnotations([white({ id: 'd-fill', fill: true })])).toEqual([]);
      // A fill is a white arrow's alone: on a push it is a field this build has no name for.
      const push = { id: 'p-fill', kind: 'push-arrow', from: [0.1, 0.5], to: [0.7, 0.5], fill: 'black' };
      expect(withAnnotations([push])).toEqual([{ id: 'p-fill', unknown: push }]);
    });

    it('is kept, verbatim and undrawn, by a build before white arrows: as any kind it has no name for', () => {
      // Checked against a34d74086's own reader, which names no `white-arrow`:
      // it carries one as a newer build's and writes it back unchanged.
      // `spiral` stands for it here, as this build's reader knows the kind.
      const older = white({ kind: 'spiral' });
      expect(withAnnotations([older])).toEqual([{ id: 'w-1', unknown: older }]);
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = [older];
      const again = throughJson(writeDiagram(readDiagram(written)!.document));
      expect(again.steps[0].annotations).toEqual([older]);
    });
  });

  it('carries a rotation of a shape it does not know, even one it would call incomplete', () => {
    const newer = { id: 'n-8', kind: 'rotate', from: [0, 0], to: [0, 0], rotate: { degrees: 30, direction: 'cw' } };
    expect(withAnnotations([newer])).toEqual([{ id: 'n-8', unknown: newer }]);
  });

  describe('a right angle', () => {
    const mark = (more: Record<string, unknown> = {}) => ({
      id: 'r-1',
      kind: 'right-angle',
      from: [0.5, 0.5],
      to: [0.5 + 0.02 * Math.SQRT1_2, 0.5 - 0.02 * Math.SQRT1_2],
      ...more,
    });

    it('round-trips its corner and the way it opens, at whatever distance `to` was written', () => {
      // Only its direction is read: a `to` further along reads as written, and is written back so.
      const far = mark({ id: 'r-2', to: [0.9, 0.1] });
      const read = withAnnotations([mark(), far]);
      expect(read).toEqual([mark(), far]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual([mark(), far]);
    });

    it('carries what a newer build might write: a field it has no name for, or a point past reach', () => {
      const newer = [mark({ id: 'r-3', size: 'large' }), mark({ id: 'r-4', from: [4.5, 0.5], to: [4.6, 0.4] })];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    });

    it('drops one that opens no way, or has no corner', () => {
      expect(withAnnotations([mark({ to: [0.5, 0.5] }), mark({ id: 'r-5', from: undefined })])).toEqual([]);
    });

    it('is kept, verbatim and undrawn, by a build that knows no right angle: as any kind it has no name for', () => {
      // What a build before right angles does with one: its reader names no
      // such kind, so it is a newer build's (`spiral-arrow` here stands for it).
      const older = mark({ kind: 'spiral-arrow' });
      expect(withAnnotations([older])).toEqual([{ id: 'r-1', unknown: older }]);
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = [older];
      const again = throughJson(writeDiagram(readDiagram(written)!.document));
      expect(again.steps[0].annotations).toEqual([older]);
    });
  });

  describe('an angle mark (15b)', () => {
    const mark = (more: Record<string, unknown> = {}) => ({
      id: 'm-1',
      kind: 'angle-mark',
      from: [0.5, 0.98],
      to: [0.48, 0.96],
      other: [0.5, 0.96],
      ...more,
    });

    it('round-trips its vertex, its arms and its ticks', () => {
      const ticked = mark({ id: 'm-2', ticks: 2 });
      const read = withAnnotations([mark(), ticked]);
      expect(read).toEqual([mark(), ticked]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual([mark(), ticked]);
    });

    it('carries what a newer build might write: more ticks than three, a field it has no name for, an arm past reach', () => {
      const newer = [mark({ id: 'm-3', ticks: 4 }), mark({ id: 'm-4', style: 'arc' }), mark({ id: 'm-5', other: [4.5, 0.5] })];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    });

    it('drops one with no second arm, ticks that are no count, or arms that make no angle', () => {
      const damaged = [
        mark({ other: undefined }),
        mark({ id: 'm-6', ticks: 0 }),
        mark({ id: 'm-7', ticks: 1.5 }),
        // Along one line: no angle to mark.
        mark({ id: 'm-8', to: [0.4, 0.98], other: [0.6, 0.98] }),
      ];
      expect(withAnnotations(damaged)).toEqual([]);
    });
  });

  describe('a pleat arrow (15c)', () => {
    const pleat = (more: Record<string, unknown> = {}) => ({
      id: 'p-1',
      kind: 'pleat-arrow',
      from: [0.62, 0.42],
      to: [0.18, 0.5],
      ...more,
    });

    it('round-trips its ends, its Zs and the side they step to — one, and the right, when unsaid', () => {
      const pleated = pleat({ id: 'p-2', kinks: 2, mirrored: true });
      const read = withAnnotations([pleat(), pleated]);
      expect(read).toEqual([pleat(), pleated]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual([pleat(), pleated]);
    });

    it('reads its Zs stepping right when a file says so, and writes nothing for it', () => {
      const read = withAnnotations([pleat({ mirrored: false })]);
      expect(read).toEqual([pleat()]);
    });

    it('carries what a newer build might write: more Zs than five, a field it has no name for', () => {
      const newer = [pleat({ id: 'p-3', kinks: 6 }), pleat({ id: 'p-4', zigzag: true })];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    });

    it('drops one whose Zs are no count, or whose side is not a yes or a no', () => {
      const damaged = [
        pleat({ kinks: 0 }),
        pleat({ id: 'p-5', kinks: 2.5 }),
        pleat({ id: 'p-6', kinks: 'two' }),
        pleat({ id: 'p-7', mirrored: 'left' }),
      ];
      expect(withAnnotations(damaged)).toEqual([]);
    });
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
    const step = stepsIn(read).find((entry) => entry.id === stepIds[0])!;
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
    expect(stepsIn(read)[1].picture).toBeNull();
  });

  it('carries an asset of a kind it does not know, and writes it back as it came', () => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    written.assets['asset-v'] = { id: 'asset-v', kind: 'video', frames: 3 };
    written.steps.push({ id: 'step-later', source: { kind: 'video', assetId: 'asset-v' }, text: '' });
    const read = readDiagram(written)!;
    expect(read.document.assets['asset-v']).toEqual({ id: 'asset-v', unknown: written.assets['asset-v'] });
    expect(stepsIn(read.document).at(-1)?.unknown).toEqual(written.steps.at(-1));
    const again = throughJson(writeDiagram(read.document));
    expect(again.assets['asset-v']).toEqual(written.assets['asset-v']);
    expect(stepsIn(again).at(-1)).toEqual(written.steps.at(-1));
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
    expect(stepsIn(read.document)[0].unknown).toEqual(written.steps[0]);
    // Written back as it came, with the asset it names.
    const again = throughJson(writeDiagram(read.document));
    expect(stepsIn(again)[0]).toEqual(written.steps[0]);
    expect(again.assets['asset-pdf']).toEqual(written.assets['asset-pdf']);
  });

  it('reads a picture whose source names another asset, or none, as no picture', () => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    written.steps[0].source.assetId = 'asset-b';
    written.steps[1].source = null;
    const read = readDiagram(written)!.document;
    expect(stepsIn(read).map((step) => step.picture)).toEqual([null, null]);
  });

  it('reads a pose it does not understand as upright', () => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    written.steps[0].source.rotationQuarterTurns = 5;
    written.steps[0].source.mirrored = 'yes';
    expect(stepsIn(readDiagram(written)!.document)[0].source).toMatchObject({
      rotationQuarterTurns: 0,
      mirrored: false,
    });
  });

  it('leaves out an asset nothing refers to', () => {
    const { document, stepIds } = uploadDiagram();
    const trimmed = { ...document, steps: stepsIn(document).filter((step) => step.id !== stepIds[1]) };
    expect(Object.keys(throughJson(writeDiagram(trimmed)).assets)).toEqual(['asset-a']);
  });
});

/** A linked step's source as `throughJson` gives it back: any shape, for damaging. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a file read back, damaged on purpose
type WrittenSource = Record<string, any>;

/** A flat fold with its layers spread (Phase 13). */
const SPREAD_FLAT = {
  mode: 'folded-flat' as const,
  side: 'front' as const,
  rotationDeg: 0,
  foldCase: 1,
  spread: { kind: 'depth' as const, amount: 0.075, toward: 'down-right' as const },
};

/** An affine spread (13g), off its defaults in every field. */
const AFFINE_SPREAD = { kind: 'affine' as const, amount: 0.04, keep: 'bottom' as const, skew: 0.35, axisDeg: 120 };

/** A linked step of each render mode, with each kind of captured picture. */
function linkedDiagram() {
  const ids = sequentialIds();
  const stored = sanitizeSvg(FIXED_SVG, { idPrefix: 'fixed-1', mode: 'import' });
  if (!stored.ok) throw new Error(stored.error);
  const steps = [
    cpStep('step-cp', { mode: 'crease-pattern', rotationDeg: 45 }),
    {
      ...cpStep('step-flat', { mode: 'folded-flat', side: 'back', rotationDeg: 90, foldCase: 2 }),
      // Shown as its crease pattern before, turned: the pose Show as brings back (D19).
      source: {
        ...cpStep('step-flat', { mode: 'folded-flat', side: 'back', rotationDeg: 90, foldCase: 2 }).source!,
        remembered: { 'crease-pattern': { mode: 'crease-pattern' as const, rotationDeg: 30 } },
      } as DiagramCpSource,
    },
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
    cpStep('step-simulated', { mode: 'simulated', foldPercent: 0, view: { yaw: 0.8, pitch: -0.9, zoom: 1.4 } }),
    // Folded part way in Pose, stood upright: the orientation is kept with the camera.
    cpStep('step-simulated-40', {
      mode: 'simulated',
      foldPercent: 40.5,
      view: { yaw: 0.8, pitch: -0.9, zoom: 1.4, orient: [1, 0, 0, 0, 0, -1, 0, 1, 0] },
    }),
    // Its layers spread (Phase 13).
    cpStep('step-spread', { ...SPREAD_FLAT, rotationDeg: 15 }),
    // Shown as its pattern, remembering a spread fold to come back to (D19).
    {
      ...cpStep('step-remembers-spread', { mode: 'crease-pattern', rotationDeg: 0 }),
      source: {
        ...cpStep('step-remembers-spread', { mode: 'crease-pattern', rotationDeg: 0 }).source!,
        remembered: { folded: SPREAD_FLAT },
      } as DiagramCpSource,
    },
    // Opened as DEFOX opens a fold (13g).
    cpStep('step-affine', { ...SPREAD_FLAT, spread: AFFINE_SPREAD }),
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

  it('drops a remembered pose that does not read, or names the way the step is shown now, and keeps the step', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[1].source.remembered = {
      'crease-pattern': { mode: 'crease-pattern', rotationDeg: 'thirty' },
      folded: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 },
    };
    const source = stepsIn(readDiagram(written)!.document)[1].source as DiagramCpSource;
    expect(source.render).toMatchObject({ mode: 'folded-flat', foldCase: 2 });
    expect(source.remembered).toBeUndefined();
  });

  it('keeps a stored scene as one string, so the file is not a line per coordinate', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    expect(typeof written.steps[0].picture.sceneJson).toBe('string');
  });

  it('takes the markup out of a stored scene, and keeps the rest', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    const withMarkup = sceneOf([...sheetWithCrease().items, markup('<script>alert(1)</script>')]);
    written.steps[0].picture.sceneJson = JSON.stringify(withMarkup);
    const picture = stepsIn(readDiagram(written)!.document)[0].picture;
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
    const picture = stepsIn(readDiagram(written)!.document)[3].picture as { kind: string; svg: string };
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
    expect(stepsIn(readDiagram(written)!.document)[3].picture).toBeNull();
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
    const step = stepsIn(readDiagram(written)!.document)[index];
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
    const step = stepsIn(readDiagram(written)!.document)[1];
    expect(step).toMatchObject({ source: null, picture: null, text: 'Fold it.' });
    expect(step.unknown).toBeUndefined();
  });

  it('drops a 3D camera that is not one, and the link with it', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[2].source.render.camera.zoom = -1;
    expect(stepsIn(readDiagram(written)!.document)[2].source).toBeNull();
  });

  it('writes a rotation one way: within a turn, never negative', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[0].source.render.rotationDeg = -45;
    written.steps[1].source.render.rotationDeg = 810;
    const steps = stepsIn(readDiagram(written)!.document);
    expect(steps[0].source).toMatchObject({ render: { rotationDeg: 315 } });
    expect(steps[1].source).toMatchObject({ render: { rotationDeg: 90 } });
  });

  it.each([
    ['no spread', (source: WrittenSource) => delete source.render.spread, null],
    ['a spread at the most it reads', (source: WrittenSource) => (source.render.spread.amount = 0.2), 0.2],
    ['a spread finer than a slider sets', (source: WrittenSource) => (source.render.spread.amount = 0.001), 0.001],
    // Written on this branch before a spread had a kind: every one was by depth.
    ['a spread saved before there were two kinds', (source: WrittenSource) => delete source.render.spread.kind, 0.075],
  ])('reads a flat fold with %s', (_label, patch, amount) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    patch(written.steps[7].source);
    const source = stepsIn(readDiagram(written)!.document)[7].source as DiagramCpSource;
    expect(source.render).toEqual({
      mode: 'folded-flat',
      side: 'front',
      rotationDeg: 15,
      foldCase: 1,
      ...(amount === null ? {} : { spread: { kind: 'depth', amount, toward: 'down-right' } }),
    });
  });

  it('writes a spread with its kind first, and reads a kindless one back with it', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    expect(Object.keys(written.steps[7].source.render.spread)).toEqual(['kind', 'amount', 'toward']);
    expect(Object.keys(written.steps[9].source.render.spread)).toEqual(['kind', 'amount', 'keep', 'skew', 'axisDeg']);
    delete written.steps[7].source.render.spread.kind;
    const again = throughJson(writeDiagram(readDiagram(written)!.document));
    expect(again.steps[7].source.render.spread).toEqual({ kind: 'depth', amount: 0.075, toward: 'down-right' });
  });

  it.each([
    ['the most it opens', { amount: 0.25 }],
    ['no skew', { skew: 0 }],
    ['all skew', { skew: 1 }],
    ['an axis along x', { axisDeg: 0 }],
    ['the last axis before x again', { axisDeg: 179 }],
    ['the top held still', { keep: 'top' }],
  ])('reads an affine spread at %s', (_label, patch) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    Object.assign(written.steps[9].source.render.spread, patch);
    const source = stepsIn(readDiagram(written)!.document)[9].source as DiagramCpSource;
    expect(source.render).toMatchObject({ spread: { ...AFFINE_SPREAD, ...patch } });
  });

  it.each([
    ['no step at all', 7, (spread: WrittenSource) => (spread.amount = 0)],
    ['a step back', 7, (spread: WrittenSource) => (spread.amount = -0.05)],
    ['an amount that is not a number', 7, (spread: WrittenSource) => (spread.amount = '5%')],
    ['no direction', 7, (spread: WrittenSource) => delete spread.toward],
    ['a direction that is not a name', 7, (spread: WrittenSource) => (spread.toward = 315)],
    ['a kind that is not a name', 7, (spread: WrittenSource) => (spread.kind = 2)],
    ['a kind of null', 7, (spread: WrittenSource) => (spread.kind = null)],
    ['an affine opening of nothing', 9, (spread: WrittenSource) => (spread.amount = 0)],
    ['no layer held still', 9, (spread: WrittenSource) => delete spread.keep],
    ['a layer held still that is not a name', 9, (spread: WrittenSource) => (spread.keep = 1)],
    ['a skew that is not a number', 9, (spread: WrittenSource) => (spread.skew = 'full')],
    ['no axis', 9, (spread: WrittenSource) => delete spread.axisDeg],
  ])('drops a link whose spread has %s, and the picture with it; the words stay', (_label, index, damage) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[index].text = 'Fold it.';
    damage(written.steps[index].source.render.spread);
    const step = stepsIn(readDiagram(written)!.document)[index];
    expect(step).toMatchObject({ source: null, picture: null, text: 'Fold it.' });
    expect(step.unknown).toBeUndefined();
  });

  it.each([
    ['a spread that is not one', (source: WrittenSource) => (source.render.spread = true)],
    ['a spread of null', (source: WrittenSource) => (source.render.spread = null)],
  ])('drops a link with %s', (_label, damage) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    damage(written.steps[7].source);
    expect(stepsIn(readDiagram(written)!.document)[7].source).toBeNull();
  });

  it.each([
    ['a scope it does not know', (source: WrittenSource) => (source.scope = { kind: 'lasso', path: [1] })],
    ['a render mode it does not know', (source: WrittenSource) => (source.render = { mode: 'animated', percent: 40 })],
    // An older build would write these back without what it cannot name (Phase 13).
    ['a field on its render it does not know', (source: WrittenSource) => (source.render.mirrored = true)],
    ['a spread on a render that has none here', (source: WrittenSource) => {
      source.render = { mode: 'crease-pattern', rotationDeg: 0, spread: { amount: 0.05, toward: 'up' } };
    }],
    ['a spread with a field it does not know', (source: WrittenSource) => {
      source.render.spread = { amount: 0.05, toward: 'up', easing: 'linear' };
    }],
    ['a spread toward a direction it does not know', (source: WrittenSource) => {
      source.render.spread = { amount: 0.05, toward: 'away' };
    }],
    ['a spread past the amount it reads', (source: WrittenSource) => {
      source.render.spread = { amount: 0.35, toward: 'up' };
    }],
    // 13g: a spread is one of two kinds, each with its own fields and ranges.
    ['a spread of a kind it does not know', (source: WrittenSource) => {
      source.render.spread = { kind: 'wavy', amount: 0.05 };
    }],
    ['a depth spread past the amount it reads, which an affine one could take', (source: WrittenSource) => {
      source.render.spread = { kind: 'depth', amount: 0.22, toward: 'up' };
    }],
    ['a depth spread with an affine field', (source: WrittenSource) => {
      source.render.spread = { kind: 'depth', amount: 0.05, toward: 'up', keep: 'top' };
    }],
    ['an affine spread with a direction', (source: WrittenSource) => {
      source.render.spread = { ...AFFINE_SPREAD, toward: 'up' };
    }],
    ['an affine spread past the amount it reads', (source: WrittenSource) => {
      source.render.spread = { ...AFFINE_SPREAD, amount: 0.3 };
    }],
    ['an affine spread holding a layer it does not know still', (source: WrittenSource) => {
      source.render.spread = { ...AFFINE_SPREAD, keep: 'middle' };
    }],
    ['an affine spread skewed past all the way', (source: WrittenSource) => {
      source.render.spread = { ...AFFINE_SPREAD, skew: 1.5 };
    }],
    ['an affine spread skewed the other way', (source: WrittenSource) => {
      source.render.spread = { ...AFFINE_SPREAD, skew: -0.1 };
    }],
    ['an affine spread about an axis past the half turn', (source: WrittenSource) => {
      source.render.spread = { ...AFFINE_SPREAD, axisDeg: 180 };
    }],
    ['an affine spread about an axis below zero', (source: WrittenSource) => {
      source.render.spread = { ...AFFINE_SPREAD, axisDeg: -1 };
    }],
    ['a remembered affine spread with a field it does not know', (source: WrittenSource) => {
      source.remembered.folded = { ...source.render, side: 'front', spread: { ...AFFINE_SPREAD, catalyst: [1, 2] } };
      source.render = { mode: 'crease-pattern', rotationDeg: 0 };
      delete source.remembered['crease-pattern'];
    }],
    ['a remembered render with a field it does not know', (source: WrittenSource) => {
      source.remembered['crease-pattern'].mirrored = true;
    }],
    ['a remembered render of a mode it does not know', (source: WrittenSource) => {
      source.remembered['crease-pattern'] = { mode: 'traced', rotationDeg: 30 };
    }],
    ['a remembered spread past the amount it reads', (source: WrittenSource) => {
      source.remembered.folded = { ...source.render, side: 'front', spread: { amount: 0.5, toward: 'up' } };
      source.render = { mode: 'crease-pattern', rotationDeg: 0 };
      delete source.remembered['crease-pattern'];
    }],
    ['a way of showing it does not know', (source: WrittenSource) => {
      source.remembered.animated = { mode: 'animated', percent: 40 };
    }],
  ])('carries, locked and verbatim, a linked step with %s', (_label, newer) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    newer(written.steps[1].source);
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(stepsIn(read.document)[1].unknown).toEqual(written.steps[1]);
    expect(stepsIn(throughJson(writeDiagram(read.document)))[1]).toEqual(written.steps[1]);
  });

  it('keeps a capture held as a bitmap, and drops a scene with no link to say what it is', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    const raster = rasterAsset('asset-r', 64, 48);
    written.assets = { 'asset-r': raster };
    written.steps[0].picture = { kind: 'asset', assetId: 'asset-r', paperScale: 3, styleKey: 'pens-1', key: 'raster-1' };
    written.steps[1].source = null;
    const read = readDiagram(written)!.document;
    // With the style it was drawn in, so a change of style says it is out of date.
    expect(stepsIn(read)[0].picture).toEqual({
      kind: 'asset',
      assetId: 'asset-r',
      paperScale: 3,
      styleKey: 'pens-1',
      key: 'raster-1',
    });
    expect(stepsIn(throughJson(writeDiagram(read)))[0].picture).toEqual(written.steps[0].picture);
    expect(read.assets['asset-r']).toEqual(raster);
    expect(stepsIn(read)[1].picture).toBeNull();
  });
});

/** A sequence card, a Find step of the back, a card no region matched, and one pulled with its plan and way. */
function sentDiagram() {
  const steps = [
    referencesStep('step-seq'),
    referencesStep('step-find', { mode: 'find', settings: null, line: null, card: 1, side: 'back' }),
    referencesStep('step-turn', { card: null, line: null, fingerprint: null }),
    referencesStep('step-pulled', { plan: '{"planner":"p"}', way: 'O1:c0,c1:0', sentence: 'Fold P onto Q &amp; R.' }),
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

  it('drops a plan or a way that does not read, and keeps the step and the rest of its source', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[3].source.plan = 7;
    written.steps[3].source.way = '';
    written.steps[3].source.sentence = 3;
    const step = stepsIn(readDiagram(written)!.document)[3];
    expect(step.source).toMatchObject({ kind: 'references-step', card: 2 });
    expect(step.source).not.toHaveProperty('plan');
    expect(step.source).not.toHaveProperty('way');
    expect(step.source).not.toHaveProperty('sentence');
  });

  it('reads a card’s recorded sentence as a step’s text is read: XML-clean', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[3].source.sentence = 'Fold\u0000 P';
    expect(stepsIn(readDiagram(written)!.document)[3]!.source).toMatchObject({ sentence: 'Fold P' });
  });

  it('keeps a card drawn with a primitive this build does not draw, locked and verbatim', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[0].picture.model.primitives.push({ kind: 'hinge', at: [0.5, 0.5] });
    const read = readDiagram(written)!;
    expect(stepsIn(read.document)[0].unknown).toEqual(written.steps[0]);
    expect(stepsIn(throughJson(writeDiagram(read.document)))[0]).toEqual(written.steps[0]);
  });

  it('drops a card whose drawing does not read, and keeps the link and the words', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[0].picture.model.primitives[1].to = [1, 'a'];
    const step = stepsIn(readDiagram(written)!.document)[0];
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
    const step = stepsIn(readDiagram(written)!.document)[0];
    expect(step).toMatchObject({ source: null, picture: null, text: 'Fold the bottom edge to the top.' });
  });

  it('keeps a card only as a References step’s picture, and a step diagram only there', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[0].picture = scenePicture();
    written.steps[1].source = throughJson(cpStep('x').source);
    written.steps[1].picture = stepDiagramPicture();
    const steps = stepsIn(readDiagram(written)!.document);
    expect(steps[0].picture).toBeNull();
    expect(steps[1]).toMatchObject({ source: { kind: 'cp' }, picture: null });
  });
});

describe('turns between steps (D22)', () => {
  function turning() {
    const ids = sequentialIds();
    let diagram = createDiagram({ title: 'Crane', newId: ids });
    diagram = insertSteps(
      diagram,
      [
        createStep(ids),
        createTurn({ kind: 'turn-over', axis: 'horizontal' }, ids),
        createStep(ids),
        createTurn({ kind: 'rotate', rotate: { amount: 'eighth', direction: 'ccw' } }, ids),
      ],
      0
    );
    return diagram;
  }

  it('writes a turn as what it is and reads it back in its place', () => {
    const diagram = turning();
    const written = throughJson(writeDiagram(diagram));
    expect(written.steps[1]).toEqual({ id: 'turn-3', kind: 'turn-over', axis: 'horizontal' });
    expect(written.steps[3]).toEqual({ id: 'turn-5', kind: 'rotate', rotate: { amount: 'eighth', direction: 'ccw' } });
    expect(readDiagram(written)!.document).toEqual(diagram);
  });

  it('turns over side to side, or a quarter clockwise, when a turn does not say', () => {
    const written = throughJson(writeDiagram(turning()));
    delete written.steps[1].axis;
    delete written.steps[3].rotate;
    const read = readDiagram(written)!.document.steps;
    expect(read[1]).toEqual({ id: 'turn-3', kind: 'turn-over', axis: 'vertical' });
    expect(read[3]).toEqual({ id: 'turn-5', kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } });
  });

  it('carries a newer build’s turn whole and locked: a kind, a field or a value this build does not know', () => {
    for (const newer of [
      { id: 'turn-3', kind: 'spin', axis: 'vertical' },
      { id: 'turn-3', kind: 'turn-over', axis: 'vertical', speed: 2 },
      { id: 'turn-3', kind: 'turn-over', axis: 'diagonal' },
      { id: 'turn-3', kind: 'rotate', rotate: { amount: 'third', direction: 'cw' } },
    ]) {
      const written = throughJson(writeDiagram(turning()));
      written.steps[1] = newer;
      const read = readDiagram(written)!.document;
      const carried = read.steps[1]!;
      // Still a turn: it takes no number, and the step after it is step 2.
      expect(isTurn(carried) && isLockedTurn(carried)).toBe(true);
      expect(carried).toMatchObject({ id: 'turn-3', unknown: newer });
      expect(stepNumber(read, read.steps[2]!.id)).toBe(2);
      // Written back exactly as it came.
      expect(throughJson(writeDiagram(read)).steps[1]).toEqual(newer);
    }
  });

  it('leaves out a turn that does not read, and keeps the rest', () => {
    const written = throughJson(writeDiagram(turning()));
    written.steps[1] = { id: 'turn-3', kind: 'turn-over', axis: 7 };
    written.steps[3] = { kind: 'rotate' };
    const read = readDiagram(written)!.document;
    expect(read.steps.map((entry) => entry.id)).toEqual(['step-2', 'step-4']);
  });
});
