import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_SETUP,
  createDiagram,
  createStep,
  defaultHanStyle,
  duplicateStep,
  insertSteps,
  insertionIndex,
  isLockedStep,
  moveStep,
  normalizePageSetup,
  removeSteps,
  setDiagramStyle,
  setDiagramTitle,
  setHanStyle,
  setPageSetup,
  setStepBreakBefore,
  setStepText,
  stepHasContent,
  insertPictureSteps,
  setStepPicture,
  removeStepPicture,
  stepAsset,
  stepHasPicture,
  withReferencedAssets,
  editStepAnnotations,
  uploadPictureKey,
  mirrorPose,
  poseBlocker,
  rotatePose,
  setUploadPose,
  pullReferencesSteps,
  setReferencesSide,
  setReferencesWay,
  stepDiagramKey,
  DEFAULT_SIMULATED_VIEW,
  renderToShowAs,
  setLinkedPicture,
  showAsOf,
  creasePatternSide,
  withCreasePatternSide,
  withRememberedPoses,
  anchorTakesCard,
  createTurn,
  indexForStepNumber,
  isTurn,
  setTurn,
  stepToTurn,
  canBecomeTurn,
  stepById,
  stepNumber,
  stepNumbers,
  stepsAround,
  stepsOf,
  turnById,
  clampSpreadAmount,
  clampSpreadAxis,
  clampSpreadSkew,
  DEFAULT_AFFINE_SPREAD,
  DEFAULT_DEPTH_SPREAD,
  DEFAULT_LAYER_SPREAD,
  DEFAULT_SPREAD_STARTS,
  nearestEarlierShowAs,
  nearestEarlierSpread,
  sameSpread,
  SPREAD_AMOUNT_RANGE,
  spreadStartsFor,
  type DiagramLayerSpread,
  type SentReferencesEntry,
  type SentReferencesStep,
  type DiagramDocument,
  type DiagramIdFactory,
  type DiagramStep,
  type KnownDiagramAsset,
} from './diagramDocument';
import { cpSource, cpStep, referencesSource, referencesStep, scenePicture, stepDiagramPicture, stepsIn } from './diagramSteps.fixtures';

function sequentialIds(): DiagramIdFactory {
  let next = 0;
  return (prefix) => `${prefix}-${++next}`;
}

function diagramWith(count: number): { diagram: DiagramDocument; ids: DiagramIdFactory } {
  const ids = sequentialIds();
  let diagram = createDiagram({ title: 'Crane', newId: ids });
  for (let i = 0; i < count; i++) {
    diagram = insertSteps(diagram, [createStep(ids)], diagram.steps.length);
  }
  return { diagram, ids };
}

const stepIds = (diagram: DiagramDocument) => stepsIn(diagram).map((step) => step.id);

describe('createDiagram', () => {
  it('starts empty, on the default page, in the Diagram paper preset', () => {
    const diagram = createDiagram({ title: 'Crane', newId: sequentialIds() });
    expect(diagram).toMatchObject({
      formatVersion: 1,
      id: 'diagram-1',
      title: 'Crane',
      hanStyle: 'sc',
      style: { preset: 'diagram' },
      page: DEFAULT_PAGE_SETUP,
      steps: [],
      assets: {},
    });
  });

  it('removes characters XML cannot hold from the title', () => {
    expect(createDiagram({ title: 'Cr\u000Bane\uD800' }).title).toBe('Crane');
  });
});

describe('defaultHanStyle', () => {
  it('follows the author’s language and defaults to Simplified Chinese', () => {
    expect(defaultHanStyle('ja')).toBe('jp');
    expect(defaultHanStyle('ko')).toBe('kr');
    expect(defaultHanStyle('zh-CN')).toBe('sc');
    expect(defaultHanStyle('zh-TW')).toBe('tc');
    expect(defaultHanStyle('en')).toBe('sc');
    expect(defaultHanStyle(undefined)).toBe('sc');
  });
});

describe('insertion', () => {
  it('adds after the selected step, or at the end when nothing is selected', () => {
    const { diagram } = diagramWith(3);
    expect(insertionIndex(diagram, null)).toBe(3);
    expect(insertionIndex(diagram, 'step-2')).toBe(1);
    expect(insertionIndex(diagram, 'step-4')).toBe(3);
    // A selection that no longer exists behaves as no selection.
    expect(insertionIndex(diagram, 'step-99')).toBe(3);
  });

  it('inserts several steps in order at an index, clamped', () => {
    const { diagram, ids } = diagramWith(2);
    const a = createStep(ids);
    const b = createStep(ids);
    expect(stepIds(insertSteps(diagram, [a, b], 1))).toEqual(['step-2', a.id, b.id, 'step-3']);
    expect(stepIds(insertSteps(diagram, [a], 99))).toEqual(['step-2', 'step-3', a.id]);
    expect(insertSteps(diagram, [], 0)).toBe(diagram);
  });
});

describe('removeSteps and moveStep', () => {
  it('removes by id and is a no-op for unknown ids', () => {
    const { diagram } = diagramWith(3);
    expect(stepIds(removeSteps(diagram, ['step-3']))).toEqual(['step-2', 'step-4']);
    expect(removeSteps(diagram, ['nope'])).toBe(diagram);
  });

  it('moves a step to an index, clamped, and is a no-op in place', () => {
    const { diagram } = diagramWith(4);
    expect(stepIds(moveStep(diagram, 'step-2', 2))).toEqual(['step-3', 'step-4', 'step-2', 'step-5']);
    expect(stepIds(moveStep(diagram, 'step-5', 0))).toEqual(['step-5', 'step-2', 'step-3', 'step-4']);
    expect(stepIds(moveStep(diagram, 'step-2', 99))).toEqual(['step-3', 'step-4', 'step-5', 'step-2']);
    expect(moveStep(diagram, 'step-3', 1)).toBe(diagram);
    expect(moveStep(diagram, 'missing', 0)).toBe(diagram);
  });
});

