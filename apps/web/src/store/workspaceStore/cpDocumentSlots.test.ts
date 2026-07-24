import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../workspaceStore';
import {
  activeSlotTracksProjectDirty,
  captureCpDocumentState,
  cpSlotGeneration,
  cpSlotGenerationIsCurrent,
  enterCpDocumentSlot,
  installCpDocumentState,
  rememberPristineCpDocumentState,
  resetCpDocumentSlotsForTest,
} from './cpDocumentSlots';
import { activeCpDocumentSlot } from './oristudioCpRuntime';
import { CP_DOCUMENT_SCOPED_KEYS, type CpDocumentScopedState } from './types';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';

/**
 * A recognisable stand-in for a loaded document. The slot machinery only ever
 * moves these values around, so the shapes need to be distinguishable, not real.
 */
function markDocumentState(marker: string): Partial<CpDocumentScopedState> {
  return {
    oristudioCpDocument: { marker } as unknown as CpDocumentScopedState['oristudioCpDocument'],
    oristudioCpRevision: 7,
    oristudioCpHistoryPast: [
      { label: `${marker}-edit` } as unknown as CpDocumentScopedState['oristudioCpHistoryPast'][number],
    ],
    oristudioCpSelection: emptyOristudioCpSelection(),
    oristudioCpError: `${marker}-error`,
  };
}

describe('crease-pattern document slots', () => {
  beforeEach(() => {
    resetCpDocumentSlotsForTest();
    // A pristine baseline for slots that have never been entered.
    installCpDocumentState({
      ...captureCpDocumentState(useWorkspaceStore.getState()),
      oristudioCpDocument: null,
      oristudioCpRevision: 0,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      oristudioCpError: null,
    });
    rememberPristineCpDocumentState(useWorkspaceStore.getState());
  });

  it('starts in the edit slot', () => {
    expect(activeCpDocumentSlot()).toBe('edit');
  });

  it('is a no-op when the requested slot is already active', () => {
    const generation = cpSlotGeneration();
    enterCpDocumentSlot('edit');
    expect(cpSlotGeneration()).toBe(generation);
  });

  /**
   * The load-bearing test. A type can prove the *declared* fields travel; only a
   * behavioural round-trip can prove nothing leaks through state a type cannot
   * see. If someone later adds a module-level cache keyed to "the current
   * document", this is what fails.
   */
  it('restores the edit document byte-for-byte after a round trip through learn', () => {
    useWorkspaceStore.setState(markDocumentState('editor') as never);
    const before = captureCpDocumentState(useWorkspaceStore.getState());

    enterCpDocumentSlot('learn');
    // The learn slot starts pristine rather than inheriting the editor's work.
    expect(useWorkspaceStore.getState().oristudioCpDocument).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toEqual([]);

    useWorkspaceStore.setState(markDocumentState('lesson') as never);

    enterCpDocumentSlot('edit');
    expect(captureCpDocumentState(useWorkspaceStore.getState())).toEqual(before);
  });

  it('keeps each slot’s document across repeated switches', () => {
    useWorkspaceStore.setState(markDocumentState('editor') as never);
    enterCpDocumentSlot('learn');
    useWorkspaceStore.setState(markDocumentState('lesson') as never);
    const lessonState = captureCpDocumentState(useWorkspaceStore.getState());

    enterCpDocumentSlot('edit');
    enterCpDocumentSlot('learn');

    expect(captureCpDocumentState(useWorkspaceStore.getState())).toEqual(lessonState);
  });

  it('advances the generation on every switch so in-flight work can be dropped', () => {
    const captured = cpSlotGeneration();
    expect(cpSlotGenerationIsCurrent(captured)).toBe(true);

    enterCpDocumentSlot('learn');

    expect(cpSlotGenerationIsCurrent(captured)).toBe(false);
    expect(cpSlotGenerationIsCurrent(cpSlotGeneration())).toBe(true);
  });

  it('does not let an ephemeral slot mark the project dirty', () => {
    expect(activeSlotTracksProjectDirty()).toBe(true);
    enterCpDocumentSlot('learn');
    expect(activeSlotTracksProjectDirty()).toBe(false);

    useWorkspaceStore.setState({ dirty: true });
    // The store-level invariant clears it again (see store.ts).
    expect(useWorkspaceStore.getState().dirty).toBe(false);

    enterCpDocumentSlot('edit');
    useWorkspaceStore.setState({ dirty: true });
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  /**
   * Regression: suppressing `dirty` for the tutorial must not *destroy* the
   * editor's copy of it. When `dirty` was global, a round trip through a lesson
   * silently told the user their unsaved work was saved.
   */
  it('preserves unsaved-changes state across a round trip through learn', () => {
    useWorkspaceStore.setState({ ...markDocumentState('editor'), dirty: true } as never);
    expect(useWorkspaceStore.getState().dirty).toBe(true);

    enterCpDocumentSlot('learn');
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    useWorkspaceStore.setState(markDocumentState('lesson') as never);

    enterCpDocumentSlot('edit');
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('captures every document-scoped field and nothing else', () => {
    const bundle = captureCpDocumentState(useWorkspaceStore.getState());
    expect(Object.keys(bundle).sort()).toEqual(Object.keys(CP_DOCUMENT_SCOPED_KEYS).sort());
  });
});
