import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const menu = vi.hoisted(() => ({ handleMenuAction: vi.fn() }));
vi.mock('../../commands/menuActions', () => ({ handleMenuAction: menu.handleMenuAction }));

const analytics = vi.hoisted(() => ({ trackFoldStepAdded: vi.fn() }));
vi.mock('../../analytics/trackFold', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/trackFold')>()),
  trackFoldStepAdded: analytics.trackFoldStepAdded,
}));

/** The app's session is the worker-bound one; these tests hand the commands one over a fake engine. */
const app = vi.hoisted(() => ({ session: null as import('../session/foldSession').FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/foldSession')>()),
  foldSession: () => {
    if (!app.session) throw new Error('no session');
    return app.session;
  },
}));

import i18n from '../../i18n';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import { createFoldSession } from '../session/foldSession';
import { fakeFoldEngine, inProcessFoldRuntime, settle } from '../session/foldSession.fixtures';
import { FOLD_PENDING_NODE } from '../session/foldSessionState';
import {
  actionStatus,
  currentFoldActions,
  foldActionContext,
  foldCommandActionId,
  registerFoldKindControl,
  runFoldMenuVerb,
  turnOp,
} from './foldCommands';
import { foldPathEntries } from './foldSequencePath';
import { foldTools } from '../tools/foldToolState';

const t = i18n.t.bind(i18n);
const state = () => useWorkspaceStore.getState();
const shownSteps = () => state().foldSequences[0]?.document.steps ?? [];

beforeEach(async () => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  menu.handleMenuAction.mockClear();
  analytics.trackFoldStepAdded.mockClear();
  app.session = createFoldSession({
    document: foldSessionDocumentSource(useWorkspaceStore),
    runtime: inProcessFoldRuntime(() => fakeFoldEngine()),
  });
  app.session.retain();
  await settle();
});

afterEach(() => {
  app.session?.dispose();
  app.session = null;
});

describe('the catalog’s context', () => {
  it('gates on the step’s standing: ready, still folding, broken or locked', () => {
    expect(['ok', 'changed', 'pending', 'broken', 'brokenAbove', 'locked'].map((each) => actionStatus(each as never))).toEqual([
      'ready',
      'ready',
      'replaying',
      'broken',
      'broken',
      'locked',
    ]);
  });

  it('says where the step is, what follows it, and what the sheet is', () => {
    const document = sequenceOf([step('a', null), step('b', 'a', valleyAt(0.25)), step('c', 'a', valleyAt(0.75))]);
    const ok = { ...FOLD_PENDING_NODE, status: 'ok' as const };
    const entries = foldPathEntries(document, ['a', 'c'], ok, new Map([['a', ok], ['c', ok]]), FOLD_PENDING_NODE);
    expect(foldActionContext(document, entries, 1, false, 'mountain')).toEqual({
      step: { id: 'a', followers: 2 },
      state: 'ready',
      path: 'ready',
      atTip: false,
      readOnly: false,
      foldKind: 'mountain',
      sheet: 'square',
      stepCount: 3,
    });
    expect(foldActionContext(document, entries, 0, true, 'valley')).toMatchObject({ step: null, atTip: false, readOnly: true });
  });

  it('turns a turn into the step that makes it', () => {
    expect(turnOp({ kind: 'turn-over', axis: 'vertical' })).toEqual({ kind: 'turn', axis: 'vertical' });
    expect(turnOp({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'ccw' } })).toEqual({
      kind: 'rotate',
      rotate: { amount: 'quarter', direction: 'ccw' },
    });
  });
});