describe('duplicateStep', () => {
  it('places a copy right after the original with fresh ids', () => {
    const { diagram, ids } = diagramWith(2);
    const withText = setStepText(diagram, 'step-2', 'Fold in half');
    const annotated: DiagramDocument = {
      ...withText,
      steps: stepsIn(withText).map((step) =>
        step.id === 'step-2'
          ? { ...step, revision: 4, annotations: [{ id: 'a', unknown: { id: 'a', kind: 'x' } }] }
          : step
      ),
    };
    const result = duplicateStep(annotated, 'step-2', ids);
    expect(result).not.toBeNull();
    const { document, stepId } = result!;
    expect(stepIds(document)).toEqual(['step-2', stepId, 'step-3']);
    const copy = stepsIn(document)[1];
    expect(copy).toMatchObject({ text: 'Fold in half', revision: 0 });
    expect(copy.annotations[0].id).not.toBe('a');
  });

  it('keeps a new page with the original: the copy follows it on that page', () => {
    const { diagram, ids } = diagramWith(2);
    const breaking = setStepBreakBefore(diagram, 'step-3', true);
    const { document } = duplicateStep(breaking, 'step-3', ids)!;
    // step-2, step-3 (starting its page), and its copy after it on that page.
    expect(stepsIn(document).map((step) => step.breakBefore)).toEqual([false, true, false]);
  });

  it('refuses a missing or locked step', () => {
    const { diagram } = diagramWith(1);
    expect(duplicateStep(diagram, 'missing')).toBeNull();
    const locked: DiagramDocument = {
      ...diagram,
      steps: [{ ...stepsIn(diagram)[0], unknown: { id: stepsIn(diagram)[0].id } }],
    };
    expect(duplicateStep(locked, stepsIn(diagram)[0].id)).toBeNull();
  });
});

describe('step and document fields', () => {
  it('sets text, normalized, and is a no-op when unchanged', () => {
    const { diagram } = diagramWith(1);
    const next = setStepText(diagram, 'step-2', 'Fold\u0000 the corner');
    expect(stepsIn(next)[0].text).toBe('Fold the corner');
    expect(setStepText(next, 'step-2', 'Fold the corner')).toBe(next);
  });

  it('never edits a locked step', () => {
    const { diagram } = diagramWith(1);
    const lockedStep: DiagramStep = { ...stepsIn(diagram)[0], unknown: { id: 'step-2' } };
    const locked: DiagramDocument = { ...diagram, steps: [lockedStep] };
    expect(isLockedStep(lockedStep)).toBe(true);
    expect(setStepText(locked, 'step-2', 'hello')).toBe(locked);
    expect(setStepBreakBefore(locked, 'step-2', true)).toBe(locked);
  });

  it('sets the title, Han style, paper style and page break', () => {
    const { diagram } = diagramWith(1);
    expect(setDiagramTitle(diagram, 'Crane').title).toBe('Crane');
    expect(setDiagramTitle(diagram, 'Crane')).toBe(diagram);
    expect(setHanStyle(diagram, 'jp').hanStyle).toBe('jp');
    expect(setHanStyle(diagram, 'sc')).toBe(diagram);
    expect(setDiagramStyle(diagram, { preset: 'diagram' })).toBe(diagram);
    expect(setDiagramStyle(diagram, { preset: 'default' }).style).toEqual({ preset: 'default' });
    expect(stepsIn(setStepBreakBefore(diagram, 'step-2', true))[0].breakBefore).toBe(true);
  });
});

describe('page setup', () => {
  it('clamps every field to its range and keeps the rest', () => {
    const { diagram } = diagramWith(0);
    const next = setPageSetup(diagram, { columns: 9, rows: 0, marginMm: -4 });
    expect(next.page).toMatchObject({ columns: 5, rows: 1, marginMm: 0, size: 'a4' });
    expect(setPageSetup(diagram, { columns: 3 })).toBe(diagram);
  });

  it('starts a new diagram in the flow layout', () => {
    expect(DEFAULT_PAGE_SETUP.layout).toBe('flow');
    expect(createDiagram().page.layout).toBe('flow');
  });

  it('reads anything, falling back field by field', () => {
    // A layout not said is the grid, every diagram's before the flow was a new one's.
    expect(normalizePageSetup(null)).toEqual({ ...DEFAULT_PAGE_SETUP, layout: 'grid' });
    expect(
      normalizePageSetup({
        size: 'letter',
        orientation: 'sideways',
        columns: 2.6,
        pageNumbers: { enabled: false, first: 0 },
      })
    ).toMatchObject({
      size: 'letter',
      orientation: 'portrait',
      columns: 3,
      pageNumbers: { enabled: false, first: 1 },
    });
  });
});

describe('stepHasContent', () => {
  it('is false only for a step with nothing in it', () => {
    const empty = createStep(() => 'step-1');
    expect(stepHasContent(empty)).toBe(false);
    expect(stepHasContent({ ...empty, text: '  \n ' })).toBe(false);
    expect(stepHasContent({ ...empty, breakBefore: true })).toBe(false);
    expect(stepHasContent({ ...empty, text: 'Fold' })).toBe(true);
    expect(stepHasContent({ ...empty, unknown: { id: 'step-1' } })).toBe(true);
  });
});

function svgAsset(id: string): KnownDiagramAsset {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" viewBox="0 0 10 20"/>`;
  return { id, kind: 'svg', svg, widthPx: 10, heightPx: 20, bytes: svg.length };
}

