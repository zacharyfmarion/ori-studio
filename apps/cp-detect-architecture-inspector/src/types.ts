export interface StageInfo {
  id: string;
  label: string;
  title: string;
  status: string;
}

export interface ExampleRow {
  id: string;
  source_id?: string | null;
  family?: string | null;
  profile?: string | null;
  edge_count?: number | null;
  image_size: number;
  threshold: number;
  input_image_url: string;
}

export interface ExamplesResponse {
  schema: string;
  dense_manifest: string;
  generated_at?: string | null;
  rows: ExampleRow[];
  counts: {
    profiles?: Record<string, number>;
    families?: Record<string, number>;
    samples?: number;
  };
}

export interface EvidenceConfigSummary {
  image_size: number;
  threshold: number;
  line_threshold: number;
  strong_line_support: number;
  hough_vote_threshold: number;
  max_line_primitives: number;
  max_junction_primitives: number;
  max_boundary_contact_primitives: number;
}

export interface EvidenceReport {
  schema: string;
  legacy_dependency: boolean;
  image_size: number;
  extraction_seconds: number;
  line_pixels_above_threshold: number;
  hough_segments: number;
  line_primitives: number;
  strong_line_primitives: number;
  weak_line_primitives: number;
  junction_primitives: number;
  boundary_contact_primitives: number;
}

export interface MapPayload {
  id: string;
  label: string;
  width: number;
  height: number;
  min: number;
  max: number;
  values: number[];
}

export interface DenseTensorSummary {
  id: string;
  length: number;
  dims: number[];
  channels: number;
  min: number;
  max: number;
  mean: number;
}

export interface Stage0Response {
  schema: string;
  sample: ExampleRow;
  map_size: number;
  config: EvidenceConfigSummary;
  maps: MapPayload[];
  model_manifest_id?: string | null;
  rectification_report?: unknown;
  runtime?: {
    requested_execution_provider?: string;
    active_execution_provider?: string;
    webgpu_available?: boolean;
    wasm_threads?: number;
    session_create_ms?: number;
    fallback_reason?: string;
    preprocess_ms?: number;
    model_run_ms?: number;
    output_collect_ms?: number;
    total_inference_ms?: number;
  } | null;
  input_image_url: string;
  dense_outputs: DenseTensorSummary[];
}

export interface AssignmentEvidence {
  label: number;
  confidence: number;
  margin: number;
  probabilities: [number, number, number, number];
}

export interface LineStyleEvidence {
  probabilities: [number, number, number, number];
  dashed_or_gapped_support: number;
}

export interface LinePrimitive {
  p0: [number, number];
  p1: [number, number];
  theta: number;
  rho: number;
  support: number;
  votes: number;
  assignment: AssignmentEvidence;
  style: LineStyleEvidence;
  source: 'observed_strong' | 'observed_weak' | string;
}

export interface JunctionPrimitive {
  point: [number, number];
  support: number;
  source: 'observed_strong' | 'observed_weak' | string;
}

export interface BoundaryContactPrimitive {
  point: [number, number];
  side: 'top' | 'right' | 'bottom' | 'left' | string;
  side_coordinate: number;
  support: number;
  source: 'observed_strong' | 'observed_weak' | string;
}

export interface Stage1Response {
  schema: string;
  sample: ExampleRow;
  map_size: number;
  config: EvidenceConfigSummary;
  report: EvidenceReport;
  maps: MapPayload[];
  primitives: {
    line_primitives: LinePrimitive[];
    junction_primitives: JunctionPrimitive[];
    boundary_contact_primitives: BoundaryContactPrimitive[];
  };
}

export interface ArrangementCarrier {
  id: number;
  kind: 'observed_local' | 'shared_collinear_alternative' | string;
  primitive_ids: number[];
  normal: { x: number; y: number };
  direction: { x: number; y: number };
  rho: number;
  support_interval: [number, number];
  visual_support: number;
  style_support: number;
  assignment: {
    label: 'mountain' | 'valley' | 'boundary' | 'unknown' | 'flat' | string;
    confidence: number;
    margin: number;
  };
  source: string;
  hypothesis_cost: number;
}

