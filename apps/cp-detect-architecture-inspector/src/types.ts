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

