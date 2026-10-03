import { describe, expect, it } from 'vitest';

import { createDiagram, createStep, insertSteps } from '../../diagram/document/diagramDocument';
import type { DiagramDocument, DiagramStep } from '../../diagram/document/diagramDocument';
import { diagramDataBytes, trimDiagramHistory, type DiagramHistory } from './diagramState';
import { snapshotEntry } from './snapshotHistory';

/**
 * A step carried verbatim from a newer build — the one heavy part a diagram can
 * hold before pictures exist. `size` characters of payload.
 */
function lockedStep(id: string, size: number): DiagramStep {
  return { ...createStep(() => id), unknown: { id, payload: 'x'.repeat(size) } };
}

function diagramWith(...steps: DiagramStep[]): DiagramDocument {
  const empty = createDiagram({ newId: () => 'diagram' });
  return insertSteps(empty, steps, 0);
}

function historyOf(...snapshots: (DiagramDocument | null)[]): DiagramHistory {
  return { past: snapshots.map((snapshot) => snapshotEntry(snapshot, 'edit')), future: [] };
}

describe('the diagram history byte cap', () => {
  it('keeps every entry while what they hold fits', () => {
    const a = lockedStep('a', 100);
    const history = historyOf(null, diagramWith(a));
    expect(trimDiagramHistory(history, diagramWith(a), 1_000)).toBe(history);
  });

  it('drops the oldest entries once the data only they keep alive passes the cap', () => {
    const steps = ['a', 'b', 'c', 'd'].map((id) => lockedStep(id, 400));
    // Each entry held a different replaced step; the current diagram holds none.
    const history = historyOf(...steps.map((step) => diagramWith(step)));

    const trimmed = trimDiagramHistory(history, diagramWith(), 1_000);

    // The two newest fit in 1,000 bytes; the third would not.
    expect(trimmed.past).toEqual(history.past.slice(2));
  });

  it('counts data the current diagram still holds as free, and shared data once', () => {
    const big = lockedStep('big', 5_000);
    // Every entry, and the current diagram, share the one large step.
    const history = historyOf(diagramWith(big), diagramWith(big), diagramWith(big, lockedStep('s', 10)));

    expect(trimDiagramHistory(history, diagramWith(big), 1_000)).toBe(history);
  });

  it('measures what a diagram puts in the file', () => {
    expect(diagramDataBytes(null)).toBe(0);
    expect(diagramDataBytes(diagramWith(createStep()))).toBe(0);
    const step = lockedStep('a', 2_000);
    expect(diagramDataBytes(diagramWith(step))).toBe(JSON.stringify(step.unknown).length);
  });
});
