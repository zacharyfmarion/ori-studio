import { beforeEach, describe, expect, it } from 'vitest';
import type { ReferencesReaderStateV1 } from '../../../cp-workspace/references/referencesReaderState';
import { useWorkspaceStore } from '../store';
import { DEFAULT_REFERENCES_SETTINGS, restoredReferencesState } from './referencesSlice';

const SAVED: ReferencesReaderStateV1 = {
  v: 1,
  settings: { precreaseGrid: false, candidateCount: 400 },
  mode: 'sequence',
  sheet: { bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
  landmarksFirst: true,
  activeCard: { index: 3, line: { n: [1, 0], d: 0.5 } },
};

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('restoredReferencesState', () => {
  it('leaves everything as it is for a file that says nothing, but what the last open restored', () => {
    expect(restoredReferencesState(null, 3, DEFAULT_REFERENCES_SETTINGS)).toEqual({
      referencesRestore: null,
    });
  });

  it('takes the file’s settings over the session’s, and the rest as it was saved', () => {
    const session = { ...DEFAULT_REFERENCES_SETTINGS, includeApproximate: true };
    const state = restoredReferencesState(SAVED, 3, session);
    expect(state.referencesSettings).toEqual({
      ...session,
      precreaseGrid: false,
      // Clamped like any other setting that reaches the store.
      candidateCount: 20,
    });
    expect(state.referencesView).toMatchObject({ mode: 'sequence', landmarksFirst: true, activeStep: 0 });
    expect(state.referencesSelectedSheet).toBeNull();
    expect(state.referencesRestore).toEqual({ loadSerial: 3, sheet: SAVED.sheet, card: SAVED.activeCard });
  });
});

describe('the restore record', () => {
  const restore = () => useWorkspaceStore.getState().referencesRestore;

  beforeEach(() => {
    useWorkspaceStore.setState(restoredReferencesState(SAVED, 3, DEFAULT_REFERENCES_SETTINGS));
  });

  it('selects the restored sheet without resetting what was restored with it', () => {
    useWorkspaceStore.getState().commitReferencesRestoredSheet(5);
    const state = useWorkspaceStore.getState();
    expect(state.referencesSelectedSheet).toBe(5);
    expect(state.referencesView.mode).toBe('sequence');
    expect(state.referencesView.landmarksFirst).toBe(true);
    expect(restore()).toEqual({ loadSerial: 3, sheet: null, card: SAVED.activeCard });
  });

  it('drops the card with a sheet that is not there any more', () => {
    useWorkspaceStore.getState().commitReferencesRestoredSheet(null);
    expect(useWorkspaceStore.getState().referencesSelectedSheet).toBeNull();
    expect(restore()).toEqual({ loadSerial: 3, sheet: null, card: null });
  });

  it('hands the card over once', () => {
    expect(useWorkspaceStore.getState().takeReferencesRestoredCard(3)).toEqual(SAVED.activeCard);
    expect(useWorkspaceStore.getState().takeReferencesRestoredCard(3)).toBeNull();
    // The record itself stays, so the open is still known to have restored a mode.
    expect(restore()?.loadSerial).toBe(3);
  });

  // A card saved with one file names a line, and another file's plan can have
  // a fold on that line: handed over, it would open the other file mid-plan.
  it('hands the card only to the document it was restored for', () => {
    expect(useWorkspaceStore.getState().takeReferencesRestoredCard(4)).toBeNull();
    expect(restore()?.card).toEqual(SAVED.activeCard);
  });

  it('ends when the reader picks a sheet themselves', () => {
    useWorkspaceStore.getState().setReferencesSelectedSheet(9);
    expect(restore()).toEqual({ loadSerial: 3, sheet: null, card: null });
  });
});
