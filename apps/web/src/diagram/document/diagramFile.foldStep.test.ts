import { describe, expect, it } from 'vitest';

import {
  createDiagram,
  insertSteps,
  posedRenderOf,
  renderToShowAs,
  setFoldStepPicture,
  stepById,
  withRememberedPoses,
  type DiagramCpRender,
  type DiagramFoldStepSource,
} from './diagramDocument';
import { readDiagram, storedFoldStepSource, storedSceneJson, writeDiagram } from './diagramFile';
import {
  cpSource,
  fixedPicture,
  foldStepSource,
  foldStepStep,
  scenePicture,
  stepDiagramPicture,
  stepsIn,
} from './diagramSteps.fixtures';

/** What `serializeNativeProjectFile` does to the value, and back. */
const throughJson = (value: unknown) => JSON.parse(JSON.stringify(value, null, 2));

/** A flat fold's scene of two faces, and its faces on the paper as a capture keeps them. */
function flatPictureWithFaces() {
  const scene = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    sheet: 10,
    items: [{ kind: 'face', face: 0, side: 'front', rings: [[[0, 0], [10, 0], [10, 10], [0, 10]]], shade: 1, hidden: false }],
  };
  const paperFaces = JSON.stringify({
    points: [
      [0, 0, 0, 0],
      [5, 0, 10, 0],
      [5, 5, 10, 10],
      [0, 5, 0, 10],
    ],
    rings: [[0, 1, 2, 3]],
    levels: [0],
  });
  return { ...scenePicture('scene-fold'), sceneJson: storedSceneJson(scene)!, paperFaces };
}

function foldDiagram() {
  const steps = [
    foldStepStep('step-before', {}, flatPictureWithFaces()),
    foldStepStep('step-pattern', {
      moment: 'after',
      render: { mode: 'crease-pattern', rotationDeg: 90, side: 'back' },
      remembered: { folded: { mode: 'folded-flat', side: 'back', rotationDeg: 180, foldCase: 1 } },
    }),
    // The flat sheet's first step, which says nothing: no sentence.
    { ...foldStepStep('step-quiet', { sentence: undefined }), text: '' },
    // Not captured yet.
    foldStepStep('step-unposed', {}, null),
    // A precrease and its mirror image, drawn as one.
    foldStepStep('step-run', { through: 'fstep-3', sentence: 'Valley fold and unfold. Do this on both sides.' }),
  ];
  return insertSteps(createDiagram({ title: 'Crane' }), steps, 0);
}

/** The written diagram, with step `index`'s source patched as a hand or a newer build would. */
function writtenWith(index: number, patch: (source: Record<string, unknown>) => Record<string, unknown>) {
  const written = throughJson(writeDiagram(foldDiagram()));
  written.steps[index].source = patch(written.steps[index].source);
  return written;
}

