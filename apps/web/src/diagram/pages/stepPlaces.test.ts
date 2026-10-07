import { describe, expect, it } from 'vitest';
import {
  createDiagram,
  createStep,
  createTurn,
  duplicateStep,
  editStepAnnotations,
  indexForStepNumber,
  insertPictureSteps,
  insertSteps,
  isTurn,
  moveStep,
  pullReferencesSteps,
  removeStepPicture,
  removeSteps,
  setDiagramStyle,
  setDiagramTitle,
  setLinkedPicture,
  setPageSetup,
  setStepBreakBefore,
  setStepPicture,
  setStepText,
  setUploadPose,
  stepById,
  stepIndex,
  stepToTurn,
  stepsOf,
  turnById,
  type DiagramDocument,
  type DiagramPageSetup,
  type DiagramRasterAsset,
  type DiagramStep,
  type DiagramStepPlace,
} from '../document/diagramDocument';
import { cpSource, cpStep, fixedPicture, referencesSource, scenePicture, stepDiagramPicture } from '../document/diagramSteps.fixtures';
import { layoutDiagram } from './diagramPages';
import { estimateTextSetter } from './estimateTextSetter';
import { flowPagePlan } from './flowLane';
import { pageLayoutFixtures } from './pageLayouts.fixtures';
import { cellSlots, sameCell, settlePlaces } from './stepPlaces';

/**
 * Which cell each step prints in, and Decision 1A's one rule: a frame moved
 * by hand is kept while its step stays in its cell, and sent home when the
 * cell changes, whatever changed it (`implementation-plans/
 * diagram-page-overrides.md`, "When an override clears"). One case per row
 * of the clearing table.
 */

describe('cellSlots', () => {
  it.each(pageLayoutFixtures().map(({ name, document }) => [name, document] as const))(
    'puts every step in the cell the layout does: %s',
    (_name, document) => {
      const cells = cellSlots(document);
      const pages = layoutDiagram(document, estimateTextSetter).pages;
      expect(cells.pages).toEqual(pages.map((page) => page.cells.map((cell) => cell.stepId)));
      for (const [index, page] of pages.entries()) {
        page.cells.forEach((cell, k) => expect(cells.slots.get(cell.stepId)).toEqual({ page: index, first: page.cells[0]!.stepId, k }));
      }
      expect(cells.slots.size).toBe(stepsOf(document).length);
    }
  );

  it('keeps a step in its cell while its place on its page holds, the page keeping its number or the step it starts with', () => {
    const two = (ids: readonly string[], page: Partial<DiagramPageSetup> = {}) =>
      cellSlots(setPageSetup(insertSteps(createDiagram(), ids.map((id) => cpStep(id)), 0), { layout: 'grid', columns: 2, rows: 1, ...page }));
    const was = two(['a', 'b', 'c', 'd']);
    expect(sameCell(was, was, 'b')).toBe(true);
    expect(sameCell(was, was, 'gone')).toBe(false);
    // Swapped on its page: another place there.
    expect(sameCell(was, two(['a', 'b', 'd', 'c']), 'd')).toBe(false);
    // b and c swap pages: page two starts with b now but keeps its number, so d is in its cell; c is not.
    expect(sameCell(was, two(['a', 'c', 'b', 'd']), 'd')).toBe(true);
    expect(sameCell(was, two(['a', 'c', 'b', 'd']), 'c')).toBe(false);
    // Another shape or layout is another cell.
    expect(sameCell(was, two(['a', 'b', 'c', 'd'], { columns: 1, rows: 2 }), 'b')).toBe(false);
    expect(sameCell(was, two(['a', 'b', 'c', 'd'], { layout: 'flow' }), 'b')).toBe(false);
  });

  it('follows a page renumbered by a page break, by the step it starts with', () => {
    const steps = ['a', 'b', 'c', 'd'].map((id) => ({ ...cpStep(id), breakBefore: id === 'c' }));
    const before = setPageSetup(insertSteps(createDiagram(), steps, 0), { layout: 'grid', columns: 2, rows: 1 });
    // A step put in at the front adds a page: c's is page three now, and still starts with c.
    const after = insertSteps(before, [cpStep('x')], 0);
    expect(cellSlots(after).slots.get('d')).toEqual({ page: 2, first: 'c', k: 1 });
    expect(sameCell(cellSlots(before), cellSlots(after), 'd')).toBe(true);
    expect(sameCell(cellSlots(before), cellSlots(after), 'b')).toBe(false);
  });
});

