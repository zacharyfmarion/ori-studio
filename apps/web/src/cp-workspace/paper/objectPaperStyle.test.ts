import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { foldedFigureGesture } from '../folded/foldedFigureGesture';
import type { InlineSimulation } from '../inlineSimulation/inlineSimulation';
import { inlineSimulationGesture } from '../inlineSimulation/inlineSimulationGesture';
import {
  effectiveObjectPaperStyle,
  setFoldedFigureAppearance,
  setFoldedFigureAppearances,
  setInlineSimulationAppearance,
  setInlineSimulationAppearances,
} from './objectPaperStyle';

const FIGURE_ID = 'folded-1';
const WINDOW_ID = 'inline-sim-1';

function figure(): OristudioCpFoldedFigureEntry {
  return {
    id: FIGURE_ID,
    title: 'Folded model 1',
    handle: null,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    renderSnapshot: null,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
  };
}

function window(): InlineSimulation {
  return {
    id: WINDOW_ID,
    box: { center: { x: 0, y: 0 }, width: 100, height: 100, rotation: 0 },
    z: 1,
    view: { yaw: 0, pitch: 0, zoom: 1 },
    sourceBoundary: null,
    sourceBounds: null,
    sourceFingerprint: null,
    segmentIdHint: null,
  };
}

const initialSettings = useSettingsStore.getInitialState();

beforeEach(() => {
  foldedFigureGesture.abortAll();
  inlineSimulationGesture.abortAll();
  useSettingsStore.setState(initialSettings, true);
  useWorkspaceStore.setState({
    // `pushOverlayHistoryEntry` needs a document to record against; nothing here
    // reads its contents.
    oristudioCpDocument: { document: {}, summary: null } as unknown as OristudioCpDocumentState,
    oristudioCpFoldedFigures: [figure()],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpInlineSimulations: [window()],
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    dirty: false,
  });
});

afterEach(() => {
  foldedFigureGesture.abortAll();
  inlineSimulationGesture.abortAll();
});

describe('effectiveObjectPaperStyle', () => {
  it('is the display style with the object’s pins on top', () => {
    expect(effectiveObjectPaperStyle(figure())).toBe(DEFAULT_PAPER_STYLE);
    useSettingsStore.getState().setPaperStyleField('display', 'erode', 0.1);
    const pinned = { ...figure(), appearance: { 'paper.front': '#ff0000' } };
    expect(effectiveObjectPaperStyle(pinned)).toEqual({
      ...DEFAULT_PAPER_STYLE,
      erode: 0.1,
      paper: { ...DEFAULT_PAPER_STYLE.paper, front: '#ff0000' },
    });
    // The pin wins over the display style for its own field only.
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#00ff00');
    expect(effectiveObjectPaperStyle(pinned).paper.front).toBe('#ff0000');
    expect(effectiveObjectPaperStyle(figure()).paper.front).toBe('#00ff00');
  });
});

describe('the override verbs', () => {
  it('pin a field on a folded figure with exactly one undo entry', async () => {
    expect(await setFoldedFigureAppearance(FIGURE_ID, 'paper.front', '#ff0000')).toBe(true);
    const state = useWorkspaceStore.getState();
    expect(state.oristudioCpFoldedFigures[0]?.appearance).toEqual({ 'paper.front': '#ff0000' });
    expect(state.oristudioCpHistoryPast).toHaveLength(1);
    expect(state.oristudioCpHistoryPast[0]?.label).toBe('Change paper style');
    expect(state.dirty).toBe(true);

    expect(await setFoldedFigureAppearance(FIGURE_ID, 'paper.front', undefined)).toBe(true);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.appearance).toBeUndefined();
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(2);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast[1]?.label).toBe(
      'Reset paper style'
    );
  });

  it('record nothing for an edit that changed nothing', async () => {
    expect(await setFoldedFigureAppearance(FIGURE_ID, 'erode', undefined)).toBe(true);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toEqual([]);
    expect(await setFoldedFigureAppearance('missing', 'erode', 0.1)).toBe(false);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toEqual([]);
  });

  it('refuse while a drag holds the layer’s bracket', async () => {
    const token = foldedFigureGesture.begin('canvas');
    expect(token).not.toBeNull();
    expect(await setFoldedFigureAppearance(FIGURE_ID, 'erode', 0.1)).toBe(false);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.appearance).toBeUndefined();
  });

  it('clear several pins of a folded figure as one reset', async () => {
    expect(
      await setFoldedFigureAppearances(FIGURE_ID, [
        { field: 'paper.front', value: '#ff0000' },
        { field: 'paper.back', value: '#00ff00' },
      ])
    ).toBe(true);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.appearance).toEqual({
      'paper.front': '#ff0000',
      'paper.back': '#00ff00',
    });
    expect(
      await setFoldedFigureAppearances(FIGURE_ID, [
        { field: 'paper.front', value: undefined },
        { field: 'paper.back', value: undefined },
      ])
    ).toBe(true);
    const state = useWorkspaceStore.getState();
    expect(state.oristudioCpFoldedFigures[0]?.appearance).toBeUndefined();
    expect(state.oristudioCpHistoryPast.map((entry) => entry.label)).toEqual([
      'Change paper style',
      'Reset paper style',
    ]);
  });

  it('pin a field on an inline simulation window with exactly one undo entry', async () => {
    expect(await setInlineSimulationAppearance(WINDOW_ID, 'erode', 0.1)).toBe(true);
    const state = useWorkspaceStore.getState();
    expect(state.oristudioCpInlineSimulations[0]?.appearance).toEqual({ erode: 0.1 });
    expect(state.oristudioCpHistoryPast).toHaveLength(1);
    expect(state.oristudioCpHistoryPast[0]?.label).toBe('Change paper style');
  });

  it('pin several fields of a window as one entry, and clear them as one reset', async () => {
    // The crease style switch writes both fold pens from one press.
    const pen = { ...DEFAULT_PAPER_STYLE.mountainFolds, color: '#000000' };
    expect(
      await setInlineSimulationAppearances(WINDOW_ID, [
        { field: 'mountainFolds', value: pen },
        { field: 'valleyFolds', value: pen },
      ])
    ).toBe(true);
    let state = useWorkspaceStore.getState();
    expect(state.oristudioCpInlineSimulations[0]?.appearance).toEqual({
      mountainFolds: pen,
      valleyFolds: pen,
    });
    expect(state.oristudioCpHistoryPast.map((entry) => entry.label)).toEqual([
      'Change paper style',
    ]);

    expect(
      await setInlineSimulationAppearances(WINDOW_ID, [
        { field: 'mountainFolds', value: undefined },
        { field: 'valleyFolds', value: undefined },
      ])
    ).toBe(true);
    state = useWorkspaceStore.getState();
    expect(state.oristudioCpInlineSimulations[0]?.appearance).toBeUndefined();
    expect(state.oristudioCpHistoryPast.map((entry) => entry.label)).toEqual([
      'Change paper style',
      'Reset paper style',
    ]);
  });
});
