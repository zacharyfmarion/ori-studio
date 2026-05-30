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
  rejected_edge_ids: number[];
  undecided_edge_ids: number[];
  selected_hypothesis_ids: number[];
  edge_scores: SelectionEdgeScore[];
  structural_edits: SelectionStructuralEdit[];
  report: {
    selected_edges: number;
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

export interface CompiledSelectionVertex {
  id: number;
  arrangement_vertex_id: number;
  point: { x: number; y: number };
  source_kind:
    | 'corner'
    | 'observed_junction'
    | 'junction_cluster'
    | 'boundary_contact'
    | 'carrier_intersection'
    | 'observed_line_endpoint'
    | string;
  boundary_side?: 'top' | 'right' | 'bottom' | 'left' | null | string;
  selected_degree: number;
}

export interface CompiledSelectionEdge {
  id: number;
  vertices: [number, number];
  carrier_id: number;
  assignment_label: 'mountain' | 'valley' | 'boundary' | 'unknown' | 'flat' | string;
  assignment_confidence: number;
  carrier_t_interval: [number, number];
  source_atomic_edge_ids: number[];
  collapsed_vertex_ids: number[];
  line_support_min: number;
  line_support_mean: number;
  line_support_max: number;
}

export interface CompiledSelectionGraph {
  coordinate_space: string;
  image_size: number;
  vertices: CompiledSelectionVertex[];
  edges: CompiledSelectionEdge[];
  report: {
    vertices: number;
    edges: number;
    source_atomic_edges: number;
    collapsed_pass_through_vertices: number;
    non_collinear_degree_two_vertices: number;
    mountain_edges: number;
    valley_edges: number;
    boundary_edges: number;
    unknown_edges: number;
  };
}

export interface Stage5Response extends Stage4Response {
  compiled_selection_graph: CompiledSelectionGraph;
  ground_truth?: GroundTruthGraph | null;
}