/** An upload's table entry: what a step made from it, or given it, refers to. */
const RASTER: DiagramRasterAsset = { id: 'asset-1', kind: 'raster', src: 'data:image/png;base64,AA==', widthPx: 20, heightPx: 10, bytes: 24 };

/** The placement every step starts with: a frame moved, two parts moved, a pin. */
const PLACE: DiagramStepPlace = { frame: [2, 1], number: [1, 0], text: [0, 1.5], scale: { mmPerUnit: 0.3 } };
const { frame: _frame, ...PARTS } = PLACE;

/**
 * Steps `s0`… on a 3 × 3 grid, each placed: two full pages and a third
 * started by a page break at `s13` — so a shift from page one stops at the
 * end of page two.
 */
function placed(count = 16, page: Partial<DiagramPageSetup> = {}, breaks: readonly number[] = [13]): DiagramDocument {
  const steps = Array.from({ length: count }, (_, index) => ({ ...cpStep(`s${index}`), place: PLACE, breakBefore: breaks.includes(index) }));
  return setPageSetup(insertSteps(createDiagram({ title: 'Crane', newId: () => 'diagram-1' }), steps, 0), {
    layout: 'grid',
    columns: 3,
    rows: 3,
    ...page,
  });
}

const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => `s${from + index}`);

/**
 * What settling `after` against `before` did: the steps whose frames went
 * home, in order; checked on the way that it touched nothing else — every
 * pin and part offset, and every step it did not send home, as they were.
 */
function settle(before: DiagramDocument, after: DiagramDocument): string[] {
  const { document, settled } = settlePlaces(before, after);
  const home: string[] = [];
  for (const [index, entry] of document.steps.entries()) {
    const edited = after.steps[index]!;
    if (isTurn(entry) || isTurn(edited)) {
      expect(entry).toBe(edited);
      continue;
    }
    if (entry === edited) continue;
    expect(edited.place?.frame).toBeDefined();
    const { frame: _home, ...rest } = edited.place ?? {};
    expect(entry.place).toEqual(Object.keys(rest).length > 0 ? rest : undefined);
    expect({ ...entry, place: undefined }).toEqual({ ...edited, place: undefined });
    home.push(entry.id);
  }
  expect(settled).toBe(home.length);
  if (settled === 0) expect(document).toBe(after);
  return home;
}

