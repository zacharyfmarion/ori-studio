import { describe, expect, it } from 'vitest';
import { createToolRuntime } from '../../cp-workspace/tools/runtime';
import { AXIOM_SLOTS } from '../document/foldSequenceDocument';
import { FOLD_LINE_MODES, lineModeAxiom, lineModeSteps } from './foldToolCatalog';
import { inSlotOrder, lineModeInput, locateEngine, nextStep, toolInput } from './foldToolRegistry';
import i18n from '../../i18n';

const t = i18n.t.bind(i18n);

describe('the Fold tools’ input registry', () => {
  it('takes as many clicks as each line mode has instructions, each axiom slot once', () => {
    for (const mode of FOLD_LINE_MODES) {
      const model = lineModeInput(mode);
      expect(model.steps).toHaveLength(lineModeSteps(t, mode).length);
      const axiom = lineModeAxiom(mode);
      if (axiom === null) continue;
      const slots = model.steps.map((step) => step.slot);
      expect([...slots].sort()).toEqual(AXIOM_SLOTS[axiom].map((_, slot) => slot));
      // A point slot snaps to points, a line slot needs a line.
      model.steps.forEach((step) => {
        const kind = AXIOM_SLOTS[axiom][step.slot ?? -1];
        expect(step.snap).toBe(kind === 'point' ? 'point' : 'crease-required');
      });
    }
  });

  it('stores the clicks in the axiom’s own order, whatever order they were made in', () => {
    // O4: perpendicular to the line (clicked first), through the point: stored [p, m].
    expect(inSlotOrder(lineModeInput('axiom-4'), ['line', 'point'])).toEqual(['point', 'line']);
    // O5: the point to move, the pivot, the line: stored [pivot, p, m1].
    expect(inSlotOrder(lineModeInput('axiom-5'), ['point', 'pivot', 'line'])).toEqual(['pivot', 'point', 'line']);
    expect(inSlotOrder(lineModeInput('axiom-5'), ['point', 'pivot'])).toBeNull();
    expect(inSlotOrder(lineModeInput('free'), ['a', 'b'])).toBeNull();
  });

  it('takes free points for a free line and a fold or crease, never a raw edge, for an existing one', () => {
    expect(lineModeInput('free').steps.map((step) => step.snap)).toEqual(['free', 'free']);
    expect(lineModeInput('crease').steps).toEqual([{ snap: 'crease-required', slot: null, edges: false }]);
    expect(toolInput('divide-line', 'axiom-2')?.steps).toEqual([{ snap: 'crease-required', slot: null, edges: true }]);
    // The reverse fold locates its line as every fold does.
    expect(toolInput('inside-reverse', 'axiom-2')).toBe(lineModeInput('axiom-2'));
    expect(nextStep(lineModeInput('crease'), 1)).toBeNull();
  });

  it('counts the clicks on the surface-agnostic sequence reducer', () => {
    const runtime = createToolRuntime(locateEngine(lineModeInput('axiom-2')));
    expect(runtime.feed({ kind: 'down', point: { x: 0, y: 0 } }).commit).toBeNull();
    expect(runtime.feed({ kind: 'down', point: { x: 1, y: 1 } }).commit?.points).toHaveLength(2);
  });

  it('offers optional point snapping for free-line ends, never for free region picks', () => {
    expect(lineModeInput('free').steps.every((step) => step.snapFree)).toBe(true);
    expect(toolInput('crimp', 'free', 'free').steps.every((step) => step.snapFree)).toBe(true);
    for (const tool of ['squash', 'petal', 'rabbit-ear'] as const) {
      expect(toolInput(tool, 'free').steps.filter((step) => step.snap === 'free').every((step) => !step.snapFree)).toBe(true);
    }
  });
});
