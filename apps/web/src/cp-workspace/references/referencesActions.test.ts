import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  buildReferencesActions,
  referencesCommands,
  type ReferencesActionState,
  type ReferencesCommand,
} from './referencesActions';

// The builder only ever calls t(key, defaultValue); return the default so the
// assertions read as the English UI.
const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function state(overrides: Partial<ReferencesActionState> = {}): ReferencesActionState {
  return {
    stepCount: 4,
    activeStep: 1,
    candidateCount: 3,
    activeCandidate: 1,
    wayCount: 3,
    activeWay: 1,
    canRecompute: true,
    hasView: true,
    hasDiagram: true,
    diagram: { canSend: true, canSendAll: true, waitingStep: null },
    fold: { available: true, playing: false, folded: false, pleat: false },
    ...overrides,
  };
}

function command(s: ReferencesActionState, id: ReferencesCommand['id']): ReferencesCommand {
  const found = referencesCommands(buildReferencesActions(s, { t })).find(
    (action) => action.id === id
  );
  if (!found) throw new Error(`no ${id} command`);
  return found;
}

describe('buildReferencesActions', () => {
  it('steps through the active card\'s ways, and says why when it has one', () => {
    expect(command(state({ activeWay: 0 }), 'previous-way').disabled).toBe(true);
    expect(command(state({ activeWay: 0 }), 'next-way').disabled).toBe(false);
    expect(command(state({ activeWay: 2 }), 'next-way').disabled).toBe(true);
    expect(command(state({ activeWay: 2 }), 'previous-way').disabled).toBe(false);
    const single = command(state({ wayCount: 0, activeWay: 0 }), 'next-way');
    expect(single.disabled).toBe(true);
    expect(single.hint).toBe('This step folds only one way');
    expect(command(state(), 'next-way').label).toBe('Next Way');
  });

  it('orders the verbs steps, ways, candidates, recompute, the camera, export, then the diagram', () => {
    const ids = referencesCommands(buildReferencesActions(state(), { t })).map(
      (action) => action.id
    );
    expect(ids).toEqual([
      'previous-step',
      'next-step',
      'play-fold',
      'previous-way',
      'next-way',
      'previous-candidate',
      'next-candidate',
      'recompute',
      'reset-view',
      'zoom-in',
      'zoom-out',
      'export-step',
      'export-all-steps',
      'send-to-diagram',
      'send-all-to-diagram',
    ]);
  });

  it('takes its labels from the shortcut registry', () => {
    expect(command(state(), 'next-step').label).toBe('Next Step');
    expect(command(state(), 'recompute').label).toBe('Recompute References');
    expect(command(state(), 'zoom-in').shortcutId).toBe('references.zoomIn');
  });

  it('names every verb by the registry id the surfaces dispatch through', () => {
    const actions = referencesCommands(buildReferencesActions(state(), { t }));
    expect(actions.map((action) => action.shortcutId)).toEqual([
      'references.previousStep',
      'references.nextStep',
      'references.playFold',
      'references.previousWay',
      'references.nextWay',
      'references.previousCandidate',
      'references.nextCandidate',
      'references.recompute',
      'references.resetView',
      'references.zoomIn',
      'references.zoomOut',
      'references.exportStep',
      'references.exportAllSteps',
      'references.sendToDiagram',
      'references.sendAllToDiagram',
    ]);
  });

  it('offers one export verb while a diagram is showing, and says why not otherwise', () => {
    const exportStep = command(state(), 'export-step');
    expect(exportStep.label).toBe('Export step…');
    expect(exportStep.disabled).toBe(false);
    expect(exportStep.hint).toBeUndefined();
    // A finished card, an empty strip, a finding: nothing to paint.
    const blank = command(state({ hasDiagram: false }), 'export-step');
    expect(blank.disabled).toBe(true);
    expect(blank.hint).toBe('No step is showing');
  });

  it('offers every step while the strip has cards, whichever is showing', () => {
    // The finished card has no diagram of its own, but the steps before it do.
    const finished = command(state({ hasDiagram: false }), 'export-all-steps');
    expect(finished.label).toBe('Export all steps…');
    expect(finished.disabled).toBe(false);
    const empty = command(state({ stepCount: 0, activeStep: 0 }), 'export-all-steps');
    expect(empty.disabled).toBe(true);
    expect(empty.hint).toBe('Pick a vertex or crease first');
  });

  describe('sending to the diagram', () => {
    it('sends the card on show, or the strip, while each can be sent', () => {
      expect(command(state(), 'send-to-diagram')).toMatchObject({ label: 'Send to diagram', disabled: false });
      expect(command(state(), 'send-all-to-diagram')).toMatchObject({ label: 'Send all to diagram', disabled: false });
    });

    it('names the step it will fill when From References… waits for one', () => {
      const interpolating = ((_key: string, fallback: string, options?: Record<string, unknown>) =>
        options ? fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : fallback) as unknown as TFunction;
      const waiting = state({ diagram: { canSend: true, canSendAll: true, waitingStep: 3 } });
      const send = referencesCommands(buildReferencesActions(waiting, { t: interpolating })).find(
        (entry) => entry.id === 'send-to-diagram'
      );
      expect(send).toMatchObject({ label: 'Send to Diagram Step 3', shortcutId: 'references.sendToDiagram' });
    });

    it('says why it cannot', () => {
      const stale = state({
        diagram: { canSend: false, canSendAll: false, hint: 'Recompute first', waitingStep: null },
      });
      expect(command(stale, 'send-to-diagram')).toMatchObject({ disabled: true, hint: 'Recompute first' });
      expect(command(stale, 'send-all-to-diagram')).toMatchObject({ disabled: true, hint: 'Recompute first' });
      const nothing = state({ diagram: { canSend: false, canSendAll: false, waitingStep: null }, stepCount: 0 });
      expect(command(nothing, 'send-to-diagram').hint).toBe('No step is showing');
      expect(command(nothing, 'send-all-to-diagram').hint).toBe('Pick a vertex or crease first');
    });
  });

  it('separates export from the camera verbs in the menu', () => {
    const actions = buildReferencesActions(state(), { t });
    const before = actions.findIndex(
      (action) => action.kind === 'command' && action.id === 'export-step'
    );
    expect(actions[before - 1]).toEqual({ kind: 'separator', id: 'before-export' });
  });

  it('disables stepping at either end', () => {
    expect(command(state({ activeStep: 0 }), 'previous-step').disabled).toBe(true);
    expect(command(state({ activeStep: 0 }), 'next-step').disabled).toBe(false);
    expect(command(state({ activeStep: 3 }), 'next-step').disabled).toBe(true);
    expect(command(state({ activeCandidate: 2 }), 'next-candidate').disabled).toBe(true);
    expect(command(state({ activeCandidate: 0 }), 'previous-candidate').disabled).toBe(true);
  });

  it('explains itself when nothing has been picked', () => {
    const none = state({ stepCount: 0, candidateCount: 0, canRecompute: false });
    for (const id of ['previous-step', 'next-step', 'next-candidate', 'recompute'] as const) {
      const action = command(none, id);
      expect(action.disabled).toBe(true);
      expect(action.hint).toBe('Pick a vertex or crease first');
    }
    // An enabled verb carries no hint.
    expect(command(state(), 'next-step').hint).toBeUndefined();
  });

  it('names the fold verb by what pressing it does next, and says why it cannot', () => {
    const flat = command(state(), 'play-fold');
    expect(flat.label).toBe('Play Fold');
    expect(flat.icon).toBe('play-fold');
    expect(flat.disabled).toBe(false);
    const moving = command(
      state({ fold: { available: true, playing: true, folded: false, pleat: false } }),
      'play-fold'
    );
    expect(moving.label).toBe('Pause Fold');
    expect(moving.icon).toBe('pause-fold');
    const folded = command(
      state({ fold: { available: true, playing: false, folded: true, pleat: false } }),
      'play-fold'
    );
    expect(folded.label).toBe('Unfold');
    expect(folded.icon).toBe('unfold');
    const pleat = command(
      state({ fold: { available: false, playing: false, folded: false, pleat: true } }),
      'play-fold'
    );
    expect(pleat.disabled).toBe(true);
    expect(pleat.hint).toBe('Pleats aren’t animated yet');
    const none = command(
      state({ fold: { available: false, playing: false, folded: false, pleat: false } }),
      'play-fold'
    );
    expect(none.hint).toBe('Nothing to fold on this card');
  });

  it('gates the camera verbs on there being a view', () => {
    const blank = state({ hasView: false });
    expect(command(blank, 'reset-view').disabled).toBe(true);
    expect(command(blank, 'zoom-in').disabled).toBe(true);
    expect(command(state(), 'zoom-out').disabled).toBe(false);
  });
});
