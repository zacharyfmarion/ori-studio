use crate::{AssignmentLabel, CandidateProgram, EdgeSelection};
use serde_json::json;
use treemaker_fold::{Assignment, FoldAngle, FoldDocument};

pub fn export_program_to_fold_document(program: &CandidateProgram) -> FoldDocument {
    let selected_edges = program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected)
        .collect::<Vec<_>>();
    let mut used_vertices = selected_edges
        .iter()
        .flat_map(|edge| edge.vertices)
        .collect::<Vec<_>>();
    used_vertices.sort_unstable();
    used_vertices.dedup();
    let mut vertex_remap = vec![usize::MAX; program.vertices.len()];
    let vertices_coords = used_vertices
        .iter()
        .enumerate()
        .filter_map(|(next_index, old_index)| {
            vertex_remap[*old_index] = next_index;
            program
                .vertices
                .get(*old_index)
                .map(|vertex| vec![vertex.position.x, vertex.position.y])
        })
        .collect::<Vec<_>>();
    let edges_vertices = selected_edges
        .iter()
        .map(|edge| {
            [
                vertex_remap[edge.vertices[0]],
                vertex_remap[edge.vertices[1]],
            ]
        })
        .collect::<Vec<_>>();
    let edges_assignment = selected_edges
        .iter()
        .map(|edge| fold_assignment(edge.assignment.label))
        .collect::<Vec<_>>();
    let edges_fold_angle = edges_assignment
        .iter()
        .map(|assignment| FoldAngle::default_for_assignment(*assignment))
        .collect::<Vec<_>>();
    let mut document = FoldDocument::new(vertices_coords, edges_vertices);
    document.file_creator = Some("ori-studio-cp-compiler".to_owned());
    document.frame_title = Some("compiled crease pattern".to_owned());
    document.edges_assignment = edges_assignment;
    document.edges_fold_angle = edges_fold_angle;
    document.extra.insert(
        "cp_detector".to_owned(),
        json!({
            "edge_ids": selected_edges.iter().map(|edge| edge.id).collect::<Vec<_>>(),
            "edge_carrier_ids": selected_edges.iter().map(|edge| edge.carrier_id).collect::<Vec<_>>(),
            "edge_source": selected_edges.iter().map(|edge| edge.source).collect::<Vec<_>>(),
            "edge_provenance": selected_edges
                .iter()
                .map(|edge| edge.provenance.clone())
                .collect::<Vec<_>>(),
            "edge_support": selected_edges.iter().map(|edge| edge.line_support).collect::<Vec<_>>(),
            "assignment_confidence": selected_edges
                .iter()
                .map(|edge| edge.assignment.confidence)
                .collect::<Vec<_>>(),
            "assignment_margin": selected_edges
                .iter()
                .map(|edge| edge.assignment.margin)
                .collect::<Vec<_>>(),
        }),
    );
    document
}

pub fn export_program_to_fold_json(
    program: &CandidateProgram,
) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&export_program_to_fold_document(program))
}

fn fold_assignment(label: AssignmentLabel) -> Assignment {
    match label {
        AssignmentLabel::Boundary => Assignment::Boundary,
        AssignmentLabel::Mountain => Assignment::Mountain,
        AssignmentLabel::Valley => Assignment::Valley,
        AssignmentLabel::Flat => Assignment::Flat,
        AssignmentLabel::Unknown => Assignment::Unassigned,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AssignmentCandidate, CandidateEdge, CandidateVertex, EvidenceSource, Point2, Provenance,
        VertexKind,
    };

    #[test]
    fn exports_selected_edges_and_assignments_to_fold_document() {
        let program = CandidateProgram {
            coordinate_space: "unit_test".to_owned(),
            image_size: None,
            carriers: Vec::new(),
            vertices: vec![
                vertex(0, Point2::new(0.0, 0.0)),
                vertex(1, Point2::new(1.0, 0.0)),
                vertex(2, Point2::new(0.5, 0.5)),
            ],
            edges: vec![
                edge(
                    0,
                    [0, 1],
                    AssignmentLabel::Boundary,
                    EdgeSelection::Selected,
                ),
                edge(
                    1,
                    [0, 2],
                    AssignmentLabel::Mountain,
                    EdgeSelection::Selected,
                ),
                edge(2, [1, 2], AssignmentLabel::Valley, EdgeSelection::Rejected),
            ],
        };

        let fold = export_program_to_fold_document(&program);

        assert_eq!(fold.vertices_coords.len(), 3);
        assert_eq!(fold.edges_vertices, vec![[0, 1], [0, 2]]);
        assert_eq!(
            fold.edges_assignment,
            vec![Assignment::Boundary, Assignment::Mountain]
        );
        assert_eq!(
            fold.extra["cp_detector"]["edge_ids"],
            serde_json::json!([0, 1])
        );
        assert_eq!(
            fold.extra["cp_detector"]["edge_provenance"],
            serde_json::json!([["legacy_decoder"], ["legacy_decoder"]])
        );
    }

    fn vertex(id: usize, position: Point2) -> CandidateVertex {
        CandidateVertex {
            id,
            position,
            kind: VertexKind::Interior,
            support: 1.0,
            boundary_side: None,
            incident_carriers: Vec::new(),
            provenance: vec![Provenance::LegacyDecoder],
        }
    }

    fn edge(
        id: usize,
        vertices: [usize; 2],
        label: AssignmentLabel,
        selection: EdgeSelection,
    ) -> CandidateEdge {
        CandidateEdge {
            id,
            carrier_id: id,
            vertices,
            assignment: AssignmentCandidate {
                label,
                confidence: 1.0,
                margin: 1.0,
            },
            line_support: 1.0,
            style_support: 0.0,
            selection,
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::LegacyDecoder],
        }
    }
}
