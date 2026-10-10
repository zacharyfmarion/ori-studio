import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import {
  createDiagram,
  createStep,
  duplicateStep,
  insertSteps,
  setDiagramStyle,
  setHanStyle,
  setPageSetup,
  setStepText,
  createTurn,
  isLockedTurn,
  isTurn,
  stepNumber,
  type DiagramIdFactory,
  type DiagramCpRender,
  type DiagramCpSource,
} from './diagramDocument';
import { readDiagram, storedSceneJson, writeDiagram } from './diagramFile';
import { SVG_STORED_MAX_BYTES, sanitizeSvg } from '../upload/svgSanitize';
import { SCENE_JSON_MAX_BYTES } from './paperFacesFile';
import { MAX_STORED_STROKES } from '../../cp-workspace/sheets/sheetThumbnail';
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
import { diagramLayoutSteps } from '../pages/diagramPages';

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

  it('writes the first page’s side only when it is the right, and reads a file without it as the left', () => {
    const left = throughJson(writeDiagram(sampleDiagram()));
    expect('firstPageSide' in left.page).toBe(false);
    expect(readDiagram(left)!.document.page.firstPageSide).toBe('left');
    const onTheRight = setPageSetup(sampleDiagram(), { firstPageSide: 'right' });
    const right = throughJson(writeDiagram(onTheRight));
    expect(right.page.firstPageSide).toBe('right');
    const read = readDiagram(right)!;
    expect(read.readOnly).toBe(false);
    expect(read.document).toEqual(onTheRight);
    // Damage reads as the left; a side this build has no name for is a newer build's, shown as the left and kept.
    expect(readDiagram({ ...right, page: { ...right.page, firstPageSide: 3 } })!.document.page.firstPageSide).toBe('left');
    const both = readDiagram({ ...right, page: { ...right.page, firstPageSide: 'both' } })!;
    expect(both.readOnly).toBe(false);
    expect(both.document.page.firstPageSide).toBe('left');
    expect(throughJson(writeDiagram(both.document)).page.firstPageSide).toBe('both');
  });

  it('writes the flow band’s width and colour only when not the defaults, and reads a file without them as the defaults', () => {
    const plain = throughJson(writeDiagram(sampleDiagram()));
    expect('pathWidthMm' in plain.page).toBe(false);
    expect('pathColor' in plain.page).toBe(false);
    // 20 mm: a file that never chose, which drew the band in proportion to its steps until 2026-10-08, too.
    expect(readDiagram(plain)!.document.page).toMatchObject({ pathWidthMm: 20, pathColor: '#ecece8' });
    const chosen = setPageSetup(sampleDiagram(), { pathWidthMm: 18, pathColor: '#D6E8F5' });
    expect(chosen.page).toMatchObject({ pathWidthMm: 18, pathColor: '#d6e8f5' });
    const written = throughJson(writeDiagram(chosen));
    expect(written.page).toMatchObject({ pathWidthMm: 18, pathColor: '#d6e8f5' });
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(read.document).toEqual(chosen);
    // Back to the defaults: unsaid again.
    const reset = throughJson(writeDiagram(setPageSetup(chosen, { pathWidthMm: 20, pathColor: '#ecece8' })));
    expect('pathWidthMm' in reset.page || 'pathColor' in reset.page).toBe(false);
    // A file that says the default reads as it, and is written back without it.
    const said = readDiagram({ ...written, page: { ...written.page, pathWidthMm: 20 } })!;
    expect(said.document.page.pathWidthMm).toBe(20);
    expect('pathWidthMm' in throughJson(writeDiagram(said.document)).page).toBe(false);
    // A width past the range is shown clamped, as the margin is, and written back as it came; damage reads as the default.
    const page = (patch: Record<string, unknown>) => readDiagram({ ...written, page: { ...written.page, ...patch } })!;
    expect(page({ pathWidthMm: 400 }).document.page.pathWidthMm).toBe(60);
    expect(throughJson(writeDiagram(page({ pathWidthMm: 400 }).document)).page.pathWidthMm).toBe(400);
    expect(page({ pathWidthMm: 1 }).document.page.pathWidthMm).toBe(4);
    expect(page({ pathWidthMm: '18' }).document.page.pathWidthMm).toBe(20);
    expect(page({ pathWidthMm: null }).document.page.pathWidthMm).toBe(20);
    expect(page({ pathColor: 7 }).document.page.pathColor).toBe('#ecece8');
    expect(page({ pathColor: 7 }).readOnly).toBe(false);
    // A colour in a notation this build cannot read is a newer build's: shown as the default, kept as it came.
    for (const pathColor of ['oklch(0.9 0.02 90)', '#d6e8f580', 'teal']) {
      const newer = page({ pathColor });
      expect(newer.readOnly, pathColor).toBe(false);
      expect(newer.document.page.pathColor, pathColor).toBe('#ecece8');
      expect(throughJson(writeDiagram(newer.document)).page.pathColor, pathColor).toBe(pathColor);
    }
  });

  it('keeps a diagram saved in the grid a grid, now that a new one starts in the flow', () => {
    // As a build before the flow was the default wrote it: every page field, the layout said.
    const saved = {
      formatVersion: 1,
      id: 'diagram-old',
      title: 'Crane',
      hanStyle: 'sc',
      style: { preset: 'diagram' },
      page: {
        size: 'a4',
        orientation: 'portrait',
        marginMm: 12,
        layout: 'grid',
        columns: 3,
        rows: 3,
        showPath: true,
        scale: 'fit',
        showTitle: true,
        pageNumbers: { enabled: true, first: 1 },
      },
      steps: [],
      assets: {},
    };
    const read = readDiagram(saved)!;
    expect(read.readOnly).toBe(false);
    expect(read.document.page.layout).toBe('grid');
    expect(throughJson(writeDiagram(read.document)).page.layout).toBe('grid');
    // A layout not said — a hand-edited or damaged page — reads as the grid too, never as the new default.
    const { layout: _layout, ...unsaid } = saved.page;
    expect(readDiagram({ ...saved, page: unsaid })!.document.page.layout).toBe('grid');
    expect(readDiagram({ ...saved, page: { ...saved.page, layout: 7 } })!.document.page.layout).toBe('grid');
    expect(readDiagram({ ...saved, page: undefined })!.document.page.layout).toBe('grid');
    // A new diagram is a flow, and says so: it opens as one again.
    const fresh = createDiagram({ newId: sequentialIds() });
    expect(fresh.page.layout).toBe('flow');
    const written = throughJson(writeDiagram(fresh));
    expect(written.page.layout).toBe('flow');
    expect(readDiagram(written)!.document.page.layout).toBe('flow');
  });

  it('opens a diagram saved with One scale as any other, and writes no scale', () => {
    const saved = throughJson(writeDiagram(sampleDiagram()));
    expect('scale' in saved.page).toBe(false);
    for (const scale of ['paper', 'fit', 'another', 7]) {
      const read = readDiagram({ ...saved, page: { ...saved.page, scale } })!;
      expect(read.readOnly, String(scale)).toBe(false);
      expect(read.document.page).toEqual(readDiagram(saved)!.document.page);
      expect('scale' in throughJson(writeDiagram(read.document)).page).toBe(false);
    }
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

  it.each([
    ['a step field', (step: Record<string, unknown>) => ({ ...step, hologram: { from: 'annotation-1', depth: 3 } })],
    ['a field of its scene picture', (step: Record<string, unknown>) => ({ ...step, picture: { ...(step.picture as object), depthMap: '{}' } })],
    ['a step field no build has written yet', (step: Record<string, unknown>) => ({ ...step, layers: [1, 2] })],
  ])('carries a step with %s it has no name for, locked, and writes it back byte for byte', (_label, patch) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    const newer = patch(written.steps[0]);
    written.steps[0] = newer;
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(stepsIn(read.document)[0].unknown).toEqual(newer);
    // The other steps read as ever.
    expect(stepsIn(read.document).slice(1).every((step) => step.unknown === undefined)).toBe(true);
    expect(JSON.stringify(writeDiagram(read.document))).toBe(JSON.stringify(written));
  });

  // Decision 2 of the launch review: drawn rather than blank, and still locked.
  it('shows a newer build’s step as far as it reads it — its link, picture and marks — never its placement', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[1].place = { frame: [3.5, -2] };
    written.steps[1].annotations = [{ id: 'ann-1', kind: 'valley-arrow', from: [0, 0], to: [0.5, 0.5] }];
    const ours = stepsIn(readDiagram(written)!.document)[1];
    const newer = { ...written.steps[1], layers: [1, 2] };
    written.steps[1] = newer;
    const read = readDiagram(written)!;
    const step = stepsIn(read.document)[1];
    expect(step.unknown).toEqual(newer);
    expect(step.source).toEqual(ours.source);
    expect(step.picture).toEqual(ours.picture);
    expect(step.annotations).toEqual(ours.annotations);
    expect(step.place).toBeUndefined();
    // Written back as it came, whatever was read of it.
    expect(throughJson(writeDiagram(read.document))).toEqual(written);
  });

  it('shows nothing of a newer build’s step whose frame, marks or picture it cannot read', () => {
    const cases: [string, (step: Record<string, unknown>) => Record<string, unknown>][] = [
      ['a frame', (step) => ({ ...step, zoom: { from: 'ann-1', shape: 'hexagon' } })],
      ['more marks than a step holds', (step) => ({ ...step, annotations: Array.from({ length: 501 }, (_, i) => ({ id: `a${i}` })) })],
      ['a picture', (step) => ({ ...step, picture: { ...(step.picture as object), kind: 'hologram' } })],
    ];
    for (const [label, patch] of cases) {
      const written = throughJson(writeDiagram(linkedDiagram()));
      written.steps[1] = patch(written.steps[1]);
      const step = stepsIn(readDiagram(written)!.document)[1];
      expect(step.unknown, label).toEqual(written.steps[1]);
      expect(step.picture, label).toBeNull();
    }
  });

  it('reads every step a build writes with nothing locked, and writes it back byte for byte', () => {
    for (const document of [sampleDiagram(), linkedDiagram(), uploadDiagram().document, sentDiagram()]) {
      const written = throughJson(writeDiagram(document));
      const read = readDiagram(written)!;
      expect(stepsIn(read.document).every((step) => step.unknown === undefined)).toBe(true);
      expect(JSON.stringify(throughJson(writeDiagram(read.document)))).toBe(JSON.stringify(written));
    }
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

  // Decisions 1 and 2 together: an asset or a thumbnail that only a newer
  // build's writing names is that build's too, wherever the name is.
  const NAMES_BOTH = { assetId: 'asset-cover', thumbnail: 'thumb-cover' };
  it.each([
    ['field of the diagram', (written: WrittenSource) => (written.cover = NAMES_BOTH)],
    ['page field', (written: WrittenSource) => (written.page = { ...written.page, background: NAMES_BOTH })],
    ['style', (written: WrittenSource) => (written.style = { preset: 'future', paper: NAMES_BOTH })],
    ['turn', (written: WrittenSource) => written.steps.push({ id: 'turn-newer', kind: 'spin', cover: NAMES_BOTH })],
    ['annotation', (written: WrittenSource) => (written.steps[0].annotations = [{ id: 'ann-newer', kind: 'sticker', ...NAMES_BOTH }])],
    ['asset', (written: WrittenSource) => (written.assets['asset-video'] = { id: 'asset-video', kind: 'video', poster: NAMES_BOTH })],
  ])('keeps the asset and the thumbnail only a newer build’s %s names', (_label, patch) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.assets = { ...written.assets, 'asset-cover': rasterAsset('asset-cover', 64, 48) };
    written.thumbnails['thumb-cover'] = JSON.stringify({ viewBox: '0 0 100 100', strokes: [] });
    patch(written);
    const read = readDiagram(written)!;
    expect(throughJson(writeDiagram(read.document))).toEqual(written);
    // And through an edit elsewhere, which the store prunes as it lands.
    const again = throughJson(writeDiagram(setStepText(read.document, read.document.steps[0]!.id, 'Fold in half.')));
    expect(again.assets['asset-cover']).toEqual(written.assets['asset-cover']);
    expect(again.thumbnails['thumb-cover']).toBe(written.thumbnails['thumb-cover']);
  });

  // Decision 2 of the launch review: what a newer build wrote at the
  // document's level falls back alone, and the diagram stays editable.
  it.each([
    ['a document key it does not know', { fonts: { han: 'sc' } }, {}],
    ['a Han style it does not know', { hanStyle: 'vi' }, { hanStyle: 'sc' }],
    ['a preset it does not know', { style: { preset: 'future' } }, { style: { preset: 'diagram' } }],
    ['a style field it does not know', { style: { preset: 'diagram', ink: 'riso' } }, { style: { preset: 'diagram' } }],
    // This build stores a preset or a style; a newer one might store a preset and what it changes.
    [
      'a preset with a paper style beside it',
      { style: { preset: 'diagram', style: DEFAULT_PAPER_STYLE } },
      { style: { preset: 'diagram' } },
    ],
    [
      'a paper style it does not read whole',
      { style: { style: { ...DEFAULT_PAPER_STYLE, grain: 'washi' } } },
      { style: { style: DEFAULT_PAPER_STYLE } },
    ],
    ['a page size it does not know', { page: { size: 'a3' } }, { page: { size: 'a4' } }],
    ['a page key it does not know', { page: { bleedMm: 3 } }, {}],
    ['a margin past what it reads', { page: { marginMm: 45 } }, { page: { marginMm: 30 } }],
    ['more columns than it lays out', { page: { columns: 8 } }, { page: { columns: 5 } }],
    ['page numbers with a field it does not know', { page: { pageNumbers: { enabled: true, first: 3, at: 'top' } } }, {}],
    ['a first page number past what it reads', { page: { pageNumbers: { enabled: true, first: 20_000 } } }, {}],
  ])('falls back alone, stays editable and writes back as it came, a diagram with %s', (_label, patch, shown) => {
    const base = throughJson(writeDiagram(sampleDiagram()));
    const written = { ...base, ...patch };
    if ('page' in patch) written.page = { ...base.page, ...patch.page };
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(read.document.newer).toBeDefined();
    expect(read.document).toMatchObject(shown);
    // Steps read as ever.
    expect(stepsIn(read.document)).toHaveLength(2);
    expect(throughJson(writeDiagram(read.document))).toEqual(written);
    // And an edit elsewhere keeps it.
    const edited = setStepText(read.document, stepsIn(read.document)[0].id, 'Fold in half.');
    const again = throughJson(writeDiagram(edited));
    expect({ ...again, steps: written.steps }).toEqual(written);
  });

  it('lets go of a newer value when the field is set here, and keeps the rest', () => {
    const base = throughJson(writeDiagram(sampleDiagram()));
    const written = {
      ...base,
      hanStyle: 'vi',
      style: { preset: 'future' },
      page: { ...base.page, size: 'a3', bleedMm: 3 },
    };
    const read = readDiagram(written)!.document;
    // Set to the value shown in its place: still a choice made here.
    const sized = setPageSetup(read, { size: 'a4' });
    expect(throughJson(writeDiagram(sized)).page).toMatchObject({ size: 'a4', bleedMm: 3 });
    const styled = setDiagramStyle(sized, { preset: 'diagram' });
    expect(throughJson(writeDiagram(styled)).style).toEqual({ preset: 'diagram' });
    const han = setHanStyle(styled, 'sc');
    expect(throughJson(writeDiagram(han)).hanStyle).toBe('sc');
    expect(han.newer).toEqual({ page: { bleedMm: 3 } });
    expect(setPageSetup(han, { bleedMm: 1 } as never).newer).toBeUndefined();
  });

  it('reads a diagram this build wrote with nothing newer', () => {
    for (const document of [sampleDiagram(), setDiagramStyle(sampleDiagram(), { style: DEFAULT_PAPER_STYLE })]) {
      expect(readDiagram(throughJson(writeDiagram(document)))!.document.newer).toBeUndefined();
    }
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
    // Every field equal divisions write (Revision 2).
    { id: 'a-13', kind: 'divisions', from: [0, 0], to: [1, 0], parts: 7, offset: 1.5, mirrored: true, ticks: 2, numbered: true },
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

    it('round-trips a fold-and-unfold arrow’s return shaped by hand, from the tip', () => {
      const back = [
        { at: [0.7, 0.5], out: [0.6, 0.65] },
        { at: [0.15, 0.55], in: [0.3, 0.7], out: [0.1, 0.5] },
        { at: [0.12, 0.45], in: [0.1, 0.48] },
      ];
      const read = withAnnotations([shaped({ back })]);
      expect(read).toEqual([shaped({ back })]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual([shaped({ back })]);
    });

    it('drops a return that does not start at the tip, and carries one no build writes as a newer build’s', () => {
      const back = [{ at: [0.7, 0.5], out: [0.6, 0.65] }, { at: [0.15, 0.55] }];
      const read = withAnnotations([
        shaped({ id: 'd-start', back: [{ at: [0.6, 0.5] }, { at: [0.15, 0.55] }] }),
        shaped({ id: 'd-one', back: [{ at: [0.7, 0.5] }] }),
        shaped({ id: 'kept', back }),
      ]);
      expect(read.map((annotation) => annotation.id)).toEqual(['kept']);
      const newer = [
        // A return on an arrow that has none, or with no path to return along.
        shaped({ id: 'n-valley', kind: 'valley-arrow', back }),
        { id: 'n-arc', kind: 'fold-unfold-arrow', from: [0.1, 0.5], to: [0.7, 0.5], bend: 0.2, back },
      ];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
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

  describe('a solid line (17a)', () => {
    const solid = (more: Record<string, unknown> = {}) => ({ id: 's-1', kind: 'solid-line', from: [0.1, 0.5], to: [0.7, 0.5], ...more });

    it('round-trips its colour and its ends behind a flap, and one with no colour, written with none', () => {
      const every = [
        solid({ color: '#c91d87' }),
        solid({ id: 's-2', color: '#1971C2', behind: { from: 1, to: 2 } }),
        solid({ id: 's-3' }),
      ];
      expect(withAnnotations(every)).toEqual(every);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: withAnnotations(every) }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual(every);
    });

    it('carries a colour it cannot draw as a newer build’s, and drops one that is not a word', () => {
      for (const color of ['magenta', 'theme:accent', '#c91d87ff', 'rgb(1, 2, 3)']) {
        const newer = solid({ id: `n-${color}`, color });
        expect(withAnnotations([newer]), color).toEqual([{ id: newer.id, unknown: newer }]);
      }
      expect(withAnnotations([solid({ id: 'd-number', color: 7 }), solid({ id: 'd-null', color: null })])).toEqual([]);
      // A colour is a solid line's alone: on a valley line it is a field this build has no name for.
      const valley = { id: 'v-color', kind: 'valley-line', from: [0, 0], to: [1, 1], color: '#e03131' };
      expect(withAnnotations([valley])).toEqual([{ id: 'v-color', unknown: valley }]);
    });

    it('is kept, verbatim and undrawn, by a build before solid lines: as any kind it has no name for', () => {
      // A build before 17a names no `solid-line`; `spiral-line` stands for it here.
      const older = solid({ kind: 'spiral-line', color: '#e03131' });
      expect(withAnnotations([older])).toEqual([{ id: 's-1', unknown: older }]);
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = [older];
      expect(throughJson(writeDiagram(readDiagram(written)!.document)).steps[0].annotations).toEqual([older]);
    });
  });

  describe('a label’s options (17b)', () => {
    const label = (more: Record<string, unknown> = {}) => ({ id: 't-1', kind: 'label', from: [0.2, 0.3], to: [0.2, 0.3], text: 'P', ...more });

    it('round-trips every option, each written only as it is set, and a plain label as it was', () => {
      const every = [
        label({ color: '#c91d87', bold: true, halo: true, sizePt: 9, offsetPt: [-6.5, 4.25] }),
        label({ id: 't-2', bold: true }),
        label({ id: 't-3', sizePt: 4 }),
        label({ id: 't-4', sizePt: 48, offsetPt: [200, -200] }),
        label({ id: 't-5' }),
      ];
      expect(withAnnotations(every)).toEqual(every);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: withAnnotations(every) }, stepsIn(document)[1]!];
      const written = throughJson(writeDiagram(document)).steps[0].annotations;
      expect(written).toEqual(every);
      // A plain label is written with the fields every label was written with before them.
      expect(Object.keys(written[4])).toEqual(['id', 'kind', 'from', 'to', 'text']);
      // Bold and the halo read false as unsaid, and are never written false.
      expect(withAnnotations([label({ id: 't-6', bold: false, halo: false })])).toEqual([label({ id: 't-6' })]);
    });

    it('carries a colour, a size or an offset past what it draws as a newer build’s', () => {
      const newer = [
        label({ id: 'n-color', color: 'magenta' }),
        label({ id: 'n-size', sizePt: 72 }),
        label({ id: 'n-offset', offsetPt: [0, 240] }),
      ];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    });

    it('drops one whose options are damaged', () => {
      const damaged = [
        label({ id: 'd-bold', bold: 'yes' }),
        label({ id: 'd-halo', halo: 1 }),
        label({ id: 'd-size', sizePt: 2 }),
        label({ id: 'd-size-nan', sizePt: 'large' }),
        label({ id: 'd-offset', offsetPt: [1] }),
        label({ id: 'd-offset-word', offsetPt: ['1', 2] }),
        label({ id: 'd-color', color: 7 }),
      ];
      expect(withAnnotations(damaged)).toEqual([]);
    });

    it('is kept, verbatim and undrawn, by a build before them, as a field it has no name for is; a callout never had them', () => {
      // A build before 17b names `text` alone on a label: any option is a field it has no name for.
      const styled = label({ bold: true, offsetPt: [3, 4], underline: true });
      expect(withAnnotations([styled])).toEqual([{ id: 't-1', unknown: styled }]);
      const callout = { id: 'c-bold', kind: 'callout', from: [0.1, 0.1], to: [0.3, 0.3], text: 'Repeat', bold: true };
      expect(withAnnotations([callout])).toEqual([{ id: 'c-bold', unknown: callout }]);
    });
  });

  describe('a mark lifted from a References card (17d)', () => {
    const lifted = [
      { id: 'i-1', kind: 'valley-line', from: [0, 0.5], to: [1, 0.5], imported: 'untouched' },
      { id: 'i-2', kind: 'solid-line', from: [0, 0], to: [1, 0], color: '#c91d87', imported: 'edited' },
      { id: 'i-3', kind: 'circle', from: [0, 1], to: [0, 1], imported: 'untouched' },
      { id: 'i-4', kind: 'fold-unfold-arrow', from: [0.1, 0.4], to: [0.5, 0.4], bend: -0.134, imported: 'untouched' },
      {
        id: 'i-5',
        kind: 'label',
        from: [0, 1],
        to: [0, 1],
        text: 'P',
        color: '#c91d87',
        bold: true,
        halo: true,
        sizePt: 9,
        offsetPt: [-6.02, 7.73],
        imported: 'untouched',
      },
    ];

    it('round-trips its tag on every kind, and a mark of the author’s with none', () => {
      expect(withAnnotations(lifted)).toEqual(lifted);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: withAnnotations(lifted) }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual(lifted);
      expect(Object.keys(stepsIn(throughJson(writeDiagram(sampleDiagram())))[0].annotations[0] ?? {})).not.toContain('imported');
    });

    it('carries a state it does not know as a newer build’s, told before damage, and drops a tag that is not a word', () => {
      const newer = { id: 'n-1', kind: 'circle', from: [0, 1], to: [0, 1], imported: 'linked' };
      expect(withAnnotations([newer])).toEqual([{ id: 'n-1', unknown: newer }]);
      // News before damage: a newer tag on a mark whose bend does not read is still a newer build's.
      const both = { id: 'n-2', kind: 'valley-arrow', from: [0, 0], to: [1, 0], bend: 'wide', imported: 'linked' };
      expect(withAnnotations([both])).toEqual([{ id: 'n-2', unknown: both }]);
      expect(withAnnotations([{ ...lifted[0], imported: 3 }, { ...lifted[2], imported: null }])).toEqual([]);
    });

    it('is kept, verbatim and undrawn, by a build before 17d, as a field it has no name for is', () => {
      // A build before 17d names no `imported`; `borrowed` stands for it here.
      const older = { id: 'o-1', kind: 'circle', from: [0, 1], to: [0, 1], borrowed: 'untouched' };
      expect(withAnnotations([older])).toEqual([{ id: 'o-1', unknown: older }]);
    });
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

  describe('a mark behind a flap (15e)', () => {
    const arrow = (more: Record<string, unknown> = {}) => ({
      id: 'a-1',
      kind: 'valley-arrow',
      from: [0.2, 0.5],
      to: [0.7, 0.4],
      bend: 0.1,
      ...more,
    });

    it('round-trips the ends behind and how deep each is, from end to end', () => {
      const read = withAnnotations([arrow({ behind: { from: 1, to: 3 } }), arrow({ id: 'a-2', behind: { to: 2 } })]);
      expect(read).toEqual([arrow({ behind: { from: 1, to: 3 } }), arrow({ id: 'a-2', behind: { to: 2 } })]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      const written = stepsIn(throughJson(writeDiagram(document)))[0].annotations;
      expect(written).toEqual([arrow({ behind: { from: 1, to: 3 } }), arrow({ id: 'a-2', behind: { to: 2 } })]);
      // A circle's one end, a line's two.
      const circle = { id: 'c-1', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5], behind: { from: 1 } };
      const line = { id: 'l-1', kind: 'mountain-line', from: [0.1, 0.5], to: [0.9, 0.5], behind: { from: 2, to: 1 } };
      expect(withAnnotations([circle, line])).toEqual([circle, line]);
      // Said with no end: in front.
      expect(withAnnotations([arrow({ behind: {} })])).toEqual([arrow()]);
    });

    it('carries what a newer build might write: an end its kind has no name for, more layers than nine, behind on a kind that never is', () => {
      const newer = [
        { id: 'n-1', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5], behind: { to: 1 } },
        arrow({ id: 'n-2', behind: { from: 10 } }),
        arrow({ id: 'n-3', behind: { from: 1, middle: 2 } }),
        { id: 'n-4', kind: 'push-arrow', from: [0.1, 0.5], to: [0.6, 0.5], behind: { from: 1 } },
        { id: 'n-5', kind: 'hidden-line', from: [0.1, 0.5], to: [0.6, 0.5], behind: { from: 1 } },
      ];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    });

    it('drops one whose layers are no whole count, or whose `behind` is no record', () => {
      const damaged = [arrow({ behind: { from: 0 } }), arrow({ id: 'd-2', behind: { to: 1.5 } }), arrow({ id: 'd-3', behind: true })];
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

  describe('equal divisions (Revision 2)', () => {
    const divisions = (more: Record<string, unknown> = {}) => ({
      id: 'e-1',
      kind: 'divisions',
      from: [0, 0],
      to: [1, 0],
      parts: 4,
      offset: 2.5,
      ...more,
    });

    it('round-trip their line, parts and offset — the line to the right, one tick and no count when unsaid — and every field when said', () => {
      const full = divisions({ id: 'e-2', parts: 32, offset: 0, mirrored: true, ticks: 3, numbered: true });
      const odd = divisions({ id: 'e-3', offset: 2.37 });
      const read = withAnnotations([divisions(), full, odd]);
      expect(read).toEqual([divisions(), full, odd]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual([divisions(), full, odd]);
    });

    it('round-trip short dividers (Revision 3), written only when on', () => {
      const short = divisions({ id: 'e-20', parts: 3, offset: 10, numbered: true, shortDividers: true });
      const read = withAnnotations([short, divisions({ id: 'e-21', shortDividers: false })]);
      expect(read).toEqual([short, divisions({ id: 'e-21' })]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      const written = stepsIn(throughJson(writeDiagram(document)))[0].annotations;
      expect(written).toEqual([short, divisions({ id: 'e-21' })]);
      expect(Object.keys(written[1]).sort()).toEqual(['from', 'id', 'kind', 'offset', 'parts', 'to']);
    });

    it('drop those whose short dividers are not a yes or a no', () => {
      expect(withAnnotations([divisions({ shortDividers: 'yes' }), divisions({ id: 'e-22', shortDividers: 1 })])).toEqual([]);
    });

    it('are kept, verbatim and undrawn, with short dividers by a build before Revision 3: as a field it has no name for', () => {
      // A build before 18a names no `shortDividers`; `stubDividers` stands for it here.
      const older = divisions({ id: 'e-23', stubDividers: true });
      expect(withAnnotations([older])).toEqual([{ id: 'e-23', unknown: older }]);
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = [older];
      const again = throughJson(writeDiagram(readDiagram(written)!.document));
      expect(again.steps[0].annotations).toEqual([older]);
    });

    it('read a side, a count or ticks said as their defaults, and write nothing for them', () => {
      const read = withAnnotations([divisions({ mirrored: false, numbered: false })]);
      expect(read).toEqual([divisions()]);
      const written = throughJson(writeDiagram({ ...sampleDiagram(), steps: [{ ...stepsIn(sampleDiagram())[0]!, annotations: read }] }));
      expect(Object.keys(written.steps[0].annotations[0]).sort()).toEqual(['from', 'id', 'kind', 'offset', 'parts', 'to']);
    });

    it('carry what a newer build might write: more parts than 32, an offset past 15 mm, a field they have no name for, `behind`', () => {
      const newer = [
        divisions({ id: 'e-4', parts: 33 }),
        divisions({ id: 'e-5', offset: 16 }),
        divisions({ id: 'e-6', style: 'drafting' }),
        divisions({ id: 'e-7', behind: { from: 1 } }),
        divisions({ id: 'e-8', ticks: 4 }),
      ];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    });

    it('drop those whose parts are no count of two or more, whose offset is below none or no number, or that leave either unsaid', () => {
      const damaged = [
        divisions({ parts: 1 }),
        divisions({ id: 'e-9', parts: 2.5 }),
        divisions({ id: 'e-10', offset: -1 }),
        divisions({ id: 'e-11', offset: '2.5' }),
        divisions({ id: 'e-12', parts: undefined }),
        divisions({ id: 'e-13', offset: undefined }),
        divisions({ id: 'e-14', numbered: 'yes' }),
        divisions({ id: 'e-15', mirrored: 'left' }),
        divisions({ id: 'e-16', ticks: 0 }),
      ];
      expect(withAnnotations(damaged)).toEqual([]);
    });

    it('are kept, verbatim and undrawn, by a build that knows none: as any kind it has no name for', () => {
      // What a build before them does: its reader names no such kind, so they
      // are a newer build's (`spiral-arrow` here stands for it).
      const older = divisions({ kind: 'spiral-arrow', mirrored: true, numbered: true, ticks: 2 });
      expect(withAnnotations([older])).toEqual([{ id: 'e-1', unknown: older }]);
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = [older];
      const again = throughJson(writeDiagram(readDiagram(written)!.document));
      expect(again.steps[0].annotations).toEqual([older]);
    });
  });

  describe('a star (Revision 3)', () => {
    const star = (more: Record<string, unknown> = {}) => ({ id: 's-1', kind: 'star', from: [0.4, 0.6], to: [0.4, 0.6], ...more });

    it('round-trips its point, its fill, its turn and its scale — an outline, upright, at its print size when unsaid', () => {
      const full = star({ id: 's-2', fill: 'black', angle: 37.5, scale: 2.25 });
      const read = withAnnotations([star(), full]);
      expect(read).toEqual([star(), full]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      const written = stepsIn(throughJson(writeDiagram(document)))[0].annotations;
      expect(written).toEqual([star(), full]);
      expect(Object.keys(written[0]).sort()).toEqual(['from', 'id', 'kind', 'to']);
    });

    it('reads its `to` as its point, whatever is written there', () => {
      expect(withAnnotations([star({ to: [0.9, 0.1] })])).toEqual([star()]);
    });

    it('reads its turn within [0, 360), and drops a turn that is no number alone, keeping the star', () => {
      expect(withAnnotations([star({ angle: -90 }), star({ id: 's-3', angle: 725 })])).toEqual([
        star({ angle: 270 }),
        star({ id: 's-3', angle: 5 }),
      ]);
      expect(withAnnotations([star({ angle: '30' }), star({ id: 's-4', angle: null })])).toEqual([star(), star({ id: 's-4' })]);
    });

    it('carries what a newer build might write: a fill it does not know, a scale past half to four times, a field it has no name for', () => {
      const newer = [
        star({ id: 's-5', fill: 'grey' }),
        star({ id: 's-6', scale: 4.5 }),
        star({ id: 's-7', scale: 0.25 }),
        star({ id: 's-8', halo: true }),
        star({ id: 's-9', behind: { from: 1 } }),
      ];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
      // Written back as it came.
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = newer;
      expect(throughJson(writeDiagram(readDiagram(written)!.document)).steps[0].annotations).toEqual(newer);
    });

    it('drops one whose scale is no positive number, or whose fill is no word', () => {
      const damaged = [star({ scale: 0 }), star({ id: 's-10', scale: -1 }), star({ id: 's-11', scale: '2' }), star({ id: 's-12', fill: 1 })];
      expect(withAnnotations(damaged)).toEqual([]);
    });

    it('is kept, verbatim and undrawn, by a build that knows none: as any kind it has no name for', () => {
      // What a build before Revision 3 does: its reader names no such kind (`spiral-arrow` stands for it).
      const older = star({ kind: 'spiral-arrow', fill: 'black', angle: 20, scale: 2 });
      expect(withAnnotations([older])).toEqual([{ id: 's-1', unknown: older }]);
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = [older];
      expect(throughJson(writeDiagram(readDiagram(written)!.document)).steps[0].annotations).toEqual([older]);
    });
  });

  describe('an eye (Revision 3)', () => {
    const eye = (more: Record<string, unknown> = {}) => ({ id: 'e-1', kind: 'eye', from: [0.4, 0.6], to: [0.4, 0.6], ...more });

    it('round-trips its centre, the way it looks and its scale — looking right, at its print size, when unsaid', () => {
      const full = eye({ id: 'e-2', angle: 217.25, scale: 1.75 });
      const read = withAnnotations([eye(), full]);
      expect(read).toEqual([eye(), full]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      const written = stepsIn(throughJson(writeDiagram(document)))[0].annotations;
      expect(written).toEqual([eye(), full]);
      expect(Object.keys(written[0]).sort()).toEqual(['from', 'id', 'kind', 'to']);
    });

    it('reads its `to` as its centre, whatever is written there: the way it looks is its angle', () => {
      expect(withAnnotations([eye({ to: [0.9, 0.1] })])).toEqual([eye()]);
    });

    it('reads the way it looks within [0, 360), and drops one that is no number alone, keeping the eye', () => {
      expect(withAnnotations([eye({ angle: -90 }), eye({ id: 'e-3', angle: 540 })])).toEqual([eye({ angle: 270 }), eye({ id: 'e-3', angle: 180 })]);
      expect(withAnnotations([eye({ angle: 'left' }), eye({ id: 'e-4', angle: null })])).toEqual([eye(), eye({ id: 'e-4' })]);
    });

    it('carries what a newer build might write: a scale past half to four times, a fill or a field it has no name for', () => {
      const newer = [eye({ id: 'e-5', scale: 4.5 }), eye({ id: 'e-6', scale: 0.25 }), eye({ id: 'e-7', fill: 'black' }), eye({ id: 'e-8', arrow: true })];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = newer;
      expect(throughJson(writeDiagram(readDiagram(written)!.document)).steps[0].annotations).toEqual(newer);
    });

    it('drops one whose scale is no positive number, or whose centre does not read', () => {
      const damaged = [eye({ scale: 0 }), eye({ id: 'e-9', scale: -2 }), eye({ id: 'e-10', scale: '2' }), eye({ id: 'e-11', from: [0.4] })];
      expect(withAnnotations(damaged)).toEqual([]);
    });

    it('is kept, verbatim and undrawn, by a build that knows none: as any kind it has no name for', () => {
      // What a build before Revision 3 does: its reader names no such kind (`spiral-arrow` stands for it).
      const older = eye({ kind: 'spiral-arrow', angle: 180, scale: 2 });
      expect(withAnnotations([older])).toEqual([{ id: 'e-1', unknown: older }]);
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = [older];
      expect(throughJson(writeDiagram(readDiagram(written)!.document)).steps[0].annotations).toEqual([older]);
    });
  });

  describe('an oval and a rectangle (Revision 3)', () => {
    const shape = (kind: 'oval' | 'rectangle', more: Record<string, unknown> = {}) => ({
      id: `${kind}-1`,
      kind,
      from: [0.4, 0.6],
      to: [0.4, 0.6],
      size: [0.3, 0.45],
      ...more,
    });

    it('round-trips its centre, its size and its turn — upright when unsaid — each kind its own', () => {
      const shapes = [shape('oval'), shape('rectangle', { id: 'r-2', angle: 37.5 }), shape('oval', { id: 'o-3', size: [2, 0.015] })];
      const read = withAnnotations(shapes);
      expect(read).toEqual(shapes);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      const written = stepsIn(throughJson(writeDiagram(document)))[0].annotations;
      expect(written).toEqual(shapes);
      expect(Object.keys(written[0]).sort()).toEqual(['from', 'id', 'kind', 'size', 'to']);
    });

    it('reads its `to` as its centre, whatever is written there', () => {
      expect(withAnnotations([shape('rectangle', { to: [0.9, 0.1] })])).toEqual([shape('rectangle')]);
    });

    it('reads its turn within [0, 180), a half turn drawing it the same, and drops one that is no number alone', () => {
      expect(withAnnotations([shape('oval', { angle: -30 }), shape('rectangle', { id: 'r-4', angle: 200 })])).toEqual([
        shape('oval', { angle: 150 }),
        shape('rectangle', { id: 'r-4', angle: 20 }),
      ]);
      expect(withAnnotations([shape('oval', { angle: 'level' }), shape('rectangle', { angle: null })])).toEqual([
        shape('oval'),
        shape('rectangle'),
      ]);
    });

    it('drops one with no size, or a size that is not two positive numbers, or whose centre does not read', () => {
      const { size: _none, ...unsized } = shape('oval');
      const damaged = [
        unsized,
        shape('rectangle', { size: [0.3] }),
        shape('oval', { id: 'o-5', size: [0.3, -0.1] }),
        shape('rectangle', { id: 'r-6', size: '0.3' }),
        shape('oval', { id: 'o-7', from: [0.4] }),
      ];
      expect(withAnnotations(damaged)).toEqual([]);
    });

    it('carries what a newer build might write: a side past a slip to twice the frame, a fill, a field it has no name for', () => {
      const newer = [
        shape('oval', { id: 'o-8', size: [2.5, 0.3] }),
        shape('rectangle', { id: 'r-9', size: [0.3, 0.01] }),
        shape('rectangle', { id: 'r-10', fill: 'white' }),
        shape('oval', { id: 'o-11', radius: 0.2 }),
      ];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = newer;
      expect(throughJson(writeDiagram(readDiagram(written)!.document)).steps[0].annotations).toEqual(newer);
    });

    it('is kept, verbatim and undrawn, by a build that knows neither: as any kind it has no name for', () => {
      const older = shape('oval', { kind: 'spiral-arrow', angle: 30 });
      expect(withAnnotations([older])).toEqual([{ id: 'oval-1', unknown: older }]);
      const written = throughJson(writeDiagram(sampleDiagram()));
      written.steps[0].annotations = [older];
      expect(throughJson(writeDiagram(readDiagram(written)!.document)).steps[0].annotations).toEqual([older]);
    });
  });

  describe('a close-up (15f)', () => {
    const closeUp = (more: Record<string, unknown> = {}) => ({
      id: 'z-1',
      kind: 'close-up',
      from: [0.5, 0.3],
      to: [1.21, 0.3],
      radius: 0.08,
      scale: 2,
      ...more,
    });

    it('round-trips its centres, its area and its scale — exactly, an unsaid scale unsaid', () => {
      const { scale: _unsaid, ...twice } = closeUp({ id: 'z-2' });
      const odd = closeUp({ id: 'z-3', radius: 0.0712345678, scale: 2.345 });
      const read = withAnnotations([closeUp(), twice, odd]);
      expect(read).toEqual([closeUp(), twice, odd]);
      const document = { ...sampleDiagram() };
      document.steps = [{ ...stepsIn(document)[0]!, annotations: read }, stepsIn(document)[1]!];
      expect(stepsIn(throughJson(writeDiagram(document)))[0].annotations).toEqual([closeUp(), twice, odd]);
    });

    it('carries what a newer build might write: an area or a scale past this build’s, a field it has no name for', () => {
      const newer = [
        closeUp({ id: 'n-1', radius: 1.5 }),
        closeUp({ id: 'n-2', radius: 0.001 }),
        closeUp({ id: 'n-3', scale: 8 }),
        closeUp({ id: 'n-4', scale: 1.1 }),
        closeUp({ id: 'n-5', shape: 'square' }),
        closeUp({ id: 'n-6', to: [4.5, 0.3] }),
      ];
      expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    });

    it('drops one with no area, or an area or a scale that is no size', () => {
      const damaged = [
        closeUp({ radius: undefined }),
        closeUp({ id: 'd-2', radius: 0 }),
        closeUp({ id: 'd-3', radius: '0.1' }),
        closeUp({ id: 'd-4', scale: -2 }),
        closeUp({ id: 'd-5', scale: 'twice' }),
        closeUp({ id: 'd-6', to: undefined }),
      ];
      expect(withAnnotations(damaged)).toEqual([]);
    });
  });
});

describe('an enlarge area in the file (Revision 2)', () => {
  const area = (more: Record<string, unknown> = {}) => ({
    id: 'z-1',
    kind: 'zoom',
    from: [0.4, 0.3],
    to: [0.4, 0.3],
    radius: 0.15,
    ...more,
  });
  const rounded = (more: Record<string, unknown> = {}) => {
    const { radius: _circle, ...rest } = area({ id: 'z-2', size: [0.3, 0.2], ...more });
    return rest;
  };
  function withAnnotations(annotations: unknown[]) {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.steps[0].annotations = annotations;
    return stepsIn(readDiagram(written)!.document)[0]!.annotations;
  }
  const writtenBack = (annotations: unknown[]) => {
    const document = { ...sampleDiagram() };
    document.steps = [{ ...stepsIn(document)[0]!, annotations: withAnnotations(annotations) }, stepsIn(document)[1]!];
    return stepsIn(throughJson(writeDiagram(document)))[0].annotations;
  };

  it('round-trips a circle and a rounded rectangle, every field when said and nothing for what is not', () => {
    const full = rounded({ id: 'z-3', angle: 37.5, scale: 2.25, edge: 'cut', anchor: [12.5, -40.125] });
    const all = [area(), rounded(), full, area({ id: 'z-4', edge: 'whole', scale: 6 })];
    expect(withAnnotations(all)).toEqual(all);
    expect(writtenBack(all)).toEqual(all);
    expect(Object.keys(writtenBack([area()])[0]).sort()).toEqual(['from', 'id', 'kind', 'radius', 'to']);
  });

  it('carries what a newer build might write: a size, a radius or a Size past this build’s, an edge or a field it has no name for', () => {
    const newer = [
      rounded({ id: 'n-1', size: [2.5, 0.2] }),
      area({ id: 'n-2', radius: 1.5 }),
      area({ id: 'n-3', scale: 7 }),
      area({ id: 'n-4', edge: 'feathered' }),
      area({ id: 'n-5', glow: true }),
      area({ id: 'n-6', from: [4.5, 0.3] }),
    ];
    expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    expect(writtenBack(newer)).toEqual(newer);
  });

  it('drops one with both a radius and a size, or neither, or a size that is not two sizes', () => {
    const damaged = [
      area({ size: [0.3, 0.3] }),
      area({ id: 'd-2', radius: undefined }),
      rounded({ id: 'd-3', size: [0, 0.2] }),
      rounded({ id: 'd-4', size: [0.3] }),
      area({ id: 'd-5', radius: '0.1' }),
    ];
    expect(withAnnotations(damaged)).toEqual([]);
  });

  it('drops alone a turn, a Size, an edge or an anchor that does not read, and keeps the area', () => {
    const read = withAnnotations([
      rounded({ angle: 'askew', scale: -2, edge: 3, anchor: [1] }),
      area({ id: 'z-5', anchor: ['a', 2] }),
    ]);
    expect(read).toEqual([rounded(), area({ id: 'z-5' })]);
  });

  it('is kept, verbatim and undrawn, by a build that knows none: as any kind it has no name for', () => {
    const older = rounded({ kind: 'spiral-arrow', angle: 12, edge: 'cut', anchor: [1, 2] });
    expect(withAnnotations([older])).toEqual([{ id: 'z-2', unknown: older }]);
    expect(writtenBack([older])).toEqual([older]);
  });
});

describe('an x-ray in the file (Revision 3, 18e)', () => {
  const xray = (more: Record<string, unknown> = {}) => ({
    id: 'x-1',
    kind: 'x-ray',
    from: [0.4, 0.3],
    to: [0.4, 0.3],
    radius: 0.15,
    depth: 2,
    ...more,
  });
  function withAnnotations(annotations: unknown[]) {
    const written = throughJson(writeDiagram(sampleDiagram()));
    written.steps[0].annotations = annotations;
    return stepsIn(readDiagram(written)!.document)[0]!.annotations;
  }
  const writtenBack = (annotations: unknown[]) => {
    const document = { ...sampleDiagram() };
    document.steps = [{ ...stepsIn(document)[0]!, annotations: withAnnotations(annotations) }, stepsIn(document)[1]!];
    return stepsIn(throughJson(writeDiagram(document)))[0].annotations;
  };

  it('round-trips its window, its depth — always written, with no upper bound — and a picked anchor on the paper', () => {
    const all = [xray(), xray({ id: 'x-2', depth: 1, anchor: [12.5, -40.125] }), xray({ id: 'x-3', depth: 40, radius: 1 })];
    expect(withAnnotations(all)).toEqual(all);
    expect(writtenBack(all)).toEqual(all);
    expect(Object.keys(writtenBack([xray()])[0]).sort()).toEqual(['depth', 'from', 'id', 'kind', 'radius', 'to']);
  });

  it('reads its `to` as its centre, whatever is written there', () => {
    expect(withAnnotations([xray({ to: [0.9, 0.1] })])).toEqual([xray()]);
  });

  it('drops one with no depth, a depth under one or not whole, or a window with no radius', () => {
    const { depth: _unsaid, ...undeep } = xray();
    const damaged = [
      undeep,
      xray({ id: 'd-2', depth: 0 }),
      xray({ id: 'd-3', depth: 1.5 }),
      xray({ id: 'd-4', depth: '2' }),
      xray({ id: 'd-5', radius: undefined }),
      xray({ id: 'd-6', radius: 0 }),
    ];
    expect(withAnnotations(damaged)).toEqual([]);
  });

  it('drops alone an anchor that does not read, and keeps the x-ray counted at its centre', () => {
    expect(withAnnotations([xray({ anchor: [1] }), xray({ id: 'x-4', anchor: ['a', 2] })])).toEqual([xray(), xray({ id: 'x-4' })]);
  });

  it('carries what a newer build might write: a window past this build’s range, a shape, a field it has no name for', () => {
    const newer = [
      xray({ id: 'n-1', radius: 1.5 }),
      xray({ id: 'n-2', size: [0.3, 0.2] }),
      xray({ id: 'n-3', creases: true }),
      xray({ id: 'n-4', from: [4.5, 0.3] }),
    ];
    expect(withAnnotations(newer)).toEqual(newer.map((entry) => ({ id: entry.id, unknown: entry })));
    expect(writtenBack(newer)).toEqual(newer);
  });

  it('is kept, verbatim and undrawn, by a build that knows none: as any kind it has no name for', () => {
    const older = xray({ kind: 'spiral-arrow', anchor: [1, 2] });
    expect(withAnnotations([older])).toEqual([{ id: 'x-1', unknown: older }]);
    expect(writtenBack([older])).toEqual([older]);
  });
});

describe('an enlarged step in the file (Revision 2)', () => {
  const zoom = (more: Record<string, unknown> = {}) => ({
    from: 'annotation-9',
    shape: 'circle',
    frame: { centre: [0.5, 0.4], radius: 0.2 },
    imprint: { centre: [12.5, -8.25], radius: 30.5, on: [40.25, 60.5] },
    ...more,
  });
  function withZoom(value: unknown, step = 1) {
    const written = throughJson(writeDiagram(linkedDiagram()));
    // Its marks drawn on its picture, as an enlarged step's are, in its window.
    written.steps[step].annotatedPictureKey = written.steps[step].picture.key;
    written.steps[step].zoom = value;
    const read = readDiagram(written)!;
    return { written, read, step: stepsIn(read.document)[step]! };
  }

  it('round-trips its provenance, shape, frame, imprint, Size and Edge, every optional field only when said', () => {
    for (const value of [
      zoom(),
      zoom({ shape: 'rounded', frame: { centre: [0.5, 0.4], size: [0.4, 0.2], angle: 30 }, imprint: undefined, scale: 1.5, edge: 'cut' }),
      zoom({ imprint: { centre: [1, 2], radius: 3, on: [4, 5], picked: true } }),
      zoom({ frame: undefined }),
    ]) {
      const { written, read, step } = withZoom(JSON.parse(JSON.stringify(value)));
      expect(step.unknown).toBeUndefined();
      expect(step.zoom).toEqual(JSON.parse(JSON.stringify(value)));
      expect(JSON.stringify(throughJson(writeDiagram(read.document)))).toBe(JSON.stringify(written));
    }
  });

  it('writes none for a step that is not enlarged', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    expect(written.steps.every((step: Record<string, unknown>) => !('zoom' in step))).toBe(true);
  });

  it.each([
    ['a field it has no name for', zoom({ depth: 2 })],
    ['a shape it has no name for', zoom({ shape: 'hexagon' })],
    ['an edge it has no name for', zoom({ edge: 'feathered' })],
    ['a Size past its range', zoom({ scale: 8 })],
    ['a field of its frame it has no name for', zoom({ frame: { centre: [0.5, 0.4], radius: 0.2, blur: 1 } })],
    ['a frame past reach', zoom({ frame: { centre: [5, 0.4], radius: 0.2 } })],
    ['a field of its imprint it has no name for', zoom({ imprint: { centre: [1, 2], radius: 3, on: [4, 5], face: 3 } })],
  ])('locks a step whose zoom has %s, and writes it back byte for byte', (_label, value) => {
    const { written, read, step } = withZoom(value);
    expect(step.unknown).toBeDefined();
    expect(JSON.stringify(writeDiagram(read.document))).toBe(JSON.stringify(written));
  });

  it.each([
    ['no provenance', zoom({ from: '' })],
    ['no shape', zoom({ shape: 7 })],
    ['a frame of both a radius and a size', zoom({ frame: { centre: [0.5, 0.4], radius: 0.2, size: [1, 1] } })],
    ['a frame of neither', zoom({ frame: { centre: [0.5, 0.4] } })],
    ['a frame not of its shape', zoom({ shape: 'rounded' })],
    ['an imprint with no paper point', zoom({ imprint: { centre: [1, 2], radius: 3 } })],
    ['a picked flag that is not true', zoom({ imprint: { centre: [1, 2], radius: 3, on: [4, 5], picked: 'yes' } })],
    ['a Size that is no size', zoom({ scale: 'twice' })],
    ['a zoom that is no record', 'enlarged'],
  ])('drops a zoom with %s, and leaves the marks drawn in its window out of step', (_label, value) => {
    const { step } = withZoom(value);
    expect(step.unknown).toBeUndefined();
    expect(step.zoom).toBeUndefined();
    expect(step.annotatedPictureKey).toBeNull();
    // Read with a zoom that reads, the same marks are in step.
    expect(withZoom(zoom()).step.annotatedPictureKey).not.toBeNull();
    expect(step.picture).not.toBeNull();
  });

  describe('the area it was captured from, as it was (review fix 4)', () => {
    const AREA_WAS = { stepId: 'step-area', outline: { centre: [0.25, 0.75], radius: 0.1 } };

    it('round-trips the area’s step, its outline — a circle’s or a turned rectangle’s — a picked anchor, Size and Edge, each only when said', () => {
      for (const areaWas of [
        AREA_WAS,
        { stepId: 'step-area', outline: { centre: [0.5, 0.5], size: [0.3, 0.2], angle: 15 }, anchor: [40.25, 60.5] },
        // The Size and Edge the capture copied (review of review fix 4).
        { ...AREA_WAS, scale: 2.5, edge: 'whole' },
      ]) {
        const value = zoom({ areaWas });
        const { written, read, step } = withZoom(JSON.parse(JSON.stringify(value)));
        expect(step.unknown).toBeUndefined();
        expect(step.zoom!.areaWas).toEqual(areaWas);
        expect(JSON.stringify(throughJson(writeDiagram(read.document)))).toBe(JSON.stringify(written));
      }
    });

    it('is unsaid in a file from before it, and written so: the step is not known to be out of date until its area is edited', () => {
      const { written, step } = withZoom(zoom());
      expect(step.zoom!.areaWas).toBeUndefined();
      expect(JSON.stringify(throughJson(writeDiagram(readDiagram(written)!.document)))).not.toContain('areaWas');
    });

    it.each([
      ['no step', { ...AREA_WAS, stepId: '' }],
      ['an outline that does not read', { ...AREA_WAS, outline: { centre: [0.5, 0.5] } }],
      ['an anchor that is no point', { ...AREA_WAS, anchor: ['a', 2] }],
      ['a Size that is no number', { ...AREA_WAS, scale: 'big' }],
      ['an Edge that is no word', { ...AREA_WAS, edge: 3 }],
      ['a record that is no record', 'moved'],
    ])('drops a record with %s alone, keeping the frame: the step is not known to be out of date', (_label, areaWas) => {
      const { step } = withZoom(zoom({ areaWas }));
      expect(step.unknown).toBeUndefined();
      expect(step.zoom).toEqual(zoom());
      expect(step.annotatedPictureKey).not.toBeNull();
    });

    it.each([
      ['a field it has no name for', { ...AREA_WAS, size: 2 }],
      ['an outline past reach', { ...AREA_WAS, outline: { centre: [5, 0.5], radius: 0.1 } }],
      ['a Size past reach', { ...AREA_WAS, scale: 40 }],
      ['an Edge it has no name for', { ...AREA_WAS, edge: 'dashed' }],
    ])('locks a step whose record has %s, as its zoom’s own fields do, and writes it back byte for byte', (_label, areaWas) => {
      const { written, read, step } = withZoom(zoom({ areaWas }));
      expect(step.unknown).toBeDefined();
      expect(JSON.stringify(writeDiagram(read.document))).toBe(JSON.stringify(written));
    });
  });

  it('is kept, locked and verbatim, by a build that reads no zoom: as any step field it has no name for', () => {
    // A build before enlarged steps knows no `zoom` key (`STEP_KEYS`): `hologram` stands for it here.
    const { written, read, step } = withZoom(undefined);
    written.steps[1].hologram = zoom();
    const older = readDiagram(written)!;
    expect(stepsIn(older.document)[1]!.unknown).toEqual(written.steps[1]);
    expect(JSON.stringify(writeDiagram(older.document))).toBe(JSON.stringify(written));
    expect(step.zoom).toBeUndefined();
    expect(read.readOnly).toBe(false);
  });
});

describe('a step placed by hand in the file (page overrides)', () => {
  const PLACED = { frame: [3.5, -2], number: [1, 0], picture: [0, 4.2], text: [-1.5, 2], scale: { mmPerUnit: 0.25 } };
  function withPlace(value: unknown, step = 1) {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[step].place = value;
    const read = readDiagram(written)!;
    return { written, read, step: stepsIn(read.document)[step]! };
  }

  it('round-trips every field, each only when said, byte for byte', () => {
    for (const value of [PLACED, { scale: { frameMm: 52.5 } }, { text: [0, 3] }, { frame: [-4, 0], picture: [1, 1] }]) {
      const { written, read, step } = withPlace(value);
      expect(read.readOnly).toBe(false);
      expect(step.unknown).toBeUndefined();
      expect(step.placeNewer).toBeUndefined();
      expect(step.place).toEqual(value);
      expect(JSON.stringify(throughJson(writeDiagram(read.document)))).toBe(JSON.stringify(written));
    }
  });

  it('writes none for a step placed by no one, or whose placement comes to nothing', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    expect(written.steps.every((step: Record<string, unknown>) => !('place' in step))).toBe(true);
    const document = linkedDiagram();
    const steps = document.steps.map((entry, index) => (index === 1 ? { ...entry, place: { frame: [0, 0], text: [0.01, -0.04] } } : entry));
    expect('place' in throughJson(writeDiagram({ ...document, steps } as typeof document)).steps[1]).toBe(false);
  });

  it('keeps an offset to a tenth of a mm, and one under 0.05 mm both ways as none', () => {
    const { step } = withPlace({ frame: [1.234, -0.26], number: [0.04, -0.049], text: [0.06, 0] });
    expect(step.place).toEqual({ frame: [1.2, -0.3], text: [0.1, 0] });
    const document = linkedDiagram();
    const steps = document.steps.map((entry, index) => (index === 1 ? { ...entry, place: { picture: [2.449, 0.0000001] } } : entry));
    expect(throughJson(writeDiagram({ ...document, steps } as typeof document)).steps[1].place).toEqual({ picture: [2.4, 0] });
  });

  it.each([
    ['an offset that is not two numbers', { ...PLACED, frame: [1, 2, 3] }, 'frame'],
    ['an offset that is not finite', { ...PLACED, text: [Number.MAX_VALUE * 10, 1] }, 'text'],
    ['a pin of no size', { ...PLACED, scale: { mmPerUnit: 0 } }, 'scale'],
    ['a pin of both measures', { ...PLACED, scale: { mmPerUnit: 1, frameMm: 40 } }, 'scale'],
    ['a pin that is no record', { ...PLACED, scale: 40 }, 'scale'],
  ] as const)('drops %s alone, and keeps the rest of the placement', (_label, value, dropped) => {
    const { step } = withPlace(value);
    const { [dropped]: _gone, ...rest } = PLACED;
    expect(step.place).toEqual(rest);
    expect(step.placeNewer).toBeUndefined();
    expect(step.picture).not.toBeNull();
  });

  it('reads a placement that is no record, or one left with nothing, as none', () => {
    for (const value of ['moved', [1, 2], null, {}, { frame: 'left' }]) {
      const { step } = withPlace(value);
      expect(step.place).toBeUndefined();
      expect(step.placeNewer).toBeUndefined();
      expect(step.unknown).toBeUndefined();
    }
  });

  it.each([
    ['a field it has no name for', { ...PLACED, rotate: 15 }],
    ['a field of its pin it has no name for', { ...PLACED, scale: { printedMm: 40 } }],
  ])('carries a placement with %s whole, written back byte for byte and never applied, the step still editable', (_label, value) => {
    const { written, read, step } = withPlace(value);
    expect(step.unknown).toBeUndefined();
    expect(step.place).toBeUndefined();
    expect(step.placeNewer).toEqual(value);
    expect(read.readOnly).toBe(false);
    expect(JSON.stringify(writeDiagram(read.document))).toBe(JSON.stringify(written));
    // Never applied: the layout is not given it.
    expect(diagramLayoutSteps(read.document).every((each) => each.place === undefined)).toBe(true);
    // Placed by this build, it is.
    expect(diagramLayoutSteps(withPlace(PLACED).read.document)[1]!.place).toEqual(PLACED);
  });

  it('leaves a newer build’s step as it came, placement and all: never read, never applied', () => {
    const { written } = withPlace(PLACED);
    written.steps[1].hologram = 3;
    const read = readDiagram(written)!;
    const step = stepsIn(read.document)[1]!;
    expect(step.unknown).toEqual(written.steps[1]);
    expect(step.place).toBeUndefined();
    expect(diagramLayoutSteps(read.document)[1]!.place).toBeUndefined();
    expect(JSON.stringify(writeDiagram(read.document))).toBe(JSON.stringify(written));
  });

  it('is kept, locked and verbatim, by a build that reads no placement: as any step field it has no name for', () => {
    // A build before placement knows no `place` key (`STEP_KEYS`): `hologram` stands for it here, as for `zoom`.
    const { written } = withPlace(undefined);
    written.steps[1].hologram = PLACED;
    const older = readDiagram(written)!;
    expect(stepsIn(older.document)[1]!.unknown).toEqual(written.steps[1]);
    expect(JSON.stringify(writeDiagram(older.document))).toBe(JSON.stringify(written));
  });
});

describe('a flat capture’s faces in the file (Revision 2)', () => {
  /** A flat step whose scene draws faces 0 and 1, and its faces as a capture keeps them. */
  function flatFaces(spread: boolean, faces: Record<string, unknown> = {}) {
    const scene = {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      sheet: 10,
      items: [
        { kind: 'face', face: 0, side: 'front', rings: [[[0, 0], [10, 0], [10, 10], [0, 10]]], shade: 1, hidden: false },
        ...(spread
          ? [{ kind: 'face', face: 1, side: 'back', rings: [[[1, 1], [11, 1], [11, 11], [1, 11]]], shade: 1, hidden: false }]
          : []),
      ],
    };
    const paperFaces = JSON.stringify({
      points: [
        [0, 0, 0, 0],
        [5, 0, 10, 0],
        [5, 5, 10, 10],
        [0, 5, 0, 10],
        [5, 10, 0, 0],
        [0, 10, 10, 0],
      ],
      rings: [
        [0, 1, 2, 3],
        [4, 5, 2, 3],
      ],
      levels: [0, 1],
      ...faces,
    });
    const render: DiagramCpRender = {
      mode: 'folded-flat',
      side: 'front',
      rotationDeg: 0,
      foldCase: 1,
      ...(spread ? { spread: { kind: 'depth', amount: 0.05, toward: 'down' } } : {}),
    };
    const picture = { ...scenePicture('scene-faces'), sceneJson: storedSceneJson(scene)!, paperFaces };
    const diagram = insertSteps(createDiagram({ title: 'Faces' }), [cpStep('step-faces', render, picture)], 0);
    return throughJson(writeDiagram(diagram));
  }
  const readFaces = (written: Record<string, unknown>) => {
    const read = readDiagram(written)!;
    return { read, step: stepsIn(read.document)[0]! };
  };

  it('round-trips them, as one string, byte for byte', () => {
    for (const spread of [false, true]) {
      const written = flatFaces(spread);
      expect(typeof written.steps[0].picture.paperFaces).toBe('string');
      const { read, step } = readFaces(written);
      expect(step.unknown).toBeUndefined();
      expect(step.picture).toMatchObject({ paperFaces: written.steps[0].picture.paperFaces });
      expect(JSON.stringify(throughJson(writeDiagram(read.document)))).toBe(JSON.stringify(written));
    }
  });

  it('locks a step whose faces have a field it has no name for, and writes it back byte for byte', () => {
    const written = flatFaces(true, { held: 3 });
    const { read, step } = readFaces(written);
    expect(step.unknown).toEqual(written.steps[0]);
    expect(JSON.stringify(writeDiagram(read.document))).toBe(JSON.stringify(written));
  });

  it.each([
    ['not JSON', (picture: Record<string, unknown>) => (picture.paperFaces = '{points')],
    ['not a string', (picture: Record<string, unknown>) => (picture.paperFaces = { points: [] })],
    ['counts that disagree', (picture: Record<string, unknown>) => (picture.paperFaces = flatFaces(false, { levels: [0] }).steps[0].picture.paperFaces)],
    ['an index past the points', (picture: Record<string, unknown>) => (picture.paperFaces = flatFaces(false, { rings: [[0, 1, 2, 3], [4, 5, 9]] }).steps[0].picture.paperFaces)],
    ['a ring of two', (picture: Record<string, unknown>) => (picture.paperFaces = flatFaces(false, { rings: [[0, 1], [4, 5, 2, 3]] }).steps[0].picture.paperFaces)],
    ['a point of three numbers', (picture: Record<string, unknown>) => (picture.paperFaces = flatFaces(false, { points: [[0, 0, 0]] }).steps[0].picture.paperFaces)],
    ['a level that is no count', (picture: Record<string, unknown>) => (picture.paperFaces = flatFaces(false, { levels: [0, -1] }).steps[0].picture.paperFaces)],
    ['a face the scene draws that it does not list', (picture: Record<string, unknown>) => (picture.paperFaces = flatFaces(true, { rings: [[0, 1, 2, 3]], levels: [0] }).steps[0].picture.paperFaces)],
  ])('drops faces that are %s, and keeps the step and its picture', (_label, damage) => {
    const written = flatFaces(true);
    damage(written.steps[0].picture);
    const { step } = readFaces(written);
    expect(step.unknown).toBeUndefined();
    expect(step.picture?.kind).toBe('scene');
    expect(step.picture && 'paperFaces' in step.picture).toBe(false);
  });

  it('drops them on a spread step whose scene does not draw a face whole, corner for corner, as they list it', () => {
    const written = flatFaces(true, {
      rings: [
        [0, 1, 2, 3],
        [4, 5, 2],
      ],
    });
    const { step } = readFaces(written);
    expect(step.picture && 'paperFaces' in step.picture).toBe(false);
    // With no spread the drawn places are the unspread ones: a buried face need not be drawn.
    const plain = readFaces(flatFaces(false, { rings: [[0, 1, 2, 3], [4, 5, 2]] })).step;
    expect(plain.picture && 'paperFaces' in plain.picture).toBe(true);
  });

  it('checks them against the scene as the load read it, with no second parse of the scene', () => {
    const written = flatFaces(true);
    const sceneJson = written.steps[0].picture.sceneJson as string;
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const { step } = readFaces(written);
      expect(step.picture && 'paperFaces' in step.picture).toBe(true);
      expect(parse.mock.calls.filter(([text]) => text === sceneJson)).toHaveLength(1);
    } finally {
      parse.mockRestore();
    }
  });

  it('keeps them only on a flat fold’s scene', () => {
    const written = flatFaces(false);
    written.steps[0].source.render = { mode: 'crease-pattern', rotationDeg: 0 };
    const { step } = readFaces(written);
    expect(step.picture && 'paperFaces' in step.picture).toBe(false);
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
    ['bytes that are not the format named', { src: 'data:image/png;base64,AAAA' }],
    ['a link rather than data', { src: 'https://example.com/a.png' }],
  ])('drops a bitmap with %s', (_label, patch) => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    Object.assign(written.assets['asset-b'], patch);
    const read = readDiagram(written)!.document;
    expect(read.assets['asset-b']).toBeUndefined();
    expect(stepsIn(read)[1].picture).toBeNull();
  });

  it.each([
    ['in a format other than PNG or JPEG', { src: pngDataUrl(64, 48).replace('image/png', 'image/gif') }],
    ['with more than 2048 px a side', { src: pngDataUrl(4096, 48), widthPx: 4096 }],
    ['with a field it has no name for', { colourSpace: 'p3' }],
  ])('carries a bitmap %s as a newer build’s, and locks the step that shows it', (_label, patch) => {
    const { document } = uploadDiagram();
    const written = throughJson(writeDiagram(document));
    Object.assign(written.assets['asset-b'], patch);
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(read.document.assets['asset-b']).toEqual({ id: 'asset-b', unknown: written.assets['asset-b'] });
    expect(stepsIn(read.document)[1].unknown).toEqual(written.steps[1]);
    expect(stepsIn(read.document)[0].unknown).toBeUndefined();
    const again = throughJson(writeDiagram(read.document));
    expect(again.assets['asset-b']).toEqual(written.assets['asset-b']);
    expect(again.steps).toEqual(written.steps);
  });

  it('carries an SVG longer than it keeps, or with a field it has no name for, as a newer build’s', () => {
    for (const patch of [{ svg: `<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(SVG_STORED_MAX_BYTES)}</svg>` }, { layers: 2 }]) {
      const { document } = uploadDiagram();
      const written = throughJson(writeDiagram(document));
      Object.assign(written.assets['asset-a'], patch);
      const read = readDiagram(written)!.document;
      expect(read.assets['asset-a']).toEqual({ id: 'asset-a', unknown: written.assets['asset-a'] });
      expect(stepsIn(read)[0].unknown).toEqual(written.steps[0]);
    }
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
    written.steps[0].source.rotationQuarterTurns = 'half';
    written.steps[0].source.mirrored = 'yes';
    expect(stepsIn(readDiagram(written)!.document)[0].source).toMatchObject({
      rotationQuarterTurns: 0,
      mirrored: false,
    });
  });

  it('carries, locked, an upload turned past the four quarter turns it draws, or with a source field it has no name for', () => {
    for (const patch of [{ rotationQuarterTurns: 5 }, { rotationQuarterTurns: 0.5 }, { cropped: [0, 0, 1, 1] }]) {
      const { document } = uploadDiagram();
      const written = throughJson(writeDiagram(document));
      Object.assign(written.steps[0].source, patch);
      const read = readDiagram(written)!.document;
      expect(stepsIn(read)[0].unknown).toEqual(written.steps[0]);
      expect(stepsIn(throughJson(writeDiagram(read)))[0]).toEqual(written.steps[0]);
    }
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

/**
 * A written link with its thumbnail inline, as files before the table held
 * it (decision 4), so a patch to it changes that link alone and not every
 * step that shares the sheet's entry.
 */
function withOwnThumbnail(written: WrittenSource, source: WrittenSource): WrittenSource {
  source.thumbnail = JSON.parse(written.thumbnails[source.thumbnail]);
  return source;
}

/** Change a written References card's model, which the file holds as one string. */
function patchModel(picture: WrittenSource, patch: (model: WrittenSource) => unknown): void {
  const model = JSON.parse(picture.model);
  patch(model);
  picture.model = JSON.stringify(model);
}

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
    // A crease pattern seen from the paper's back.
    cpStep('step-cp-back', { mode: 'crease-pattern', rotationDeg: 330, side: 'back' }),
  ];
  const diagram = createDiagram({ title: 'Crane', newId: ids });
  return insertSteps(diagram, steps, 0);
}

// Decision 4 of the launch review: what fifty steps on one sheet cost.
describe('thumbnails and References cards in the file', () => {
  /** A written diagram in the layout before the table: each link's thumbnail inline, each card's model a record. */
  function beforeTheTable(written: WrittenSource): WrittenSource {
    const old = throughJson(written);
    for (const step of old.steps) {
      if (typeof step.source?.thumbnail === 'string') step.source.thumbnail = JSON.parse(old.thumbnails[step.source.thumbnail]);
      if (typeof step.picture?.model === 'string') step.picture.model = JSON.parse(step.picture.model);
    }
    delete old.thumbnails;
    return old;
  }

  it('stores a sheet’s thumbnail once, however many links show it, under a key from what it draws', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    const keys = Object.keys(written.thumbnails);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^thumb-[0-9a-z]+$/);
    expect(typeof written.thumbnails[keys[0]!]).toBe('string');
    const links = stepsIn(written).filter((step: WrittenSource) => step.source?.kind === 'cp');
    expect(links.length).toBeGreaterThan(5);
    expect(links.every((step: WrittenSource) => step.source.thumbnail === keys[0])).toBe(true);
    // A References step's sheet is a thumbnail like any other.
    const sent = throughJson(writeDiagram(sentDiagram()));
    expect(stepsIn(sent).every((step: WrittenSource) => typeof step.source.thumbnail === 'string')).toBe(true);
  });

  it('reads the links that name one entry as sharing its thumbnail, as the file does', () => {
    const read = readDiagram(throughJson(writeDiagram(linkedDiagram())))!.document;
    const thumbnails = stepsIn(read).flatMap((step) => (step.source?.kind === 'cp' ? [step.source.thumbnail] : []));
    expect(thumbnails.length).toBeGreaterThan(5);
    expect(new Set(thumbnails).size).toBe(1);
  });

  it('writes a References card’s model as one string', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    const pictures = stepsIn(written).map((step: WrittenSource) => step.picture).filter(Boolean);
    expect(pictures.length).toBeGreaterThan(0);
    expect(pictures.every((picture: WrittenSource) => typeof picture.model === 'string')).toBe(true);
  });

  it('reads a file from before the table as it was, and writes the table', () => {
    for (const document of [linkedDiagram(), sentDiagram()]) {
      const written = throughJson(writeDiagram(document));
      const old = beforeTheTable(written);
      expect(old.thumbnails).toBeUndefined();
      const read = readDiagram(old)!;
      expect(stepsIn(read.document).every((step) => step.unknown === undefined)).toBe(true);
      expect(read.document).toEqual(readDiagram(written)!.document);
      expect(throughJson(writeDiagram(read.document))).toEqual(written);
    }
  });

  it('gives two thumbnails that differ two entries, and leaves out one no link shows', () => {
    const document = linkedDiagram();
    const steps = stepsIn(document);
    const other = steps[1]!.source as DiagramCpSource;
    const changed = {
      ...other,
      thumbnail: { ...other.thumbnail, strokes: [...other.thumbnail.strokes, { x1: 0, y1: 0, x2: 1, y2: 1, role: 'valley' as const }] },
    };
    const two = { ...document, steps: document.steps.map((entry) => (entry.id === steps[1]!.id ? { ...entry, source: changed } : entry)) };
    expect(Object.keys(throughJson(writeDiagram(two)).thumbnails)).toHaveLength(2);
    const none = { ...document, steps: document.steps.filter((entry) => stepsIn({ steps: [entry] })[0]?.source?.kind !== 'cp') };
    expect(throughJson(writeDiagram(none)).thumbnails).toBeUndefined();
  });

  it('drops a link whose thumbnail the table does not hold, or holds as no thumbnail, and keeps the words', () => {
    for (const damage of [
      (written: WrittenSource) => (written.steps[1].source.thumbnail = 'thumb-nowhere'),
      (written: WrittenSource) => (written.thumbnails[written.steps[1].source.thumbnail] = '{not json'),
    ]) {
      const written = throughJson(writeDiagram(linkedDiagram()));
      written.steps[1].text = 'Fold it.';
      damage(written);
      const step = stepsIn(readDiagram(written)!.document)[1];
      expect(step).toMatchObject({ source: null, picture: null, text: 'Fold it.' });
      expect(step.unknown).toBeUndefined();
    }
  });

  it('keeps the entry a newer build’s step names, while that step is in the diagram', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    // A newer build's step, its thumbnail of its own in the table.
    written.thumbnails['thumb-newer'] = JSON.stringify({ viewBox: '0 0 100 100', strokes: [], depth: 2 });
    written.steps[1] = { ...written.steps[1], source: { ...written.steps[1].source, thumbnail: 'thumb-newer' }, layers: [1] };
    const read = readDiagram(written)!;
    expect(stepsIn(read.document)[1].unknown).toEqual(written.steps[1]);
    expect(throughJson(writeDiagram(read.document))).toEqual(written);
    // Deleted, the step takes its entry with it.
    const without = { ...read.document, steps: read.document.steps.filter((entry) => entry.id !== written.steps[1].id) };
    expect(throughJson(writeDiagram(without)).thumbnails['thumb-newer']).toBeUndefined();
  });

  it('reads a card’s model that is a string but no JSON as no card, and keeps the link', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[0].picture.model = '{nope';
    const step = stepsIn(readDiagram(written)!.document)[0];
    expect(step).toMatchObject({ source: { kind: 'references-step' }, picture: null });
  });
});

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
  // fits before then would be saved longer than the cap: so the cap is held
  // to what is kept, and a picture past it — which this build never saves —
  // is a newer build's, carried with its step rather than dropped.
  it('carries, locked, a fixed picture that sanitizing makes too long to keep', () => {
    // A long key prefixes every id with itself: a few thousand ids are enough.
    const key = `fixed-${'k'.repeat(500)}`;
    const rects = Array.from({ length: 5_000 }, (_, index) => `<rect id="r${index}"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${rects}</svg>`;
    expect(svg.length).toBeLessThan(SVG_STORED_MAX_BYTES);
    expect(svg.length + 5_000 * key.length).toBeGreaterThan(SVG_STORED_MAX_BYTES);
    const written = throughJson(writeDiagram(linkedDiagram()));
    Object.assign(written.steps[3].picture, { svg, key });
    const step = stepsIn(readDiagram(written)!.document)[3];
    expect(step.unknown).toEqual(written.steps[3]);
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

  // Decision 1 of the launch review: what a newer build adds is carried and
  // locked, never dropped on save — at any depth of a link.
  it.each([
    ['a field of the source', 1, (source: WrittenSource) => (source.followsSheet = true)],
    ['a scope of a kind it has no name for', 1, (source: WrittenSource) => (source.scope = { kind: 'faces', faces: [1] })],
    ['a field of the scope', 1, (source: WrittenSource) => (source.scope.depth = 2)],
    ['a field of the region', 1, (source: WrittenSource) => (source.scope.region.layer = 2)],
    ['a field of the region’s box', 1, (source: WrittenSource) => (source.scope.region.bounds.z = 0)],
    ['a field of a point of the region’s rim', 1, (source: WrittenSource) => (source.scope.region.boundary[0][0].face = 4)],
    ['a thumbnail line of a role it has no name for', 1, (source: WrittenSource) => (source.thumbnail.strokes[0].role = 'cut')],
    ['a field of the thumbnail', 1, (source: WrittenSource) => (source.thumbnail.background = '#fff')],
    ['a field of a thumbnail line', 1, (source: WrittenSource) => (source.thumbnail.strokes[0].dashed = true)],
    ['more thumbnail lines than it keeps', 1, (source: WrittenSource) => {
      source.thumbnail.strokes = Array.from({ length: MAX_STORED_STROKES + 1 }, () => source.thumbnail.strokes[0]);
    }],
    ['a field of the render', 1, (source: WrittenSource) => (source.render.lighting = 'warm')],
    ['a side of a flat fold it has no name for', 1, (source: WrittenSource) => (source.render.side = 'both')],
    ['a field of a 3D camera', 2, (source: WrittenSource) => (source.render.camera.fov = 30)],
    ['a side of a 3D fold it has no name for', 2, (source: WrittenSource) => (source.render.side = 'edge')],
    ['a field of the simulated camera', 5, (source: WrittenSource) => (source.render.view.roll = 0.2)],
    ['a fold past the whole of one', 5, (source: WrittenSource) => (source.render.foldPercent = 120)],
    ['a remembered render with a field it has no name for', 1, (source: WrittenSource) => {
      source.remembered['crease-pattern'].mirror = true;
    }],
  ])('carries, locked and as it came, a link with %s', (_label, index, patch) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    patch(withOwnThumbnail(written, written.steps[index].source));
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    const steps = stepsIn(read.document);
    expect(steps[index].unknown).toEqual(written.steps[index]);
    expect(steps.filter((step) => step.unknown !== undefined)).toHaveLength(1);
    expect(throughJson(writeDiagram(read.document))).toEqual(written);
  });

  it.each([
    ['a field of the picture', 3, (picture: WrittenSource) => (picture.opacity = 0.5)],
    ['a scene longer than it keeps', 0, (picture: WrittenSource) => (picture.sceneJson = ' '.repeat(SCENE_JSON_MAX_BYTES + 1))],
    ['a scene item of a kind it has no name for', 0, (picture: WrittenSource) => {
      const scene = JSON.parse(picture.sceneJson);
      scene.items.push({ kind: 'gradient', stops: [] });
      picture.sceneJson = JSON.stringify(scene);
    }],
    ['a scene line of a role it has no name for', 0, (picture: WrittenSource) => {
      const scene = JSON.parse(picture.sceneJson);
      scene.items.find((item: { kind: string }) => item.kind === 'line').role = 'pleat';
      picture.sceneJson = JSON.stringify(scene);
    }],
    ['a field of a scene item', 0, (picture: WrittenSource) => {
      const scene = JSON.parse(picture.sceneJson);
      scene.items[0].opacity = 0.5;
      picture.sceneJson = JSON.stringify(scene);
    }],
    ['a field of the scene', 0, (picture: WrittenSource) => {
      const scene = JSON.parse(picture.sceneJson);
      scene.lights = [];
      picture.sceneJson = JSON.stringify(scene);
    }],
    ['an SVG longer than it keeps', 3, (picture: WrittenSource) => (picture.svg = `<svg>${' '.repeat(SVG_STORED_MAX_BYTES)}</svg>`)],
    ['a picture of a kind it has no name for', 0, (picture: WrittenSource) => (picture.kind = 'hologram')],
  ])('carries, locked and as it came, a picture with %s', (_label, index, patch) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    patch(written.steps[index].picture);
    const read = readDiagram(written)!;
    expect(stepsIn(read.document)[index].unknown).toEqual(written.steps[index]);
    expect(throughJson(writeDiagram(read.document))).toEqual(written);
  });

  describe('a simulated step’s shape, as a build with Pose’s tools stores it (decision 5)', () => {
    const shape = { id: 'shape-1', sheet: 'sheet-abc', pins: [[0.25, 0.5]], posed: true, state: 'v1:AAAA' };

    it('is carried as it came, and the step stays editable', () => {
      const written = throughJson(writeDiagram(linkedDiagram()));
      written.steps[6].source.render.shape = shape;
      const read = readDiagram(written)!;
      const step = stepsIn(read.document)[6];
      expect(step.unknown).toBeUndefined();
      expect(step.source).toMatchObject({ render: { mode: 'simulated', foldPercent: 40.5, shape } });
      expect(throughJson(writeDiagram(read.document))).toEqual(written);
    });

    it('is dropped alone when it is no record, and the link stays', () => {
      const written = throughJson(writeDiagram(linkedDiagram()));
      written.steps[6].source.render.shape = 'a shape';
      const step = stepsIn(readDiagram(written)!.document)[6];
      expect(step.unknown).toBeUndefined();
      expect(step.source).toMatchObject({ render: { mode: 'simulated', foldPercent: 40.5 } });
      expect((step.source as DiagramCpSource).render).not.toHaveProperty('shape');
    });
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

  it('writes a crease pattern’s side only for its back, and reads one with none as the front', () => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    // Files from before there was a back read as the front, as this build writes it.
    expect(written.steps[0].source.render).toEqual({ mode: 'crease-pattern', rotationDeg: 45 });
    expect(written.steps[10].source.render).toEqual({ mode: 'crease-pattern', rotationDeg: 330, side: 'back' });
    const steps = stepsIn(readDiagram(written)!.document);
    expect((steps[10].source as DiagramCpSource).render).toEqual({ mode: 'crease-pattern', rotationDeg: 330, side: 'back' });
    // A front said out loud — never written, but a hand may — is the front, written back as none.
    written.steps[0].source.render.side = 'front';
    const front = stepsIn(readDiagram(written)!.document)[0];
    expect(front.unknown).toBeUndefined();
    expect((front.source as DiagramCpSource).render).toEqual({ mode: 'crease-pattern', rotationDeg: 45 });
  });

  it.each([
    ['a side that is not a word', 3],
    ['a side of null', null],
    ['a side that is true', true],
  ])('drops a crease pattern with %s, and the picture with it; the words stay', (_label, side) => {
    const written = throughJson(writeDiagram(linkedDiagram()));
    written.steps[10].text = 'Turn it over.';
    written.steps[10].source.render.side = side;
    const step = stepsIn(readDiagram(written)!.document)[10];
    expect(step).toMatchObject({ source: null, picture: null, text: 'Turn it over.' });
    expect(step.unknown).toBeUndefined();
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
    // A crease pattern seen from a side this build has no name for.
    ['a crease pattern seen from a side it does not know', (source: WrittenSource) => {
      source.render = { mode: 'crease-pattern', rotationDeg: 0, side: 'both' };
      delete source.remembered['crease-pattern'];
    }],
    ['a remembered crease pattern seen from a side it does not know', (source: WrittenSource) => {
      source.remembered['crease-pattern'].side = 'edge-on';
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
    referencesStep('step-shown', { plan: '{"planner":"p"}', marks: { letters: false, highlights: true } }),
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

  it('keeps the marks a step pulled (17d), and drops a choice that does not read alone', () => {
    const read = stepsIn(readDiagram(throughJson(writeDiagram(sentDiagram())))!.document);
    expect(read[4]!.source).toMatchObject({ marks: { letters: false, highlights: true } });
    expect(read[0]!.source).not.toHaveProperty('marks');
    for (const marks of [{ letters: 'no', highlights: true }, { letters: false }, 'none', null]) {
      const written = throughJson(writeDiagram(sentDiagram()));
      written.steps[4].source.marks = marks;
      const step = stepsIn(readDiagram(written)!.document)[4]!;
      expect(step.source).toMatchObject({ kind: 'references-step', plan: '{"planner":"p"}' });
      expect(step.source).not.toHaveProperty('marks');
    }
  });

  it('reads a card’s recorded sentence as a step’s text is read: XML-clean', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    written.steps[3].source.sentence = 'Fold\u0000 P';
    expect(stepsIn(readDiagram(written)!.document)[3]!.source).toMatchObject({ sentence: 'Fold P' });
  });

  it('keeps a card drawn with a primitive this build does not draw, locked and verbatim', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    patchModel(written.steps[0].picture, (model) => model.primitives.push({ kind: 'hinge', at: [0.5, 0.5] }));
    const read = readDiagram(written)!;
    expect(stepsIn(read.document)[0].unknown).toEqual(written.steps[0]);
    expect(stepsIn(throughJson(writeDiagram(read.document)))[0]).toEqual(written.steps[0]);
  });

  it('drops a card whose drawing does not read, and keeps the link and the words', () => {
    const written = throughJson(writeDiagram(sentDiagram()));
    patchModel(written.steps[0].picture, (model) => (model.primitives[1].to = [1, 'a']));
    const step = stepsIn(readDiagram(written)!.document)[0];
    expect(step).toMatchObject({ source: { kind: 'references-step' }, picture: null });
    expect(step.text).toBe('Fold the bottom edge to the top.');
  });

  it.each([
    ['no rim', (source: WrittenSource) => (source.region.boundary = [])],
    ['an empty fingerprint', (source: WrittenSource) => (source.fingerprint = '')],
    ['a mode that is not a word', (source: WrittenSource) => (source.mode = 3)],
    ['a setting that is not a switch', (source: WrittenSource) => (source.settings.precreaseGrid = 'yes')],
    ['a card numbered zero', (source: WrittenSource) => (source.card = 0)],
    ['a line whose normal is not a unit', (source: WrittenSource) => (source.line.n = [3, 4])],
    ['no side', (source: WrittenSource) => delete source.side],
  ])('drops a source with %s, and the picture with it; the words stay', (_label, damage) => {
    const written = throughJson(writeDiagram(sentDiagram()));
    damage(written.steps[0].source);
    const step = stepsIn(readDiagram(written)!.document)[0];
    expect(step).toMatchObject({ source: null, picture: null, text: 'Fold the bottom edge to the top.' });
    expect(step.unknown).toBeUndefined();
  });

  // Decision 1 of the launch review: what a newer build adds is carried and
  // locked, never dropped on save.
  it.each([
    ['a mode it has no name for', (source: WrittenSource) => (source.mode = 'guess')],
    ['a side it has no name for', (source: WrittenSource) => (source.side = 'both')],
    ['a field of the source', (source: WrittenSource) => (source.difficulty = 'easy')],
    ['a field of the region', (source: WrittenSource) => (source.region.layer = 2)],
    ['a planner setting it has no name for', (source: WrittenSource) => (source.settings.allowPleats = true)],
    ['a field of the line', (source: WrittenSource) => (source.line.through = [0, 0])],
    ['a field of the marks it pulled', (source: WrittenSource) => (source.marks = { letters: true, highlights: true, arrows: false })],
    ['a thumbnail line of a role it has no name for', (source: WrittenSource) => (source.thumbnail.strokes[0].role = 'cut')],
  ])('carries, locked and as it came, a source with %s', (_label, patch) => {
    const written = throughJson(writeDiagram(sentDiagram()));
    patch(withOwnThumbnail(written, written.steps[0].source));
    const read = readDiagram(written)!;
    expect(stepsIn(read.document)[0].unknown).toEqual(written.steps[0]);
    expect(throughJson(writeDiagram(read.document))).toEqual(written);
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
