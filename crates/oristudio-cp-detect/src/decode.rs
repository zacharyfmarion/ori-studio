//! Public decoder API.
//!
//! The current V2 decoder is now cordoned off as the legacy backend so the
//! constraint-aware compiler can be introduced as an explicit alternative
//! instead of growing inside the old threshold/cleanup implementation.

pub use crate::backend::DecoderBackend;
pub use crate::legacy_decode::{
    DecodeConfig, DecodeEdgeStageSnapshot, DecodeError, DecodeReport, DecodeStageSnapshot,
    DecodeVertexStageSnapshot, DecodeWarning, DecodedFold, DenseOutputs, RepairAction,
    StageCarrier, StageEdge, StageHoughSegment, StageLine, StageVertex,
    decode_edge_stage_snapshot_from_maps, decode_stage_snapshot_from_line_mask,
    decode_vertex_stage_snapshot_from_maps,
};

pub fn decode_dense_outputs(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
) -> Result<DecodedFold, DecodeError> {
    decode_dense_outputs_with_backend(outputs, config, DecoderBackend::LegacyV2)
}

pub fn decode_dense_outputs_with_backend(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
    backend: DecoderBackend,
) -> Result<DecodedFold, DecodeError> {
    match backend {
        DecoderBackend::LegacyV2 => crate::legacy_decode::decode_dense_outputs(outputs, config),
        DecoderBackend::ConstraintCompilerV1 => {
            let legacy = crate::legacy_decode::decode_dense_outputs(outputs, config)?;
            compiler_from_legacy(legacy)
        }
    }
}

fn compiler_from_legacy(mut legacy: DecodedFold) -> Result<DecodedFold, DecodeError> {
    let legacy_report = serde_json::to_value(&legacy.report)?;
    let fold_value: serde_json::Value = serde_json::from_str(&legacy.fold_json)?;
    let program = oristudio_cp_compiler::CandidateProgram::from_fold_value(&fold_value)?;
    let initial_verification = oristudio_cp_compiler::verify::verify_program(
        &program,
        oristudio_cp_compiler::verify::GlobalVerificationOptions::default(),
    );
    let topology = oristudio_cp_compiler::optimizer::optimize_topology(
        &program,
        oristudio_cp_compiler::optimizer::TopologyOptimizerOptions::default(),
    );
    let assignments = oristudio_cp_compiler::assignments::solve_assignments(
        &topology.program,
        oristudio_cp_compiler::assignments::AssignmentSolverOptions::default(),
    );
    let final_program = assignments.program;
    let final_verification = oristudio_cp_compiler::verify::verify_program(
        &final_program,
        oristudio_cp_compiler::verify::GlobalVerificationOptions::default(),
    );
    let summary = oristudio_cp_compiler::CompilerSummary::from_program(&final_program);
    let topology_changed = !topology.accepted_moves.is_empty();
    let assignment_changed = assignments.decisions.iter().any(|decision| {
        decision.provenance != oristudio_cp_compiler::Provenance::AssignmentObserved
    });
    let compiler_report = serde_json::json!({
        "backend": oristudio_cp_compiler::COMPILER_BACKEND_ID,
        "mode": "global_feedback_v1",
        "summary": summary,
        "legacy_report": legacy_report,
        "initial_verification": initial_verification,
        "topology": {
            "cost": topology.cost,
            "accepted_moves": topology.accepted_moves,
            "rejected_move_count": topology.rejected_moves.len(),
            "exhausted_budget": topology.exhausted_budget,
            "ambiguous": topology.ambiguous
        },
        "assignments": {
            "solved": assignments.solved,
            "ambiguous": assignments.ambiguous,
            "exhausted_budget": assignments.exhausted_budget,
            "cost": assignments.cost,
            "decisions": assignments.decisions
        },
        "final_verification": final_verification
    });
    let mut fold: serde_json::Value = serde_json::from_str(
        &oristudio_cp_compiler::fold_export::export_program_to_fold_json(&final_program)?,
    )?;
    if let Some(object) = fold.as_object_mut() {
        let detector = object
            .entry("cp_detector".to_owned())
            .or_insert_with(|| serde_json::json!({}));
        if let Some(detector_object) = detector.as_object_mut() {
            detector_object.insert(
                "decoder_backend".to_owned(),
                serde_json::json!(DecoderBackend::ConstraintCompilerV1.id()),
            );
            detector_object.insert("compiler_report".to_owned(), compiler_report.clone());
        } else {
            object.insert(
                "cp_detector".to_owned(),
                serde_json::json!({
                    "decoder_backend": DecoderBackend::ConstraintCompilerV1.id(),
                    "compiler_report": compiler_report.clone()
                }),
            );
        }
    }
    legacy.fold_json = serde_json::to_string_pretty(&fold)?;
    legacy.report.decoder_backend = DecoderBackend::ConstraintCompilerV1;
    legacy.report.status = compiler_status(&compiler_report, topology_changed, assignment_changed);
    legacy.report.vertex_count = summary.vertices;
    legacy.report.edge_count = summary.edges;
    legacy.report.carrier_count = summary.carriers;
    legacy.report.border_edge_count = summary.border_edges;
    legacy.report.interior_edge_count = summary.interior_edges;
    legacy
        .report
        .repair_actions
        .extend(compiler_repair_actions(&compiler_report));
    legacy
        .report
        .warnings
        .extend(compiler_warnings(&compiler_report));
    if let Some(report) = legacy.report.quality_report.as_object_mut() {
        report.insert(
            "decoder_backend".to_owned(),
            serde_json::json!(DecoderBackend::ConstraintCompilerV1.id()),
        );
        report.insert("compiler_report".to_owned(), compiler_report);
    }
    Ok(legacy)
}