describe('a Fold step in the file (D17)', () => {
  it('round-trips every field, its faces on the paper and its remembered pose, byte for byte', () => {
    const document = foldDiagram();
    const written = throughJson(writeDiagram(document));
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(read.document).toEqual(document);
    expect(stepsIn(read.document).every((step) => step.unknown === undefined)).toBe(true);
    expect(JSON.stringify(throughJson(writeDiagram(read.document)))).toBe(JSON.stringify(written));
  });

  it('writes its fields in one order, so a capture and a load agree field for field', () => {
    const source = foldStepSource({ remembered: { 'crease-pattern': { mode: 'crease-pattern', rotationDeg: 0 } } });
    const shuffled = Object.fromEntries(Object.entries(source).reverse()) as unknown as DiagramFoldStepSource;
    const stored = storedFoldStepSource(shuffled)!;
    expect(Object.keys(stored)).toEqual([
      'kind',
      'sequence',
      'step',
      'moment',
      'path',
      'state',
      'engine',
      'thumbnail',
      'render',
      'sentence',
      'remembered',
    ]);
    expect(stored).toEqual(source);
    // A run names its last step after its first.
    const run = storedFoldStepSource({ ...shuffled, through: 'fstep-3' })!;
    expect(Object.keys(run).slice(0, 5)).toEqual(['kind', 'sequence', 'step', 'through', 'moment']);
  });

  it('reads a run of steps drawn as one back as it was written, and a single step with no `through`', () => {
    const steps = stepsIn(readDiagram(throughJson(writeDiagram(foldDiagram())))!.document);
    expect((steps[4]!.source as DiagramFoldStepSource).through).toBe('fstep-3');
    expect(steps[4]!.unknown).toBeUndefined();
    expect(steps.slice(0, 4).every((step) => !('through' in step.source!))).toBe(true);
  });

  it.each([
    ['a last step that is its first', (source: Record<string, unknown>) => ({ ...source, through: source.step })],
    ['an empty last step', (source: Record<string, unknown>) => ({ ...source, through: '' })],
    ['a last step that is not a string', (source: Record<string, unknown>) => ({ ...source, through: 3 })],
    ['a run shown after it folds', (source: Record<string, unknown>) => ({ ...source, moment: 'after' })],
  ])('drops a run’s source with %s as damage, and keeps the step’s words', (_label, patch) => {
    const step = stepsIn(readDiagram(writtenWith(4, patch))!.document)[4]!;
    expect(step.unknown).toBeUndefined();
    expect(step.source).toBeNull();
    expect(step.text).toBe('Valley fold and unfold. Do this on both sides.');
  });

  it('carries a run with a field it has no name for, locked, as any Fold step is', () => {
    const written = writtenWith(4, (source) => ({ ...source, mirror: 'axis' }));
    const read = readDiagram(written)!;
    expect(stepsIn(read.document)[4]!.unknown).toEqual(written.steps[4]);
    expect(JSON.stringify(writeDiagram(read.document))).toBe(JSON.stringify(written));
  });

  it('reads a step shown another way back as it was captured, so the same capture again is no edit', () => {
    // Folded, with Fold's sentence; then shown as a crease pattern, which remembers the flat fold.
    const pattern = { source: foldStepSource({ render: { mode: 'crease-pattern', rotationDeg: 0 } }), marks: [] };
    const captured = { ...pattern, picture: scenePicture('scene-pattern') };
    const shown = setFoldStepPicture(insertSteps(createDiagram({ title: 'Crane' }), [foldStepStep('s1')], 0), 's1', captured)
      .document;
    expect((stepById(shown, 's1')?.source as DiagramFoldStepSource).remembered).toBeDefined();

    const written = JSON.stringify(throughJson(writeDiagram(shown)));
    const loaded = readDiagram(JSON.parse(written))!.document;
    expect(Object.keys(stepById(loaded, 's1')!.source!)).toEqual(Object.keys(stepById(shown, 's1')!.source!));
    expect(JSON.stringify(throughJson(writeDiagram(loaded)))).toBe(written);
    // Refresh after the load, with nothing changed upstream: no undo step, nothing to save.
    expect(setFoldStepPicture(loaded, 's1', captured).document).toBe(loaded);
  });

  it.each([
    ['a field it has no name for', (source: Record<string, unknown>) => ({ ...source, branch: 'fstep-9' })],
    ['a moment it does not know', (source: Record<string, unknown>) => ({ ...source, moment: 'during' })],
    [
      'a 3D render',
      (source: Record<string, unknown>) => ({
        ...source,
        render: { mode: 'folded-3d', side: 'front', camera: { yaw: 0, pitch: 0, zoom: 1 } },
      }),
    ],
    [
      'a render mode no build has yet',
      (source: Record<string, unknown>) => ({ ...source, render: { mode: 'exploded', rotationDeg: 0 } }),
    ],
    [
      'a render field it has no name for',
      (source: Record<string, unknown>) => ({ ...source, render: { ...(source.render as object), tilt: 3 } }),
    ],
    [
      'a pose remembered for a way a Fold step is not shown in',
      (source: Record<string, unknown>) => ({
        ...source,
        remembered: { simulated: { mode: 'simulated', foldPercent: 0, view: { yaw: 0, pitch: 0, zoom: 1 } } },
      }),
    ],
  ])('carries a Fold step with %s, locked, and writes it back byte for byte', (_label, patch) => {
    const written = writtenWith(0, patch);
    const read = readDiagram(written)!;
    expect(read.readOnly).toBe(false);
    expect(stepsIn(read.document)[0].unknown).toEqual(written.steps[0]);
    expect(stepsIn(read.document).slice(1).every((step) => step.unknown === undefined)).toBe(true);
    expect(JSON.stringify(writeDiagram(read.document))).toBe(JSON.stringify(written));
  });

  it.each([
    ['no sequence', (source: Record<string, unknown>) => ({ ...source, sequence: '' })],
    ['no step', (source: Record<string, unknown>) => ({ ...source, step: 7 })],
    ['no path', (source: Record<string, unknown>) => ({ ...source, path: null })],
    ['no state', (source: Record<string, unknown>) => ({ ...source, state: undefined })],
    ['an engine version that is not a whole number', (source: Record<string, unknown>) => ({ ...source, engine: 1.5 })],
    ['a thumbnail that does not read', (source: Record<string, unknown>) => ({ ...source, thumbnail: { viewBox: 'x' } })],
    [
      'a flat fold at a second layer order',
      (source: Record<string, unknown>) => ({ ...source, render: { ...(source.render as object), foldCase: 2 } }),
    ],
  ])('drops a Fold step’s source with %s as damage, and keeps the step’s words', (_label, patch) => {
    const step = stepsIn(readDiagram(writtenWith(0, patch))!.document)[0];
    expect(step.unknown).toBeUndefined();
    expect(step.source).toBeNull();
    expect(step.picture).toBeNull();
    expect(step.text).toBe('Valley fold the bottom edge to the top.');
  });

  it('drops a remembered pose or a sentence that does not read alone, and keeps the link', () => {
    const written = writtenWith(1, (source) => ({
      ...source,
      remembered: { folded: { mode: 'folded-flat', side: 'up', rotationDeg: 0, foldCase: 1 } },
      sentence: 3,
    }));
    const source = stepsIn(readDiagram(written)!.document)[1].source as DiagramFoldStepSource;
    expect(source.kind).toBe('fold-step');
    expect(source.remembered).toBeUndefined();
    expect(source.sentence).toBeUndefined();
  });

  it('keeps a scene or a bitmap, and leaves out a picture a Fold state is never drawn as', () => {
    const written = throughJson(writeDiagram(foldDiagram()));
    written.steps[1].picture = fixedPicture();
    written.steps[2].picture = stepDiagramPicture();
    const steps = stepsIn(readDiagram(written)!.document);
    expect(steps[0].picture?.kind).toBe('scene');
    expect(steps[1].picture).toBeNull();
    expect(steps[2].picture).toBeNull();
    // Each still links to its step.
    expect(steps.slice(0, 3).every((step) => step.source?.kind === 'fold-step')).toBe(true);
  });

  it('keeps a flat fold’s faces on the paper that agree with its scene, and drops those that do not', () => {
    const written = throughJson(writeDiagram(foldDiagram()));
    expect(stepsIn(readDiagram(written)!.document)[0].picture).toMatchObject({ paperFaces: expect.any(String) });
    // No face for the one its scene draws.
    written.steps[0].picture.paperFaces = JSON.stringify({ points: [], rings: [], levels: [] });
    const picture = stepsIn(readDiagram(written)!.document)[0].picture;
    expect(picture?.kind).toBe('scene');
    expect(picture && 'paperFaces' in picture ? picture.paperFaces : undefined).toBeUndefined();
  });
});

