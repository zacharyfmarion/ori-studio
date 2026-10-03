import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { buildDiagramPoseActions } from './diagramPoseActions';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function build(state: Partial<Parameters<typeof buildDiagramPoseActions>[0]> = {}) {
  const setPose = vi.fn();
  const actions = buildDiagramPoseActions(
    {
      pose: { rotationQuarterTurns: 1, mirrored: false },
      carriesUnknownAnnotations: false,
      readOnly: false,
      ...state,
    },
    { t, setPose }
  );
  const run = (id: string) => actions.find((action) => action.id === id)?.run();
  return { actions, setPose, run };
}

describe('the pose verbs', () => {
  it('turn the picture as it is shown, and reset it upright', () => {
    const { setPose, run } = build();
    // Each verb hands on the pose it makes, and its own name (for analytics).
    run('rotate-left');
    expect(setPose).toHaveBeenLastCalledWith({ rotationQuarterTurns: 0, mirrored: false }, 'rotate-left');
    run('rotate-right');
    expect(setPose).toHaveBeenLastCalledWith({ rotationQuarterTurns: 2, mirrored: false }, 'rotate-right');
    // Flipping a quarter-turned picture reverses its turn: the stored pose mirrors first.
    run('flip');
    expect(setPose).toHaveBeenLastCalledWith({ rotationQuarterTurns: 3, mirrored: true }, 'flip');
    run('reset');
    expect(setPose).toHaveBeenLastCalledWith({ rotationQuarterTurns: 0, mirrored: false }, 'reset');
  });

  it('offer no reset for an upright picture', () => {
    const { actions } = build({ pose: { rotationQuarterTurns: 0, mirrored: false } });
    expect(actions.find((action) => action.id === 'reset')?.disabled).toBe(true);
    expect(actions.find((action) => action.id === 'flip')?.disabled).toBe(false);
  });

  it.each([
    [{ pose: null }, 'Only an uploaded picture'],
    [{ carriesUnknownAnnotations: true }, 'newer Ori Studio, which could not turn'],
    [{ readOnly: true }, 'read-only'],
  ])('are all disabled, with the reason, for %o', (state, reason) => {
    const { actions } = build(state);
    for (const action of actions) {
      expect(action.disabled, action.id).toBe(true);
      expect(action.hint, action.id).toContain(reason);
    }
  });
});