export interface ArrangementVertex {
  id: number;
  point: { x: number; y: number };
  kind:
    | 'corner'
    | 'observed_junction'
    | 'junction_cluster'
    | 'boundary_contact'
    | 'carrier_intersection'
    | 'observed_line_endpoint'
    | string;
  support: number;
  carrier_ids: number[];
  boundary_side?: 'top' | 'right' | 'bottom' | 'left' | null | string;
  primitive_ids: number[];
  source: string;
}

export interface ArrangementAtomicEdge {
  id: number;
  carrier_id: number;
  vertices: [number, number];
  t_interval: [number, number];
  line_support: number;
  support_overlap: number;
  style_support: number;
  assignment: {
    label: 'mountain' | 'valley' | 'boundary' | 'unknown' | 'flat' | string;
    confidence: number;
    margin: number;
  };
  source: string;
  hypothesis_ids: number[];
}

export interface ArrangementHypothesis {
  id: number;
  kind:
    | 'separate_segment'
    | 'shared_carrier'
    | 'merge_nearby_junction'
    | 'split_crossing'
    | 'boundary_contact'
    | string;
  carrier_ids: number[];
  vertex_ids: number[];
  atomic_edge_ids: number[];
  cost: number;
  reason: string;
}

export interface CandidateArrangement {
  schema: string;
  coordinate_space: string;
  image_size: number;
  carriers: ArrangementCarrier[];
  vertices: ArrangementVertex[];
  atomic_edges: ArrangementAtomicEdge[];
  hypotheses: ArrangementHypothesis[];
  report: {
    observed_carriers: number;
    shared_carrier_alternatives: number;
    carriers: number;
    corners: number;
    observed_junctions: number;
    junction_clusters: number;
    boundary_contacts: number;
    carrier_intersections: number;
    suppressed_carrier_intersections: number;
    line_endpoints: number;
    vertices: number;
    atomic_edges: number;
    hypotheses: number;
    selected_edges: number;
    emits_fold_graph: boolean;
  };
}

export interface CandidateGraph {
  schema: string;
  coordinate_space: string;
  image_size?: number | null;
  vertices: CandidateGraphVertex[];
  crease_candidates: CandidateGraphCreaseCandidate[];
  conflicts: CandidateGraphConflict[];
  alternatives?: CandidateGraphConflict[];
  report: {
    vertices: number;
    crease_candidates: number;
    locked_border_spans: number;
    legacy_selected_spans: number;
    legacy_low_threshold_spans: number;
    arrangement_observed_spans: number;
    arrangement_shared_spans: number;
    conflicts: number;
  };
  provenance: {
    source_adapter: string;
    source_ids: string[];
    notes: string[];
  };
}

export interface CandidateGraphVertex {
  id: number;
  point: { x: number; y: number };
  kind: string;
  support: number;
  boundary_side?: 'top' | 'right' | 'bottom' | 'left' | null | string;
  source_vertex_ids?: number[];
  source_carrier_ids?: number[];
  provenance?: string[];
}

export interface CandidateCarrierGeometry {
  normal: { x: number; y: number };
  direction: { x: number; y: number };
  rho: number;
}

