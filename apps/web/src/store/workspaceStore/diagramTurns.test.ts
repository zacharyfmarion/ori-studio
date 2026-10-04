import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isTurn, stepsOf } from '../../diagram/document/diagramDocument';
import { useWorkspaceStore } from '../workspaceStore';
import { hasDeletableDiagramSelection } from './capabilities';

const confirm = vi.hoisted(() => ({ requestConfirmation: vi.fn(async () => true) }));
vi.mock('../commandDialogStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../commandDialogStore')>()),
  ...confirm,
}));

/** Turns between steps (D22), through the store. */
const state = () => useWorkspaceStore.getState();
const order = () => state().diagram!.steps.map((entry) => entry.id);
const OVER = { kind: 'turn-over', axis: 'vertical' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('turns between steps in the store', () => {
  it('adds a turn where an add lands, selected, as one undo step; or beside a given entry', () => {
    const first = state().addDiagramStep()!;
    const second = state().addDiagramStep()!;
    state().selectDiagramStep(first);
    const turn = state().insertDiagramTurn(OVER)!;
    expect(order()).toEqual([first, turn, second]);
    expect(state().diagramSelectedStepId).toBe(turn);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Add turn');
    const before = state().insertDiagramTurn({ kind: 'rotate', rotate: { amount: 'half', direction: 'cw' } }, { stepId: first, where: 'before' })!;
    expect(order()).toEqual([before, first, turn, second]);
    state().undoDiagram();
    expect(order()).toEqual([first, turn, second]);
  });

  it('changes what a turn is as one undo step, and nothing when it is that already', () => {
    state().addDiagramStep();
    const turn = state().insertDiagramTurn(OVER)!;
    const past = state().diagramHistory.past.length;
    expect(state().setDiagramTurn(turn, { kind: 'turn-over', axis: 'horizontal' })).toBe(true);
    expect(state().diagram!.steps[1]).toEqual({ id: turn, kind: 'turn-over', axis: 'horizontal' });
    expect(state().diagramHistory.past.length).toBe(past + 1);
    expect(state().setDiagramTurn(turn, { kind: 'turn-over', axis: 'horizontal' })).toBe(false);
  });

  it('deletes a turn without asking: it holds no work', async () => {
    const step = state().addDiagramStep()!;
    state().setDiagramStepText(step, 'Fold it.');
    const turn = state().insertDiagramTurn(OVER)!;
    await expect(state().confirmDeleteDiagramSteps([turn])).resolves.toBe(true);
    expect(confirm.requestConfirmation).not.toHaveBeenCalled();
    expect(order()).toEqual([step]);
  });

  it('opens no detail on a turn, and a turn selected closes the detail open on a step', () => {
    const step = state().addDiagramStep()!;
    const turn = state().insertDiagramTurn(OVER)!;
    expect(state().openDiagramStep(turn)).toBe(false);
    expect(state().openDiagramStep(step)).toBe(true);
    state().selectDiagramStep(turn);
    expect(state().diagramDetail).toBeNull();
  });

  it('never fills a selected turn with a picture: the picture becomes a step after it', () => {
    state().addDiagramStep();
    const turn = state().insertDiagramTurn(OVER)!;
    const asset = { id: 'asset-1', kind: 'raster', mime: 'image/png', dataUrl: 'data:image/png;base64,AA==', widthPx: 1, heightPx: 1, bytes: 1 } as const;
    const added = state().addDiagramPictures([asset as never]);
    expect(added?.filled).toBe(false);
    expect(order().indexOf(added!.stepIds[0]!)).toBe(order().indexOf(turn) + 1);
    expect(isTurn(state().diagram!.steps[1]!)).toBe(true);
    expect(stepsOf(state().diagram!)).toHaveLength(2);
  });

  it('lets Delete take a selected turn', () => {
    state().addDiagramStep();
    state().insertDiagramTurn(OVER);
    expect(hasDeletableDiagramSelection({ ...state(), activeEditingContext: 'diagram' })).toBe(true);
  });
});