fn compiler_status(
    compiler_report: &serde_json::Value,
    topology_changed: bool,
    assignment_changed: bool,
) -> String {
    let final_classes = compiler_report
        .pointer("/final_verification/classifications")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let clean = final_classes
        .iter()
        .any(|value| value.as_str() == Some("clean"));
    let ambiguous = compiler_report
        .pointer("/topology/ambiguous")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
        || compiler_report
            .pointer("/assignments/ambiguous")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
    if clean && (topology_changed || assignment_changed) {
        "repaired".to_owned()
    } else if clean {
        "valid".to_owned()
    } else if ambiguous {
        "ambiguous".to_owned()
    } else {
        "failed".to_owned()
    }
}

fn compiler_repair_actions(compiler_report: &serde_json::Value) -> Vec<RepairAction> {
    let mut actions = Vec::new();
    if let Some(moves) = compiler_report
        .pointer("/topology/accepted_moves")
        .and_then(serde_json::Value::as_array)
    {
        for value in moves {
            actions.push(RepairAction {
                code: "compiler_topology_move".to_owned(),
                message: "Constraint compiler accepted a topology repair move".to_owned(),
                edge_indices: Vec::new(),
                vertex_indices: Vec::new(),
                details: value.clone(),
            });
        }
    }
    if let Some(decisions) = compiler_report
        .pointer("/assignments/decisions")
        .and_then(serde_json::Value::as_array)
    {
        for value in decisions {
            if value.get("provenance").and_then(serde_json::Value::as_str)
                == Some("assignment_observed")
            {
                continue;
            }
            actions.push(RepairAction {
                code: "compiler_assignment_decision".to_owned(),
                message: "Constraint compiler inferred or changed an assignment".to_owned(),
                edge_indices: value
                    .get("edge_id")
                    .and_then(serde_json::Value::as_u64)
                    .and_then(|edge| usize::try_from(edge).ok())
                    .into_iter()
                    .collect(),
                vertex_indices: Vec::new(),
                details: value.clone(),
            });
        }
    }
    actions
}

