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
