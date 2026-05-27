//! Public decoder API.
//!
//! The current V2 decoder is now cordoned off as the legacy backend so the
//! constraint-aware compiler can be introduced as an explicit alternative
//! instead of growing inside the old threshold/cleanup implementation.

use serde::Serialize;

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
            let program = crate::compiler_decode::candidate_program_from_dense_outputs(
                outputs,
                config.clone(),
            )?;
            compiler_from_program(program, config)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CompilerAblationResult {
    pub schema: &'static str,
    pub stages: Vec<CompilerAblationStage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompilerAblationStage {
    pub id: &'static str,
    pub fold_json: String,
    pub report: DecodeReport,
}

#[derive(Debug, Clone, Copy)]
pub struct CompilerAblationOptions {
    pub include_topology: bool,
    pub include_assignments: bool,
}

impl Default for CompilerAblationOptions {
    fn default() -> Self {
        Self {
            include_topology: true,
            include_assignments: true,
        }
    }
}

pub fn ablate_dense_outputs(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
) -> Result<CompilerAblationResult, DecodeError> {
    ablate_dense_outputs_with_options(outputs, config, CompilerAblationOptions::default())
}

pub fn ablate_dense_outputs_with_options(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
    options: CompilerAblationOptions,
) -> Result<CompilerAblationResult, DecodeError> {
    let legacy = crate::legacy_decode::decode_dense_outputs(outputs, config.clone())?;
    let seed =
        crate::compiler_decode::candidate_program_from_dense_outputs(outputs, config.clone())?;
    let locked_border =
        oristudio_cp_compiler::border::lock_square_border(&seed, Default::default());
    let exactized_seed =
        oristudio_cp_compiler::exactize::exactize_program(&seed, Default::default());
    let exactized_locked = oristudio_cp_compiler::exactize::exactize_program(
        &locked_border.program,
        Default::default(),
    );

    let mut stages = Vec::new();
    stages.push(CompilerAblationStage {
        id: "legacy",
        fold_json: legacy.fold_json.clone(),
        report: legacy.report.clone(),
    });
    stages.push(ablation_program_stage(
        "candidate_seed",
        &seed,
        &config,
        serde_json::json!({
            "candidate_pool": compiler_candidate_pool_summary(&seed)
        }),
    )?);
    stages.push(ablation_program_stage(
        "locked_border",
        &locked_border.program,
        &config,
        serde_json::json!({
            "locked_border": locked_border.report.clone()
        }),
    )?);
    stages.push(ablation_program_stage(
        "exactized_seed",
        &exactized_seed.program,
        &config,
        serde_json::json!({
            "exactize": exactized_seed.report.clone()
        }),
    )?);
    stages.push(ablation_program_stage(
        "locked_border_exactized",
        &exactized_locked.program,
        &config,
        serde_json::json!({
            "locked_border": locked_border.report.clone(),
            "exactize": exactized_locked.report.clone()
        }),
    )?);

    if options.include_topology {
        let topology_current = oristudio_cp_compiler::optimizer::optimize_topology(
            &seed,
            oristudio_cp_compiler::optimizer::TopologyOptimizerOptions::default(),
        );
        let topology_locked = oristudio_cp_compiler::optimizer::optimize_topology(
            &locked_border.program,
            oristudio_cp_compiler::optimizer::TopologyOptimizerOptions::default(),
        );
        stages.push(ablation_program_stage(
            "topology_current",
            &topology_current.program,
            &config,
            serde_json::json!({
                "topology": {
                    "cost": topology_current.cost,
                    "accepted_moves": topology_current.accepted_moves.clone(),
                    "rejected_move_count": topology_current.rejected_moves.len(),
                    "exhausted_budget": topology_current.exhausted_budget,
                    "ambiguous": topology_current.ambiguous
                }
            }),
        )?);
        stages.push(ablation_program_stage(
            "topology_locked_border",
            &topology_locked.program,
            &config,
            serde_json::json!({
                "locked_border": locked_border.report.clone(),
                "topology": {
                    "cost": topology_locked.cost,
                    "accepted_moves": topology_locked.accepted_moves.clone(),
                    "rejected_move_count": topology_locked.rejected_moves.len(),
                    "exhausted_budget": topology_locked.exhausted_budget,
                    "ambiguous": topology_locked.ambiguous
                }
            }),
        )?);

        if options.include_assignments {
            let assignments_current = oristudio_cp_compiler::assignments::solve_assignments(
                &topology_current.program,
                oristudio_cp_compiler::assignments::AssignmentSolverOptions::default(),
            );
            let assignments_locked = oristudio_cp_compiler::assignments::solve_assignments(
                &topology_locked.program,
                oristudio_cp_compiler::assignments::AssignmentSolverOptions::default(),
            );
            stages.push(ablation_program_stage(
                "assignments_current",
                &assignments_current.program,
                &config,
                serde_json::json!({
                    "topology": {
                        "cost": topology_current.cost,
                        "accepted_moves": topology_current.accepted_moves.clone(),
                        "rejected_move_count": topology_current.rejected_moves.len(),
                        "exhausted_budget": topology_current.exhausted_budget,
                        "ambiguous": topology_current.ambiguous
                    },
                    "assignments": {
                        "solved": assignments_current.solved,
                        "ambiguous": assignments_current.ambiguous,
                        "exhausted_budget": assignments_current.exhausted_budget,
                        "cost": assignments_current.cost,
                        "decisions": assignments_current.decisions.clone()
                    }
                }),
            )?);
            stages.push(ablation_program_stage(
                "assignments_locked_border",
                &assignments_locked.program,
                &config,
                serde_json::json!({
                    "locked_border": locked_border.report.clone(),
                    "topology": {
                        "cost": topology_locked.cost,
                        "accepted_moves": topology_locked.accepted_moves.clone(),
                        "rejected_move_count": topology_locked.rejected_moves.len(),
                        "exhausted_budget": topology_locked.exhausted_budget,
                        "ambiguous": topology_locked.ambiguous
                    },
                    "assignments": {
                        "solved": assignments_locked.solved,
                        "ambiguous": assignments_locked.ambiguous,
                        "exhausted_budget": assignments_locked.exhausted_budget,
                        "cost": assignments_locked.cost,
                        "decisions": assignments_locked.decisions.clone()
                    }
                }),
            )?);
        }
    }

    Ok(CompilerAblationResult {
        schema: "oristudio/cp-detect-compiler-ablation/v1",
        stages,
    })
}

fn compiler_from_program(
    program: oristudio_cp_compiler::CandidateProgram,
    config: DecodeConfig,
) -> Result<DecodedFold, DecodeError> {
    let locked_border =
        oristudio_cp_compiler::border::lock_square_border(&program, Default::default());
    let initial_verification = oristudio_cp_compiler::verify::verify_program(
        &locked_border.program,
        oristudio_cp_compiler::verify::GlobalVerificationOptions::default(),
    );
    let final_program = locked_border.program;
    let candidate_verification = oristudio_cp_compiler::verify::verify_program(
        &final_program,
        oristudio_cp_compiler::verify::GlobalVerificationOptions::default(),
    );
    let candidate_clean = verification_clean(&candidate_verification);
    let final_verification = candidate_verification.clone();
    let summary = oristudio_cp_compiler::CompilerSummary::from_program(&final_program);
    let topology_changed = false;
    let assignment_changed = false;
    let compiler_report = serde_json::json!({
        "backend": oristudio_cp_compiler::COMPILER_BACKEND_ID,
        "mode": "global_feedback_v1",
        "output": {
            "selected": "compiled",
            "reason": "compiler_backend_always_emits_compiled_candidate",
            "verified_clean": candidate_clean
        },
        "summary": summary,
        "candidate_pool": compiler_candidate_pool_summary(&program),
        "locked_border": locked_border.report,
        "initial_verification": initial_verification,
        "topology": {
            "enabled": false,
            "reason": "disabled_in_main_backend_after_ablation_regression",
            "cost": 0.0,
            "accepted_moves": [],
            "rejected_move_count": 0,
            "exhausted_budget": false,
            "ambiguous": false
        },
        "assignments": {
            "enabled": false,
            "reason": "disabled_in_main_backend_until_topology_stage_is_promoted",
            "solved": false,
            "ambiguous": false,
            "exhausted_budget": false,
            "cost": 0.0,
            "decisions": []
        },
        "candidate_verification": candidate_verification,
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
    let status = compiler_status(&compiler_report, topology_changed, assignment_changed);
    let warnings = compiler_warnings(&compiler_report);
    let repair_actions = compiler_repair_actions(&compiler_report);
    let quality_report = serde_json::json!({
        "decoder_backend": DecoderBackend::ConstraintCompilerV1.id(),
        "compiler_report": compiler_report
    });
    Ok(DecodedFold {
        fold_json: serde_json::to_string_pretty(&fold)?,
        report: DecodeReport {
            status,
            decoder_backend: DecoderBackend::ConstraintCompilerV1,
            image_size: config.image_size,
            threshold: config.threshold,
            line_count: summary.edges,
            carrier_count: summary.carriers,
            vertex_count: summary.vertices,
            edge_count: summary.edges,
            border_edge_count: summary.border_edges,
            interior_edge_count: summary.interior_edges,
            warnings,
            repair_actions,
            quality_report,
        },
    })
}

fn ablation_program_stage(
    id: &'static str,
    program: &oristudio_cp_compiler::CandidateProgram,
    config: &DecodeConfig,
    stage_details: serde_json::Value,
) -> Result<CompilerAblationStage, DecodeError> {
    let fold_json = oristudio_cp_compiler::fold_export::export_program_to_fold_json(program)?;
    let summary = oristudio_cp_compiler::CompilerSummary::from_program(program);
    let constraints = oristudio_cp_compiler::constraints::diagnose_constraints(
        program,
        oristudio_cp_compiler::constraints::ConstraintDiagnosticOptions::default(),
    );
    let verification = oristudio_cp_compiler::verify::verify_program(
        program,
        oristudio_cp_compiler::verify::GlobalVerificationOptions {
            run_flat_folder: false,
            ..oristudio_cp_compiler::verify::GlobalVerificationOptions::default()
        },
    );
    let clean = verification_clean(&verification);
    let classifications = serde_json::to_value(&verification.classifications)?;
    let warnings = if clean {
        Vec::new()
    } else {
        vec![DecodeWarning {
            code: "compiler_ablation_unresolved".to_owned(),
            message: "Compiler ablation stage still has verification failures".to_owned(),
            severity: "info".to_owned(),
            edge_indices: Vec::new(),
            vertex_indices: Vec::new(),
            details: Some(serde_json::json!({ "classifications": classifications })),
        }]
    };
    let quality_report = serde_json::json!({
        "decoder_backend": DecoderBackend::ConstraintCompilerV1.id(),
        "ablation_stage": id,
        "summary": summary,
        "constraints": constraints,
        "verification": verification,
        "stage_details": stage_details
    });
    Ok(CompilerAblationStage {
        id,
        fold_json,
        report: DecodeReport {
            status: if clean { "valid" } else { "ambiguous" }.to_owned(),
            decoder_backend: DecoderBackend::ConstraintCompilerV1,
            image_size: config.image_size,
            threshold: config.threshold,
            line_count: summary.edges,
            carrier_count: summary.carriers,
            vertex_count: summary.vertices,
            edge_count: summary.edges,
            border_edge_count: summary.border_edges,
            interior_edge_count: summary.interior_edges,
            warnings,
            repair_actions: Vec::new(),
            quality_report,
        },
    })
}

fn compiler_candidate_pool_summary(
    program: &oristudio_cp_compiler::CandidateProgram,
) -> serde_json::Value {
    let selected_edges = program
        .edges
        .iter()
        .filter(|edge| edge.selection == oristudio_cp_compiler::EdgeSelection::Selected)
        .count();
    let undecided_edges = program
        .edges
        .iter()
        .filter(|edge| edge.selection == oristudio_cp_compiler::EdgeSelection::Undecided)
        .count();
    let rejected_edges = program
        .edges
        .iter()
        .filter(|edge| edge.selection == oristudio_cp_compiler::EdgeSelection::Rejected)
        .count();
    let observed_weak_edges = program
        .edges
        .iter()
        .filter(|edge| edge.source == oristudio_cp_compiler::EvidenceSource::ObservedWeak)
        .count();
    let observed_strong_edges = program
        .edges
        .iter()
        .filter(|edge| edge.source == oristudio_cp_compiler::EvidenceSource::ObservedStrong)
        .count();
    serde_json::json!({
        "vertices": program.vertices.len(),
        "carriers": program.carriers.len(),
        "edges": program.edges.len(),
        "selected_edges": selected_edges,
        "undecided_edges": undecided_edges,
        "rejected_edges": rejected_edges,
        "observed_weak_edges": observed_weak_edges,
        "observed_strong_edges": observed_strong_edges,
    })
}

fn verification_clean(report: &oristudio_cp_compiler::verify::GlobalVerificationReport) -> bool {
    report.classifications.iter().any(|classification| {
        *classification == oristudio_cp_compiler::verify::GlobalFailureClassification::Clean
    })
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
        let compiler = decode_dense_outputs_with_backend(
            outputs,
            config,
            DecoderBackend::ConstraintCompilerV1,
        )
        .expect("compiler decode");
        let compiler_fold: Value =
            serde_json::from_str(&compiler.fold_json).expect("compiler fold");

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
        assert_compiler_output_contract(&compiler, &compiler_fold);
        assert!(
            compiler.report.quality_report["compiler_report"]["initial_verification"].is_object()
        );
        assert!(compiler.report.quality_report["compiler_report"]["locked_border"].is_object());
        assert!(
            compiler.report.quality_report["compiler_report"]["locked_border"]
                ["old_selected_border_edges"]
                .as_u64()
                .expect("old selected border edges")
                <= compiler.report.quality_report["compiler_report"]["locked_border"]
                    ["new_border_edges"]
                    .as_u64()
                    .expect("new border edges")
        );
        assert!(
            compiler.report.quality_report["compiler_report"]["locked_border"]["new_border_edges"]
                .as_u64()
                .expect("new border edges")
                > 0
        );
        assert!(
            compiler.report.quality_report["compiler_report"]["final_verification"].is_object()
        );
        assert_eq!(
            compiler.report.quality_report["compiler_report"]["topology"]["enabled"],
            false
        );
        assert!(
            compiler.report.quality_report["compiler_report"]
                .get("legacy_report")
                .is_none()
        );
    }

    fn assert_compiler_output_contract(compiler: &DecodedFold, compiler_fold: &Value) {
        let selected = compiler.report.quality_report["compiler_report"]["output"]["selected"]
            .as_str()
            .expect("selected compiler output");
        assert_eq!(selected, "compiled");
        assert_eq!(
            compiler_fold["cp_detector"]["compiler_report"]["output"]["selected"],
            selected
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
