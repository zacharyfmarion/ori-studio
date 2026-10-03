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
  uploadPictureKey,
  mirrorPose,
  poseBlocker,
  rotatePose,
  setUploadPose,
  type DiagramDocument,
  type DiagramIdFactory,
  type DiagramStep,
  type KnownDiagramAsset,
} from './diagramDocument';

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
