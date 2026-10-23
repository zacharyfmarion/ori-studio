import { describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import {
  buildFoldActions,
  foldCommand,
  foldSendToEditSource,
  type FoldAction,
  type FoldActionContext,
  type FoldActionDeps,
  type FoldChoice,
} from './foldActions';

const t = i18n.t.bind(i18n);

function deps(): FoldActionDeps {
  return {
    t,
    setFoldKind: vi.fn(),
    turn: vi.fn(),
    rotate: vi.fn(),
    unfold: vi.fn(),
    deleteStep: vi.fn(),
    importCp: vi.fn(),
    sendToEdit: vi.fn(),
    sendToDiagram: vi.fn(),
    exportFold: vi.fn(),
    exportSteps: vi.fn(),
  };
}

const CONTEXT: FoldActionContext = {
  step: { id: 'step-2', followers: 0 },
  state: 'ready',
  path: 'ready',
  atTip: true,
  readOnly: false,
  foldKind: 'valley',
  sheet: 'square',
  stepCount: 2,
};

const at = (overrides: Partial<FoldActionContext>) => ({ ...CONTEXT, ...overrides });

/** The command, or a failure naming it. */
function command(actions: readonly FoldAction[], id: Parameters<typeof foldCommand>[1]) {
  const found = foldCommand(actions, id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

function choice(actions: readonly FoldAction[]): FoldChoice {
  const found = actions.find((action): action is FoldChoice => action.kind === 'choice');
  if (!found) throw new Error('no fold-kind choice');
  return found;
}

describe('buildFoldActions', () => {
  it('orders the verbs by intent, destructive last', () => {
    const actions = buildFoldActions(CONTEXT, deps());
    expect(actions.map((action) => (action.kind === 'separator' ? '—' : action.id))).toEqual([
      'fold-kind',
      '—',
      'turn-over',
      'rotate',
      'unfold-last',
      'unfold-to',
      'repeat',
      '—',
      'import-cp',
      '—',
      'send-to-edit',
      'send-to-diagram',
      'send-path-to-diagram',
      'export-fold',
      'export-steps',
      '—',
      'delete-step',
    ]);
  });

  it('sends the step in context, or the steps to it, to the Diagram, and nothing from the flat sheet (D17)', () => {
    const bound = deps();
    const actions = buildFoldActions(CONTEXT, bound);
    command(actions, 'send-to-diagram').run();
    command(actions, 'send-path-to-diagram').run();
    expect(bound.sendToDiagram).toHaveBeenNthCalledWith(1, 'step');
    expect(bound.sendToDiagram).toHaveBeenNthCalledWith(2, 'path');
    const sheet = buildFoldActions({ ...CONTEXT, step: null }, deps());
    expect(command(sheet, 'send-to-diagram')).toMatchObject({ disabled: true, hint: expect.stringContaining('flat sheet') });
    const replaying = buildFoldActions({ ...CONTEXT, state: 'replaying' }, deps());
    expect(command(replaying, 'send-path-to-diagram').disabled).toBe(true);
  });

  it('offers the three fold kinds, the armed one checked, each setting itself', () => {
    const bound = deps();
    const kinds = choice(buildFoldActions(at({ foldKind: 'mountain' }), bound));
    expect(kinds.options.map((option) => [option.label, option.checked])).toEqual([
      ['Valley fold', false],
      ['Mountain fold', true],
      ['Precrease', false],
    ]);
    kinds.options[2]?.run();
    expect(bound.setFoldKind).toHaveBeenCalledWith('precrease');
    // Another tool in hand — a squash, a sink — arms no plain fold: none reads as chosen.
    const none = choice(buildFoldActions(at({ foldKind: null }), bound));
    expect(none.options.map((option) => option.checked)).toEqual([false, false, false]);
  });

  it('names Turn over as its card does and adds it at once, and takes the Rotate tool for a rotation', () => {
    const bound = deps();
    const actions = buildFoldActions(CONTEXT, bound);
    expect(command(actions, 'turn-over').label).toBe('Turn over, side to side');
    // A rotation has an amount and a direction to choose: the verb takes the tool, which previews it.
    expect(command(actions, 'rotate')).toMatchObject({ label: 'Rotate…', icon: 'rotate', disabled: false });
    command(actions, 'turn-over').run();
    command(actions, 'rotate').run();
    expect(bound.turn).toHaveBeenCalledTimes(1);
    expect(bound.turn).toHaveBeenCalledWith({ kind: 'turn-over', axis: 'vertical' });
    expect(bound.rotate).toHaveBeenCalledTimes(1);
  });

  it('says a verb that adds a step starts a branch anywhere but the tip', () => {
    const tip = buildFoldActions(CONTEXT, deps());
    expect(command(tip, 'turn-over').note).toBeUndefined();
    const inside = buildFoldActions(at({ atTip: false }), deps());
    for (const id of ['turn-over', 'rotate', 'import-cp'] as const) {
      expect(command(inside, id).note).toBe('Starts a new branch');
    }
    // Taking the sequence out or deleting a step starts nothing.
    expect(command(inside, 'send-to-edit').note).toBeUndefined();
    expect(command(inside, 'delete-step').note).toBeUndefined();
  });

  it('adds no step where the state cannot be folded from, and says why', () => {
    const cases = [
      [at({ state: 'replaying' }), 'Still folding the steps before this one.'],
      [at({ state: 'broken' }), 'This step no longer folds.'],
      [at({ state: 'locked' }), 'This step was made with a newer Ori Studio.'],
      [at({ readOnly: true }), 'Made with a newer Ori Studio: this sequence opens read-only.'],
    ] as const;
    for (const [context, hint] of cases) {
      const actions = buildFoldActions(context, deps());
      expect(choice(actions)).toMatchObject({ disabled: true, hint });
      for (const id of ['turn-over', 'rotate', 'import-cp'] as const) {
        expect(command(actions, id)).toMatchObject({ disabled: true, hint });
      }
    }
  });

  it('deletes a broken or locked step, which is all such a step offers (plan D6)', () => {
    for (const state of ['broken', 'locked'] as const) {
      const bound = deps();
      const remove = command(buildFoldActions(at({ state }), bound), 'delete-step');
      expect(remove.disabled).toBe(false);
      remove.run();
      expect(bound.deleteStep).toHaveBeenCalledWith('step-2');
    }
  });

  it('says what a delete takes with it', () => {
    expect(command(buildFoldActions(CONTEXT, deps()), 'delete-step')).toMatchObject({
      label: 'Delete this step',
      danger: true,
    });
    expect(
      command(buildFoldActions(at({ step: { id: 'step-2', followers: 3 } }), deps()), 'delete-step').label
    ).toBe('Delete this step and what follows');
  });

  it('has nothing to delete at the flat sheet, and nothing to change in a read-only sequence', () => {
    const bound = deps();
    const sheet = command(buildFoldActions(at({ step: null }), bound), 'delete-step');
    expect(sheet).toMatchObject({
      disabled: true,
      hint: 'The flat sheet is where the steps start: there is no step to delete.',
    });
    sheet.run();
    expect(bound.deleteStep).not.toHaveBeenCalled();
    expect(command(buildFoldActions(at({ readOnly: true }), deps()), 'delete-step').disabled).toBe(true);
  });

  it('folds from the flat sheet like any ready state', () => {
    const actions = buildFoldActions(at({ step: null }), deps());
    expect(choice(actions).disabled).toBe(false);
    expect(command(actions, 'turn-over').disabled).toBe(false);
  });

  it('imports a crease pattern into a square or rectangle, or an empty polygon sequence (plan D16)', () => {
    expect(command(buildFoldActions(at({ sheet: 'rectangle' }), deps()), 'import-cp').disabled).toBe(false);
    expect(command(buildFoldActions(at({ sheet: 'polygon', stepCount: 0 }), deps()), 'import-cp').disabled).toBe(
      false
    );
    expect(command(buildFoldActions(at({ sheet: 'polygon', stepCount: 1 }), deps()), 'import-cp')).toMatchObject({
      disabled: true,
      hint: 'Import CP needs a square or rectangle sheet.',
    });
  });

  it('sends and exports the active path once it has folded, read-only or not', () => {
    const bound = deps();
    const actions = buildFoldActions(at({ readOnly: true, state: 'broken' }), bound);
    const out = ['send-to-edit', 'export-fold', 'export-steps'] as const;
    expect(out.map((id) => [command(actions, id).label, command(actions, id).disabled])).toEqual([
      ['Send to Edit', false],
      ['Export FOLD…', false],
      ['Export steps…', false],
    ]);
    for (const id of out) command(actions, id).run();
    expect(bound.sendToEdit).toHaveBeenCalledOnce();
    expect(bound.exportFold).toHaveBeenCalledOnce();
    expect(bound.exportSteps).toHaveBeenCalledOnce();

    const cases = [
      ['replaying', 'Still folding the steps.'],
      ['broken', 'A step on this path no longer folds.'],
      ['locked', 'A step on this path was made with a newer Ori Studio.'],
    ] as const;
    for (const [path, hint] of cases) {
      const blocked = buildFoldActions(at({ path }), deps());
      for (const id of out) expect(command(blocked, id)).toMatchObject({ disabled: true, hint });
    }
    // The flat sheet alone has nothing to carry, as the menu's capability says.
    const empty = buildFoldActions(at({ stepCount: 0 }), deps());
    for (const id of out) expect(command(empty, id)).toMatchObject({ disabled: true, hint: 'Fold a step first' });
  });

  it('opens Import CP through its binding', () => {
    const bound = deps();
    command(buildFoldActions(CONTEXT, bound), 'import-cp').run();
    expect(bound.importCp).toHaveBeenCalledOnce();
  });
});

describe('foldSendToEditSource', () => {
  it('gives the shared Send to Edit button Fold’s own tooltip and no caret: precreases always go as aux lines', () => {
    expect(foldSendToEditSource(t)).toEqual({
      title: 'Send the crease pattern of the steps shown to the Edit canvas',
    });
  });
});