describe('pictures', () => {
  it('adds one step per picture, in order, after the selection, each an upright upload', () => {
    const { diagram, ids } = diagramWith(2);
    const at = insertionIndex(diagram, stepsIn(diagram)[0].id);
    const { document, stepIds } = insertPictureSteps(diagram, [svgAsset('a'), svgAsset('b')], at, ids);
    expect(stepsIn(document).map((step) => step.id)).toEqual([
      stepsIn(diagram)[0].id,
      ...stepIds,
      stepsIn(diagram)[1].id,
    ]);
    expect(stepsIn(document)[1]).toMatchObject({
      source: { kind: 'upload', assetId: 'a', rotationQuarterTurns: 0, mirrored: false },
      picture: { kind: 'asset', assetId: 'a', paperScale: null, key: uploadPictureKey('a') },
      text: '',
    });
    expect(Object.keys(document.assets)).toEqual(['a', 'b']);
    expect(stepAsset(document, stepsIn(document)[2])?.id).toBe('b');
    // The original is untouched.
    expect(diagram.assets).toEqual({});
  });

  it('replaces a step’s picture, keeping its words, and bumps its revision', () => {
    const { diagram } = diagramWith(1);
    const stepId = stepsIn(diagram)[0].id;
    const withText = setStepText(diagram, stepId, 'Fold in half.');
    const first = setStepPicture(withText, stepId, svgAsset('a'));
    const second = setStepPicture(first, stepId, svgAsset('b'));
    expect(stepsIn(second)[0]).toMatchObject({ text: 'Fold in half.', revision: 2 });
    expect(stepAsset(second, stepsIn(second)[0])?.id).toBe('b');
    // The edit itself keeps the old asset; the store prunes it as the edit lands.
    expect(Object.keys(second.assets)).toEqual(['a', 'b']);
    expect(Object.keys(withReferencedAssets(second).assets)).toEqual(['b']);
  });

  it('starts an empty step enlarged before its picture whole, and keeps one that has a picture enlarged (review fix 3)', () => {
    const zoom = { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.25, 0.5] as [number, number], radius: 0.1 } };
    const { diagram } = diagramWith(1);
    const stepId = stepsIn(diagram)[0].id;
    const enlarged = (document: DiagramDocument) => ({ ...document, steps: [{ ...stepsIn(document)[0], zoom }] });
    expect(stepsIn(setStepPicture(enlarged(diagram), stepId, svgAsset('a')))[0].zoom).toBeUndefined();
    const pictured = enlarged(setStepPicture(diagram, stepId, svgAsset('a')));
    expect(stepsIn(setStepPicture(pictured, stepId, svgAsset('b')))[0].zoom).toEqual(zoom);
    // A mark drawn in the window of the picture it had, given back: carried to the whole picture, in step as it was.
    const label = { id: 'mark', kind: 'label' as const, from: [0.5, 0.5] as [number, number], to: [0.5, 0.5] as [number, number], text: 'A' };
    const removed = {
      ...diagram,
      steps: [{ ...stepsIn(diagram)[0], zoom, annotations: [label], annotatedPictureKey: uploadPictureKey('a') }],
    };
    const given = stepsIn(setStepPicture(removed, stepId, svgAsset('a')))[0];
    expect(given.zoom).toBeUndefined();
    expect(given.annotations).toEqual([{ ...label, from: [0.25, 0.5], to: [0.25, 0.5] }]);
    expect(given.annotatedPictureKey).toBe(uploadPictureKey('a'));
  });

  it('carries marks drawn on a removed linked picture to the whole of a different upload, out of step (item 3; review fix 5)', () => {
    // Remove Picture, then Upload, on an enlarged linked step: a change of picture, not of units. The marks were
    // drawn in the linked picture's window and mark nothing on the upload either way; item 3 accepted carrying
    // them to its whole picture, as Enlarged turned off carries them, and they stay out of step with it.
    const zoom = { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.25, 0.5] as [number, number], radius: 0.1 } };
    const label = { id: 'mark', kind: 'label' as const, from: [0.5, 0.5] as [number, number], to: [0.5, 0.5] as [number, number], text: 'A' };
    const linked: DiagramStep = { ...cpStep('step-1'), zoom, annotations: [label], annotatedPictureKey: 'scene-1' };
    const removed = removeStepPicture(insertSteps(createDiagram({ title: 'Crane' }), [linked], 0), 'step-1');
    expect(stepsIn(removed)[0]).toMatchObject({ picture: null, zoom, annotatedPictureKey: 'scene-1' });
    const given = stepsIn(setStepPicture(removed, 'step-1', svgAsset('a')))[0];
    expect(given.picture?.key).toBe(uploadPictureKey('a'));
    expect(given.zoom).toBeUndefined();
    expect(given.annotations).toEqual([{ ...label, from: [0.25, 0.5], to: [0.25, 0.5] }]);
    expect(given.annotatedPictureKey).toBe('scene-1');
  });

  it('removes a picture and its source, keeping the words, and is a no-op without one', () => {
    const { diagram } = diagramWith(1);
    const stepId = stepsIn(diagram)[0].id;
    expect(removeStepPicture(diagram, stepId)).toBe(diagram);
    const pictured = setStepText(setStepPicture(diagram, stepId, svgAsset('a')), stepId, 'Turn over.');
    const removed = removeStepPicture(pictured, stepId);
    expect(stepHasPicture(stepsIn(removed)[0])).toBe(false);
    expect(stepsIn(removed)[0]).toMatchObject({ text: 'Turn over.', revision: 2 });
  });

  it('never gives a locked step a picture', () => {
    const { diagram } = diagramWith(1);
    const locked = {
      ...diagram,
      steps: [{ ...stepsIn(diagram)[0], unknown: { id: stepsIn(diagram)[0].id, source: { kind: 'later' } } }],
    };
    expect(setStepPicture(locked, stepsIn(locked)[0].id, svgAsset('a'))).toBe(locked);
    expect(stepAsset(locked, stepsIn(locked)[0])).toBeNull();
  });

  it('shares a duplicated step’s asset rather than copying it', () => {
    const { diagram, ids } = diagramWith(0);
    const { document } = insertPictureSteps(diagram, [svgAsset('a')], 0, ids);
    const copy = duplicateStep(document, stepsIn(document)[0].id, ids)!;
    expect(Object.keys(copy.document.assets)).toEqual(['a']);
    expect(stepAsset(copy.document, stepsIn(copy.document)[1])).toBe(stepAsset(document, stepsIn(document)[0]));
  });

  it('counts a picture as content worth asking about', () => {
    const { diagram } = diagramWith(1);
    const stepId = stepsIn(diagram)[0].id;
    expect(stepHasContent(stepsIn(setStepPicture(diagram, stepId, svgAsset('a')))[0])).toBe(true);
  });
});

describe('withReferencedAssets', () => {
  it('keeps what steps name, what a newer build’s step names, and kinds it does not know', () => {
    const { diagram, ids } = diagramWith(0);
    const { document } = insertPictureSteps(diagram, [svgAsset('used')], 0, ids);
    const carried = {
      ...document,
      steps: [
        ...document.steps,
        { ...createStep(ids), unknown: { id: 'later-step', source: { kind: 'later', ref: 'named' } } },
      ],
      assets: {
        ...document.assets,
        orphan: svgAsset('orphan'),
        named: svgAsset('named'),
        future: { id: 'future', unknown: { kind: 'video' } },
      },
    };
    expect(Object.keys(withReferencedAssets(carried).assets).sort()).toEqual(['future', 'named', 'used']);
  });

  it('keeps what a newer build’s annotation or asset names', () => {
    const { diagram, ids } = diagramWith(0);
    const { document } = insertPictureSteps(diagram, [svgAsset('used')], 0, ids);
    const step = stepsIn(document)[0]!;
    const carried = {
      ...document,
      steps: [{ ...step, annotations: [{ id: 'n-1', unknown: { id: 'n-1', kind: 'inset', assetId: 'inset' } }] }],
      assets: {
        ...document.assets,
        inset: svgAsset('inset'),
        poster: svgAsset('poster'),
        future: { id: 'future', unknown: { kind: 'video', poster: 'poster' } },
        orphan: svgAsset('orphan'),
      },
    };
    expect(Object.keys(withReferencedAssets(carried).assets).sort()).toEqual(['future', 'inset', 'poster', 'used']);
  });

  it('returns the same document when nothing is dropped', () => {
    const { diagram, ids } = diagramWith(0);
    const { document } = insertPictureSteps(diagram, [svgAsset('a')], 0, ids);
    expect(withReferencedAssets(document)).toBe(document);
  });
});

