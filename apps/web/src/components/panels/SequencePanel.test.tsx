import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FoldArtifacts,
  FoldDocument,
  SequencePlan,
  SequenceStateSnapshot,
  SequenceStepCertificate,
} from '../../engine/types';
import { createSampleProject } from '../../lib/sampleProject';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { SequencePanel } from './SequencePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
});

describe('SequencePanel', () => {
  it('renders before and after previews for a simple fold step', () => {
    const rendered = renderPanel(simplePlan());

    expect(rendered.querySelector('[aria-label="Folding sequence diagram"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Step 1 Before folded state unfolded"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Step 1 After folded state target"]')).not.toBeNull();
    expect(rendered.querySelectorAll('.sequence-preview-crease--highlight')).toHaveLength(2);
    expect(rendered.querySelector<HTMLDetailsElement>('.sequence-panel__details')?.open).toBe(false);
    expect(rendered.querySelector('.sequence-diagram-step__header')?.textContent).toContain('Step 1');
    expect(rendered.querySelector('.sequence-diagram-step__header')?.textContent).toContain('Simulate');
    expect(rendered.querySelector('.sequence-diagram-step__header')?.textContent).toContain('verified');
    expect(rendered.querySelector('.sequence-diagram-step__header')?.textContent).not.toContain('1 crease');
    expect(rendered.querySelector('.sequence-diagram-step__certificate-note')?.textContent).toContain(
      'boundary simple fold'
    );
    expect(rendered.querySelector('.sequence-diagram-step__label')?.textContent).toContain(
      'Make a valley fold on crease 6'
    );
    expect(
      rendered
        .querySelector('.sequence-diagram-step__visuals')
        ?.compareDocumentPosition(rendered.querySelector('.sequence-diagram-step__copy') as Node)
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(rendered.textContent).toContain('Make a valley fold on crease 6');
  });

  it('renders partial plans as a leading manual collapse step', () => {
    const plan = simplePlan();
    plan.status = 'partial';
    plan.states = [
      sequenceState('flat-cp', simpleFold(), [6]),
      sequenceState('target', simpleFold(), [6]),
    ];
    plan.steps = [
      {
        kind: 'manual_collapse',
        id: 'step-1',
        label: 'Collapse up until this point',
        affected_creases: [1, 2],
        affected_faces: [0],
        before_state: 'flat-cp',
        after_state: 'target',
        certificate: certificate('manual', 'manual_collapse_boundary', [1, 2], [0]),
      },
    ];

    const rendered = renderPanel(plan);

    expect(rendered.textContent).toContain('Collapse up until this point');
    expect(rendered.querySelector('.sequence-diagram-step__certificate')?.textContent).toContain('manual');
    expect(rendered.textContent).not.toContain('Unsupported collapse region');
    expect(rendered.querySelector('[aria-label="Step 1 Before folded state flat-cp"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Step 1 After folded state target"]')).not.toBeNull();
    expect(rendered.querySelectorAll('.sequence-preview-crease--highlight')).toHaveLength(4);
    expect(rendered.querySelector('.sequence-preview-face--highlight')).not.toBeNull();
  });

  it('focuses the simulator on a step when the step simulate action is clicked', () => {
    const activatePanel = vi.fn();
    useLayoutStore.setState({ activatePanel });
    const rendered = renderPanel(simplePlan());
    const button = rendered.querySelector<HTMLButtonElement>('[aria-label="Simulate step"]');

    act(() => {
      button?.click();
    });

    expect(useWorkspaceStore.getState().sequenceSimulationFocus).toEqual({
      kind: 'sequence_step',
      stepId: 'step-1',
    });
    expect(activatePanel).toHaveBeenCalledWith('simulator');
  });

  it('shows an indeterminate planning indicator while sequence planning is running', () => {
    const rendered = renderPanel(null, { sequencePlanning: true });

    expect(rendered.querySelector('.sequence-panel__toolbar-summary')?.textContent).toContain('Planning');
    expect(rendered.textContent).toContain('Planning folding sequence');
    expect(rendered.textContent).toContain('Resolving the flat-fold target');
    expect(rendered.querySelector('[aria-label="Sequence planning in progress"]')).not.toBeNull();
  });
});

function renderPanel(
  plan: SequencePlan | null,
  state: Partial<ReturnType<typeof useWorkspaceStore.getState>> = {}
) {
  const fold = plan?.states[0]?.document ?? simpleFold();
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      project: createSampleProject(),
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      engineReady: true,
      foldArtifacts: { fold } satisfies FoldArtifacts,
      sequencePlan: plan,
      ...state,
    },
    true
  );

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <SequencePanel />
      </TooltipProvider>
    );
  });
  return container;
}

function simplePlan(): SequencePlan {
  const unfolded = sequenceState('unfolded', simpleFold(['B', 'B', 'B', 'B', 'B', 'B', 'F']), []);
  const target = sequenceState('target', simpleFold(), [6]);
  return {
    status: 'complete',
    steps: [
      {
        kind: 'simple_fold',
        id: 'step-1',
        label: 'Make a valley fold on crease 6',
        affected_creases: [6],
        affected_faces: [0, 1],
        before_state: 'unfolded',
        after_state: 'target',
        certificate: certificate('verified', 'boundary_simple_fold', [6], [0, 1]),
      },
    ],
    states: [unfolded, target],
    diagnostics: [],
    unresolved_regions: [],
    search: {
      states_explored: 2,
      branches_pruned: 0,
      repeated_states: 0,
      timed_out: false,
      budget_exhausted: false,
      best_unresolved_creases: 0,
      target_solves: 0,
      target_solve_cache_hits: 0,
      duplicate_candidates_pruned: 0,
    },
  };
}

function certificate(
  status: SequenceStepCertificate['status'],
  recognizer: string,
  creases: number[],
  faces: number[]
): SequenceStepCertificate {
  return {
    status,
    recognizer,
    checked_creases: creases,
    checked_faces: faces,
    preconditions: [],
    postconditions: status === 'verified' ? [] : [{ code: 'open', status: 'warning', message: 'Open check' }],
    layer_order: { policy: 'preserved', preserved: true },
    diagnostics: [],
  };
}

function sequenceState(
  id: string,
  document: FoldDocument,
  activeCreases: number[]
): SequenceStateSnapshot {
  return {
    id,
    document,
    active_creases: activeCreases,
    face_orders: [],
    folded_vertices: document.vertices_coords.map((coord) => [coord[0] ?? 0, coord[1] ?? 0]),
    unresolved_regions: [],
    diagnostics: [],
  };
}

function simpleFold(
  assignments: FoldDocument['edges_assignment'] = ['B', 'B', 'B', 'B', 'B', 'B', 'V']
): FoldDocument {
  return {
    file_spec: 1.2,
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0.5],
      [1, 0.5],
    ],
    edges_vertices: [
      [0, 1],
      [1, 5],
      [5, 2],
      [2, 3],
      [3, 4],
      [4, 0],
      [4, 5],
    ],
    edges_assignment: assignments,
    edges_foldAngle: [null, null, null, null, null, null, assignments?.[6] === 'F' ? 0 : 180],
    faces_vertices: [
      [0, 1, 5, 4],
      [4, 5, 2, 3],
    ],
  };
}