describe('a Fold step’s pose', () => {
  it('is read through the one seam a linked pattern’s is', () => {
    const flat: DiagramCpRender = { mode: 'folded-flat', side: 'back', rotationDeg: 90, foldCase: 1 };
    const source = foldStepSource({ render: flat });
    expect(posedRenderOf(source)).toBe(source.render);
    expect(source.render).toEqual(flat);
    expect(posedRenderOf(cpSource())).toEqual({ mode: 'crease-pattern', rotationDeg: 0 });
    expect(posedRenderOf(null)).toBeNull();
    expect(posedRenderOf({ kind: 'upload', assetId: 'a', rotationQuarterTurns: 0, mirrored: false })).toBeNull();
  });

  it('remembers the way it was shown when shown another way, as a linked pattern does', () => {
    const before = foldStepSource();
    const pattern = renderToShowAs(before, 'crease-pattern');
    expect(pattern).toEqual({ mode: 'crease-pattern', rotationDeg: 0 });
    const after = withRememberedPoses(before, foldStepSource({ render: pattern }));
    expect(after.remembered).toEqual({ folded: before.render });
    // Back to Folded: the flat fold it had.
    expect(renderToShowAs(after, 'folded')).toEqual(before.render);
  });

  it('remembers nothing across kinds of source: a pattern’s pose is not a Fold step’s', () => {
    const linked = { ...cpSource({ mode: 'folded-flat', side: 'front', rotationDeg: 30, foldCase: 3 }) };
    const after = withRememberedPoses(linked, foldStepSource({ render: { mode: 'crease-pattern', rotationDeg: 0 } }));
    expect(after.remembered).toBeUndefined();
  });
});
