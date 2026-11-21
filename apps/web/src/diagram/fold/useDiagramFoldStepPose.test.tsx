import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Point3, SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource } from '../../cp-workspace/folded/connectedSpreadSource';
import { plainBook } from '../../cp-workspace/folded/foldedPrecrease.fixtures';
import { DEFAULT_CONNECTED_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { spreadUpdate } from '../../layer-spread/spreadUpdate';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createDiagram, insertSteps, type DiagramCpRender, type DiagramStep } from '../document/diagramDocument';
import { foldStepStep, stepsIn } from '../document/diagramSteps.fixtures';
import { useDiagramFoldStepPose, type DiagramFoldStepPose } from './useDiagramFoldStepPose';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The Step pane's own Fold pose is never live (DiagramStepPose), so its
 * Update must measure from the solve the open Pose shares (review E1): with
 * one shared, Update is offered, enabled, and asks for the amount that keeps
 * the picture.
 */
const shared = vi.hoisted(() => ({ solved: null as ConnectedSpreadView | null }));
vi.mock('./useFoldSpreadView', () => ({
  useFoldSpreadView: () => ({ view: null, preparing: false, solved: shared.solved }),
}));
vi.mock('./useFoldSpreadCamera', () => ({
  useFoldSpreadCamera: () => ({ onCamera: () => {}, registerLiveView: () => () => {}, actions: null, cancelCamera: () => {} }),
}));

const SAVED_SPREAD = { ...DEFAULT_CONNECTED_SPREAD, amount: 0.4 };
const SAVED: DiagramCpRender = {
  mode: 'folded-flat',
  side: 'front',
  rotationDeg: 0,
  foldCase: 1,
  spread: SAVED_SPREAD,
  presentation: { kind: 'perspective', camera: { yaw: 0, pitch: -0.4, zoom: 1 }, orderSide: 'front' },
};

function solvedView(): ConnectedSpreadView {
  const scene = plainBook();
  const source = connectedSpreadSource(scene);
  const reference = { plane: [0, 0, 0] as Point3, center: [0, 0, 0] as Point3, samples: 1, rms: 0 };
  const solution: SpreadSolution = {
    version: 'normalized-50-v1',
    heights: source.vertices.map((id) => (id === 2 || id === 5 ? 0.02 : 0)),
    references: [reference, reference],
    diagnostics: { status: 'solved', iterations: 1, qp_seconds: 0, variables: 6, constraints: 0,
      overlap_regions: 1, crossing_weight: 50, opening_scale: 1, max_relative_warp: 0,
      max_slope: 0.02, max_crossing: 0, rms_crossing: 0, mean_gap: 0.01 },
  };
  return { scene, prepared: { source, solution } };
}

const seen: { pose: DiagramFoldStepPose | null } = { pose: null };
let host: HTMLDivElement;
let root: Root;
const capture = vi.fn();

function Pane() {
  const step = useWorkspaceStore((store) => stepsIn(store.diagram!).find((each) => each.id === 's') ?? null) as DiagramStep | null;
  const pose = useDiagramFoldStepPose(step);
  useLayoutEffect(() => {
    seen.pose = pose;
  });
  return null;
}

beforeEach(() => {
  shared.solved = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  capture.mockReset();
  capture.mockImplementation(async (_stepId: string, request: { render: DiagramCpRender }) => ({
    status: 'captured', changed: true, render: request.render, tooDetailed: false, replaced: 0,
  }));
  useWorkspaceStore.setState({ captureDiagramFoldStep: capture });
  const diagram = insertSteps(createDiagram(), [foldStepStep('s', { render: SAVED })], 0);
  useWorkspaceStore.getState().installDiagram({ document: diagram, readOnly: false, raw: {} });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});

afterEach(() => act(() => root.unmount()));

it('offers Update held until the open Pose shares its solve, then asks for the amount that keeps the picture', async () => {
  act(() => root.render(<Pane />));
  expect(seen.pose!.equalOpening).toMatchObject({ disabled: true });
  const view = solvedView();
  shared.solved = view;
  act(() => root.render(<Pane />));
  expect(seen.pose!.equalOpening).toMatchObject({ disabled: false });
  await act(async () => {
    seen.pose!.equalOpening!.run();
    await vi.waitFor(() => expect(capture).toHaveBeenCalled());
  });
  const asked = (capture.mock.calls.at(-1)?.[1] as { render: DiagramCpRender }).render;
  expect(asked).toEqual({ ...SAVED, spread: { ...SAVED_SPREAD, version: 3, amount: spreadUpdate(SAVED_SPREAD, true, view.prepared, null)!.amount } });
});

it('shows the notice in Pose’s Step pane, and not in the Pages view’s inspector, which has no Pose to measure from', async () => {
  const { DiagramStepPose } = await import('../../components/diagram/DiagramStepPose');
  const { TooltipProvider } = await import('../../components/ui/Tooltip');
  shared.solved = solvedView();
  const step = stepsIn(useWorkspaceStore.getState().diagram!)[0]!;
  const notice = 'older Amount scale';
  act(() => root.render(<TooltipProvider><DiagramStepPose step={step} actions={[]} /></TooltipProvider>));
  expect(host.textContent).toContain(notice);
  act(() => root.render(<TooltipProvider><DiagramStepPose step={step} actions={[]} main /></TooltipProvider>));
  expect(host.textContent).not.toContain(notice);
});
