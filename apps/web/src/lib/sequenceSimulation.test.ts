import { describe, expect, it } from 'vitest';
import type { FoldDocument, SequencePlan, SequenceStateSnapshot } from '../engine/types';
import { buildSequenceStepSimulation } from './sequenceSimulation';

describe('buildSequenceStepSimulation', () => {
  it('uses before and after state angles for a normal step profile', () => {
    const plan = planWithStep({
      kind: 'simple_fold',
      id: 'step-1',
      label: 'Valley fold crease 4',
      affected_creases: [4],
      affected_faces: [0, 1],
      before_state: 'before',
      after_state: 'after',
    });

    const result = buildSequenceStepSimulation(plan, 'step-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.simulation.foldProfile.ranges.find((range) => range.edge === 4)).toEqual({
      edge: 4,
      fromAngle: 0,
      toAngle: 180,
    });
    expect(result.simulation.affectedCreases).toEqual([4]);
    expect(result.simulation.affectedFaces).toEqual([0, 1]);
    expect(result.simulation.warning).toBeNull();
  });

  it('locks non-affected creases flat for manual collapse previews', () => {
    const after = simpleFold(['B', 'B', 'B', 'B', 'V', 'M'], [null, null, null, null, 180, -180]);
    const plan = planWithStep(
      {
        kind: 'manual_collapse',
        id: 'manual',
        label: 'Collapse up until this point',
        affected_creases: [4],
        before_state: 'before',
        after_state: 'after',
      },
      simpleFold(['B', 'B', 'B', 'B', 'F', 'F'], [null, null, null, null, 0, 0]),
      after
    );

    const result = buildSequenceStepSimulation(plan, 'manual');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.simulation.foldProfile.ranges.find((range) => range.edge === 4)).toEqual({
      edge: 4,
      fromAngle: 0,
      toAngle: 180,
    });
    expect(result.simulation.foldProfile.ranges.find((range) => range.edge === 5)).toEqual({
      edge: 5,
      fromAngle: 0,
      toAngle: 0,
    });
    expect(result.simulation.fold.edges_assignment?.[5]).toBe('F');
    expect(result.simulation.warning).toMatch(/not a validated fold decomposition/i);
  });

  it('warns for heuristic macro-step previews', () => {
    const plan = planWithStep({
      kind: 'rabbit_ear',
      id: 'macro',
      label: 'Perform a rabbit ear',
      affected_creases: [4, 5],
      affected_faces: [0, 1],
      before_state: 'before',
      after_state: 'after',
      certificate: {
        status: 'heuristic',
        recognizer: 'topology_only_rabbit_ear',
        checked_creases: [4, 5],
        checked_faces: [0, 1],
        preconditions: [],
        postconditions: [],
        layer_order: { policy: 'preserved', preserved: true },
        diagnostics: [],
      },
    });

    const result = buildSequenceStepSimulation(plan, 'macro');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.simulation.warning).toMatch(/not been geometrically certified/i);
  });

  it('returns an explicit unavailable result when state ids are missing', () => {
    const plan = planWithStep({
      kind: 'simple_fold',
      id: 'step-1',
      label: 'Missing state',
      before_state: 'not-here',
      after_state: 'after',
    });

    const result = buildSequenceStepSimulation(plan, 'step-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Step simulation unavailable/);
    expect(result.reason).toMatch(/state data/);
  });
});

function planWithStep(
  step: SequencePlan['steps'][number],
  before = simpleFold(['B', 'B', 'B', 'B', 'F', 'F'], [null, null, null, null, 0, 0]),
  after = simpleFold(['B', 'B', 'B', 'B', 'V', 'F'], [null, null, null, null, 180, 0])
): SequencePlan {
  return {
    status: 'complete',
    steps: [step],
    states: [sequenceState('before', before), sequenceState('after', after)],
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

function sequenceState(id: string, document: FoldDocument): SequenceStateSnapshot {
  return {
    id,
    document,
    active_creases: [],
    face_orders: [],
    folded_vertices: document.vertices_coords.map((coord) => [coord[0] ?? 0, coord[1] ?? 0]),
    unresolved_regions: [],
    diagnostics: [],
  };
}

function simpleFold(
  assignments: FoldDocument['edges_assignment'],
  foldAngles: FoldDocument['edges_foldAngle']
): FoldDocument {
  return {
    file_spec: 1.2,
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
      [1, 3],
    ],
    edges_assignment: assignments,
    edges_foldAngle: foldAngles,
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}
