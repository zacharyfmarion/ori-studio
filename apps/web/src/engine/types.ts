import type { Point } from '../lib/geometry';
import type { CpSegment } from '../lib/creasePatternSegmentation';

export interface TreeSnapshot {
  summary: TreeSummary;
  cp_status_report: CpStatusReport;
  paper: PaperSettings;
  nodes: NodeSnapshot[];
  edges: EdgeSnapshot[];
  paths: PathSnapshot[];
  vertices: VertexSnapshot[];
  creases: CreaseSnapshot[];
  facets: FacetSnapshot[];
  conditions: ConditionSnapshot[];
}

export type FoldAssignment = 'B' | 'M' | 'V' | 'F' | 'U' | 'C' | 'J';

export interface FoldDocument {
  file_spec?: number;
  file_creator?: string;
  file_author?: string;
  file_title?: string;
  frame_title?: string;
  frame_parent?: number;
  frame_inherit?: boolean;
  frame_classes?: string[];
  vertices_coords: number[][];
  edges_vertices: [number, number][];
  edges_assignment?: FoldAssignment[];
  edges_foldAngle?: Array<number | null>;
  edges_faces?: number[][];
  faces_vertices: number[][];
  faces_edges?: number[][];
  face_orders?: [number, number, number][];
  file_frames?: FoldDocument[];
  [key: string]: unknown;
}

export interface FoldedBaseVertex {
  id: number;
  source_vertex: number;
  loc: Point;
  paper_loc: Point;
  depth: number;
  elevation: number;
  is_border: boolean;
}

export interface FoldedBaseCrease {
  id: number;
  source_crease: number;
  vertices: [number, number];
  kind: number;
  fold: number;
}

export interface FoldedBaseFacet {
  id: number;
  source_facet: number;
  vertices: number[];
  color: number;
  order: number;
}

export interface FoldedBaseSnapshot {
  vertices: FoldedBaseVertex[];
  creases: FoldedBaseCrease[];
  facets: FoldedBaseFacet[];
}

/**
 * The triangulated, consistently-wound mesh the simulator folds, built from a
 * `FoldDocument` by `foldArtifactsFromFold`. Crease parameters are deliberately
 * not carried: `simulatorSession` derives them when it prepares the model for a
 * run, and no other consumer needs them.
 */
export interface SimulationModel {
  fold: FoldDocument;
}

export interface FoldArtifacts {
  fold: FoldDocument;
  folded_base?: FoldedBaseSnapshot | null;
  folded_base_error?: string | null;
  simulation_model?: SimulationModel | null;
  /**
   * Why there is no simulation model. Either the engine declined to offer one
   * (a TreeMaker design without a complete crease pattern) or preparation
   * failed.
   */
  simulation_model_error?: string | null;
  /**
   * Crease-pattern segments computed from `simulationFoldOf(this)`. Populated in
   * the treemaker worker; absent on artifacts produced before segmentation
   * existed. See `lib/creasePatternSegmentation`.
   */
  segments?: CpSegment[];
}

export type SequencePlanStatus = 'complete' | 'partial' | 'unsupported' | 'invalid_input';
export type SequenceDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface SequenceDiagnostic {
  severity: SequenceDiagnosticSeverity;
  code: string;
  message: string;
}

export interface SequenceUnresolvedRegion {
  id: string;
  creases: number[];
  faces: number[];
  reason: string;
}

export interface SequenceStateSnapshot {
  id: string;
  document: FoldDocument;
  active_creases: number[];
  face_orders: [number, number, number][];
  folded_vertices: [number, number][];
  unresolved_regions: SequenceUnresolvedRegion[];
  diagnostics: SequenceDiagnostic[];
}

export interface SequenceStepDetails {
  id: string;
  label: string;
  affected_creases?: number[];
  affected_faces?: number[];
  before_state?: string;
  after_state?: string;
  diagnostics?: SequenceDiagnostic[];
}

export type SequenceInstructionStep =
  | ({ kind: 'unsupported_region'; region: SequenceUnresolvedRegion } & SequenceStepDetails)
  | ({ kind: string } & SequenceStepDetails);

export interface SequenceSearchStats {
  states_explored: number;
  branches_pruned: number;
  repeated_states: number;
  timed_out: boolean;
  budget_exhausted: boolean;
  best_unresolved_creases: number;
  target_solves: number;
  target_solve_cache_hits: number;
  duplicate_candidates_pruned: number;
}

export interface SequencePlan {
  status: SequencePlanStatus;
  steps: SequenceInstructionStep[];
  states: SequenceStateSnapshot[];
  diagnostics: SequenceDiagnostic[];
  unresolved_regions: SequenceUnresolvedRegion[];
  search: SequenceSearchStats;
}

export interface SequenceTargetState {
  normalized: FoldDocument;
  folded_vertices: [number, number][];
  faces_flip: boolean[];
  face_orders: [number, number, number][];
  states: string;
  diagnostics: SequenceDiagnostic[];
}

export interface SequencePlanFoldResult {
  target: SequenceTargetState;
  plan: SequencePlan;
}

export interface TreeSummary {
  scale: number;
  is_feasible: boolean;
  cp_status: string;
  nodes: number;
  edges: number;
  paths: number;
  vertices: number;
  creases: number;
  facets: number;
  leaf_nodes: number;
  conditions: number;
  conditioned_nodes: number;
  conditioned_edges: number;
  conditioned_paths: number;
}

