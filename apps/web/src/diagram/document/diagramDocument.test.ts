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
  stepDiagramKey,
  DEFAULT_SIMULATED_VIEW,
  renderToShowAs,
  setLinkedPicture,
  showAsOf,
  withRememberedPoses,
  type SentReferencesStep,
  type DiagramDocument,
  type DiagramIdFactory,
  type DiagramStep,
  type KnownDiagramAsset,
} from './diagramDocument';
import { cpSource, referencesSource, referencesStep, scenePicture, stepDiagramPicture } from './diagramSteps.fixtures';

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

const stepIds = (diagram: DiagramDocument) => diagram.steps.map((step) => step.id);

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
      steps: withText.steps.map((step) =>
        step.id === 'step-2'
          ? { ...step, revision: 4, annotations: [{ id: 'a', unknown: { id: 'a', kind: 'x' } }] }
          : step
      ),
    };
    const result = duplicateStep(annotated, 'step-2', ids);
    expect(result).not.toBeNull();
    const { document, stepId } = result!;
    expect(stepIds(document)).toEqual(['step-2', stepId, 'step-3']);
    const copy = document.steps[1];
    expect(copy).toMatchObject({ text: 'Fold in half', revision: 0 });
    expect(copy.annotations[0].id).not.toBe('a');
  });

  it('keeps a new page with the original: the copy follows it on that page', () => {
    const { diagram, ids } = diagramWith(2);
    const breaking = setStepBreakBefore(diagram, 'step-3', true);
    const { document } = duplicateStep(breaking, 'step-3', ids)!;
    // step-2, step-3 (starting its page), and its copy after it on that page.
    expect(document.steps.map((step) => step.breakBefore)).toEqual([false, true, false]);
  });

  it('refuses a missing or locked step', () => {
    const { diagram } = diagramWith(1);
    expect(duplicateStep(diagram, 'missing')).toBeNull();
    const locked: DiagramDocument = {
      ...diagram,
      steps: [{ ...diagram.steps[0], unknown: { id: diagram.steps[0].id } }],
    };
    expect(duplicateStep(locked, diagram.steps[0].id)).toBeNull();
  });
});

describe('step and document fields', () => {
  it('sets text, normalized, and is a no-op when unchanged', () => {
    const { diagram } = diagramWith(1);
    const next = setStepText(diagram, 'step-2', 'Fold\u0000 the corner');
    expect(next.steps[0].text).toBe('Fold the corner');
    expect(setStepText(next, 'step-2', 'Fold the corner')).toBe(next);
  });

  it('never edits a locked step', () => {
    const { diagram } = diagramWith(1);
    const lockedStep: DiagramStep = { ...diagram.steps[0], unknown: { id: 'step-2' } };
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
    expect(setStepBreakBefore(diagram, 'step-2', true).steps[0].breakBefore).toBe(true);
  });
});