describe('upload pose', () => {
  it('turns a quarter either way, wrapping, and flips as shown', () => {
    const upright = { rotationQuarterTurns: 0 as const, mirrored: false };
    expect(rotatePose(upright, -1)).toEqual({ rotationQuarterTurns: 3, mirrored: false });
    expect(rotatePose(rotatePose(upright, 1), 1)).toEqual({ rotationQuarterTurns: 2, mirrored: false });
    // Flipping twice is no flip, from any turn.
    for (const turns of [0, 1, 2, 3] as const) {
      const pose = { rotationQuarterTurns: turns, mirrored: false };
      expect(mirrorPose(mirrorPose(pose))).toEqual(pose);
    }
  });

  it('poses an upload, bumping its revision, and is a no-op for the same pose', () => {
    const { diagram, ids } = diagramWith(0);
    const { document, stepIds } = insertPictureSteps(diagram, [svgAsset('a')], 0, ids);
    const posed = setUploadPose(document, stepIds[0], { rotationQuarterTurns: 1, mirrored: true });
    expect(stepsIn(posed)[0]).toMatchObject({
      source: { kind: 'upload', assetId: 'a', rotationQuarterTurns: 1, mirrored: true },
      revision: 1,
    });
    expect(setUploadPose(posed, stepIds[0], { rotationQuarterTurns: 1, mirrored: true })).toBe(posed);
  });

  it('refuses a step that is not an upload, or carries annotations it cannot turn', () => {
    const { diagram, ids } = diagramWith(1);
    expect(poseBlocker(stepsIn(diagram)[0])).toBe('not-upload');
    const { document, stepIds } = insertPictureSteps(diagram, [svgAsset('a')], 1, ids);
    const annotated = {
      ...document,
      steps: stepsIn(document).map((step) =>
        step.id === stepIds[0]
          ? { ...step, annotations: [{ id: 'annotation-x', unknown: { id: 'annotation-x', kind: 'later' } }] }
          : step
      ),
    };
    expect(poseBlocker(stepsIn(annotated)[1])).toBe('unknown-annotations');
    expect(setUploadPose(annotated, stepIds[0], { rotationQuarterTurns: 2, mirrored: false })).toBe(annotated);
  });
});

describe('steps pulled from References (D20)', () => {
  const card = (n: number): SentReferencesStep => ({
    source: referencesSource({ card: n }),
    picture: stepDiagramPicture(),
    text: `Fold ${n}.`,
  });
  const ids = (document: DiagramDocument) => stepsIn(document).map((step) => step.id);
  function withSteps(...steps: DiagramStep[]): DiagramDocument {
    return insertSteps(createDiagram({ title: 'T', newId: sequentialIds() }), steps, 0);
  }

  it('puts the cards after a step, or at the end, in order', () => {
    const document = withSteps(createStep(() => 'step-a'), createStep(() => 'step-b'));
    const after = pullReferencesSteps(document, [card(1), card(2)], { kind: 'after', stepId: 'step-a' }, { newId: sequentialIds() });
    expect(ids(after.document)).toEqual(['step-a', ...after.stepIds, 'step-b']);
    expect(stepsIn(after.document)[1]).toMatchObject({ source: { card: 1 }, text: 'Fold 1.' });
    const end = pullReferencesSteps(document, [card(1)], { kind: 'end' }, { newId: sequentialIds() });
    expect(ids(end.document)).toEqual(['step-a', 'step-b', end.stepIds[0]]);
    // A step gone since: at the end.
    const gone = pullReferencesSteps(document, [card(1)], { kind: 'after', stepId: 'step-gone' }, { newId: sequentialIds() });
    expect(ids(gone.document).at(-1)).toBe(gone.stepIds[0]);
  });

  it('fills an empty step with the first card, keeping its words, and puts the rest after it', () => {
    const empty = { ...createStep(() => 'step-e'), text: 'Mine.' };
    const document = withSteps(createStep(() => 'step-a'), empty, createStep(() => 'step-b'));
    const pulled = pullReferencesSteps(document, [card(1), card(2)], { kind: 'fill', stepId: 'step-e' }, { newId: sequentialIds() });
    expect(pulled.stepIds[0]).toBe('step-e');
    expect(ids(pulled.document)).toEqual(['step-a', 'step-e', pulled.stepIds[1], 'step-b']);
    expect(stepsIn(pulled.document)[1]).toMatchObject({ source: { card: 1 }, text: 'Mine.', revision: 1 });
    // An empty instruction takes the card's sentence, as the file keeps text.
    const blank = withSteps(createStep(() => 'step-e'));
    const sentence = { ...card(3), text: 'Fold 3.\u000B' };
    expect(stepsIn(pullReferencesSteps(blank, [sentence], { kind: 'fill', stepId: 'step-e' }).document)[0]?.text).toBe('Fold 3.');
    // One that got a picture since is not filled: the cards go after it.
    const pictured = withSteps(referencesStep('step-e'));
    const after = pullReferencesSteps(pictured, [card(1)], { kind: 'fill', stepId: 'step-e' }, { newId: sequentialIds() });
    expect(ids(after.document)).toEqual(['step-e', after.stepIds[0]]);
  });

  it('replaces a References step’s card, its words only while they are still the old card’s', () => {
    // The card's own sentence is recorded on the step as it is pulled.
    const own = { ...referencesStep('step-r', { sentence: 'Fold the old way.' }), text: 'Fold the old way.' };
    const document = withSteps(own, createStep(() => 'step-b'));
    const replaced = pullReferencesSteps(document, [card(7)], { kind: 'replace', stepId: 'step-r' }, { newId: sequentialIds() });
    expect(replaced.stepIds).toEqual(['step-r']);
    expect(stepsIn(replaced.document)[0]).toMatchObject({ source: { card: 7 }, text: 'Fold 7.' });
    // Edited since: the reader's words stay.
    const edited = withSteps({ ...own, text: 'Something else.' });
    expect(
      pullReferencesSteps(edited, [card(7)], { kind: 'replace', stepId: 'step-r' }, { newId: sequentialIds() }).document
        .steps[0]
    ).toMatchObject({ source: { card: 7 }, text: 'Something else.' });
    // A step that never recorded its card's sentence: its words cannot be told from the reader's, so they stay.
    const unknown = withSteps({ ...referencesStep('step-r'), text: 'Fold the old way.' });
    expect(
      stepsIn(
        pullReferencesSteps(unknown, [card(7)], { kind: 'replace', stepId: 'step-r' }, { newId: sequentialIds() }).document
      )[0]?.text
    ).toBe('Fold the old way.');
    // Not a References step: nothing replaced, the card goes after it.
    const plain = withSteps(createStep(() => 'step-p'));
    const after = pullReferencesSteps(plain, [card(7)], { kind: 'replace', stepId: 'step-p' }, { newId: sequentialIds() });
    expect(ids(after.document)).toEqual(['step-p', after.stepIds[0]]);
  });
});