export interface CpStatusReport {
  status: string;
  bad_edges: number[];
  bad_polys: number[];
  bad_vertices: number[];
  bad_creases: number[];
  bad_facets: number[];
}

export interface PaperSettings {
  width: number;
  height: number;
  scale: number;
  has_symmetry: boolean;
  sym_loc: Point;
  sym_angle: number;
}

export interface NodeSnapshot {
  id: number;
  label: string;
  loc: Point;
  is_leaf: boolean;
  is_pinned: boolean;
  is_conditioned: boolean;
  owner: unknown;
}

export interface EdgeSnapshot {
  id: number;
  label: string;
  nodes: number[];
  length: number;
  strain: number;
  stiffness: number;
  is_conditioned: boolean;
}

export interface PathSnapshot {
  id: number;
  nodes: number[];
  is_leaf: boolean;
  is_active: boolean;
  is_feasible: boolean;
  is_border: boolean;
  is_polygon: boolean;
  is_conditioned: boolean;
}

export interface VertexSnapshot {
  id: number;
  loc: Point;
}

export interface CreaseSnapshot {
  id: number;
  kind: number;
  vertices: number[];
  fold: number;
}

export interface FacetSnapshot {
  id: number;
  vertices: number[];
  corridor_edge?: number | null;
  color: number;
}

export interface ConditionSnapshot {
  index: number;
  is_feasible: boolean;
  kind: ConditionKind;
}

export type ConditionKind =
  | {
      type: 'node_combo';
      node: number;
      to_symmetry_line: boolean;
      to_paper_edge: boolean;
      to_paper_corner: boolean;
      x_fixed: boolean;
      x_fix_value: number;
      y_fixed: boolean;
      y_fix_value: number;
    }
  | {
      type: 'node_fixed';
      node: number;
      x_fixed: boolean;
      y_fixed: boolean;
      x_fix_value: number;
      y_fix_value: number;
    }
  | { type: 'node_on_corner'; node: number }
  | { type: 'node_on_edge'; node: number }
  | { type: 'node_symmetric'; node: number }
  | { type: 'nodes_paired'; node1: number; node2: number }
  | { type: 'nodes_collinear'; node1: number; node2: number; node3: number }
  | { type: 'edge_length_fixed'; edge: number }
  | { type: 'edges_same_strain'; edge1: number; edge2: number }
  | {
      type: 'path_combo';
      node1: number;
      node2: number;
      is_angle_fixed: boolean;
      angle: number;
      is_angle_quant: boolean;
      quant: number;
      quant_offset: number;
    }
  | { type: 'path_active'; node1: number; node2: number }
  | { type: 'path_angle_fixed'; node1: number; node2: number; angle: number }
  | { type: 'path_angle_quant'; node1: number; node2: number; quant: number; quant_offset: number };

export type TreeEdit =
  | {
      type: 'add_node';
      loc: Point;
      label?: string;
      connect_to?: number;
      edge_length?: number;
    }
  | { type: 'move_node'; id: number; loc: Point }
  | { type: 'delete_node'; id: number }
  | { type: 'update_node_label'; id: number; label: string }
  | {
      type: 'update_edge';
      id: number;
      label?: string;
      length?: number;
      strain?: number;
      stiffness?: number;
    }
  | { type: 'add_edge'; node1: number; node2: number; label?: string; length?: number }
  | { type: 'delete_edge'; id: number }
  | { type: 'update_paper'; width: number; height: number; scale?: number }
  | {
      type: 'set_symmetry';
      has_symmetry: boolean;
      sym_loc?: Point;
      sym_angle?: number;
    }
  | { type: 'add_condition'; kind: ConditionKind }
  | { type: 'update_condition'; id: number; kind: ConditionKind }
  | { type: 'delete_condition'; id: number }
  | { type: 'make_root'; node: number }
  | { type: 'split_edge'; edge: number; distance: number }
  | { type: 'set_edge_lengths'; edges: number[]; length: number }
  | { type: 'scale_edge_lengths'; edges: number[]; factor: number }
  | { type: 'renormalize_to_edge'; edge: number }
  | { type: 'renormalize_to_unit_scale' }
  | { type: 'absorb_nodes'; nodes: number[] }
  | { type: 'absorb_redundant_nodes' }
  | { type: 'absorb_edges'; edges: number[] }
  | { type: 'perturb_nodes'; nodes: number[] }
  | { type: 'perturb_all_nodes' }
  | { type: 'remove_strain'; edges: number[] }
  | { type: 'remove_all_strain' }
  | { type: 'relieve_strain'; edges: number[] }
  | { type: 'relieve_all_strain' }
  | { type: 'add_largest_stub_for_nodes'; nodes: number[] }
  | { type: 'add_largest_stub_for_poly'; poly: number }
  | { type: 'triangulate_tree' };

export interface EditReport {
  snapshot: TreeSnapshot;
  created_node?: number;
  created_edge?: number;
}

export interface OptimizationReport {
  kind: string;
  converged: boolean;
  old_scale: number;
  new_scale: number;
  is_feasible: boolean;
  message: string;
}

export interface WasmErrorEnvelope {
  code: string;
  message: string;
}