describe('page setup', () => {
  it('clamps every field to its range and keeps the rest', () => {
    const { diagram } = diagramWith(0);
    const next = setPageSetup(diagram, { columns: 9, rows: 0, marginMm: -4 });
    expect(next.page).toMatchObject({ columns: 5, rows: 1, marginMm: 0, size: 'a4' });
    expect(setPageSetup(diagram, { columns: 3 })).toBe(diagram);
  });

  it('reads anything, falling back field by field', () => {
    expect(normalizePageSetup(null)).toEqual(DEFAULT_PAGE_SETUP);
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
    const at = insertionIndex(diagram, diagram.steps[0].id);
    const { document, stepIds } = insertPictureSteps(diagram, [svgAsset('a'), svgAsset('b')], at, ids);
    expect(document.steps.map((step) => step.id)).toEqual([
      diagram.steps[0].id,
      ...stepIds,
      diagram.steps[1].id,
    ]);
    expect(document.steps[1]).toMatchObject({
      source: { kind: 'upload', assetId: 'a', rotationQuarterTurns: 0, mirrored: false },
      picture: { kind: 'asset', assetId: 'a', paperScale: null, key: uploadPictureKey('a') },
      text: '',
    });
    expect(Object.keys(document.assets)).toEqual(['a', 'b']);
    expect(stepAsset(document, document.steps[2])?.id).toBe('b');
    // The original is untouched.
    expect(diagram.assets).toEqual({});
  });

  it('replaces a step’s picture, keeping its words, and bumps its revision', () => {
    const { diagram } = diagramWith(1);
    const stepId = diagram.steps[0].id;
    const withText = setStepText(diagram, stepId, 'Fold in half.');
    const first = setStepPicture(withText, stepId, svgAsset('a'));
    const second = setStepPicture(first, stepId, svgAsset('b'));
    expect(second.steps[0]).toMatchObject({ text: 'Fold in half.', revision: 2 });
    expect(stepAsset(second, second.steps[0])?.id).toBe('b');
    // The edit itself keeps the old asset; the store prunes it as the edit lands.
    expect(Object.keys(second.assets)).toEqual(['a', 'b']);
    expect(Object.keys(withReferencedAssets(second).assets)).toEqual(['b']);
  });

  it('removes a picture and its source, keeping the words, and is a no-op without one', () => {
    const { diagram } = diagramWith(1);
    const stepId = diagram.steps[0].id;
    expect(removeStepPicture(diagram, stepId)).toBe(diagram);
    const pictured = setStepText(setStepPicture(diagram, stepId, svgAsset('a')), stepId, 'Turn over.');
    const removed = removeStepPicture(pictured, stepId);
    expect(stepHasPicture(removed.steps[0])).toBe(false);
    expect(removed.steps[0]).toMatchObject({ text: 'Turn over.', revision: 2 });
  });

  it('never gives a locked step a picture', () => {
    const { diagram } = diagramWith(1);
    const locked = {
      ...diagram,
      steps: [{ ...diagram.steps[0], unknown: { id: diagram.steps[0].id, source: { kind: 'later' } } }],
    };
    expect(setStepPicture(locked, locked.steps[0].id, svgAsset('a'))).toBe(locked);
    expect(stepAsset(locked, locked.steps[0])).toBeNull();
  });

  it('shares a duplicated step’s asset rather than copying it', () => {
    const { diagram, ids } = diagramWith(0);
    const { document } = insertPictureSteps(diagram, [svgAsset('a')], 0, ids);
    const copy = duplicateStep(document, document.steps[0].id, ids)!;
    expect(Object.keys(copy.document.assets)).toEqual(['a']);
    expect(stepAsset(copy.document, copy.document.steps[1])).toBe(stepAsset(document, document.steps[0]));
  });

  it('counts a picture as content worth asking about', () => {
    const { diagram } = diagramWith(1);
    const stepId = diagram.steps[0].id;
    expect(stepHasContent(setStepPicture(diagram, stepId, svgAsset('a')).steps[0])).toBe(true);
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
    const step = document.steps[0]!;
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
    expect(posed.steps[0]).toMatchObject({
      source: { kind: 'upload', assetId: 'a', rotationQuarterTurns: 1, mirrored: true },
      revision: 1,
    });
    expect(setUploadPose(posed, stepIds[0], { rotationQuarterTurns: 1, mirrored: true })).toBe(posed);
  });

  it('refuses a step that is not an upload, or carries annotations it cannot turn', () => {
    const { diagram, ids } = diagramWith(1);
    expect(poseBlocker(diagram.steps[0])).toBe('not-upload');
    const { document, stepIds } = insertPictureSteps(diagram, [svgAsset('a')], 1, ids);
    const annotated = {
      ...document,
      steps: document.steps.map((step) =>
        step.id === stepIds[0]
          ? { ...step, annotations: [{ id: 'annotation-x', unknown: { id: 'annotation-x', kind: 'later' } }] }
          : step
      ),
    };
    expect(poseBlocker(annotated.steps[1])).toBe('unknown-annotations');
    expect(setUploadPose(annotated, stepIds[0], { rotationQuarterTurns: 2, mirrored: false })).toBe(annotated);
  });
});

