use crate::CompilerError;
use crate::evidence::{EvidenceSource, Provenance};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

impl Point2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CarrierFamily {
    Horizontal,
    Vertical,
    DiagonalPositive,
    DiagonalNegative,
    Free,
    Border,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateCarrier {
    pub id: usize,
    pub family: CarrierFamily,
    pub normal: Point2,
    pub rho: f64,
    pub support_interval: [f64; 2],
    pub visual_support: f64,
    pub dashed_support: f64,
    pub non_crease_penalty: f64,
    pub source: EvidenceSource,
    pub provenance: Vec<Provenance>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VertexKind {
    Interior,
    Boundary,
    Corner,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateVertex {
    pub id: usize,
    pub position: Point2,
    pub kind: VertexKind,
    pub support: f64,
    pub boundary_side: Option<String>,
    pub incident_carriers: Vec<usize>,
    pub provenance: Vec<Provenance>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentLabel {
    Mountain,
    Valley,
    Boundary,
    Unknown,
    Flat,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AssignmentCandidate {
    pub label: AssignmentLabel,
    pub confidence: f64,
    pub margin: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeSelection {
    Selected,
    Rejected,
    Undecided,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateEdge {
    pub id: usize,
    pub carrier_id: usize,
    pub vertices: [usize; 2],
    pub assignment: AssignmentCandidate,
    pub line_support: f64,
    pub style_support: f64,
    pub selection: EdgeSelection,
    pub source: EvidenceSource,
    pub provenance: Vec<Provenance>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateProgram {
    pub coordinate_space: String,
    pub image_size: Option<u32>,
    pub carriers: Vec<CandidateCarrier>,
    pub vertices: Vec<CandidateVertex>,
    pub edges: Vec<CandidateEdge>,
}

impl CandidateProgram {
    pub fn from_fold_value(fold: &Value) -> Result<Self, CompilerError> {
        let vertices_coords = fold
            .get("vertices_coords")
            .and_then(Value::as_array)
            .ok_or(CompilerError::MissingField("vertices_coords"))?;
        let edges_vertices = fold
            .get("edges_vertices")
            .and_then(Value::as_array)
            .ok_or(CompilerError::MissingField("edges_vertices"))?;
        let assignments = fold.get("edges_assignment").and_then(Value::as_array);
        let cp_detector = fold.get("cp_detector").unwrap_or(&Value::Null);
        let edge_support = cp_detector.get("edge_support").and_then(Value::as_array);
        let assignment_confidence = cp_detector
            .get("assignment_confidence")
            .and_then(Value::as_array);
        let assignment_margin = cp_detector
            .get("assignment_margin")
            .and_then(Value::as_array);
        let assignment_source = cp_detector
            .get("assignment_source")
            .and_then(Value::as_array);
        let image_size = cp_detector
            .get("image_size")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok());

        let mut vertices = Vec::with_capacity(vertices_coords.len());
        for (index, value) in vertices_coords.iter().enumerate() {
            let point = parse_point(value).ok_or(CompilerError::InvalidEntry {
                field: "vertices_coords",
                index,
            })?;
            vertices.push(CandidateVertex {
                id: index,
                position: point,
                kind: classify_vertex(point),
                support: 1.0,
                boundary_side: boundary_side(point).map(str::to_owned),
                incident_carriers: Vec::new(),
                provenance: vertex_provenance(point),
            });
        }

        let mut carriers = Vec::with_capacity(edges_vertices.len());
        let mut edges = Vec::with_capacity(edges_vertices.len());
        for (index, value) in edges_vertices.iter().enumerate() {
            let edge_vertices = parse_edge_vertices(value).ok_or(CompilerError::InvalidEntry {
                field: "edges_vertices",
                index,
            })?;
            let assignment = assignments
                .and_then(|values| values.get(index))
                .and_then(Value::as_str)
                .map(assignment_from_fold)
                .unwrap_or(AssignmentLabel::Unknown);
            let source = source_for_edge(assignment, assignment_source, index);
            let provenance = provenance_for_edge(assignment, source);
            let p0 = vertices
                .get(edge_vertices[0])
                .ok_or(CompilerError::InvalidEntry {
                    field: "edges_vertices",
                    index,
                })?
                .position;
            let p1 = vertices
                .get(edge_vertices[1])
                .ok_or(CompilerError::InvalidEntry {
                    field: "edges_vertices",
                    index,
                })?
                .position;
            let carrier = carrier_from_edge(index, p0, p1, assignment, source, &provenance);
            vertices[edge_vertices[0]]
                .incident_carriers
                .push(carrier.id);
            vertices[edge_vertices[1]]
                .incident_carriers
                .push(carrier.id);
            carriers.push(carrier);
            edges.push(CandidateEdge {
                id: index,
                carrier_id: index,
                vertices: edge_vertices,
                assignment: AssignmentCandidate {
                    label: assignment,
                    confidence: optional_f64(assignment_confidence, index).unwrap_or(1.0),
                    margin: optional_f64(assignment_margin, index).unwrap_or(0.0),
                },
                line_support: optional_f64(edge_support, index).unwrap_or(1.0),
                style_support: 0.0,
                selection: EdgeSelection::Selected,
                source,
                provenance,
            });
        }

        Ok(Self {
            coordinate_space: "fold_normalized".to_owned(),
            image_size,
            carriers,
            vertices,
            edges,
        })
    }
}

fn parse_point(value: &Value) -> Option<Point2> {
    let values = value.as_array()?;
    Some(Point2::new(
        values.first()?.as_f64()?,
        values.get(1)?.as_f64()?,
    ))
}

fn parse_edge_vertices(value: &Value) -> Option<[usize; 2]> {
    let values = value.as_array()?;
    let a = usize::try_from(values.first()?.as_u64()?).ok()?;
    let b = usize::try_from(values.get(1)?.as_u64()?).ok()?;
    Some([a, b])
}

fn assignment_from_fold(value: &str) -> AssignmentLabel {
    match value {
        "M" => AssignmentLabel::Mountain,
        "V" => AssignmentLabel::Valley,
        "B" => AssignmentLabel::Boundary,
        "F" => AssignmentLabel::Flat,
        _ => AssignmentLabel::Unknown,
    }
}

fn source_for_edge(
    assignment: AssignmentLabel,
    assignment_source: Option<&Vec<Value>>,
    index: usize,
) -> EvidenceSource {
    if assignment == AssignmentLabel::Boundary {
        return EvidenceSource::Border;
    }
    match assignment_source
        .and_then(|values| values.get(index))
        .and_then(Value::as_str)
    {
        Some("unknown") => EvidenceSource::ObservedWeak,
        Some("observed") => EvidenceSource::ObservedStrong,
        _ => EvidenceSource::Legacy,
    }
}

fn provenance_for_edge(assignment: AssignmentLabel, source: EvidenceSource) -> Vec<Provenance> {
    if assignment == AssignmentLabel::Boundary {
        return vec![Provenance::BorderPrior, Provenance::LegacyDecoder];
    }
    let mut provenance = vec![Provenance::LegacyDecoder];
    if matches!(
        source,
        EvidenceSource::ObservedStrong | EvidenceSource::ObservedWeak
    ) {
        provenance.push(Provenance::AssignmentObserved);
    }
    provenance
}

fn vertex_provenance(point: Point2) -> Vec<Provenance> {
    if classify_vertex(point) == VertexKind::Corner {
        vec![Provenance::BorderPrior, Provenance::LegacyDecoder]
    } else {
        vec![Provenance::LegacyDecoder]
    }
}

fn carrier_from_edge(
    id: usize,
    p0: Point2,
    p1: Point2,
    assignment: AssignmentLabel,
    source: EvidenceSource,
    provenance: &[Provenance],
) -> CandidateCarrier {
    let dx = p1.x - p0.x;
    let dy = p1.y - p0.y;
    let length = (dx * dx + dy * dy).sqrt().max(1e-12);
    let normal = Point2::new(-dy / length, dx / length);
    let rho = normal.x * p0.x + normal.y * p0.y;
    let t0 = p0.x * dx / length + p0.y * dy / length;
    let t1 = p1.x * dx / length + p1.y * dy / length;
    CandidateCarrier {
        id,
        family: carrier_family(p0, p1, assignment),
        normal,
        rho,
        support_interval: [t0.min(t1), t0.max(t1)],
        visual_support: 1.0,
        dashed_support: 0.0,
        non_crease_penalty: 0.0,
        source,
        provenance: provenance.to_vec(),
    }
}

fn carrier_family(p0: Point2, p1: Point2, assignment: AssignmentLabel) -> CarrierFamily {
    if assignment == AssignmentLabel::Boundary {
        return CarrierFamily::Border;
    }
    let dx = (p1.x - p0.x).abs();
    let dy = (p1.y - p0.y).abs();
    if dy < 1e-9 {
        CarrierFamily::Horizontal
    } else if dx < 1e-9 {
        CarrierFamily::Vertical
    } else if ((p1.y - p0.y) - (p1.x - p0.x)).abs() < 1e-9 {
        CarrierFamily::DiagonalPositive
    } else if ((p1.y - p0.y) + (p1.x - p0.x)).abs() < 1e-9 {
        CarrierFamily::DiagonalNegative
    } else {
        CarrierFamily::Free
    }
}

fn classify_vertex(point: Point2) -> VertexKind {
    let on_left = near(point.x, 0.0);
    let on_right = near(point.x, 1.0);
    let on_top = near(point.y, 0.0);
    let on_bottom = near(point.y, 1.0);
    let boundary_count = [on_left, on_right, on_top, on_bottom]
        .into_iter()
        .filter(|value| *value)
        .count();
    match boundary_count {
        0 => VertexKind::Interior,
        1 => VertexKind::Boundary,
        _ => VertexKind::Corner,
    }
}

fn boundary_side(point: Point2) -> Option<&'static str> {
    if near(point.x, 0.0) {
        Some("left")
    } else if near(point.x, 1.0) {
        Some("right")
    } else if near(point.y, 0.0) {
        Some("top")
    } else if near(point.y, 1.0) {
        Some("bottom")
    } else {
        None
    }
}

fn near(value: f64, target: f64) -> bool {
    (value - target).abs() < 1e-9
}

fn optional_f64(values: Option<&Vec<Value>>, index: usize) -> Option<f64> {
    values
        .and_then(|values| values.get(index))
        .and_then(Value::as_f64)
}
