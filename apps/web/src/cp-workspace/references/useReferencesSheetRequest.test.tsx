import { act, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { SheetAnalysis } from './sheetFrames';
import { useReferencesMode } from './useReferencesMode';
import { useReferencesSheetRequest } from './useReferencesSheetRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties: Record<string, unknown> }[] = [];
vi.mock('../../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties: Record<string, unknown>) => {
    tracked.push({ event, properties });
  },
}));

const FRAMES = {
  components: [
    { id: 2, outline: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { id: 5, outline: [[2, 0], [3, 0], [3, 1], [2, 1]] },
  ],
} as unknown as SheetAnalysis;
const SHEET_TWO = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]];

const state = () => useWorkspaceStore.getState();

/** The panel's wiring: the mode, its sheet select, and the request between them. */
function Harness({ frames }: { frames: SheetAnalysis | null }) {
  const { setMode } = useReferencesMode('document-1', false, () => {});
  const showSheet = useCallback((component: number) => state().setReferencesSelectedSheet(component), []);
  useReferencesSheetRequest(frames, showSheet, setMode);
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  tracked.length = 0;
});

describe('useReferencesSheetRequest', () => {
  it('opens the step’s sheet in its mode, though the sheet switch puts the workspace in Find', () => {
    state().setReferencesSelectedSheet(5);
    state().setReferencesView({ mode: 'sequence' });
    act(() => root!.render(<Harness frames={null} />));
    act(() => useWorkspaceStore.setState({ referencesSheetRequest: { boundary: SHEET_TWO, mode: 'sequence' } }));
    act(() => root!.render(<Harness frames={FRAMES} />));
    expect(state().referencesSelectedSheet).toBe(2);
    expect(state().referencesView.mode).toBe('sequence');
    expect(tracked).toEqual([{ event: 'referencesModeChanged', properties: { mode: 'sequence', source: 'diagram' } }]);
    expect(state().referencesSheetRequest).toBeNull();
  });

  it('asks for the step’s card on the sheet it opened, after the switch', () => {
    const card = { number: 2, line: { n: [1, 0] as [number, number], d: 0.5 } };
    state().setReferencesSelectedSheet(5);
    useWorkspaceStore.setState({ referencesSheetRequest: { boundary: SHEET_TWO, mode: 'sequence', card } });
    act(() => root!.render(<Harness frames={FRAMES} />));
    expect(state().referencesSelectedSheet).toBe(2);
    expect(state().referencesCardRequest).toEqual({ sheet: 2, card });
    // Another sheet chosen before the plan lands drops it.
    act(() => state().setReferencesSelectedSheet(5));
    expect(state().referencesCardRequest).toBeNull();
  });

  it('switches nothing, and counts nothing, when the sheet is already open in that mode', () => {
    state().setReferencesSelectedSheet(2);
    state().setReferencesView({ mode: 'sequence' });
    useWorkspaceStore.setState({ referencesSheetRequest: { boundary: SHEET_TWO, mode: 'sequence' } });
    act(() => root!.render(<Harness frames={FRAMES} />));
    expect(state().referencesView.mode).toBe('sequence');
    expect(tracked).toEqual([]);
  });
});
