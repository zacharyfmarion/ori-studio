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
  type DiagramDocument,
  type DiagramIdFactory,
  type DiagramStep,
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
