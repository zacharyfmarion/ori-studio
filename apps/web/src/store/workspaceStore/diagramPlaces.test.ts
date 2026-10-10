import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDiagram,
  createStep,
  insertSteps,
  setPageSetup,
  stepById,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepPlace,
} from '../../diagram/document/diagramDocument';
import { cpStep } from '../../diagram/document/diagramSteps.fixtures';
import { useWorkspaceStore } from '../workspaceStore';

/**
 * Placing steps by hand on the printed pages, through the store
 * (`implementation-plans/diagram-page-overrides.md`, Phase 1): the verbs and
 * their undo steps, what they refuse, and frames sent home inside the edit
 * that moved their steps.
 */

const state = () => useWorkspaceStore.getState();
const placeOf = (id: string) => stepById(state().diagram!, id)?.place;
const undoSteps = () => state().diagramHistory.past.length;

const PLACE: DiagramStepPlace = { frame: [2, 1], text: [0, 1.5], scale: { mmPerUnit: 0.3 } };

/** Steps `s0`… on a 2 × 2 grid, installed as a file would be, with nothing to undo. */
function install(steps: DiagramStep[], readOnly = false): DiagramDocument {
  const document = setPageSetup(insertSteps(createDiagram({ title: 'Crane', newId: () => 'diagram-1' }), steps, 0), {
    layout: 'grid',
    columns: 2,
    rows: 2,
  });
  state().installDiagram({ document, readOnly, raw: {} });
  return document;
}

const plain = (count: number) => Array.from({ length: count }, (_, index) => cpStep(`s${index}`));

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('setDiagramStepPlace', () => {
  it('places a step as one undo step, kept as the file keeps it, and records nothing for no change', () => {
    install(plain(3));
    expect(state().setDiagramStepPlace('s1', { frame: [3.04, -1.26] })).toBe(true);
    expect(placeOf('s1')).toEqual({ frame: [3, -1.3] });
    expect(undoSteps()).toBe(1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Place on page');
    expect(state().dirty).toBe(true);
    expect(state().setDiagramStepPlace('s1', { frame: [3, -1.3] })).toBe(false);
    expect(undoSteps()).toBe(1);
    state().undoDiagram();
    expect(placeOf('s1')).toBeUndefined();
  });

  it('folds a sitting of nudges at the same part into one undo step, and starts another at another part', () => {
    install(plain(2));
    const session = 7;
    state().setDiagramStepPlace('s0', { text: [0.5, 0] }, { session });
    state().setDiagramStepPlace('s0', { text: [1, 0] }, { session });
    state().setDiagramStepPlace('s0', { text: [1.5, 0] }, { session });
    expect(undoSteps()).toBe(1);
    state().setDiagramStepPlace('s0', { number: [0, 0.5] }, { session });
    expect(undoSteps()).toBe(2);
    expect(placeOf('s0')).toEqual({ number: [0, 0.5], text: [1.5, 0] });
    state().undoDiagram();
    expect(placeOf('s0')).toEqual({ text: [1.5, 0] });
    state().undoDiagram();
    expect(placeOf('s0')).toBeUndefined();
  });

  it('drops an edit that outlived its diagram, as a debounced nudge may', () => {
    install(plain(2));
    const loadId = state().diagramLoadId;
    install(plain(2));
    expect(state().setDiagramStepPlace('s0', { picture: [1, 1] }, { loadId })).toBe(false);
    expect(placeOf('s0')).toBeUndefined();
    expect(state().setDiagramStepPlace('s0', { picture: [1, 1] }, { loadId: state().diagramLoadId })).toBe(true);
  });

  it('is refused on a read-only diagram, a newer build’s step, a newer build’s placement, and for a pin on an enlarged step', () => {
    const locked: DiagramStep = { ...createStep(() => 'locked'), unknown: { id: 'locked', hologram: 1 } };
    const newer: DiagramStep = { ...cpStep('newer'), placeNewer: { frame: [1, 1], tilt: 2 } };
    const enlarged: DiagramStep = { ...cpStep('enlarged'), zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.5, 0.5], radius: 0.2 } } };
    install([locked, newer, enlarged]);
    expect(state().setDiagramStepPlace('locked', { frame: [1, 0] })).toBe(false);
    expect(state().setDiagramStepPlace('newer', { frame: [1, 0] })).toBe(false);
    expect(state().setDiagramStepPlace('enlarged', { scale: { mmPerUnit: 0.3 } })).toBe(false);
    expect(state().setDiagramStepPlace('enlarged', { picture: [0, 2] })).toBe(true);
    expect(state().setDiagramStepPlace('gone', { frame: [1, 0] })).toBe(false);
    install(plain(2), true);
    expect(state().setDiagramStepPlace('s0', { frame: [1, 0] })).toBe(false);
    expect(state().resetDiagramPlaces(null)).toBe(false);
    expect(undoSteps()).toBe(0);
  });

  it('brings no diagram into being', () => {
    expect(state().setDiagramStepPlace('s0', { frame: [1, 0] })).toBe(false);
    expect(state().diagram).toBeNull();
  });
});