describe('settlePlaces: a frame goes home when its step lands in another cell (Decision 1A)', () => {
  it('its own move: Move Earlier, Move to, a reorder — and the steps it passed, whose cells it took', () => {
    const before = placed();
    expect(settle(before, moveStep(before, 's5', stepIndex(before, 's4')))).toEqual(['s5', 's4']);
    // Moved to be step 2: it, and every step it passed, in their new order.
    expect(settle(before, moveStep(before, 's7', indexForStepNumber(before, 's7', 2)))).toEqual(['s7', ...ids(1, 6)]);
    // Across the page: every step it passed changed cell. Page two starts with another step now, but
    // keeps its number, and s12 its place on it.
    const across = moveStep(before, 's2', stepIndex(before, 's11'));
    expect(settle(before, across).sort()).toEqual(ids(2, 11).sort());
  });

  it('a swap that changes the step a page starts with sends home only the two that swapped', () => {
    const before = placed();
    // Move Earlier on a page's second step.
    expect(settle(before, moveStep(before, 's1', stepIndex(before, 's0')))).toEqual(['s1', 's0']);
    expect(settle(before, moveStep(before, 's10', stepIndex(before, 's9')))).toEqual(['s10', 's9']);
    // Move Later on a page's last step, which then starts the next page.
    expect(settle(before, moveStep(before, 's8', stepIndex(before, 's9')))).toEqual(['s9', 's8']);
  });

  it.each([
    ['a step inserted', (document: DiagramDocument) => insertSteps(document, [createStep(() => 'new')], 2)],
    ['a step duplicated', (document: DiagramDocument) => duplicateStep(document, 's1', () => 'copy')!.document],
    ['a picture uploaded', (document: DiagramDocument) => insertPictureSteps(document, [RASTER], 2, () => 'upload').document],
    [
      'a card pulled from References',
      (document: DiagramDocument) =>
        pullReferencesSteps(document, [{ source: referencesSource(), picture: stepDiagramPicture(), text: 'Fold.' }], { kind: 'after', stepId: 's1' }, { newId: () => 'card' }).document,
    ],
  ])('%s before it, as far as the shift reaches: a page that ends in a page break stops it', (_label, edit) => {
    const before = placed();
    // s2–s8 move along page one; s8 goes to page two, which now starts at it, so all of page two is new.
    expect(settle(before, edit(before))).toEqual(ids(2, 12));
  });

  it.each([
    ['deleted', (document: DiagramDocument) => removeSteps(document, ['s1'])],
    [
      'made into a turn',
      (document: DiagramDocument) => stepToTurn({ ...document, steps: document.steps.map((each) => (each.id === 's1' ? { ...createStep(() => 's1'), place: PLACE } : each)) }, 's1', { kind: 'turn-over', axis: 'vertical' })!.document,
    ],
  ])('a step %s before it, as far as the shift reaches', (_label, edit) => {
    const before = placed();
    expect(settle(before, edit(before))).toEqual(ids(2, 12));
  });

  it('a duplicate’s copy keeps no frame offset: it is a new step, with no cell to keep', () => {
    const before = placed(4, {}, []);
    const { document } = duplicateStep(before, 's3', () => 'copy')!;
    expect(stepById(document, 'copy')!.place).toEqual(PARTS);
    // Even given one, it would go: a step that was in no cell before is not in the one it had.
    const framed = { ...document, steps: document.steps.map((each) => (each.id === 'copy' ? { ...each, place: PLACE } : each)) };
    expect(settle(before, framed)).toEqual(['copy']);
  });

  it('keeps every frame through steps added, deleted or moved after it', () => {
    const before = placed();
    expect(settle(before, insertSteps(before, [createStep(() => 'end')], before.steps.length))).toEqual([]);
    expect(settle(before, removeSteps(before, ['s15']))).toEqual([]);
    // Moved among themselves after the others: only the two that swapped.
    expect(settle(before, moveStep(before, 's15', stepIndex(before, 's14')))).toEqual(['s15', 's14']);
  });

  it('keeps every frame through a turn added, removed or moved: a turn takes no cell', () => {
    const before = placed();
    const turned = insertSteps(before, [createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn')], 3);
    expect(settle(before, turned)).toEqual([]);
    expect(settle(turned, moveStep(turned, 'turn', 10))).toEqual([]);
    expect(settle(turned, removeSteps(turned, ['turn']))).toEqual([]);
  });

  it('a new page started at or before it on its page, or cleared where the shift reaches it', () => {
    const before = placed();
    // At s4: page one ends at s3, and s4–s12 make a new page two, the break at s13 still holding.
    expect(settle(before, setStepBreakBefore(before, 's4', true))).toEqual(ids(4, 12));
    // On the step itself, which then starts the page.
    expect(settle(before, setStepBreakBefore(before, 's11', true))).toEqual(ids(11, 12));
    // Cleared at s13: s13–s15 run on page two.
    expect(settle(before, setStepBreakBefore(before, 's13', false))).toEqual(ids(13, 15));
  });

  it('keeps a frame through a new page started on a later step, or set where a page already starts', () => {
    const before = placed();
    // At s7: s0–s6 stay where they were.
    expect(settle(before, setStepBreakBefore(before, 's7', true))).toEqual(ids(7, 12));
    // s9 starts page two already: saying so moves no step.
    expect(settle(before, setStepBreakBefore(before, 's9', true))).toEqual([]);
  });

  it.each([
    ['the columns change', 'grid', { columns: 4 }],
    ['the rows change', 'grid', { rows: 2 }],
    ['the steps per page change', 'flow', { stepsPerPage: 12 }],
    // 9 steps are 3 × 3 on A4 portrait, and 5 × 2 on its side.
    ['the orientation changes a flow page’s shape', 'flow', { orientation: 'landscape' }],
    ['the grid becomes the flow', 'grid', { layout: 'flow' }],
    ['the flow becomes the grid', 'flow', { layout: 'grid' }],
  ] as const)('sends every frame home when %s: every cell changed shape', (_label, layout, patch) => {
    const before = placed(16, { layout });
    expect(settle(before, setPageSetup(before, patch))).toEqual(ids(0, 15));
  });

  it('sends a flow page’s frames home when its steps per page change, though the shape they make does not', () => {
    // 7 and 8 steps are both 3 × 3 on A4 portrait; the eighth cell takes a step that was on page two.
    const before = placed(16, { layout: 'flow', stepsPerPage: 7 }, []);
    expect(cellSlots(before)).toMatchObject({ columns: 3, rows: 3, perPage: 7 });
    expect(cellSlots(setPageSetup(before, { stepsPerPage: 8 }))).toMatchObject({ columns: 3, rows: 3, perPage: 8 });
    expect(settle(before, setPageSetup(before, { stepsPerPage: 8 }))).toEqual(ids(0, 15));
  });

  it('keeps a flow page’s frames through a paper, orientation or margin that leaves its shape as it was', () => {
    // 9 steps are 3 × 3 on A4 and on Letter, upright, and at a margin of 25 mm.
    const before = placed(16, { layout: 'flow' });
    for (const patch of [{ size: 'letter' }, { marginMm: 25 }] as const) {
      expect(cellSlots(setPageSetup(before, patch))).toMatchObject({ columns: 3, rows: 3 });
      expect(settle(before, setPageSetup(before, patch))).toEqual([]);
    }
    // 6 steps are 2 × 3 upright, 3 × 2 on its side, on A4 and on Letter alike.
    const six = placed(16, { layout: 'flow', stepsPerPage: 6, orientation: 'landscape' });
    expect(settle(six, setPageSetup(six, { size: 'letter' }))).toEqual([]);
    // The grid's shape is its own, whatever the paper.
    const grid = placed(16);
    expect(settle(grid, setPageSetup(grid, { orientation: 'landscape' }))).toEqual([]);
    // A flow page's columns and rows say nothing: its steps per page do.
    expect(settle(before, setPageSetup(before, { columns: 4, rows: 2 }))).toEqual([]);
  });

  it('keeps every frame through the first page’s side, and a page added after its own that turns its rows', () => {
    const before = placed(16, { layout: 'flow' });
    expect(settle(before, setPageSetup(before, { firstPageSide: 'right' }))).toEqual([]);
    // Two rows: appending a page makes the last page's exit the spine, and turns every row of it.
    const one = placed(4, { layout: 'flow', stepsPerPage: 4 }, []);
    expect(flowPagePlan(0, 1, 'left', 2)).not.toEqual(flowPagePlan(0, 2, 'left', 2));
    expect(settle(one, insertSteps(one, [createStep(() => 'next')], one.steps.length))).toEqual([]);
    // A page removed after its own.
    const two = placed(5, { layout: 'flow', stepsPerPage: 4 }, []);
    expect(settle(two, removeSteps(two, ['s4']))).toEqual([]);
  });

  it.each([
    ['paper size', { size: 'letter' }],
    ['margin', { marginMm: 25 }],
    ['title shown', { showTitle: false }],
    ['page numbers', { pageNumbers: { enabled: false, first: 4 } }],
    ['path width', { pathWidthMm: 20 }],
    ['path colour', { pathColor: '#d6e8f5' }],
    ['path shown', { showPath: false }],
  ] as const)('keeps every frame through the %s', (_label, patch) => {
    const before = placed(16, { layout: 'flow' });
    expect(settle(before, setPageSetup(before, patch))).toEqual([]);
  });

  it('keeps every frame through the title, the style and an instruction', () => {
    const before = placed();
    expect(settle(before, setDiagramTitle(before, 'Swan'))).toEqual([]);
    expect(settle(before, setDiagramStyle(before, { preset: 'default' }))).toEqual([]);
    expect(settle(before, setStepText(before, 's3', 'A much longer instruction that will be cut to its box at last.'))).toEqual([]);
  });

  it('keeps all of it through a picture refreshed, recaptured, shown as another kind and back, re-posed or annotated', () => {
    const before = placed();
    const steps = (document: DiagramDocument) => stepsOf(document).map((step) => step.place);
    const refreshed = setLinkedPicture(before, 's2', { source: cpSource(), picture: scenePicture('scene-2') });
    const flat = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 0, foldCase: 1 };
    const shownAs = setLinkedPicture(refreshed, 's2', { source: cpSource(flat), picture: fixedPicture('flat-1') });
    const back = setLinkedPicture(shownAs, 's2', { source: cpSource(), picture: scenePicture('scene-3') });
    const label = { id: 'label-1', kind: 'label' as const, from: [0.5, 0.5] as [number, number], to: [0.5, 0.5] as [number, number], text: 'A' };
    const annotated = editStepAnnotations(back, 's2', () => [label]);
    const uploaded = setStepPicture(annotated, 's3', RASTER);
    const posed = setUploadPose(uploaded, 's3', { rotationQuarterTurns: 1, mirrored: true });
    const edits = [before, refreshed, shownAs, back, annotated, uploaded, posed];
    edits.slice(1).forEach((after, index) => {
      expect(after).not.toBe(edits[index]);
      expect(settle(edits[index]!, after)).toEqual([]);
      expect(steps(after)).toEqual(steps(before));
    });
  });

  it('takes the step’s placement with it when it is deleted or made into a turn', () => {
    // The last step, empty so that it can become a turn: no other step changes cell.
    const four = placed(4, {}, []);
    const before = { ...four, steps: four.steps.map((each) => (each.id === 's3' ? { ...createStep(() => 's3'), place: PLACE } : each)) };
    expect(stepById(settlePlaces(before, removeSteps(before, ['s3'])).document, 's3')).toBeNull();
    const turned = stepToTurn(before, 's3', { kind: 'turn-over', axis: 'vertical' }, () => 'turn-3')!.document;
    expect(Object.keys(turnById(settlePlaces(before, turned).document, 'turn-3')!)).not.toContain('place');
  });

  it('keeps all of it, the pin included, when the picture goes, changes kind or the step is enlarged: a pin of another kind sleeps', () => {
    const before = placed();
    const removed = removeStepPicture(before, 's2');
    expect(settle(before, removed)).toEqual([]);
    expect(stepById(removed, 's2')!.place).toEqual(PLACE);
    const uploaded = setStepPicture(before, 's2', RASTER);
    expect(settle(before, uploaded)).toEqual([]);
    expect(stepById(uploaded, 's2')!.place).toEqual(PLACE);
    const enlarged = { ...before, steps: before.steps.map((each) => (each.id === 's2' ? { ...each, zoom: { from: 'area-1', shape: 'circle' as const } } : each)) };
    expect(settle(before, enlarged)).toEqual([]);
  });

  it('touches nothing when no step has its frame moved, however much the cells change', () => {
    const plain = (document: DiagramDocument) => ({
      ...document,
      steps: document.steps.map((each) => (isTurn(each) ? each : { ...each, place: PARTS })),
    });
    const before = plain(placed());
    const after = setPageSetup(insertSteps(before, [createStep(() => 'new')], 0), { columns: 5 });
    expect(settlePlaces(before, after).document).toBe(after);
  });

  it('carries a newer build’s step as it is', () => {
    const locked: DiagramStep = { ...createStep(() => 'locked'), unknown: { id: 'locked', place: { frame: [4, 4] } } };
    const before = insertSteps(placed(), [locked], 0);
    const after = insertSteps(before, [createStep(() => 'new')], 0);
    expect(stepById(settlePlaces(before, after).document, 'locked')).toBe(locked);
  });

  it('sends a newer build’s frame home too, keeping the rest of its placement as it came', () => {
    const newer: DiagramStep = { ...cpStep('newer'), placeNewer: { frame: [3, 3], tilt: 1 } };
    const before = insertSteps(placed(4, {}, []), [newer], 0);
    // In its cell, it is kept as it came.
    const kept = settlePlaces(before, setStepText(before, 's2', 'Fold.'));
    expect(stepById(kept.document, 'newer')).toBe(newer);
    // Moved to another cell, its frame goes home with the others, and is counted.
    const { document, settled } = settlePlaces(before, insertSteps(before, [createStep(() => 'new')], 0));
    expect(stepById(document, 'newer')!.placeNewer).toEqual({ tilt: 1 });
    expect(settled).toBe(5);
  });
});

describe('settlePlaces against the printed grid', () => {
  /** Where each step prints: its page, the step that page starts with, and its cell's corner on the page. */
  const printedAt = (document: DiagramDocument) =>
    new Map(
      layoutDiagram(document, estimateTextSetter).pages.flatMap((page, index) =>
        page.cells.map((cell) => [cell.stepId, { page: index, first: page.cells[0]!.stepId, at: `${cell.cellMm.x.toFixed(3)} ${cell.cellMm.y.toFixed(3)}` }] as const)
      )
    );

  it('sends a frame home exactly when its step prints elsewhere on its page, or on a page that is not its own renumbered', () => {
    let seed = 20261007;
    const pick = (count: number) => {
      seed = (seed * 16807) % 2147483647;
      return Math.floor((seed / 2147483647) * count);
    };
    const framed = (document: DiagramDocument) => ({ ...document, steps: document.steps.map((each) => (isTurn(each) ? each : { ...each, place: PLACE })) });
    let before = placed(16, {}, [13]);
    let sentHome = 0;
    let kept = 0;
    for (let round = 0; round < 80; round += 1) {
      const steps = stepsOf(before);
      const id = steps[pick(steps.length)]!.id;
      const edits = [
        () => moveStep(before, id, pick(before.steps.length)),
        () => insertSteps(before, [{ ...cpStep(`new-${round}`), place: PLACE }], pick(before.steps.length + 1)),
        () => (steps.length > 6 ? removeSteps(before, [id]) : moveStep(before, id, 0)),
        () => setStepBreakBefore(before, id, !stepById(before, id)!.breakBefore),
      ];
      const after = edits[pick(edits.length)]!();
      const [was, now] = [printedAt(before), printedAt(after)];
      const { document } = settlePlaces(before, after);
      for (const step of stepsOf(document)) {
        const [from, to] = [was.get(step.id), now.get(step.id)!];
        const same = from !== undefined && from.at === to.at && (from.page === to.page || from.first === to.first);
        expect({ step: step.id, round, kept: step.place?.frame !== undefined }).toEqual({ step: step.id, round, kept: same });
        if (same) kept += 1;
        else sentHome += 1;
      }
      before = framed(document);
    }
    // The walk sent frames home, and kept them through edits too.
    expect(sentHome).toBeGreaterThan(100);
    expect(kept).toBeGreaterThan(500);
  });
});
