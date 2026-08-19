import type { FoldProfile } from '@treemaker/origami-simulator';
import type {
  FoldAssignment,
  FoldDocument,
  SequenceInstructionStep,
  SequencePlan,
  SequenceStateSnapshot,
} from '../engine/types';

export interface SequenceStepSimulation {
  step: SequenceInstructionStep;
  stepIndex: number;
  beforeState: SequenceStateSnapshot;
  afterState: SequenceStateSnapshot;
  fold: FoldDocument;
  foldProfile: FoldProfile;
  affectedCreases: number[];
  affectedFaces: number[];
  warning: string | null;
}

export type SequenceStepSimulationResult =
  { ok: true; simulation: SequenceStepSimulation } | { ok: false; reason: string };

const MANUAL_COLLAPSE_WARNING =
  'Approximate manual collapse preview. This is not a validated fold decomposition.';

export function buildSequenceStepSimulation(
  plan: SequencePlan | null | undefined,
  stepId: string,
): SequenceStepSimulationResult {
  if (!plan) return unavailable('No sequence plan is available.');
  const stepIndex = plan.steps.findIndex((candidate) => candidate.id === stepId);
  if (stepIndex < 0) return unavailable(`Step ${stepId} is not in the current sequence plan.`);
  const step = plan.steps[stepIndex];
  if (!step.before_state || !step.after_state) {
    return unavailable('The selected step does not include before and after state ids.');
  }

  const beforeState = plan.states.find((state) => state.id === step.before_state);
  const afterState = plan.states.find((state) => state.id === step.after_state);
  if (!beforeState || !afterState) {
    return unavailable('The selected step references state data that is no longer available.');
  }
  if (!sameTopology(beforeState.document, afterState.document)) {
    return unavailable(
      'The selected step changes topology, so it cannot be simulated step-locally.',
    );
  }

  const affectedCreases = affectedCreasesForStep(step);
  const affectedFaces = affectedFacesForStep(step);
  const isManualCollapse = step.kind === 'manual_collapse';
  const ranges = afterState.document.edges_vertices.map((_, edge) => {
    const fromAngle = isManualCollapse ? 0 : foldAngleForEdge(beforeState.document, edge);
    const toAngle =
      isManualCollapse && !affectedCreases.includes(edge)
        ? 0
        : foldAngleForEdge(afterState.document, edge);
    return { edge, fromAngle, toAngle };
  });

  const fold = cloneFoldDocument(afterState.document);
  fold.frame_title = `${step.label} simulation`;
  fold.edges_assignment = ranges.map((range, edge) =>
    simulationAssignmentForRange(afterState.document, edge, range.fromAngle, range.toAngle),
  );
  fold.edges_foldAngle = ranges.map((range) => range.toAngle);

  return {
    ok: true,
    simulation: {
      step,
      stepIndex,
      beforeState,
      afterState,
      fold,
      foldProfile: { ranges },
      affectedCreases,
      affectedFaces,
      warning: isManualCollapse ? MANUAL_COLLAPSE_WARNING : null,
    },
  };
}

function unavailable(reason: string): SequenceStepSimulationResult {
  return { ok: false, reason: `Step simulation unavailable: ${reason}` };
}

function sameTopology(left: FoldDocument, right: FoldDocument): boolean {
  return (
    left.vertices_coords.length === right.vertices_coords.length &&
    left.edges_vertices.length === right.edges_vertices.length &&
    left.faces_vertices.length === right.faces_vertices.length
  );
}

function affectedCreasesForStep(step: SequenceInstructionStep): number[] {
  const region = (step as { region?: { creases?: number[] } }).region;
  return uniqueSorted(region?.creases ?? step.affected_creases ?? []);
}

function affectedFacesForStep(step: SequenceInstructionStep): number[] {
  const region = (step as { region?: { faces?: number[] } }).region;
  return uniqueSorted(region?.faces ?? step.affected_faces ?? []);
}

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value >= 0))).sort(
    (a, b) => a - b,
  );
}

function foldAngleForEdge(document: FoldDocument, edge: number): number {
  const explicit = document.edges_foldAngle?.[edge];
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  return assignmentFoldAngle(document.edges_assignment?.[edge]) ?? 0;
}

function assignmentFoldAngle(assignment: FoldAssignment | undefined): number | null {
  if (assignment === 'M') return -180;
  if (assignment === 'V') return 180;
  if (assignment === 'F') return 0;
  return null;
}

function simulationAssignmentForRange(
  document: FoldDocument,
  edge: number,
  fromAngle: number,
  toAngle: number,
): FoldAssignment {
  const existing = document.edges_assignment?.[edge];
  if (fromAngle === 0 && toAngle === 0 && existing && isBoundaryAssignment(existing)) {
    return existing;
  }
  const nonZeroAngle = toAngle !== 0 ? toAngle : fromAngle;
  if (nonZeroAngle < 0) return 'M';
  if (nonZeroAngle > 0) return 'V';
  return 'F';
}

function isBoundaryAssignment(assignment: FoldAssignment): boolean {
  return assignment === 'B' || assignment === 'C' || assignment === 'J';
}

function cloneFoldDocument(document: FoldDocument): FoldDocument {
  return {
    ...document,
    frame_classes: [...(document.frame_classes ?? [])],
    vertices_coords: document.vertices_coords.map((coord) => [...coord]),
    edges_vertices: document.edges_vertices.map((edge) => [edge[0], edge[1]]),
    edges_assignment: document.edges_assignment ? [...document.edges_assignment] : undefined,
    edges_foldAngle: document.edges_foldAngle ? [...document.edges_foldAngle] : undefined,
    edges_faces: document.edges_faces?.map((faces) => [...faces]),
    faces_vertices: document.faces_vertices.map((face) => [...face]),
    faces_edges: document.faces_edges?.map((edges) => [...edges]),
    face_orders: document.face_orders?.map((order) => [order[0], order[1], order[2]]),
  };
}