describe('a References step’s side', () => {
  function withSteps(...steps: DiagramStep[]): DiagramDocument {
    return insertSteps(createDiagram({ title: 'T', newId: sequentialIds() }), steps, 0);
  }

  it('turns a step over, re-keying its picture, and back', () => {
    const document = withSteps(referencesStep('step-r'));
    const turned = setReferencesSide(document, 'step-r', true);
    expect(stepsIn(turned)[0]?.picture).toMatchObject({ mirrored: true, key: 'steps-1-back' });
    expect(stepsIn(turned)[0]?.source).toMatchObject({ side: 'front' });
    const back = setReferencesSide(turned, 'step-r', false);
    expect(stepsIn(back)[0]?.picture).toMatchObject({ mirrored: false, key: 'steps-1' });
    // No change is no edit.
    expect(setReferencesSide(document, 'step-r', false)).toBe(document);
    expect(stepsIn(setReferencesSide(withSteps(createStep(() => 'step-e')), 'step-e', true))[0]?.picture).toBeNull();
  });

  it('marks a key for the back once, whichever side it starts from', () => {
    expect(stepDiagramKey('steps-x', true)).toBe('steps-x-back');
    expect(stepDiagramKey('steps-x-back', true)).toBe('steps-x-back');
    expect(stepDiagramKey('steps-x-back', false)).toBe('steps-x');
  });
});

describe('a References step’s way to fold (D23)', () => {
  function withSteps(...steps: DiagramStep[]): DiagramDocument {
    return insertSteps(createDiagram({ title: 'T', newId: sequentialIds() }), steps, 0);
  }
  const other = { signature: 'O2:cp|0', picture: { ...stepDiagramPicture(), key: 'steps-2' }, sentence: 'Fold the corner to the point.' };

  it('shows the way chosen, recording it, and its sentence while the words are still the card’s', () => {
    const own = { ...referencesStep('step-r', { way: 'O3:el|0', sentence: 'Fold the edge to the line.' }), text: 'Fold the edge to the line.' };
    const chosen = stepsIn(setReferencesWay(withSteps(own), 'step-r', other))[0]!;
    expect(chosen.source).toMatchObject({ way: other.signature, sentence: other.sentence, card: 2 });
    expect(chosen.picture).toEqual(other.picture);
    expect(chosen.text).toBe(other.sentence);
    expect(chosen.revision).toBe(own.revision + 1);
    // The reader's own words stay, though the card's sentence is the new way's.
    const edited = stepsIn(setReferencesWay(withSteps({ ...own, text: 'Mine.' }), 'step-r', other))[0]!;
    expect(edited.text).toBe('Mine.');
    expect(edited.source).toMatchObject({ sentence: other.sentence });
  });

  it('records nothing for the way it shows, and touches no other kind of step', () => {
    const document = withSteps(referencesStep('step-r', { way: other.signature }), createStep(() => 'step-e'));
    const same = setReferencesWay(document, 'step-r', { ...other, picture: stepDiagramPicture() });
    expect(same).toBe(document);
    expect(setReferencesWay(document, 'step-e', other)).toBe(document);
  });
});

describe('editStepAnnotations', () => {
  function pictured() {
    const { diagram, ids } = diagramWith(0);
    const { document } = insertPictureSteps(diagram, [svgAsset('pic')], 0, ids);
    return { document, stepId: stepsIn(document)[0]!.id };
  }
  const label = { id: 'l', kind: 'label' as const, from: [0.5, 0.5] as [number, number], to: [0.5, 0.5] as [number, number], text: 'A' };

  it('writes them as this build reads them: within reach, a label’s text clean and on one line', () => {
    const { document, stepId } = pictured();
    const edited = editStepAnnotations(document, stepId, () => [
      { ...label, text: 'A\u000bB\nC', to: [9, 9] },
      { id: 'v', kind: 'valley-line', from: [-7, 0], to: [1, 9] },
    ]);
    expect(stepsIn(edited)[0]!.annotations).toEqual([
      { ...label, text: 'AB C' },
      { id: 'v', kind: 'valley-line', from: [-4, 0], to: [1, 4] },
    ]);
  });

  it('records nothing for an edit that says what is there already', () => {
    const { document, stepId } = pictured();
    const once = editStepAnnotations(document, stepId, () => [label]);
    expect(editStepAnnotations(once, stepId, (list) => list.map((annotation) => ({ ...annotation })))).toBe(once);
  });

  it('takes no more than a step holds', () => {
    const { document, stepId } = pictured();
    const full = editStepAnnotations(document, stepId, () =>
      Array.from({ length: 500 }, (_, index) => ({ ...label, id: `l-${index}` }))
    );
    expect(stepsIn(full)[0]!.annotations).toHaveLength(500);
    expect(editStepAnnotations(full, stepId, (list) => [...list, { ...label, id: 'one-more' }])).toBe(full);
  });
});

