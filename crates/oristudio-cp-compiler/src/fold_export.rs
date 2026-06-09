use crate::{
    AssignmentLabel, CandidateProgram, CompilerError, EdgeSelection, ExactSolveInput,
    ExactSolvedGraph,
};
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

pub fn export_exact_solved_to_fold_document(
    input: &ExactSolveInput,
    solved: &ExactSolvedGraph,
) -> Result<FoldDocument, CompilerError> {
    if solved.edges_exact.len() != input.selected_spans.len() {
        return Err(CompilerError::ExactExport(format!(
            "edge/span count mismatch: solved edges {}, selected spans {}",
            solved.edges_exact.len(),
            input.selected_spans.len()
        )));
    }

    let mut used_vertices = solved
        .edges_exact
        .iter()
        .flat_map(|edge| edge.iter().copied())
        .collect::<Vec<_>>();
    used_vertices.sort_unstable();
    used_vertices.dedup();

    let mut vertex_remap = vec![usize::MAX; solved.vertices_exact.len()];
    let mut vertices_coords = Vec::with_capacity(used_vertices.len());
    for (next_index, old_index) in used_vertices.iter().copied().enumerate() {
        let Some(point) = solved.vertices_exact.get(old_index) else {
            return Err(CompilerError::ExactExport(format!(
                "edge references missing exact vertex {old_index}"
            )));
        };
        vertex_remap[old_index] = next_index;
        vertices_coords.push(vec![point.x, point.y]);
    }

    let mut edges_vertices = Vec::with_capacity(solved.edges_exact.len());
    for edge in &solved.edges_exact {
        let [a, b] = *edge;
        let Some(remapped_a) = vertex_remap.get(a).copied() else {
            return Err(CompilerError::ExactExport(format!(
                "edge references missing exact vertex {a}"
            )));
        };
        let Some(remapped_b) = vertex_remap.get(b).copied() else {
            return Err(CompilerError::ExactExport(format!(
                "edge references missing exact vertex {b}"
            )));
        };
        if remapped_a == usize::MAX || remapped_b == usize::MAX {
            return Err(CompilerError::ExactExport(
                "edge references an unused exact vertex".to_owned(),
            ));
        }
        edges_vertices.push([remapped_a, remapped_b]);
    }

    let edges_assignment = input
        .selected_spans
        .iter()
        .map(|span| fold_assignment(span.assignment_label()))
        .collect::<Vec<_>>();
    let edges_fold_angle = edges_assignment
        .iter()
        .map(|assignment| FoldAngle::default_for_assignment(*assignment))
        .collect::<Vec<_>>();
    let mut document = FoldDocument::new(vertices_coords, edges_vertices);
    document.file_creator = Some("ori-studio-cp-compiler".to_owned());
    document.frame_title = Some("exact-solved crease pattern".to_owned());
    document.edges_assignment = edges_assignment;
    document.edges_fold_angle = edges_fold_angle;
    document.extra.insert(
        "cp_detector".to_owned(),
        json!({
            "source": "exact_solve",
            "coordinate_space": input.coordinate_space,
            "image_size": input.image_size,
            "exact_status": solved.status,
            "vertex_original_ids": used_vertices,
            "edge_ids": input
                .selected_spans
                .iter()
                .map(|span| span.source_edge_ids.first().copied().unwrap_or(span.id))
                .collect::<Vec<_>>(),
            "edge_span_ids": input.selected_spans.iter().map(|span| span.id).collect::<Vec<_>>(),
            "edge_source": input.selected_spans.iter().map(|span| span.source_kind).collect::<Vec<_>>(),
            "edge_provenance": input
                .selected_spans
                .iter()
                .map(|span| span.provenance.clone())
                .collect::<Vec<_>>(),
            "edge_support": input
                .selected_spans
                .iter()
                .map(|span| span.line_support_mean)
                .collect::<Vec<_>>(),
            "assignment_confidence": input
                .selected_spans
                .iter()
                .map(|span| span.assignment_evidence.confidence)
                .collect::<Vec<_>>(),
            "assignment_margin": input
                .selected_spans
                .iter()
                .map(|span| span.assignment_evidence.margin)
                .collect::<Vec<_>>(),
            "boundary_role": input
                .selected_spans
                .iter()
                .map(|span| span.boundary_role())
                .collect::<Vec<_>>(),
            "exact_solve": {
                "movement_report": solved.movement_report,
                "theorem_residual_report": solved.theorem_residual_report
            }
        }),
    );
    Ok(document)
}

pub fn export_exact_solved_to_fold_json(
    input: &ExactSolveInput,
    solved: &ExactSolvedGraph,
) -> Result<String, CompilerError> {
    Ok(serde_json::to_string_pretty(
        &export_exact_solved_to_fold_document(input, solved)?,
    )?)
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
        AssignmentCandidate, CandidateCarrier, CandidateEdge, CandidateVertex, CarrierFamily,
        EvidenceSource, ExactSolvedGraphStatus, LegacyCandidateAdapter, Point2, Provenance,
        SelectedGraph, VertexKind,
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

    #[test]
    fn exports_exact_solved_vertices_instead_of_candidate_positions() {
        let program = CandidateProgram {
            coordinate_space: "unit_test".to_owned(),
            image_size: Some(100),
            carriers: vec![carrier(0)],
            vertices: vec![
                vertex(0, Point2::new(0.0, 0.0)),
                vertex(1, Point2::new(1.0, 0.0)),
            ],
            edges: vec![edge(
                0,
                [0, 1],
                AssignmentLabel::Mountain,
                EdgeSelection::Selected,
            )],
        };
        let graph = LegacyCandidateAdapter::from_program(&program);
        let selected = SelectedGraph::from_selected_span_ids(&graph, vec![0]);
        let input = ExactSolveInput::from_candidate_selection(&graph, &selected);
        let mut solved = ExactSolvedGraph {
            schema: "test".to_owned(),
            vertices_exact: input.vertices.iter().map(|vertex| vertex.point).collect(),
            edges_exact: input
                .selected_spans
                .iter()
                .map(|span| span.vertices)
                .collect(),
            movement_report: serde_json::json!({"status": "test"}),
            theorem_residual_report: serde_json::json!({"status": "test"}),
            status: ExactSolvedGraphStatus::Solved,
        };
        solved.vertices_exact[1] = Point2::new(0.875, 0.125);

        let fold =
            export_exact_solved_to_fold_document(&input, &solved).expect("exact FOLD export");

        assert_eq!(
            fold.vertices_coords,
            vec![vec![0.0, 0.0], vec![0.875, 0.125]]
        );
        assert_eq!(fold.edges_vertices, vec![[0, 1]]);
        assert_eq!(fold.edges_assignment, vec![Assignment::Mountain]);
        assert_eq!(fold.extra["cp_detector"]["source"], "exact_solve");
        assert_eq!(
            fold.extra["cp_detector"]["edge_span_ids"],
            serde_json::json!([0])
        );
        assert_eq!(
            fold.extra["cp_detector"]["edge_ids"],
            serde_json::json!([0])
        );
    }

    fn carrier(id: usize) -> CandidateCarrier {
        CandidateCarrier {
            id,
            family: CarrierFamily::Free,
            normal: Point2::new(0.0, 1.0),
            rho: 0.0,
            support_interval: [0.0, 1.0],
            visual_support: 1.0,
            dashed_support: 0.0,
            non_crease_penalty: 0.0,
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::LegacyDecoder],
        }
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
