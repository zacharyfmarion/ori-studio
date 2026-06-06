use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EvalPoint {
    pub x: f64,
    pub y: f64,
}

impl EvalPoint {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

impl From<[f64; 2]> for EvalPoint {
    fn from(value: [f64; 2]) -> Self {
        Self {
            x: value[0],
            y: value[1],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalAssignment {
    Mountain,
    Valley,
    Boundary,
    Auxiliary,
    Unknown,
}

impl EvalAssignment {
    pub fn from_fold_code(value: &str) -> Self {
        match value.trim().to_ascii_uppercase().as_str() {
            "M" | "MOUNTAIN" => Self::Mountain,
            "V" | "VALLEY" => Self::Valley,
            "B" | "BOUNDARY" => Self::Boundary,
            "F" | "A" | "AUX" | "AUXILIARY" | "FLAT" => Self::Auxiliary,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalBoundaryRole {
    #[default]
    None,
    PaperBoundary,
    CutBoundary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvalEdge {
    pub vertices: [usize; 2],
    pub assignment: EvalAssignment,
    #[serde(default)]
    pub boundary_role: EvalBoundaryRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
}

impl EvalEdge {
    pub const fn new(vertices: [usize; 2], assignment: EvalAssignment) -> Self {
        Self {
            vertices,
            assignment,
            boundary_role: EvalBoundaryRole::None,
            source_id: None,
        }
    }

    pub const fn with_boundary_role(mut self, boundary_role: EvalBoundaryRole) -> Self {
        self.boundary_role = boundary_role;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvalGraph {
    pub vertices: Vec<EvalPoint>,
    pub edges: Vec<EvalEdge>,
}

impl EvalGraph {
    pub fn new(vertices: Vec<EvalPoint>, edges: Vec<EvalEdge>) -> Self {
        Self { vertices, edges }
    }

    pub fn from_arrays(
        vertices: impl IntoIterator<Item = [f64; 2]>,
        edges: impl IntoIterator<Item = [usize; 2]>,
        assignments: impl IntoIterator<Item = EvalAssignment>,
    ) -> Self {
        let vertices = vertices.into_iter().map(EvalPoint::from).collect();
        let edges = edges
            .into_iter()
            .zip(assignments)
            .map(|(vertices, assignment)| EvalEdge::new(vertices, assignment))
            .collect();
        Self { vertices, edges }
    }

    pub fn from_fold_value(value: &Value) -> Result<Self, EvalGraphError> {
        let vertices_value = value
            .get("vertices_coords")
            .and_then(Value::as_array)
            .ok_or(EvalGraphError::MissingField("vertices_coords"))?;
        let vertices = vertices_value
            .iter()
            .enumerate()
            .map(|(index, item)| parse_point(item, index))
            .collect::<Result<Vec<_>, _>>()?;

        let edges_value = value
            .get("edges_vertices")
            .and_then(Value::as_array)
            .ok_or(EvalGraphError::MissingField("edges_vertices"))?;
        let assignment_values = value
            .get("edges_assignment")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let boundary_roles = value
            .get("cp_detector")
            .and_then(|detector| detector.get("edge_boundary_role"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let edges = edges_value
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let vertices = parse_edge_vertices(item, index)?;
                let assignment = assignment_values
                    .get(index)
                    .map(parse_assignment_value)
                    .unwrap_or(EvalAssignment::Unknown);
                let boundary_role = boundary_roles
                    .get(index)
                    .map(parse_boundary_role_value)
                    .unwrap_or_default();
                Ok(EvalEdge {
                    vertices,
                    assignment,
                    boundary_role,
                    source_id: None,
                })
            })
            .collect::<Result<Vec<_>, EvalGraphError>>()?;

        Ok(Self { vertices, edges })
    }

    pub fn from_fold_json(json: &str) -> Result<Self, EvalGraphError> {
        let value = serde_json::from_str(json)?;
        Self::from_fold_value(&value)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum EvalGraphError {
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("FOLD document is missing {0}")]
    MissingField(&'static str),
    #[error("vertices_coords[{index}] is not a two-number point")]
    InvalidVertex { index: usize },
    #[error("edges_vertices[{index}] is not a two-index edge")]
    InvalidEdge { index: usize },
}

fn parse_point(value: &Value, index: usize) -> Result<EvalPoint, EvalGraphError> {
    let Some(items) = value.as_array() else {
        return Err(EvalGraphError::InvalidVertex { index });
    };
    let Some(x) = items.first().and_then(Value::as_f64) else {
        return Err(EvalGraphError::InvalidVertex { index });
    };
    let Some(y) = items.get(1).and_then(Value::as_f64) else {
        return Err(EvalGraphError::InvalidVertex { index });
    };
    Ok(EvalPoint { x, y })
}

fn parse_edge_vertices(value: &Value, index: usize) -> Result<[usize; 2], EvalGraphError> {
    let Some(items) = value.as_array() else {
        return Err(EvalGraphError::InvalidEdge { index });
    };
    let Some(a) = items.first().and_then(Value::as_u64) else {
        return Err(EvalGraphError::InvalidEdge { index });
    };
    let Some(b) = items.get(1).and_then(Value::as_u64) else {
        return Err(EvalGraphError::InvalidEdge { index });
    };
    Ok([a as usize, b as usize])
}

fn parse_assignment_value(value: &Value) -> EvalAssignment {
    match value {
        Value::String(code) => EvalAssignment::from_fold_code(code),
        Value::Number(number) => match number.as_i64() {
            Some(0) => EvalAssignment::Mountain,
            Some(1) => EvalAssignment::Valley,
            Some(2) => EvalAssignment::Boundary,
            Some(3) => EvalAssignment::Auxiliary,
            _ => EvalAssignment::Unknown,
        },
        _ => EvalAssignment::Unknown,
    }
}

fn parse_boundary_role_value(value: &Value) -> EvalBoundaryRole {
    let Some(role) = value.as_str() else {
        return EvalBoundaryRole::None;
    };
    match role {
        "paper_boundary" => EvalBoundaryRole::PaperBoundary,
        "cut_boundary" => EvalBoundaryRole::CutBoundary,
        _ => EvalBoundaryRole::None,
    }
}