describe('the ways a linked pattern is shown (D19)', () => {
  const flat = { mode: 'folded-flat' as const, side: 'back' as const, rotationDeg: 30, foldCase: 2 };
  const pattern = { mode: 'crease-pattern' as const, rotationDeg: 45 };

  it('remembers the pose a way had when the step is shown another way, and never the way it is shown', () => {
    const before = cpSource(flat);
    const after = withRememberedPoses(before, cpSource(pattern));
    expect(after.render).toEqual(pattern);
    expect(after.remembered).toEqual({ folded: flat });
    // Back again: the folded pose is the step's own, and the crease pattern's is remembered.
    const back = withRememberedPoses(after, cpSource(flat));
    expect(back.remembered).toEqual({ 'crease-pattern': pattern });
    // A pose within one way remembers nothing new.
    expect(withRememberedPoses(cpSource(flat), cpSource({ ...flat, rotationDeg: 60 })).remembered).toBeUndefined();
    // A first link has nothing to remember.
    expect(withRememberedPoses(null, cpSource(flat)).remembered).toBeUndefined();
  });

  it('shows a way in the pose it last had, or turned as the step is from the front', () => {
    expect(renderToShowAs({ render: flat }, 'folded')).toBe(flat);
    expect(renderToShowAs({ render: pattern, remembered: { folded: flat } }, 'folded')).toBe(flat);
    expect(renderToShowAs({ render: pattern }, 'folded')).toEqual({
      mode: 'folded-flat',
      side: 'front',
      rotationDeg: 45,
      foldCase: 1,
    });
    // A back at 30 is the front at 330, turned over: the pattern lies as that front does.
    expect(renderToShowAs({ render: flat }, 'crease-pattern')).toEqual({ mode: 'crease-pattern', rotationDeg: 330 });
    expect(renderToShowAs({ render: { ...flat, side: 'front' } }, 'crease-pattern')).toEqual({
      mode: 'crease-pattern',
      rotationDeg: 30,
    });
    const threeD = { mode: 'folded-3d' as const, camera: { yaw: 1, pitch: 0, zoom: 1 }, side: 'front' as const };
    expect(renderToShowAs({ render: threeD }, 'crease-pattern')).toEqual({ mode: 'crease-pattern', rotationDeg: 0 });
    expect(showAsOf(threeD)).toBe('folded');
  });

  it('gives a crease pattern’s paper its back colour and changes nothing else; the front is written as no side', () => {
    expect(creasePatternSide(pattern)).toBe('front');
    const back = withCreasePatternSide(pattern, 'back');
    expect(back).toEqual({ ...pattern, side: 'back' });
    expect(creasePatternSide(back)).toBe('back');
    expect(withCreasePatternSide(back, 'front')).toEqual(pattern);
    expect('side' in withCreasePatternSide(back, 'front')).toBe(false);
  });

  it('keeps a crease pattern’s back through the other ways, and starts them from the front at its own turn', () => {
    const back = { mode: 'crease-pattern' as const, rotationDeg: 30, side: 'back' as const };
    // Nothing mirrored (Zach, 2026-10-06: the back is the paper's colour): the fold lies as the pattern does.
    expect(renderToShowAs({ render: back }, 'folded')).toEqual({ mode: 'folded-flat', side: 'front', rotationDeg: 30, foldCase: 1 });
    // Remembered while it is shown folded, and brought back as it was.
    const folded = withRememberedPoses(cpSource(back), cpSource(flat));
    expect(folded.remembered).toEqual({ 'crease-pattern': back });
    expect(renderToShowAs(folded, 'crease-pattern')).toBe(back);
  });

  it('shows Simulated at 0%, from the camera it last had or Simulate’s own default', () => {
    const view = { yaw: 1, pitch: -0.4, zoom: 2 };
    expect(renderToShowAs({ render: pattern }, 'simulated')).toEqual({
      mode: 'simulated',
      foldPercent: 0,
      view: DEFAULT_SIMULATED_VIEW,
    });
    expect(
      renderToShowAs({ render: pattern, remembered: { simulated: { mode: 'simulated', foldPercent: 40, view } } }, 'simulated')
    ).toEqual({ mode: 'simulated', foldPercent: 0, view });
    // From a simulation, the pattern is upright.
    expect(renderToShowAs({ render: { mode: 'simulated', foldPercent: 40, view } }, 'crease-pattern')).toEqual({
      mode: 'crease-pattern',
      rotationDeg: 0,
    });
  });

  it('keeps what a step remembers through a new capture, and records nothing for one that changes nothing', () => {
    const document = insertSteps(createDiagram({ newId: () => 'diagram-1' }), [{ ...createStep(() => 'step-1'), source: cpSource(flat), picture: scenePicture('a') }], 0);
    const shown = setLinkedPicture(document, 'step-1', { source: cpSource(pattern), picture: scenePicture('b') });
    expect(stepsIn(shown)[0]!.source).toMatchObject({ render: pattern, remembered: { folded: flat } });
    expect(setLinkedPicture(shown, 'step-1', { source: cpSource(pattern), picture: scenePicture('b') })).toBe(shown);
  });

  it('takes a capture that adds the faces on the paper to a picture drawn the same, its marks kept in step (Revision 2)', () => {
    const mark = { id: 'annotation-1', kind: 'valley-line' as const, from: [0, 0] as [number, number], to: [1, 1] as [number, number] };
    const step = { ...createStep(() => 'step-1'), source: cpSource(flat), picture: scenePicture('a'), annotations: [mark], annotatedPictureKey: 'a' };
    const document = insertSteps(createDiagram({ newId: () => 'diagram-1' }), [step], 0);
    const faces = JSON.stringify({ points: [], rings: [], levels: [] });
    const refreshed = setLinkedPicture(document, 'step-1', { source: cpSource(flat), picture: { ...scenePicture('a'), paperFaces: faces } });
    expect(refreshed).not.toBe(document);
    expect(stepsIn(refreshed)[0]).toMatchObject({ picture: { key: 'a', paperFaces: faces }, annotations: [mark], annotatedPictureKey: 'a' });
    expect(setLinkedPicture(refreshed, 'step-1', { source: cpSource(flat), picture: { ...scenePicture('a'), paperFaces: faces } })).toBe(refreshed);
  });

  it('remembers a fold’s spread while the pattern is shown, and brings it back with the fold (Phase 13)', () => {
    const spread = { ...flat, spread: { kind: 'depth' as const, amount: 0.08, toward: 'left' as const } };
    const shown = withRememberedPoses(cpSource(spread), cpSource(pattern));
    expect(shown.remembered).toEqual({ folded: spread });
    expect(renderToShowAs(shown, 'folded', DEFAULT_LAYER_SPREAD)).toEqual(spread);
    // A fold remembered with none keeps none: it already has a pose (13g).
    const unspread = withRememberedPoses(cpSource(flat), cpSource(pattern));
    expect(renderToShowAs(unspread, 'folded', DEFAULT_LAYER_SPREAD)).not.toHaveProperty('spread');
  });

  it('starts a fold shown for the first time with the spread it is given, and none without one (13g)', () => {
    expect(renderToShowAs({ render: pattern }, 'folded', DEFAULT_LAYER_SPREAD)).toEqual({
      mode: 'folded-flat',
      side: 'front',
      rotationDeg: 45,
      foldCase: 1,
      spread: { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 },
    });
    expect(renderToShowAs({ render: pattern }, 'folded')).not.toHaveProperty('spread');
    // The pattern and the simulation take none.
    expect(renderToShowAs({ render: flat }, 'crease-pattern', DEFAULT_LAYER_SPREAD)).not.toHaveProperty('spread');
  });
});