describe('resetting placements', () => {
  it('resets one part, the pin, the position or the lot of a step, each as one undo step', () => {
    install([{ ...cpStep('s0'), place: { ...PLACE, number: [1, 1] } }, cpStep('s1')]);
    expect(state().resetDiagramStepPlace('s0', 'scale')).toBe(true);
    expect(placeOf('s0')).toEqual({ frame: [2, 1], number: [1, 1], text: [0, 1.5] });
    expect(state().resetDiagramStepPlace('s0', 'frame')).toBe(true);
    expect(state().resetDiagramStepPlace('s0', 'frame')).toBe(false);
    expect(state().resetDiagramStepPlace('s0', 'position')).toBe(true);
    expect(placeOf('s0')).toBeUndefined();
    expect(undoSteps()).toBe(3);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Reset placement');
  });

  it('drops a newer build’s placement only with the whole of it: Reset Layout', () => {
    install([{ ...cpStep('s0'), placeNewer: { frame: [1, 1], tilt: 2 } }]);
    expect(state().resetDiagramStepPlace('s0', 'frame')).toBe(false);
    expect(state().resetDiagramStepPlace('s0', 'all')).toBe(true);
    expect(stepById(state().diagram!, 's0')!.placeNewer).toBeUndefined();
  });

  it('resets one page’s steps, or every step, as one undo step', () => {
    install(plain(6).map((step, index) => (index === 5 ? { ...step, placeNewer: { tilt: 1 } } : { ...step, place: { text: [1, 0] } })));
    // Four to a page: the second page is s4 and s5.
    expect(state().resetDiagramPlaces(1)).toBe(true);
    expect([0, 1, 2, 3, 4, 5].map((index) => stepById(state().diagram!, `s${index}`)!.place !== undefined)).toEqual([true, true, true, true, false, false]);
    expect(stepById(state().diagram!, 's5')!.placeNewer).toBeUndefined();
    expect(state().resetDiagramPlaces(1)).toBe(false);
    expect(state().resetDiagramPlaces(7)).toBe(false);
    expect(state().resetDiagramPlaces(null)).toBe(true);
    expect(state().diagram!.steps.some((entry) => 'place' in entry)).toBe(false);
    expect(undoSteps()).toBe(2);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Reset placements');
  });
});

describe('frames sent home by the edit that moved their steps (Decision 1A)', () => {
  it('in that edit’s own undo step, counted for the notice; undo brings them back and says nothing', () => {
    install(plain(6).map((step) => ({ ...step, place: PLACE })));
    expect(state().diagramPlacesSettled).toBeNull();
    state().selectDiagramStep('s0');
    const added = state().addDiagramStep()!;
    // s1–s3 shift along page one; page two starts with s3 now, so s4 and s5 are in new cells too.
    expect(['s0', 's1', 's2', 's3', 's4', 's5'].map((id) => placeOf(id)?.frame ?? null)).toEqual([[2, 1], null, null, null, null, null]);
    expect(placeOf('s1')).toEqual({ text: [0, 1.5], scale: { mmPerUnit: 0.3 } });
    expect(stepById(state().diagram!, added)!.place).toBeUndefined();
    expect(undoSteps()).toBe(1);
    const settled = state().diagramPlacesSettled!;
    expect(settled.count).toBe(5);
    // The undo entry they went home in: what an Undo offered with the notice checks is still the newest.
    expect(settled.entry).not.toBeNull();
    expect(settled.entry).toBe(state().diagramHistory.past.at(-1));
    expect(stepById(settled.entry!.snapshot!, 's3')!.place).toEqual(PLACE);
    state().undoDiagram();
    expect(placeOf('s3')).toEqual(PLACE);
    expect(state().diagramPlacesSettled).toBe(settled);
    state().redoDiagram();
    expect(placeOf('s3')?.frame).toBeUndefined();
    expect(state().diagramPlacesSettled).toBe(settled);
  });

  it('says so anew for each edit that sends any home, and not for one that sends none', () => {
    install(plain(4).map((step) => ({ ...step, place: PLACE })));
    state().setDiagramStepText('s2', 'Fold.');
    expect(state().diagramPlacesSettled).toBeNull();
    state().moveDiagramStep('s3', 2);
    const first = state().diagramPlacesSettled!;
    expect(first.count).toBe(2);
    state().setDiagramPage({ columns: 3 });
    const second = state().diagramPlacesSettled!;
    expect(second.count).toBe(2);
    expect(second.nonce).not.toBe(first.nonce);
    // The first one's undo entry is no longer the newest: its Undo would undo another edit.
    expect(state().diagramHistory.past.at(-1)).toBe(second.entry);
    expect(state().diagramHistory.past.at(-1)).not.toBe(first.entry);
    // An edit after it, sending none home, leaves the notice as it was, its entry no longer the newest.
    state().setDiagramStepText('s0', 'Fold again.');
    expect(state().diagramPlacesSettled).toBe(second);
    expect(state().diagramHistory.past.at(-1)).not.toBe(second.entry);
    // Opening another diagram forgets it.
    install(plain(1));
    expect(state().diagramPlacesSettled).toBeNull();
  });

  it('keeps every frame through an edit that moves no step to another cell', () => {
    install(plain(6).map((step) => ({ ...step, place: PLACE })));
    // s4 starts page two already.
    state().setDiagramStepBreakBefore('s4', true);
    state().setDiagramPage({ marginMm: 20, firstPageSide: 'right' });
    expect(['s0', 's1', 's2', 's3', 's4', 's5'].every((id) => placeOf(id)?.frame !== undefined)).toBe(true);
    expect(state().diagramPlacesSettled).toBeNull();
  });
});