fn compiler_warnings(compiler_report: &serde_json::Value) -> Vec<DecodeWarning> {
    let final_classes = compiler_report
        .pointer("/final_verification/classifications")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let clean = final_classes
        .iter()
        .any(|value| value.as_str() == Some("clean"));
    if clean {
        return Vec::new();
    }
    vec![DecodeWarning {
        code: "constraint_compiler_unresolved".to_owned(),
        message: "Constraint compiler output still has verification failures".to_owned(),
        severity: "warning".to_owned(),
        edge_indices: Vec::new(),
        vertex_indices: Vec::new(),
        details: Some(serde_json::json!({ "classifications": final_classes })),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn legacy_backend_router_preserves_existing_output() {
        let size = 64usize;
        let pixels = size * size;
        let mut line_logits = vec![-8.0; pixels];
        let mut junction_logits = vec![-8.0; pixels];
        let mut assignment_logits = vec![-4.0; pixels * 4];
        let non_crease_logits = vec![-8.0; pixels];
        let line_style_logits = vec![-4.0; pixels * 4];
        let mut boundary_contact_logits = vec![-8.0; pixels];

        draw_line(&mut line_logits, size, (32, 0), (32, 63), 8.0);
        draw_line(&mut line_logits, size, (0, 32), (63, 32), 8.0);
        draw_line(&mut line_logits, size, (0, 0), (63, 0), 8.0);
        draw_line(&mut line_logits, size, (63, 0), (63, 63), 8.0);
        draw_line(&mut line_logits, size, (0, 63), (63, 63), 8.0);
        draw_line(&mut line_logits, size, (0, 0), (0, 63), 8.0);
        junction_logits[32 * size + 32] = 8.0;
        boundary_contact_logits[32] = 8.0;
        boundary_contact_logits[63 * size + 32] = 8.0;
        boundary_contact_logits[32 * size] = 8.0;
        boundary_contact_logits[32 * size + 63] = 8.0;
        for y in 0..size {
            assignment_logits[y * size + 32] = 8.0;
        }
        for x in 0..size {
            assignment_logits[pixels + 32 * size + x] = 8.0;
            assignment_logits[2 * pixels + x] = 8.0;
            assignment_logits[2 * pixels + (size - 1) * size + x] = 8.0;
        }
        for y in 0..size {
            assignment_logits[2 * pixels + y * size] = 8.0;
            assignment_logits[2 * pixels + y * size + size - 1] = 8.0;
        }

        let outputs = DenseOutputs {
            line_logits: &line_logits,
            junction_logits: &junction_logits,
            assignment_logits: &assignment_logits,
            non_crease_logits: &non_crease_logits,
            line_style_logits: &line_style_logits,
            boundary_contact_logits: &boundary_contact_logits,
        };
        let config = DecodeConfig {
            image_size: size as u32,
            threshold: 0.65,
            carrier_extent_padding_px: size as f32,
            ..DecodeConfig::default()
        };

        let routed =
            decode_dense_outputs_with_backend(outputs, config.clone(), DecoderBackend::LegacyV2)
                .expect("routed decode should succeed");
        let direct = crate::legacy_decode::decode_dense_outputs(outputs, config)
            .expect("legacy decode should succeed");

        assert_eq!(routed, direct);
        assert_eq!(routed.report.decoder_backend, DecoderBackend::LegacyV2);
        assert_eq!(
            routed.report.quality_report["decoder_backend"],
            "legacy_v2_decoder"
        );
        let fold: Value = serde_json::from_str(&routed.fold_json).expect("fold JSON");
        assert_eq!(fold["cp_detector"]["decoder_backend"], "legacy_v2_decoder");
    }

    #[test]
    fn compiler_backend_runs_global_feedback_pipeline() {
        let (outputs, config) = square_cross_fixture();
        let legacy =
            decode_dense_outputs_with_backend(outputs, config.clone(), DecoderBackend::LegacyV2)
                .expect("legacy decode");
        let compiler = decode_dense_outputs_with_backend(
            outputs,
            config,
            DecoderBackend::ConstraintCompilerV1,
        )
        .expect("compiler decode");
        let legacy_fold: Value = serde_json::from_str(&legacy.fold_json).expect("legacy fold");
        let compiler_fold: Value =
            serde_json::from_str(&compiler.fold_json).expect("compiler fold");

        assert_eq!(
            legacy_fold["vertices_coords"],
            compiler_fold["vertices_coords"]
        );
        assert_eq!(
            legacy_fold["edges_vertices"],
            compiler_fold["edges_vertices"]
        );
        assert_eq!(
            legacy_fold["edges_assignment"],
            compiler_fold["edges_assignment"]
        );
        assert_eq!(
            compiler.report.decoder_backend,
            DecoderBackend::ConstraintCompilerV1
        );
        assert_eq!(
            compiler.report.quality_report["compiler_report"]["mode"],
            "global_feedback_v1"
        );
        assert_eq!(
            compiler_fold["cp_detector"]["decoder_backend"],
            "constraint_compiler_v1"
        );
        assert_eq!(
            compiler_fold["cp_detector"]["edge_ids"]
                .as_array()
                .expect("edge ids")
                .len(),
            compiler_fold["edges_vertices"]
                .as_array()
                .expect("edges")
                .len()
        );
        assert!(
            compiler_fold["cp_detector"]["edge_provenance"]
                .as_array()
                .expect("edge provenance")
                .iter()
                .all(Value::is_array)
        );
        assert!(
            compiler.report.quality_report["compiler_report"]["initial_verification"].is_object()
        );
        assert!(
            compiler.report.quality_report["compiler_report"]["final_verification"].is_object()
        );
    }

    fn square_cross_fixture() -> (DenseOutputs<'static>, DecodeConfig) {
        let size = 64usize;
        let pixels = size * size;
        let line_logits = Box::leak(vec![-8.0; pixels].into_boxed_slice());
        let junction_logits = Box::leak(vec![-8.0; pixels].into_boxed_slice());
        let assignment_logits = Box::leak(vec![-4.0; pixels * 4].into_boxed_slice());
        let non_crease_logits = Box::leak(vec![-8.0; pixels].into_boxed_slice());
        let line_style_logits = Box::leak(vec![-4.0; pixels * 4].into_boxed_slice());
        let boundary_contact_logits = Box::leak(vec![-8.0; pixels].into_boxed_slice());

        draw_line(line_logits, size, (32, 0), (32, 63), 8.0);
        draw_line(line_logits, size, (0, 32), (63, 32), 8.0);
        draw_line(line_logits, size, (0, 0), (63, 0), 8.0);
        draw_line(line_logits, size, (63, 0), (63, 63), 8.0);
        draw_line(line_logits, size, (0, 63), (63, 63), 8.0);
        draw_line(line_logits, size, (0, 0), (0, 63), 8.0);
        junction_logits[32 * size + 32] = 8.0;
        boundary_contact_logits[32] = 8.0;
        boundary_contact_logits[63 * size + 32] = 8.0;
        boundary_contact_logits[32 * size] = 8.0;
        boundary_contact_logits[32 * size + 63] = 8.0;
        for y in 0..size {
            assignment_logits[y * size + 32] = 8.0;
        }
        for x in 0..size {
            assignment_logits[pixels + 32 * size + x] = 8.0;
            assignment_logits[2 * pixels + x] = 8.0;
            assignment_logits[2 * pixels + (size - 1) * size + x] = 8.0;
        }
        for y in 0..size {
            assignment_logits[2 * pixels + y * size] = 8.0;
            assignment_logits[2 * pixels + y * size + size - 1] = 8.0;
        }

        (
            DenseOutputs {
                line_logits,
                junction_logits,
                assignment_logits,
                non_crease_logits,
                line_style_logits,
                boundary_contact_logits,
            },
            DecodeConfig {
                image_size: size as u32,
                threshold: 0.65,
                carrier_extent_padding_px: size as f32,
                ..DecodeConfig::default()
            },
        )
    }

    fn draw_line(
        logits: &mut [f32],
        size: usize,
        start: (usize, usize),
        end: (usize, usize),
        value: f32,
    ) {
        let dx = end.0 as isize - start.0 as isize;
        let dy = end.1 as isize - start.1 as isize;
        let steps = dx.abs().max(dy.abs()).max(1);
        for step in 0..=steps {
            let t = step as f32 / steps as f32;
            let x = (start.0 as f32 + dx as f32 * t).round() as usize;
            let y = (start.1 as f32 + dy as f32 * t).round() as usize;
            logits[y * size + x] = value;
        }
    }
}