export interface CandidateGraphCreaseCandidate {
  id: number;
  kind: string;
  vertices: [number, number];
  carrier: CandidateCarrierGeometry;
  t_interval: [number, number];
  assignment_evidence: {
    mountain: number;
    valley: number;
    boundary: number;
    auxiliary: number;
    unknown: number;
    observed_label: 'mountain' | 'valley' | 'boundary' | 'unknown' | 'flat' | string;
    source: string;
    confidence: number;
    margin: number;
  };
  presence_probability: number;
  line_support_min: number;
  line_support_mean: number;
  line_support_max: number;
  style_support: number;
  non_crease_support: number;
  source_kind: string;
  selection_policy: string;
  boundary_role?: 'none' | 'paper_boundary' | 'cut_boundary' | string;
  source_edge_ids?: number[];
  source_atomic_edge_ids?: number[];
  source_carrier_ids?: number[];
  replaced_span_ids?: number[];
  replaced_atomic_edge_ids?: number[];
  collapsed_vertex_ids?: number[];
  provenance?: string[];
  reasons?: string[];
}

export interface CandidateGraphConflict {
  id: number;
  kind: string;
  candidate_ids: number[];
  hard: boolean;
  reason: string;
}

export interface Stage2Response extends Stage1Response {
  overlay_frame_px: {
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
  };
  arrangement: CandidateArrangement;
}

export interface SelectionScoreBreakdown {
  visual_reward: number;
  vertex_anchor_reward: number;
  assignment_reward: number;
  topology_delta: number;
  weak_support_cost: number;
  inferred_geometry_cost: number;
  shared_carrier_cost: number;
  tiny_edge_cost: number;
  duplicate_cost: number;
  exactizability_cost: number;
  continuity_reward: number;
  fragmentation_cost: number;
  degree_two_cost: number;
}

export interface SelectionEdgeScore {
  edge_id: number;
  carrier_id: number;
  vertices: [number, number];
  decision: 'selected' | 'rejected' | 'undecided' | string;
  total_score: number;
  breakdown: SelectionScoreBreakdown;
  reasons: string[];
}

export interface CandidateSelection {
  schema: string;
  coordinate_space: string;
  image_size: number;
  selected_edge_ids: number[];
  selected_spans: SelectionSpan[];
  rejected_edge_ids: number[];
  undecided_edge_ids: number[];
  selected_hypothesis_ids: number[];
  edge_scores: SelectionEdgeScore[];
  structural_edits: SelectionStructuralEdit[];
  report: {
    selected_edges: number;
    selected_spans: number;
    rejected_edges: number;
    undecided_edges: number;
    selected_hypotheses: number;
    weak_edges_promoted: number;
    topology_improved_edges: number;
    duplicate_edges_rejected: number;
    odd_degree_vertices: number;
    total_score: number;
    exactizability_evaluated: boolean;
    shared_replacements: number;
    local_fragments_replaced: number;
    local_fragments_retained: number;
    collapsible_degree_two_vertices: number;
    non_collinear_degree_two_vertices: number;
    structural_penalty: number;
    continuity_reward: number;
    emits_fold_graph: boolean;
  };
}

export interface SelectionSpan {
  id: number;
  kind: 'atomic_interval' | 'observed_carrier_span' | 'normalized_pass_through_span' | 'shared_carrier_span' | string;
  carrier_id: number;
  vertices: [number, number];
  endpoint_points?: [{ x: number; y: number }, { x: number; y: number }] | null;
  t_interval: [number, number];
  assignment: {
    label: 'mountain' | 'valley' | 'boundary' | 'unknown' | 'flat' | string;
    confidence: number;
    margin: number;
  };
  boundary_role?: 'none' | 'paper_boundary' | 'cut_boundary' | string;
  source_atomic_edge_ids: number[];
  replaced_atomic_edge_ids: number[];
  collapsed_vertex_ids: number[];
  line_support_min: number;
  line_support_mean: number;
  line_support_max: number;
  score: number;
  reasons: string[];
}

export interface SelectionStructuralEdit {
  kind:
    | 'shared_carrier_replacement'
    | 'collapsible_degree_two_vertex'
    | 'non_collinear_degree_two_vertex'
    | 'local_fragment_retained'
    | string;
  vertex_ids: number[];
  carrier_ids: number[];
  added_edge_ids: number[];
  removed_edge_ids: number[];
  score_delta: number;
  reason: string;
}