describe('a flat fold’s spread (Phase 13)', () => {
  const flat = (spread?: DiagramLayerSpread) => ({
    mode: 'folded-flat' as const,
    side: 'front' as const,
    rotationDeg: 0,
    foldCase: 1,
    ...(spread ? { spread } : {}),
  });
  const depth = (amount: number, toward: 'up-left' | 'down'): DiagramLayerSpread => ({ kind: 'depth', amount, toward });
  const affine = (amount: number): DiagramLayerSpread => ({ kind: 'affine', amount, keep: 'bottom', skew: 0.5, axisDeg: 30 });

  function spreadDiagram() {
    const steps = [
      { ...createStep(() => 'step-a'), source: cpSource(flat(depth(0.1, 'down'))), picture: scenePicture() },
      { ...createStep(() => 'step-b'), source: cpSource(flat(affine(0.06))), picture: scenePicture() },
      { ...createStep(() => 'step-c'), source: cpSource(flat(depth(0.03, 'up-left'))), picture: scenePicture() },
      { ...createStep(() => 'step-d'), source: cpSource(flat()), picture: scenePicture() },
      createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-1'),
      { ...createStep(() => 'step-e'), source: cpSource({ mode: 'crease-pattern', rotationDeg: 0 }), picture: scenePicture() },
      // A newer build's step: what it holds is not this build's to read.
      { ...createStep(() => 'step-f'), source: cpSource(flat(depth(0.2, 'down'))), unknown: { id: 'step-f' } },
      { ...createStep(() => 'step-g'), source: cpSource(flat()), picture: scenePicture() },
    ];
    return insertSteps(createDiagram({ newId: () => 'diagram-1' }), steps, 0);
  }

  it('starts from the nearest step before with one, past turns, other renders and newer steps', () => {
    const document = spreadDiagram();
    expect(nearestEarlierSpread(document, 'step-g')).toEqual(depth(0.03, 'up-left'));
    expect(nearestEarlierSpread(document, 'step-c')).toEqual(affine(0.06));
    expect(nearestEarlierSpread(document, 'step-b')).toEqual(depth(0.1, 'down'));
    expect(nearestEarlierSpread(document, 'step-a')).toBeNull();
    expect(nearestEarlierSpread(document, 'step-gone')).toBeNull();
  });

  it('starts each kind from the nearest step before of that kind, else its default (13g)', () => {
    const document = spreadDiagram();
    expect(nearestEarlierSpread(document, 'step-g', 'affine')).toEqual(affine(0.06));
    expect(nearestEarlierSpread(document, 'step-c', 'depth')).toEqual(depth(0.1, 'down'));
    expect(spreadStartsFor(document, 'step-g')).toEqual({
      any: depth(0.03, 'up-left'),
      depth: depth(0.03, 'up-left'),
      affine: affine(0.06),
    });
    expect(spreadStartsFor(document, 'step-b')).toEqual({
      any: depth(0.1, 'down'),
      depth: depth(0.1, 'down'),
      affine: DEFAULT_AFFINE_SPREAD,
    });
    expect(spreadStartsFor(document, 'step-a')).toEqual(DEFAULT_SPREAD_STARTS);
  });

  it('names the way the nearest linked step before shows its pattern, past turns, uploads, References steps and newer steps (review fix 3)', () => {
    const document = spreadDiagram();
    const upload: DiagramStep = {
      ...createStep(() => 'step-u'),
      source: { kind: 'upload', assetId: 'u', rotationQuarterTurns: 0, mirrored: false },
      picture: { kind: 'asset', assetId: 'u', paperScale: null, key: uploadPictureKey('u') },
    };
    const after = insertSteps(document, [upload, referencesStep('step-r'), createStep(() => 'step-new')], document.steps.length);
    expect(nearestEarlierShowAs(after, 'step-new')).toBe('folded');
    expect(nearestEarlierShowAs(after, 'step-g')).toBe('crease-pattern');
    expect(nearestEarlierShowAs(after, 'step-b')).toBe('folded');
    expect(nearestEarlierShowAs(after, 'step-a')).toBeNull();
    expect(nearestEarlierShowAs(after, 'step-gone')).toBeNull();
  });

  it('defaults to affine, at the playground’s bird base; and depth to 2.5%, deeper layers down (Zach, 2026-10-05)', () => {
    expect(DEFAULT_LAYER_SPREAD).toEqual({ kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 });
    expect(DEFAULT_AFFINE_SPREAD).toEqual({ kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 });
    expect(DEFAULT_DEPTH_SPREAD).toEqual({ kind: 'depth', amount: 0.025, toward: 'down' });
    expect(DEFAULT_SPREAD_STARTS).toEqual({ any: DEFAULT_AFFINE_SPREAD, depth: DEFAULT_DEPTH_SPREAD, affine: DEFAULT_AFFINE_SPREAD });
  });

  it('keeps a depth amount within 0.5% and 20%, to a hundredth of a percent', () => {
    expect(clampSpreadAmount('depth', 0.0525)).toBe(0.0525);
    expect(clampSpreadAmount('depth', 0.05 + 1e-12)).toBe(0.05);
    expect(clampSpreadAmount('depth', 0.123456)).toBe(0.1235);
    expect(clampSpreadAmount('depth', 0.5)).toBe(SPREAD_AMOUNT_RANGE.depth.max);
    expect(clampSpreadAmount('depth', 0)).toBe(SPREAD_AMOUNT_RANGE.depth.min);
    expect(clampSpreadAmount('depth', Number.NaN)).toBe(DEFAULT_DEPTH_SPREAD.amount);
  });

  it('keeps an affine amount within 0.5% and 25%, a skew within 0 and 1, an axis in whole degrees of a half turn', () => {
    expect(clampSpreadAmount('affine', 0.22)).toBe(0.22);
    expect(clampSpreadAmount('affine', 0.5)).toBe(SPREAD_AMOUNT_RANGE.affine.max);
    expect(SPREAD_AMOUNT_RANGE.affine.max).toBe(0.25);
    expect(clampSpreadAmount('affine', Number.NaN)).toBe(DEFAULT_AFFINE_SPREAD.amount);
    expect(clampSpreadSkew(0.456)).toBe(0.46);
    expect(clampSpreadSkew(1.2)).toBe(1);
    expect(clampSpreadSkew(-0.2)).toBe(0);
    expect(clampSpreadSkew(Number.NaN)).toBe(DEFAULT_AFFINE_SPREAD.skew);
    expect(clampSpreadAxis(80.6)).toBe(81);
    expect(clampSpreadAxis(179.6)).toBe(0);
    expect(clampSpreadAxis(-10)).toBe(170);
    expect(clampSpreadAxis(270)).toBe(90);
    expect(clampSpreadAxis(Number.NaN)).toBe(DEFAULT_AFFINE_SPREAD.axisDeg);
  });

  it('tells one spread from another, and none from none', () => {
    expect(sameSpread(undefined, undefined)).toBe(true);
    expect(sameSpread(depth(0.05, 'down'), depth(0.05, 'down'))).toBe(true);
    expect(sameSpread(depth(0.05, 'down'), depth(0.05, 'up-left'))).toBe(false);
    expect(sameSpread(depth(0.05, 'down'), undefined)).toBe(false);
    expect(sameSpread(affine(0.05), affine(0.05))).toBe(true);
    expect(sameSpread(affine(0.05), depth(0.05, 'down'))).toBe(false);
    for (const change of [{ keep: 'top' }, { skew: 0.6 }, { axisDeg: 31 }, { amount: 0.06 }]) {
      expect(sameSpread(affine(0.05), { ...affine(0.05), ...change } as DiagramLayerSpread), JSON.stringify(change)).toBe(false);
    }
  });
});

