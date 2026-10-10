import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createDiagram, createStep, createTurn, insertSteps, stepById, type DiagramEntry, type DiagramStep } from '../document/diagramDocument';
import { cpStep, referencesStep } from '../document/diagramSteps.fixtures';
import { useDiagramStepLink, type DiagramStepLink } from './useStepLink';

/** The pattern picker's Show as, through the store: what it offers each time it opens. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = () => useWorkspaceStore.getState();
const seen: { link: DiagramStepLink | null } = { link: null };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Probe() {
  const step = useWorkspaceStore((store) => (store.diagram ? stepById(store.diagram, 'step-c') : null));
  const link = useDiagramStepLink(step);
  useLayoutEffect(() => {
    seen.link = link;
  });
  return null;
}

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useWorkspaceStore.setState({
    diagram: insertSteps(
      createDiagram({ title: 'Picker' }),
      [cpStep('step-c', { mode: 'crease-pattern', rotationDeg: 0 }), cpStep('step-d', { mode: 'crease-pattern', rotationDeg: 0 })],
      0
    ),
  });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() => root!.render(<Probe />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('the pattern picker’s Show as', () => {
  it('offers the step’s own way each time it opens, whatever was picked when it last closed', () => {
    act(() => void state().openDiagramPatternPicker('step-c'));
    expect(seen.link?.picker?.showAs).toBe('crease-pattern');
    act(() => seen.link!.picker!.setShowAs('folded'));
    expect(seen.link?.picker?.showAs).toBe('folded');
    // Closed by something other than Cancel — here the picker itself, as a link does.
    act(() => state().closeDiagramPatternPicker());
    act(() => void state().openDiagramPatternPicker('step-c'));
    expect(seen.link?.picker?.showAs).toBe('crease-pattern');
  });

  it('offers a step with no link the way the nearest linked step before it is shown, past turns, uploads and References steps (review fix 3)', () => {
    const upload: DiagramStep = { ...createStep(() => 'step-u'), source: { kind: 'upload', assetId: 'u', rotationQuarterTurns: 0, mirrored: false } };
    const before: DiagramEntry[] = [
      cpStep('step-f', { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 }),
      createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-1'),
      upload,
      referencesStep('step-r'),
    ];
    const empty = createStep(() => 'step-c');
    useWorkspaceStore.setState({ diagram: insertSteps(createDiagram({ title: 'Picker' }), [...before, empty], 0) });
    act(() => void state().openDiagramPatternPicker('step-c'));
    expect(seen.link?.picker?.showAs).toBe('folded');
    // Nothing linked before it: the way the picker last linked, a crease pattern until it has.
    act(() => state().closeDiagramPatternPicker());
    useWorkspaceStore.setState({ diagram: insertSteps(createDiagram({ title: 'Picker' }), [empty, ...before], 0) });
    act(() => void state().openDiagramPatternPicker('step-c'));
    expect(seen.link?.picker?.showAs).toBe('crease-pattern');
  });

  it('forgets a way picked for a step when another step is selected', () => {
    act(() => void state().openDiagramPatternPicker('step-c'));
    act(() => seen.link!.picker!.setShowAs('simulated'));
    act(() => state().selectDiagramStep('step-d'));
    act(() => void state().openDiagramPatternPicker('step-c'));
    expect(seen.link?.picker?.showAs).toBe('crease-pattern');
  });
});