export interface Stage3Response extends Stage2Response {
  selection: CandidateSelection;
}

export type ExactProbeStatus = 'feasible' | 'low_cost' | 'high_cost' | 'infeasible' | string;

export interface ExactizabilityProbeSummary {
  exactizability_evaluated: boolean;
  vertex_probes: number;
  carrier_probes: number;
  boundary_probes: number;
  feasible: number;
  low_cost: number;
  high_cost: number;
  infeasible: number;
  odd_degree_vertices: number;
  hard_kawasaki_vertices: number;
  max_kawasaki_residual_degrees: number;
  max_estimated_vertex_move: number;
  max_carrier_endpoint_move: number;
  max_boundary_move: number;
  total_estimated_energy: number;
}

export interface VertexExactizabilityProbe {
  vertex_id: number;
  point: { x: number; y: number };
  degree: number;
  feasible: boolean;
  status: ExactProbeStatus;
  estimated_energy: number;
  max_vertex_move: number;
  residual_before_degrees?: number | null;
  residual_after_degrees?: number | null;
  ray_angles_degrees: number[];
  sector_angles_degrees: number[];
  incident_edge_ids: number[];
  blockers: string[];
}

export interface CarrierExactizabilityProbe {
  carrier_id: number;
  carrier_kind: 'observed_local' | 'shared_collinear_alternative' | string;
  selected_edges: number;
  feasible: boolean;
  status: ExactProbeStatus;
  estimated_energy: number;
  max_endpoint_move: number;
  mean_endpoint_move: number;
  blockers: string[];
}

export interface BoundaryExactizabilityProbe {
  vertex_id: number;
  point: { x: number; y: number };
  side?: 'top' | 'right' | 'bottom' | 'left' | null | string;
  feasible: boolean;
  status: ExactProbeStatus;
  estimated_energy: number;
  max_vertex_move: number;
  residual_before: number;
  residual_after: number;
  blockers: string[];
}

export interface ExactizabilityReport {
  schema: string;
  coordinate_space: string;
  image_size: number;
  summary: ExactizabilityProbeSummary;
  vertex_probes: VertexExactizabilityProbe[];
  carrier_probes: CarrierExactizabilityProbe[];
  boundary_probes: BoundaryExactizabilityProbe[];
}

export interface Stage4Response extends Stage3Response {
  exactizability: ExactizabilityReport;
}

export interface GroundTruthGraph {
  image_size: number;
  vertices_px: [number, number][];
  edges_vertices: [number, number][];
  edges_assignment_labels: string[];
}

export interface Stage5Response extends Stage4Response {
  candidate_strategy?: string;
  candidate_graph?: CandidateGraph | null;
  ground_truth?: GroundTruthGraph | null;
  legacy_graph?: GroundTruthGraph | null;
}

export interface CandidateDecisionAudit {
  schema: string;
  summary: {
    total_candidates: number;
    selected: number;
    available: number;
    rejected: number;
    conflicted_with_selected: number;
    dominated_or_replaced: number;
    locked: number;
    gt_edges: number;
    gt_edges_with_selected_match: number;
    gt_edges_without_candidate: number;
  };
  candidates: CandidateDecisionRecord[];
  gt_edges: GtEdgeAuditRecord[];
}

export interface DecisionConflictRecord {
  id: number;
  kind: string;
  candidate_ids: number[];
  hard: boolean;
  reason: string;
  touches_selected: boolean;
}