describe('running the verbs', () => {
  it('turns the model over as a step of its own, after the step on screen', async () => {
    expect(runFoldMenuVerb(t, { kind: 'command', id: 'turn-over' })).toBe(true);
    await settle();
    expect(shownSteps().map((node) => node.op)).toEqual([{ kind: 'turn', axis: 'vertical' }]);
    expect(state().foldReader?.cursor).toBe(shownSteps()[0]?.id);
    // The step it added is counted as the rail's and T's turn is; the press was `command invoked`'s.
    expect(analytics.trackFoldStepAdded.mock.calls).toEqual([['turn']]);
  });

  it('deletes the step on screen and what follows, and nothing at the sheet', async () => {
    await app.session!.commitStep(valleyAt(0.5));
    await app.session!.commitStep(valleyAt(0.25));
    await settle();
    expect(runFoldMenuVerb(t, { kind: 'command', id: 'delete-step' })).toBe(true);
    expect(shownSteps()).toHaveLength(1);
    state().moveFoldCursor(null);
    expect(runFoldMenuVerb(t, { kind: 'command', id: 'delete-step' })).toBe(false);
    expect(shownSteps()).toHaveLength(1);
  });

  it('arms a fold kind through the tools, and offers none without them', () => {
    expect(runFoldMenuVerb(t, { kind: 'fold-kind', id: 'mountain' })).toBe(false);
    const arm = vi.fn();
    const release = registerFoldKindControl({ kind: () => 'valley', arm });
    expect(runFoldMenuVerb(t, { kind: 'fold-kind', id: 'mountain' })).toBe(true);
    expect(arm).toHaveBeenCalledWith('mountain');
    release();
    const choice = currentFoldActions(t).find((action) => action.kind === 'choice');
    expect(choice).toMatchObject({ disabled: true });
  });

  it('says why, in the catalog’s words, when the catalog turns down a verb the menu bar or a key ran', () => {
    const refused = vi.fn();
    // No tools on screen (no canvas mounted): no kind to arm.
    expect(runFoldMenuVerb(t, { kind: 'fold-kind', id: 'valley' }, refused)).toBe(false);
    expect(refused).toHaveBeenLastCalledWith('Take a fold tool on the canvas to choose its kind.');
    // The flat sheet on screen: no step to delete.
    expect(runFoldMenuVerb(t, { kind: 'command', id: 'delete-step' }, refused)).toBe(false);
    expect(refused).toHaveBeenLastCalledWith('The flat sheet is where the steps start: there is no step to delete.');
    expect(refused).toHaveBeenCalledTimes(2);
    // A verb that runs says nothing.
    const release = registerFoldKindControl({ kind: () => 'valley', arm: vi.fn() });
    expect(runFoldMenuVerb(t, { kind: 'fold-kind', id: 'mountain' }, refused)).toBe(true);
    release();
    expect(refused).toHaveBeenCalledTimes(2);
  });

  it('dispatches Import CP, Send to Edit and the exports by the catalog’s ids', () => {
    for (const id of ['import-cp', 'send-to-edit', 'export-fold', 'export-steps'] as const) {
      const command = currentFoldActions(t).find((action) => action.kind === 'command' && action.id === id);
      if (command?.kind === 'command') command.run();
    }
    expect(menu.handleMenuAction.mock.calls).toEqual([
      ['fold.import-cp'],
      ['fold.send-to-edit'],
      ['fold.export-fold'],
      ['fold.export-steps'],
    ]);
    expect(foldCommandActionId('delete-step')).toBe('fold.delete-step');
  });

  it('adds a turn at a card’s step by putting the reader there first', async () => {
    await app.session!.commitStep(valleyAt(0.5));
    await app.session!.commitStep(valleyAt(0.25));
    await settle();
    const [first] = shownSteps();
    const turn = currentFoldActions(t, first!.id).find((action) => action.kind === 'command' && action.id === 'turn-over');
    expect(turn).toMatchObject({ note: 'Starts a new branch' });
    if (turn?.kind === 'command') turn.run();
    await settle();
    const added = shownSteps()[2];
    expect(added).toMatchObject({ parent: first!.id, op: { kind: 'turn' } });
    expect(state().foldReader?.cursor).toBe(added?.id);
  });

  it('takes the Rotate tool at a card’s step, the reader put there first, and adds nothing until it is applied', async () => {
    await app.session!.commitStep(valleyAt(0.5));
    await app.session!.commitStep(valleyAt(0.25));
    await settle();
    const [first] = shownSteps();
    const rotate = currentFoldActions(t, first!.id).find((action) => action.kind === 'command' && action.id === 'rotate');
    expect(rotate).toMatchObject({ label: 'Rotate…', note: 'Starts a new branch' });
    if (rotate?.kind === 'command') rotate.run();
    await settle();
    expect(state().foldReader?.cursor).toBe(first!.id);
    expect(foldTools().store.getState().tool).toBe('rotate');
    expect(shownSteps()).toHaveLength(2);
    foldTools().putDown();
  });
});
