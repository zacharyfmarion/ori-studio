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
    canRecompute: true,
    hasView: true,
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
  it('orders the verbs steps, candidates, recompute, then the camera', () => {
    const ids = referencesCommands(buildReferencesActions(state(), { t })).map(
      (action) => action.id
    );
    expect(ids).toEqual([
      'previous-step',
      'next-step',
      'previous-candidate',
      'next-candidate',
      'recompute',
      'reset-view',
      'zoom-in',
      'zoom-out',
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
      'references.previousCandidate',
      'references.nextCandidate',
      'references.recompute',
      'references.resetView',
      'references.zoomIn',
      'references.zoomOut',
    ]);
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

  it('gates the camera verbs on there being a view', () => {
    const blank = state({ hasView: false });
    expect(command(blank, 'reset-view').disabled).toBe(true);
    expect(command(blank, 'zoom-in').disabled).toBe(true);
    expect(command(state(), 'zoom-out').disabled).toBe(false);
  });
});