export interface CandidateDecisionRecord {
  id: number;
  kind: string;
  vertices: [number, number];
  endpoint_points?: [{ x: number; y: number }, { x: number; y: number }] | null;
  assignment_label: 'mountain' | 'valley' | 'boundary' | 'unknown' | 'flat' | string;
  boundary_role: 'none' | 'paper_boundary' | 'cut_boundary' | string;
  source_kind: string;
  selection_policy: string;
  decision: 'selected' | 'rejected' | 'undecided' | 'not_considered' | string;
  reason_category: 'selected' | 'locked' | 'available' | 'conflict' | 'dominated' | 'policy' | 'cost' | 'not_considered' | string;
  score: number;
  score_breakdown?: SelectionScoreBreakdown | null;
  line_support_min: number;
  line_support_mean: number;
  line_support_max: number;
  presence_probability: number;
  conflicts: DecisionConflictRecord[];
  replaced_by: number[];
  replaces: number[];
  source_atomic_edge_ids: number[];
  replaced_atomic_edge_ids: number[];
  collapsed_vertex_ids: number[];
  reasons: string[];
}

export interface GtCandidateMatchRecord {
  candidate_id: number;
  decision: string;
  reason_category: string;
  distance_px: number;
  angle_delta_degrees: number;
  selected: boolean;
}

export interface GtEdgeAuditRecord {
  gt_edge_id: number;
  vertices: [number, number];
  assignment_label: string;
  root_cause: string;
  best_candidate_ids: number[];
  selected_candidate_ids: number[];
  matches: GtCandidateMatchRecord[];
}

export interface Stage5bResponse extends Stage5Response {
  decision_audit: CandidateDecisionAudit;
}

export interface ExactSolvePoint {
  x: number;
  y: number;
}

export interface ExactMovedVertex {
  vertex_id: number;
  before: ExactSolvePoint;
  after: ExactSolvePoint;
  movement: number;
  movement_policy?: string;
  boundary_side?: 'top' | 'right' | 'bottom' | 'left' | null | string;
  support?: number;
}

export interface ExactVertexDiagnostic {
  vertex_id: number;
  degree: number;
  mountain_count: number;
  valley_count: number;
  unknown_count: number;
  kawasaki_residual_degrees?: number | null;
  maekawa_residual?: number | null;
}

export interface ExactSolveAnalysis {
  eligible_vertices: number;
  odd_degree_vertices: number[];
  degree_two_vertices: number[];
  maekawa_failures: number[];
  boundary_span_ids: number[];
  paper_boundary_span_ids: number[];
  cut_boundary_span_ids: number[];
  boundary_vertices: number[];
  max_kawasaki_residual_degrees: number;
  max_carrier_residual: number;
  max_vertex_movement: number;
  mean_vertex_movement: number;
  degenerate_edges: [number, number][];
  unmodeled_crossings: [number, number][];
  boundary_failures: number[];
  vertex_diagnostics: ExactVertexDiagnostic[];
}

export interface ExactSolveMovementReport {
  schema: string;
  termination: string;
  evaluations: number;
  initial_objective: number;
  final_objective: number;
  max_vertex_movement: number;
  max_vertex_movement_budget: number;
  moved_vertices: ExactMovedVertex[];
}

export interface ExactSolveTheoremReport {
  schema: string;
  termination: string;
  before: ExactSolveAnalysis;
  after: ExactSolveAnalysis;
}

export interface ExactSolvedGraph {
  schema: string;
  vertices_exact: ExactSolvePoint[];
  edges_exact: [number, number][];
  movement_report: ExactSolveMovementReport;
  theorem_residual_report: ExactSolveTheoremReport;
  status: 'solved' | 'ambiguous' | 'failed' | string;
}

export interface Stage6Response extends Stage5Response {
  exact_solve: ExactSolvedGraph;
}

export interface UploadedInspectorRunBundle {
  schema: string;
  source: 'upload';
  sample: ExampleRow;
  active_stage: string;
  stage_order: string[];
  stages: {
    stage0: Stage0Response;
    stage1: Stage1Response;
    stage2: Stage2Response;
    stage3: Stage3Response;
    stage4: Stage4Response;
    stage5: Stage5Response;
    stage5b: Stage5bResponse;
    stage6: Stage6Response;
  };
}