describe('an empty step made a turn (D24)', () => {
  const OVER = { kind: 'turn-over', axis: 'vertical' } as const;

  it('puts a turn in its place, numbered none, so the steps after it read one less', () => {
    const { diagram, ids } = diagramWith(3);
    const [s1, s2, s3] = stepIds(diagram);
    const made = stepToTurn(diagram, s2!, OVER, ids)!;
    expect(made.document.steps.map((entry) => entry.id)).toEqual([s1, made.turnId, s3]);
    expect(turnById(made.document, made.turnId)).toMatchObject(OVER);
    expect(stepNumber(made.document, s3!)).toBe(2);
  });

  it('carries a new page it started on to the step after it, where the turn now leads', () => {
    const { diagram, ids } = diagramWith(3);
    const [, s2, s3] = stepIds(diagram);
    const breaking = setStepBreakBefore(diagram, s2!, true);
    const made = stepToTurn(breaking, s2!, OVER, ids)!;
    expect(stepById(made.document, s3!)?.breakBefore).toBe(true);
  });

  it('makes a turn only of an empty step: not one with a picture or a link, a newer build’s, or a turn', () => {
    const { diagram, ids } = diagramWith(1);
    const turned = insertSteps(
      insertSteps(diagram, [{ ...referencesStep('step-r') }, { ...createStep(() => 'step-n'), unknown: { id: 'step-n' } }], 1),
      [createTurn(OVER, () => 'turn-t')],
      3
    );
    for (const id of ['step-r', 'step-n', 'turn-t', 'step-gone']) expect(stepToTurn(turned, id, OVER, ids)).toBeNull();
    expect(canBecomeTurn(stepsIn(diagram)[0]!)).toBe(true);
    // Words do not stop it: the store asks first.
    const worded = setStepText(diagram, stepIds(diagram)[0]!, 'Fold it.');
    expect(stepToTurn(worded, stepIds(diagram)[0]!, OVER, ids)).not.toBeNull();
  });
});

describe('turns between steps (D22)', () => {
  /** Steps 1–3 with a turn-over between 1 and 2 and a rotation after 3: [s1, t1, s2, s3, t2]. */
  function turning(): { diagram: DiagramDocument; ids: DiagramIdFactory } {
    const { diagram, ids } = diagramWith(3);
    const [s1, , s3] = stepIds(diagram);
    let next = insertSteps(diagram, [createTurn({ kind: 'turn-over', axis: 'vertical' }, ids)], 1);
    next = insertSteps(next, [createTurn({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } }, ids)], 4);
    expect(next.steps.map((entry) => entry.id)).toEqual([s1, 'turn-5', stepIds(diagram)[1], s3, 'turn-6']);
    return { diagram: next, ids };
  }

  it('numbers the steps alone: the steps either side of a turn read 1 and 2', () => {
    const { diagram } = turning();
    expect(stepsOf(diagram).map((step) => step.id)).toEqual(['step-2', 'step-3', 'step-4']);
    expect([...stepNumbers(diagram)]).toEqual([
      ['step-2', 1],
      ['step-3', 2],
      ['step-4', 3],
    ]);
    expect(stepNumber(diagram, 'turn-5')).toBeNull();
    expect(stepsAround(diagram, 'turn-5')).toEqual({ before: 1, after: 2 });
    expect(stepsAround(diagram, 'turn-6')).toEqual({ before: 3, after: null });
    // Read once per order: the same order, the same lists.
    expect(stepsOf(diagram)).toBe(stepsOf(diagram));
  });

  it('finds a step and a turn by id, each only as what it is', () => {
    const { diagram } = turning();
    expect(stepById(diagram, 'turn-5')).toBeNull();
    expect(turnById(diagram, 'turn-5')).toMatchObject({ kind: 'turn-over' });
    expect(turnById(diagram, 'step-2')).toBeNull();
    expect(isTurn(diagram.steps[1]!)).toBe(true);
  });

  it('leaves a turn alone to every step edit, and copies none', () => {
    const { diagram } = turning();
    expect(setStepText(diagram, 'turn-5', 'Turn it.')).toBe(diagram);
    expect(setStepBreakBefore(diagram, 'turn-5', true)).toBe(diagram);
    expect(duplicateStep(diagram, 'turn-5')).toBeNull();
    expect(anchorTakesCard(diagram, { kind: 'fill', stepId: 'turn-5' })).toBe(false);
  });

  it('changes what a turn is, and nothing when it is that already', () => {
    const { diagram } = turning();
    const half = setTurn(diagram, 'turn-6', { kind: 'rotate', rotate: { amount: 'half', direction: 'ccw' } });
    expect(half.steps[4]).toEqual({ id: 'turn-6', kind: 'rotate', rotate: { amount: 'half', direction: 'ccw' } });
    expect(setTurn(half, 'turn-6', { kind: 'rotate', rotate: { amount: 'half', direction: 'ccw' } })).toBe(half);
    expect(setTurn(half, 'step-2', { kind: 'turn-over', axis: 'vertical' })).toBe(half);
  });

  it('moves a step to a number counting steps alone, a turn before that step staying before it', () => {
    const { diagram } = turning();
    // Step 3 to number 2: before step-3, and after the turn before it.
    const moved = moveStep(diagram, 'step-4', indexForStepNumber(diagram, 'step-4', 2));
    expect(moved.steps.map((entry) => entry.id)).toEqual(['step-2', 'turn-5', 'step-4', 'step-3', 'turn-6']);
    // Step 1 to the last number: after the last step, before the turn after it.
    const last = moveStep(diagram, 'step-2', indexForStepNumber(diagram, 'step-2', 3));
    expect(last.steps.map((entry) => entry.id)).toEqual(['turn-5', 'step-3', 'step-4', 'step-2', 'turn-6']);
  });

  it('pulls a turn-over card as a turn, never into the step it fills', () => {
    const { diagram, ids } = diagramWith(1);
    const [empty] = stepIds(diagram);
    const sent: SentReferencesEntry[] = [
      { kind: 'turn-over', axis: 'vertical' },
      { source: referencesSource({ card: 1 }), picture: stepDiagramPicture(), text: 'Fold 1.' },
      { kind: 'turn-over', axis: 'vertical' },
      { source: referencesSource({ card: 2 }), picture: stepDiagramPicture(), text: 'Fold 2.' },
    ];
    const { document, stepIds: made, turnIds } = pullReferencesSteps(diagram, sent, { kind: 'fill', stepId: empty! }, { newId: ids });
    // The turn before the first card goes before the step it fills; the rest after it, in order.
    expect(document.steps.map((entry) => entry.id)).toEqual([turnIds[0], empty, turnIds[1], made[1]]);
    expect(made[0]).toBe(empty);
    expect(stepsOf(document).map((step) => step.text)).toEqual(['Fold 1.', 'Fold 2.']);
  });

  it('puts a turn-over pulled alone for an empty step before it, the step left for a card', () => {
    const { diagram, ids } = diagramWith(1);
    const [empty] = stepIds(diagram);
    const result = pullReferencesSteps(diagram, [{ kind: 'turn-over', axis: 'vertical' }], { kind: 'fill', stepId: empty! }, { newId: ids });
    expect(result.stepIds).toEqual([]);
    expect(result.document.steps.map((entry) => entry.id)).toEqual([result.turnIds[0], empty]);
  });
});