describe('steps pulled from References (D20)', () => {
  const card = (n: number): SentReferencesStep => ({
    source: referencesSource({ card: n }),
    picture: stepDiagramPicture(),
    text: `Fold ${n}.`,
  });
  const ids = (document: DiagramDocument) => document.steps.map((step) => step.id);
  function withSteps(...steps: DiagramStep[]): DiagramDocument {
    return insertSteps(createDiagram({ title: 'T', newId: sequentialIds() }), steps, 0);
  }

  it('puts the cards after a step, or at the end, in order', () => {
    const document = withSteps(createStep(() => 'step-a'), createStep(() => 'step-b'));
    const after = pullReferencesSteps(document, [card(1), card(2)], { kind: 'after', stepId: 'step-a' }, { newId: sequentialIds() });
    expect(ids(after.document)).toEqual(['step-a', ...after.stepIds, 'step-b']);
    expect(after.document.steps[1]).toMatchObject({ source: { card: 1 }, text: 'Fold 1.' });
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
    expect(pulled.document.steps[1]).toMatchObject({ source: { card: 1 }, text: 'Mine.', revision: 1 });
    // An empty instruction takes the card's sentence, as the file keeps text.
    const blank = withSteps(createStep(() => 'step-e'));
    const sentence = { ...card(3), text: 'Fold 3.\u000B' };
    expect(pullReferencesSteps(blank, [sentence], { kind: 'fill', stepId: 'step-e' }).document.steps[0]?.text).toBe('Fold 3.');
    // One that got a picture since is not filled: the cards go after it.
    const pictured = withSteps(referencesStep('step-e'));
    const after = pullReferencesSteps(pictured, [card(1)], { kind: 'fill', stepId: 'step-e' }, { newId: sequentialIds() });
    expect(ids(after.document)).toEqual(['step-e', after.stepIds[0]]);
  });

  it('replaces a References step’s card, its words only while they are still the old card’s', () => {
    const own = { ...referencesStep('step-r'), text: 'Fold the old way.' };
    const document = withSteps(own, createStep(() => 'step-b'));
    const replaced = pullReferencesSteps(
      document,
      [card(7)],
      { kind: 'replace', stepId: 'step-r', sentence: 'Fold the old way.' },
      { newId: sequentialIds() }
    );
    expect(replaced.stepIds).toEqual(['step-r']);
    expect(replaced.document.steps[0]).toMatchObject({ source: { card: 7 }, text: 'Fold 7.' });
    const edited = pullReferencesSteps(
      document,
      [card(7)],
      { kind: 'replace', stepId: 'step-r', sentence: 'Something else.' },
      { newId: sequentialIds() }
    );
    expect(edited.document.steps[0]).toMatchObject({ source: { card: 7 }, text: 'Fold the old way.' });
    // Not a References step: nothing replaced, the card goes after it.
    const plain = withSteps(createStep(() => 'step-p'));
    const after = pullReferencesSteps(plain, [card(7)], { kind: 'replace', stepId: 'step-p', sentence: null }, { newId: sequentialIds() });
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
    expect(turned.steps[0]?.picture).toMatchObject({ mirrored: true, key: 'steps-1-back' });
    expect(turned.steps[0]?.source).toMatchObject({ side: 'front' });
    const back = setReferencesSide(turned, 'step-r', false);
    expect(back.steps[0]?.picture).toMatchObject({ mirrored: false, key: 'steps-1' });
    // No change is no edit.
    expect(setReferencesSide(document, 'step-r', false)).toBe(document);
    expect(setReferencesSide(withSteps(createStep(() => 'step-e')), 'step-e', true).steps[0]?.picture).toBeNull();
  });

  it('marks a key for the back once, whichever side it starts from', () => {
    expect(stepDiagramKey('steps-x', true)).toBe('steps-x-back');
    expect(stepDiagramKey('steps-x-back', true)).toBe('steps-x-back');
    expect(stepDiagramKey('steps-x-back', false)).toBe('steps-x');
  });
});

describe('editStepAnnotations', () => {
  function pictured() {
    const { diagram, ids } = diagramWith(0);
    const { document } = insertPictureSteps(diagram, [svgAsset('pic')], 0, ids);
    return { document, stepId: document.steps[0]!.id };
  }
  const label = { id: 'l', kind: 'label' as const, from: [0.5, 0.5] as [number, number], to: [0.5, 0.5] as [number, number], text: 'A' };

  it('writes them as this build reads them: within reach, a label’s text clean and on one line', () => {
    const { document, stepId } = pictured();
    const edited = editStepAnnotations(document, stepId, () => [
      { ...label, text: 'A\u000bB\nC', to: [9, 9] },
      { id: 'v', kind: 'valley-line', from: [-7, 0], to: [1, 9] },
    ]);
    expect(edited.steps[0]!.annotations).toEqual([
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
    expect(full.steps[0]!.annotations).toHaveLength(500);
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
    expect(renderToShowAs({ render: flat }, 'crease-pattern')).toEqual({ mode: 'crease-pattern', rotationDeg: 30 });
    const threeD = { mode: 'folded-3d' as const, camera: { yaw: 1, pitch: 0, zoom: 1 }, side: 'front' as const };
    expect(renderToShowAs({ render: threeD }, 'crease-pattern')).toEqual({ mode: 'crease-pattern', rotationDeg: 0 });
    expect(showAsOf(threeD)).toBe('folded');
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
    expect(shown.steps[0]!.source).toMatchObject({ render: pattern, remembered: { folded: flat } });
    expect(setLinkedPicture(shown, 'step-1', { source: cpSource(pattern), picture: scenePicture('b') })).toBe(shown);
  });
});
