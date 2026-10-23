import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { valleyAt } from '../document/foldSequence.fixtures';
import type { FoldOp } from '../document/foldSequenceDocument';

const state = () => useWorkspaceStore.getState();
beforeEach(() => useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true));

describe('individual Repeat transaction', () => {
  it('branches with an entire range, with one undo/redo for all new nodes', () => {
    const a = state().commitFoldStep({ parent: null, op: valleyAt(0.2) })!;
    const b = state().commitFoldStep({ parent: a, op: valleyAt(0.3) })!;
    state().moveFoldCursor(a);
    const history = state().foldHistory.past.length;
    const last = state().commitFoldSteps(a, [{ op: valleyAt(0.7) }, { op: valleyAt(0.8) }], state().foldLoadId);
    expect(last).not.toBeNull();
    const document = state().foldSequences[0]!.document;
    expect(document.steps.map((s) => s.parent)).toEqual([null, a, a, document.steps[2]!.id]);
    expect(state().foldHistory.past).toHaveLength(history + 1);
    expect(state().foldReader?.cursor).toBe(last);
    state().undoFold();
    expect(state().foldSequences[0]!.document.steps.map((s) => s.id)).toEqual([a, b]);
    state().redoFold();
    expect(state().foldSequences[0]!.document.steps).toEqual(document.steps);
    // Existing Undo/Redo navigation selects the first restored subtree node.
    expect(state().foldReader?.cursor).toBe(document.steps[2]!.id);
  });

  it('rejects a stale cursor and a malformed suffix without recording an undo entry', () => {
    const a = state().commitFoldStep({ parent: null, op: valleyAt(0.2) })!;
    const b = state().commitFoldStep({ parent: a, op: valleyAt(0.3) })!;
    const before = state().foldSequences;
    const history = state().foldHistory.past;
    expect(state().commitFoldSteps(a, [{ op: valleyAt(0.7) }], state().foldLoadId)).toBeNull();
    expect(
      state().commitFoldSteps(b, [{ op: valleyAt(0.7) }, { op: { kind: 'future-op' } as unknown as FoldOp }], state().foldLoadId),
    ).toBeNull();
    expect(state().foldSequences).toBe(before);
    expect(state().foldHistory.past).toBe(history);
  });
});
