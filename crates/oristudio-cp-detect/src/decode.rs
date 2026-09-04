//! Public decoder API.
//!
//! The current V2 decoder is now cordoned off as the legacy backend so the
//! constraint-aware compiler can be introduced as an explicit alternative
//! instead of growing inside the old threshold/cleanup implementation.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

pub use crate::backend::DecoderBackend;
pub use crate::legacy_decode::{
    DecodeConfig, DecodeEdgeStageSnapshot, DecodeError, DecodeReport, DecodeStageSnapshot,
    DecodeVertexStageSnapshot, DecodeWarning, DecodedFold, DenseOutputs,
    PRODUCT_JUNCTION_OFFSET_CLUSTER_RADIUS_PX, RepairAction, StageCarrier, StageEdge,
    StageHoughSegment, StageLine, StageVertex, decode_edge_stage_snapshot_from_maps,
    decode_stage_snapshot_from_line_mask, decode_vertex_stage_snapshot_from_maps,
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
        DecoderBackend::ConstraintCompilerV2 => {
            let seed = crate::compiler_decode_v2::candidate_program_from_dense_outputs_v2(
                outputs,
                config.clone(),
            )?;
            compiler_from_program_with_context(
                seed.program,
                config,
                CompilerBackendContext {
                    backend: DecoderBackend::ConstraintCompilerV2,
                    architecture: "v2",
                    mode: "compiler_native_evidence_v2_locked_border_baseline",
                    legacy_dependency: false,
                    evidence_report: Some(serde_json::to_value(seed.evidence.report)?),
                },
            )
        }
        DecoderBackend::LegacyCandidateExactSolveV1 => {
            legacy_candidate_exact_solve(outputs, config)
        }
    }
}

pub fn decode_dense_outputs_with_backend_and_refined_vertices(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
    backend: DecoderBackend,
    refined_vertices: Option<&[RefinedVertexPrimitive]>,
) -> Result<DecodedFold, DecodeError> {
    decode_dense_outputs_with_backend_junction_source_and_refined_vertices(
        outputs,
        config,
        backend,
        crate::evidence_extract::JunctionEvidenceSource::Model,
        refined_vertices,
    )
}

pub fn decode_dense_outputs_with_backend_junction_source_and_refined_vertices(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
    backend: DecoderBackend,
    junction_evidence_source: crate::evidence_extract::JunctionEvidenceSource,
    refined_vertices: Option<&[RefinedVertexPrimitive]>,
) -> Result<DecodedFold, DecodeError> {
    decode_dense_outputs_with_backend_junction_source_and_refined_vertices_in_regions(
        outputs,
        config,
        backend,
        junction_evidence_source,
        refined_vertices,
        None,
    )
}

pub fn decode_dense_outputs_with_backend_junction_source_and_refined_vertices_in_regions(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
    backend: DecoderBackend,
    junction_evidence_source: crate::evidence_extract::JunctionEvidenceSource,
    refined_vertices: Option<&[RefinedVertexPrimitive]>,
    refined_regions: Option<&[RefinedVertexRegion]>,
) -> Result<DecodedFold, DecodeError> {
    match (backend, refined_vertices) {
        (DecoderBackend::LegacyCandidateExactSolveV1, Some(vertices)) => {
            legacy_candidate_exact_solve_with_refined_vertices_in_regions(
                outputs,
                config,
                vertices,
                refined_regions,
            )
        }
        (DecoderBackend::LegacyCandidateExactSolveV1, None)
            if junction_evidence_source
                == crate::evidence_extract::JunctionEvidenceSource::LineArrangement =>
        {
            legacy_candidate_exact_solve_with_junction_evidence_source(
                outputs,
                config,
                junction_evidence_source,
                "line-arrangement",
            )
        }
        _ => decode_dense_outputs_with_backend(outputs, config, backend),
    }
}

/// Wall clock for the decode stage timings reported in `compiler_report`.
///
/// `std::time::Instant` panics under `wasm32-unknown-unknown`, so the browser
/// arm reads `Date.now()` instead — the same split
/// `oristudio_cp_compiler::exact_solve`'s deadline clock uses, so the solver's
/// `movement_report.elapsed_seconds` and our `exact_solve_seconds` come off the
/// same source. `Date.now()` is millisecond-resolution and can be coarsened
/// further by cross-origin isolation settings, so browser stage timings are
/// accurate to a few milliseconds, not to the microsecond that `Instant` gives
/// natively.
struct StageTimer {
    #[cfg(not(target_arch = "wasm32"))]
    started_at: Instant,
    #[cfg(target_arch = "wasm32")]
    started_at_ms: f64,
}

impl StageTimer {
    fn start() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            started_at: Instant::now(),
            #[cfg(target_arch = "wasm32")]
            started_at_ms: js_sys::Date::now(),
        }
    }

    fn elapsed_seconds(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.started_at.elapsed().as_secs_f64()
        }
        #[cfg(target_arch = "wasm32")]
        {
            ((js_sys::Date::now() - self.started_at_ms) / 1000.0).max(0.0)
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RefinedVertexPrimitive {
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_side: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side_coordinate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RefinedVertexRegion {
    pub x_min: f64,
    pub y_min: f64,
    pub x_max: f64,
    pub y_max: f64,
}

/// One sample's refiner output for the benchmark's `--refined-vertices` cache:
/// merged vertices (pixel space) plus the refinement regions they cover. Fed
/// through the same in-regions evidence override the product uses.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RefinedVertexCacheEntry {
    #[serde(default)]
    pub vertices: Vec<RefinedVertexPrimitive>,
    #[serde(default)]
    pub regions: Vec<RefinedVertexRegion>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct RefinedVertexEvidenceReport {
    source: &'static str,
    input_vertices: usize,
    refinement_regions: usize,
    preserved_junction_primitives: usize,
    preserved_boundary_contact_primitives: usize,
    accepted_junction_primitives: usize,
    accepted_boundary_contact_primitives: usize,
    skipped_vertices: usize,
}

#[derive(Debug, Clone)]
struct CandidateExactSolveContext {
    junction_source: &'static str,
    evidence_report: Option<serde_json::Value>,
    refined_vertex_report: Option<RefinedVertexEvidenceReport>,
}

impl CandidateExactSolveContext {
    fn dense_model() -> Self {
        Self {
            junction_source: "dense-model",
            evidence_report: None,
            refined_vertex_report: None,
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
    let carrier_reconciled = oristudio_cp_compiler::carrier_reconcile::reconcile_carriers(
        &locked_border.program,
        Default::default(),
    );
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
            "candidate_pool": compiler_candidate_pool_summary(&seed),
            "edits": compiler_edit_accounting(&seed, &seed)
        }),
    )?);
    stages.push(ablation_program_stage(
        "locked_border",
        &locked_border.program,
        &config,
        serde_json::json!({
            "locked_border": locked_border.report.clone(),
            "edits": compiler_edit_accounting(&seed, &locked_border.program)
        }),
    )?);
    stages.push(ablation_program_stage(
        "carrier_reconciled_locked_border",
        &carrier_reconciled.program,
        &config,
        serde_json::json!({
            "locked_border": locked_border.report.clone(),
            "carrier_reconcile": carrier_reconciled.report.clone(),
            "edits": compiler_edit_accounting(&locked_border.program, &carrier_reconciled.program)
        }),
    )?);
    stages.push(ablation_program_stage(
        "exactized_seed",
        &exactized_seed.program,
        &config,
        serde_json::json!({
            "exactize": exactized_seed.report.clone(),
            "edits": compiler_edit_accounting(&seed, &exactized_seed.program)
        }),
    )?);
    stages.push(ablation_program_stage(
        "locked_border_exactized",
        &exactized_locked.program,
        &config,
        serde_json::json!({
            "locked_border": locked_border.report.clone(),
            "exactize": exactized_locked.report.clone(),
            "edits": compiler_edit_accounting(&locked_border.program, &exactized_locked.program)
        }),
    )?);

    if options.include_topology {
        let topology_locked = topology_stage(
            "topology_locked_border",
            &locked_border.program,
            &config,
            serde_json::json!({
                "locked_border": locked_border.report.clone()
            }),
            oristudio_cp_compiler::optimizer::TopologyOptimizerOptions::default(),
        )?;
        stages.push(topology_locked.stage.clone());
        stages.push(
            topology_stage(
                "topology_carrier_reconciled",
                &carrier_reconciled.program,
                &config,
                serde_json::json!({
                    "locked_border": locked_border.report.clone(),
                    "carrier_reconcile": carrier_reconciled.report.clone()
                }),
                oristudio_cp_compiler::optimizer::TopologyOptimizerOptions::default(),
            )?
            .stage,
        );
        for variant in topology_ablation_variants() {
            stages.push(
                topology_stage(
                    variant.id,
                    &locked_border.program,
                    &config,
                    serde_json::json!({
                        "locked_border": locked_border.report.clone()
                    }),
                    variant.options,
                )?
                .stage,
            );
        }

        if options.include_assignments {
            let assignments_locked = oristudio_cp_compiler::assignments::solve_assignments(
                &topology_locked.program,
                oristudio_cp_compiler::assignments::AssignmentSolverOptions::default(),
            );
            stages.push(ablation_program_stage(
                "assignments_locked_border",
                &assignments_locked.program,
                &config,
                serde_json::json!({
                    "locked_border": locked_border.report.clone(),
                    "topology": {
                        "cost": topology_locked.result.cost,
                        "accepted_moves": topology_locked.result.accepted_moves.clone(),
                        "rejected_move_count": topology_locked.result.rejected_moves.len(),
                        "exhausted_budget": topology_locked.result.exhausted_budget,
                        "ambiguous": topology_locked.result.ambiguous
                    },
                    "assignments": {
                        "solved": assignments_locked.solved,
                        "ambiguous": assignments_locked.ambiguous,
                        "exhausted_budget": assignments_locked.exhausted_budget,
                        "cost": assignments_locked.cost,
                        "decisions": assignments_locked.decisions.clone()
                    },
                    "edits": compiler_edit_accounting(&locked_border.program, &assignments_locked.program)
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
    compiler_from_program_with_context(
        program,
        config,
        CompilerBackendContext {
            backend: DecoderBackend::ConstraintCompilerV1,
            architecture: "v1",
            mode: "global_feedback_v1",
            legacy_dependency: true,
            evidence_report: None,
        },
    )
}

fn legacy_candidate_exact_solve(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
) -> Result<DecodedFold, DecodeError> {
    let generation_options = default_candidate_generation_options(
        &config,
        crate::evidence_extract::JunctionEvidenceSource::Model,
    );
    let generation = crate::candidate_generation::generate_candidate_graph(
        crate::candidate_generation::CandidateGenerationContext {
            outputs,
            config: config.clone(),
        },
        generation_options,
    )?;
    legacy_candidate_exact_solve_from_generation(
        config,
        generation,
        CandidateExactSolveContext::dense_model(),
    )
}

fn legacy_candidate_exact_solve_with_refined_vertices_in_regions(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
    refined_vertices: &[RefinedVertexPrimitive],
    refined_regions: Option<&[RefinedVertexRegion]>,
) -> Result<DecodedFold, DecodeError> {
    let generation_options = default_candidate_generation_options(
        &config,
        crate::evidence_extract::JunctionEvidenceSource::Model,
    );
    let strategy = crate::candidate_generation::JunctionFirstV1Strategy::new(
        generation_options.junction_first_v1,
    );
    let mut evidence = strategy.extract_evidence(outputs, &config)?;
    let refined_vertex_report = apply_refined_vertex_evidence_override(
        &mut evidence,
        refined_vertices,
        config.image_size,
        refined_regions,
    );
    let evidence_report = Some(serde_json::to_value(&evidence.report)?);
    let generation = strategy.generate_from_evidence(&evidence, &config);
    legacy_candidate_exact_solve_from_generation(
        config,
        generation,
        CandidateExactSolveContext {
            junction_source: "vertex-refiner-v3",
            evidence_report,
            refined_vertex_report: Some(refined_vertex_report),
        },
    )
}

fn legacy_candidate_exact_solve_with_junction_evidence_source(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
    junction_evidence_source: crate::evidence_extract::JunctionEvidenceSource,
    junction_source_label: &'static str,
) -> Result<DecodedFold, DecodeError> {
    let generation_options =
        default_candidate_generation_options(&config, junction_evidence_source);
    let strategy = crate::candidate_generation::JunctionFirstV1Strategy::new(
        generation_options.junction_first_v1,
    );
    let evidence = strategy.extract_evidence(outputs, &config)?;
    let evidence_report = Some(serde_json::to_value(&evidence.report)?);
    let generation = strategy.generate_from_evidence(&evidence, &config);
    legacy_candidate_exact_solve_from_generation(
        config,
        generation,
        CandidateExactSolveContext {
            junction_source: junction_source_label,
            evidence_report,
            refined_vertex_report: None,
        },
    )
}

fn default_candidate_generation_options(
    config: &DecodeConfig,
    junction_evidence_source: crate::evidence_extract::JunctionEvidenceSource,
) -> crate::candidate_generation::CandidateGenerationOptions {
    let mut generation_options = crate::candidate_generation::CandidateGenerationOptions::default();
    // The model manifest declares the offset head's normalization radius;
    // radius-trained models decode junctions via offset-vote clustering.
    generation_options
        .junction_first_v1
        .junction_offset_cluster_radius_px = config.junction_offset_cluster_radius_px as f64;
    generation_options
        .junction_first_v1
        .junction_cluster_keep_rule = config.junction_cluster_keep_rule;
    generation_options
        .junction_carrier_v1
        .junction_cluster_keep_rule = config.junction_cluster_keep_rule;
    generation_options
        .junction_first_v1
        .junction_evidence_source = junction_evidence_source;
    generation_options
        .junction_carrier_v1
        .junction_evidence_source = junction_evidence_source;
    generation_options
}

/// Everything the pre-solve half of the candidate exact-solve backend
/// produces, and the only value the solving tail is allowed to start from.
///
/// The point of the type is that it has **one** constructor
/// ([`recognize_from_generation`]). Recognize-only and recognize-then-solve are
/// then not two pipelines that have to be kept in agreement — the second is
/// literally the first plus [`oristudio_cp_compiler::solve_exact`] — so they
/// cannot drift apart by editing one and forgetting the other. The parity test
/// `recognize_then_solve_is_byte_identical_to_the_fused_decode` is what fails
/// if that ever stops being true.
struct RecognizedCandidate {
    /// Started at the top of recognition, so `compiler_seconds` covers the same
    /// span on both paths (the solve, when it runs, is nested inside it).
    compiler_started: StageTimer,
    context: CandidateExactSolveContext,
    candidate_strategy: &'static str,
    weak_threshold: f32,
    candidate_graph: oristudio_cp_compiler::CandidateGraph,
    selection: oristudio_cp_compiler::selection::CandidateSelection,
    selected_span_set: BTreeSet<usize>,
    exact_input: oristudio_cp_compiler::ExactSolveInput,
    /// `exact_input` serialized *before* any solve, verbatim.
    exact_solve_input: serde_json::Value,
}

fn legacy_candidate_exact_solve_from_generation(
    config: DecodeConfig,
    generation: crate::candidate_generation::CandidateGenerationOutput,
    context: CandidateExactSolveContext,
) -> Result<DecodedFold, DecodeError> {
    let recognized = recognize_from_generation(generation, context)?;
    // The one branch. Everything above it is shared by construction.
    if config.recognize_only {
        return recognized_candidate_fold(&config, recognized);
    }
    solve_recognized_candidate(&config, recognized)
}

/// Recognize a candidate crease pattern: generate, select, finalize
/// assignments, and build the `ExactSolveInput` a solve would run on. No solve.
///
/// Takes no `DecodeConfig` because it needs none — every knob it would read was
/// already consumed by candidate generation, and the only config the solving
/// tail adds is `exact_solve_timeout_seconds`. Threading an unused parameter
/// through would just be a `-D warnings` failure waiting to be silenced.
fn recognize_from_generation(
    generation: crate::candidate_generation::CandidateGenerationOutput,
    context: CandidateExactSolveContext,
) -> Result<RecognizedCandidate, DecodeError> {
    let compiler_started = StageTimer::start();
    let weak_threshold = generation.low_threshold;
    let candidate_strategy = generation.strategy.id();
    let mut candidate_graph = generation.candidate_graph;
    // Shared production selection + post-selection assignment finalization —
    // the same single codepath the stage inspector and the benchmark use.
    let selection = oristudio_cp_compiler::selection::select_and_finalize_candidate_graph(
        &mut candidate_graph,
        oristudio_cp_compiler::selection::SelectionOptions::default(),
        oristudio_cp_compiler::exact_probe::ExactProbeOptions::default(),
    );
    let selected_span_ids = selection
        .selected_spans
        .iter()
        .map(|span| span.id)
        .collect::<Vec<_>>();
    let selected_span_set = selected_span_ids.iter().copied().collect::<BTreeSet<_>>();
    let selected_graph = oristudio_cp_compiler::SelectedGraph::from_selected_span_ids(
        &candidate_graph,
        selected_span_ids,
    );
    let exact_input = oristudio_cp_compiler::ExactSolveInput::from_candidate_selection(
        &candidate_graph,
        &selected_graph,
    );
    // Captured *before* the solve, and verbatim: `solve_exact` is a pure
    // function of this value, so emitting it is what lets the browser edit the
    // candidate topology by hand and re-solve (see
    // `implementation-plans/crease-topology-repair.md`, "The seam already
    // exists"). Serialized eagerly so a serialization failure propagates as a
    // typed `DecodeError::Json` rather than panicking inside `json!`.
    let exact_solve_input = serde_json::to_value(&exact_input)?;
    Ok(RecognizedCandidate {
        compiler_started,
        context,
        candidate_strategy,
        weak_threshold,
        candidate_graph,
        selection,
        selected_span_set,
        exact_input,
        exact_solve_input,
    })
}

fn solve_recognized_candidate(
    config: &DecodeConfig,
    recognized: RecognizedCandidate,
) -> Result<DecodedFold, DecodeError> {
    let RecognizedCandidate {
        compiler_started,
        context,
        candidate_strategy,
        weak_threshold,
        candidate_graph,
        selection,
        selected_span_set,
        exact_input,
        exact_solve_input,
    } = recognized;
    let exact_started = StageTimer::start();
    let exact_solve = oristudio_cp_compiler::solve_exact(
        &exact_input,
        oristudio_cp_compiler::ExactSolveOptions {
            timeout_seconds: config.exact_solve_timeout_seconds,
            ..oristudio_cp_compiler::ExactSolveOptions::default()
        },
    );
    let exact_seconds = exact_started.elapsed_seconds();
    let mut fold_document =
        oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document(
            &exact_input,
            &exact_solve,
        )?;
    let final_verification = oristudio_cp_compiler::verify::verify_fold_document(
        &fold_document,
        product_export_verification_options(),
    );
    let candidate_clean = verification_clean(&final_verification);
    let summary = exact_export_summary(&exact_input);
    let weak_selected_spans = weak_selected_span_count(&exact_input);
    let dropped_legacy_spans = dropped_legacy_span_count(&candidate_graph, &selected_span_set);
    let moved_vertices = exact_moved_vertex_count(&exact_solve);
    let compiler_seconds = compiler_started.elapsed_seconds();
    let compiler_report = serde_json::json!({
        // Historical backend id kept for wire compatibility; the candidate
        // stage is whatever strategy CandidateGenerationOptions selects
        // (junction-first-v1 by default since PR #55), not the legacy adapter.
        "backend": "legacy_candidate_exact_solve_v1",
        "candidate_strategy": candidate_strategy,
        "junction_source": context.junction_source,
        "compiler_architecture": "v2",
        "mode": "candidate_generation_beam_selection_exact_solve",
        "legacy_dependency": false,
        "stage_ids": [
            "candidate_generation",
            "candidate_graph_beam_selection",
            "exact_solve",
            "verify_final",
            "fold_export"
        ],
        "timings": {
            "compiler_seconds": compiler_seconds,
            "exact_solve_seconds": exact_seconds
        },
        "output": {
            "selected": "exact_solved",
            "reason": "legacy candidates selected by shared beam selector, then exported from exact-solved coordinates",
            "verified_clean": candidate_clean
        },
        "final_verification_scope": {
            "run_oristudio_checks": false,
            "run_flat_folder": false,
            "reason": "browser product export keeps heavyweight global validation out of the detector worker"
        },
        "candidate_graph": {
            "report": candidate_graph.report,
            "provenance": candidate_graph.provenance,
            "legacy_low_threshold": weak_threshold
        },
        "evidence": context.evidence_report,
        "refined_vertices": context.refined_vertex_report,
        "selection": {
            "report": selection.report,
            "weak_selected_spans": weak_selected_spans,
            "dropped_legacy_spans": dropped_legacy_spans
        },
        // The pre-solve candidate the solve ran on, verbatim. Round-trips back
        // into `oristudio_cp_compiler::ExactSolveInput`, so a client can hand a
        // hand-edited copy to `cp_detect_solve_exact` and get a real solve.
        "exact_solve_input": exact_solve_input,
        "exact_solve": exact_solve,
        "summary": summary,
        "topology": {
            "enabled": true,
            "source": "candidate_graph_beam_selection",
            "accepted_moves": [],
            "weak_selected_spans": weak_selected_spans,
            "dropped_legacy_spans": dropped_legacy_spans,
            "ambiguous": false
        },
        "assignments": {
            "enabled": false,
            "reason": "assignment_solver_not_promoted_in_product_route",
            "solved": false,
            "ambiguous": false,
            "exhausted_budget": false,
            "cost": 0.0,
            "decisions": []
        },
        "final_verification": final_verification
    });
    if let Some(detector_object) = fold_document
        .extra
        .entry("cp_detector".to_owned())
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
    {
        detector_object.insert(
            "decoder_backend".to_owned(),
            serde_json::json!(DecoderBackend::LegacyCandidateExactSolveV1.id()),
        );
        detector_object.insert(
            "candidate_strategy".to_owned(),
            serde_json::json!(candidate_strategy),
        );
        detector_object.insert(
            "compiler_report".to_owned(),
            fold_compiler_report(&compiler_report),
        );
    }
    let topology_changed =
        weak_selected_spans > 0 || dropped_legacy_spans > 0 || moved_vertices > 0;
    let status = compiler_status(&compiler_report, topology_changed, false);
    let warnings = compiler_warnings(&compiler_report);
    let repair_actions = compiler_repair_actions(&compiler_report);
    let quality_report = serde_json::json!({
        "decoder_backend": DecoderBackend::LegacyCandidateExactSolveV1.id(),
        "junction_source": context.junction_source,
        "candidate_strategy": candidate_strategy,
        "refined_vertices": context.refined_vertex_report,
        "compiler_report": compiler_report
    });
    Ok(DecodedFold {
        fold_json: serde_json::to_string_pretty(&fold_document)?,
        report: DecodeReport {
            status,
            decoder_backend: DecoderBackend::LegacyCandidateExactSolveV1,
            image_size: config.image_size,
            threshold: config.threshold,
            line_count: summary.edges,
            carrier_count: exact_input.selected_spans.len(),
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

/// Status reported when `recognize_only` stopped the pipeline before the solve.
///
/// Deliberately not one of `compiler_status`'s four values: `"failed"` and
/// `"ambiguous"` both claim a solve reached a verdict, and this one never
/// started. A reader that does not know the token must not mistake it for a
/// solved pattern, which is why it is a new word rather than `"valid"`.
const RECOGNIZED_STATUS: &str = "recognized";

/// The recognize-only ending: export the candidate at its pre-solve
/// coordinates, say what is wrong with its topology, and stop.
///
/// No solve is attempted and **no `exact_solve` block is emitted**. Emitting
/// one — which is what `exact_solve_timeout_seconds: 0.0` would have produced —
/// would report `status: "failed"` with timeout rejection reasons and so label
/// a candidate that was never attempted as one that failed. `solve.attempted`
/// states the distinction positively, so a reader is not left inferring it from
/// a missing key.
fn recognized_candidate_fold(
    config: &DecodeConfig,
    recognized: RecognizedCandidate,
) -> Result<DecodedFold, DecodeError> {
    let RecognizedCandidate {
        compiler_started,
        context,
        candidate_strategy,
        weak_threshold,
        candidate_graph,
        selection,
        selected_span_set,
        exact_input,
        exact_solve_input,
    } = recognized;
    // The candidate export self-identifies: `frame_title = "candidate crease
    // pattern"` and `cp_detector.source = "exact_solve_candidate"` rather than
    // `"exact_solve"`. That discriminator is what a client should read, not the
    // absence of a solve block.
    let mut fold_document =
        oristudio_cp_compiler::fold_export::export_candidate_to_fold_document(&exact_input)?;
    let topology_diagnostics = oristudio_cp_compiler::analyze_candidate_topology(&exact_input);
    let summary = exact_export_summary(&exact_input);
    let weak_selected_spans = weak_selected_span_count(&exact_input);
    let dropped_legacy_spans = dropped_legacy_span_count(&candidate_graph, &selected_span_set);
    let compiler_seconds = compiler_started.elapsed_seconds();
    let compiler_report = serde_json::json!({
        "backend": "legacy_candidate_exact_solve_v1",
        "candidate_strategy": candidate_strategy,
        "junction_source": context.junction_source,
        "compiler_architecture": "v2",
        "mode": "candidate_generation_beam_selection_recognize_only",
        "legacy_dependency": false,
        "stage_ids": [
            "candidate_generation",
            "candidate_graph_beam_selection",
            "topology_diagnostics",
            "candidate_fold_export"
        ],
        "timings": {
            "compiler_seconds": compiler_seconds
        },
        "output": {
            "selected": "recognized_candidate",
            "reason": "recognize_only: exported at pre-solve candidate coordinates; the exact solve was not attempted",
            "verified": false
        },
        // Global verification describes a *solved* export. Running it over
        // candidate coordinates would report the residuals the solve exists to
        // remove, so a recognize-only result reports no verification rather
        // than a misleading one.
        "final_verification_scope": {
            "run_oristudio_checks": false,
            "run_flat_folder": false,
            "reason": "recognize_only stops before the solve, so there is no solved export to verify"
        },
        "candidate_graph": {
            "report": candidate_graph.report,
            "provenance": candidate_graph.provenance,
            "legacy_low_threshold": weak_threshold
        },
        "evidence": context.evidence_report,
        "refined_vertices": context.refined_vertex_report,
        "selection": {
            "report": selection.report,
            "weak_selected_spans": weak_selected_spans,
            "dropped_legacy_spans": dropped_legacy_spans
        },
        // The pre-solve candidate, verbatim and in the same place the fused
        // path puts it. Round-trips back into
        // `oristudio_cp_compiler::ExactSolveInput`, so a client hands a
        // hand-edited copy to `cp_detect_solve_exact` and gets a real solve.
        "exact_solve_input": exact_solve_input,
        // The repair worklist. Combinatorial findings survive moving the
        // drawing around and are what a user can act on; the angle-dependent
        // ones are large by construction on an unsolved candidate and say
        // nothing about whether the topology is right.
        "topology_diagnostics": topology_diagnostics,
        "solve": solve_not_attempted_report(config),
        "summary": summary,
        "topology": {
            "enabled": true,
            "source": "candidate_graph_beam_selection",
            "accepted_moves": [],
            "weak_selected_spans": weak_selected_spans,
            "dropped_legacy_spans": dropped_legacy_spans,
            "ambiguous": false
        },
        "assignments": {
            "enabled": false,
            "reason": "assignment_solver_not_promoted_in_product_route",
            "solved": false,
            "ambiguous": false,
            "exhausted_budget": false,
            "cost": 0.0,
            "decisions": []
        }
    });
    if let Some(detector_object) = fold_document
        .extra
        .entry("cp_detector".to_owned())
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
    {
        detector_object.insert(
            "decoder_backend".to_owned(),
            serde_json::json!(DecoderBackend::LegacyCandidateExactSolveV1.id()),
        );
        detector_object.insert(
            "candidate_strategy".to_owned(),
            serde_json::json!(candidate_strategy),
        );
        detector_object.insert(
            "compiler_report".to_owned(),
            fold_compiler_report(&compiler_report),
        );
    }
    let quality_report = serde_json::json!({
        "decoder_backend": DecoderBackend::LegacyCandidateExactSolveV1.id(),
        "junction_source": context.junction_source,
        "candidate_strategy": candidate_strategy,
        "refined_vertices": context.refined_vertex_report,
        "compiler_report": compiler_report
    });
    Ok(DecodedFold {
        fold_json: serde_json::to_string_pretty(&fold_document)?,
        report: DecodeReport {
            status: RECOGNIZED_STATUS.to_owned(),
            decoder_backend: DecoderBackend::LegacyCandidateExactSolveV1,
            image_size: config.image_size,
            threshold: config.threshold,
            line_count: summary.edges,
            carrier_count: exact_input.selected_spans.len(),
            vertex_count: summary.vertices,
            edge_count: summary.edges,
            border_edge_count: summary.border_edges,
            interior_edge_count: summary.interior_edges,
            // Nothing was verified and nothing was repaired. A warning here
            // would be about the candidate's residuals, which
            // `topology_diagnostics` reports properly.
            warnings: Vec::new(),
            repair_actions: Vec::new(),
            quality_report,
        },
    })
}

/// The solve the recognize-only path did not run, and the budget the caller
/// owes it.
///
/// **The staged flow keeps the same total wall-clock budget as today's fused
/// solve** — the measured 307/563 baseline was measured against that cap, and
/// "25 s max" is what the product promises. Rust cannot enforce that on its
/// own: `solve_exact` builds its deadline from the `timeout_seconds` of the
/// call it is in, so two separate `cp_detect_solve_exact` calls are two
/// independent deadlines with no shared clock between them. What Rust can do is
/// publish the number, so the caller budgets against the same value the fused
/// path used instead of hardcoding one.
///
/// The caller's rule, then: spend `total_seconds` across *all* solve calls for
/// this candidate. `runCpExactSolve` makes two — give stage 1 `total_seconds`
/// and stage 2 `total_seconds` minus stage 1's elapsed wall. A negative
/// `total_seconds` disables the timeout and must be passed through unchanged
/// rather than clamped, because zero means "time out immediately".
fn solve_not_attempted_report(config: &DecodeConfig) -> serde_json::Value {
    serde_json::json!({
        "attempted": false,
        "reason": "recognize_only",
        "budget": {
            "total_seconds": config.exact_solve_timeout_seconds,
            "spent_seconds": 0.0,
            "policy": "shared_total_across_staged_solve_calls"
        }
    })
}

fn weak_selected_span_count(input: &oristudio_cp_compiler::ExactSolveInput) -> usize {
    input
        .selected_spans
        .iter()
        .filter(|span| {
            span.source_kind == oristudio_cp_compiler::CandidateCreaseSourceKind::LegacyLowThreshold
        })
        .count()
}

fn dropped_legacy_span_count(
    candidate_graph: &oristudio_cp_compiler::CandidateGraph,
    selected_span_set: &BTreeSet<usize>,
) -> usize {
    candidate_graph
        .crease_candidates
        .iter()
        .filter(|span| {
            span.source_kind == oristudio_cp_compiler::CandidateCreaseSourceKind::LegacySelected
                && !selected_span_set.contains(&span.id)
        })
        .count()
}

/// The compiler report as the FOLD document carries it: everything except the
/// pre-solve `ExactSolveInput`.
///
/// That blob is the bulk of a detection payload — 39 K / 108 K / 252 K on the
/// measured fixtures — and it used to cross the wasm bridge **twice**, once in
/// `report.quality_report` and once again inside the `fold_json` *string*, up
/// to ~0.5 MB duplicated per detection. The report copy is the one that stays:
/// it is where the browser already reads it from
/// (`CpDetectImportModal.tsx`'s `detectionCompilerReport`), and it is the copy
/// that has not been through `to_string_pretty` and back, which matters for a
/// value whose entire purpose is to deserialize into `ExactSolveInput` again.
///
/// The key is replaced rather than dropped, so a reader looking in the FOLD
/// finds out where it went instead of concluding the detection had no seam.
fn fold_compiler_report(compiler_report: &serde_json::Value) -> serde_json::Value {
    let mut trimmed = compiler_report.clone();
    if let Some(object) = trimmed.as_object_mut()
        && object.remove("exact_solve_input").is_some()
    {
        object.insert(
            "exact_solve_input_location".to_owned(),
            serde_json::json!("report.quality_report.compiler_report.exact_solve_input"),
        );
    }
    trimmed
}

pub(crate) fn apply_refined_vertex_evidence_override(
    evidence: &mut crate::evidence_extract::CompilerEvidence,
    refined_vertices: &[RefinedVertexPrimitive],
    image_size: u32,
    refined_regions: Option<&[RefinedVertexRegion]>,
) -> RefinedVertexEvidenceReport {
    let image_max = image_size.saturating_sub(1).max(1) as f64;
    let mut junctions = refined_regions.map_or_else(Vec::new, |regions| {
        evidence
            .junction_primitives
            .iter()
            .filter(|primitive| !point_in_any_refined_region(primitive.point, regions))
            .cloned()
            .collect()
    });
    let mut contacts = refined_regions.map_or_else(Vec::new, |regions| {
        evidence
            .boundary_contact_primitives
            .iter()
            .filter(|primitive| !point_in_any_refined_region(primitive.point, regions))
            .cloned()
            .collect()
    });
    let preserved_junction_primitives = junctions.len();
    let preserved_boundary_contact_primitives = contacts.len();
    let mut skipped_vertices = 0usize;
    for vertex in refined_vertices {
        let score = finite_refined_score(vertex.score);
        let kind = vertex.kind.as_deref().unwrap_or("interior_junction");
        if kind == "background" || kind == "corner" {
            skipped_vertices += 1;
            continue;
        }
        let point = [
            vertex.x.clamp(0.0, image_max) as f32,
            vertex.y.clamp(0.0, image_max) as f32,
        ];
        let explicit_side = vertex
            .boundary_side
            .as_deref()
            .and_then(refined_boundary_side);
        if let Some(side) = refined_boundary_contact_side(kind, explicit_side, point, image_max) {
            contacts.push(crate::evidence_extract::BoundaryContactPrimitive {
                point,
                side,
                side_coordinate: refined_side_coordinate(vertex.side_coordinate)
                    .unwrap_or_else(|| boundary_side_coordinate(point, side, image_max)),
                support: score,
                source: refined_primitive_source(score),
            });
        } else {
            junctions.push(crate::evidence_extract::JunctionPrimitive {
                point,
                support: score,
                source: refined_primitive_source(score),
            });
        }
    }
    evidence.junction_primitives = junctions;
    evidence.boundary_contact_primitives = contacts;
    evidence.report.junction_primitives = evidence.junction_primitives.len();
    evidence.report.boundary_contact_primitives = evidence.boundary_contact_primitives.len();
    RefinedVertexEvidenceReport {
        source: "vertex-refiner-v3",
        input_vertices: refined_vertices.len(),
        refinement_regions: refined_regions.map_or(0, |regions| regions.len()),
        preserved_junction_primitives,
        preserved_boundary_contact_primitives,
        accepted_junction_primitives: evidence.junction_primitives.len(),
        accepted_boundary_contact_primitives: evidence.boundary_contact_primitives.len(),
        skipped_vertices,
    }
}

fn point_in_any_refined_region(point: [f32; 2], regions: &[RefinedVertexRegion]) -> bool {
    regions.iter().any(|region| {
        let x_min = region.x_min.min(region.x_max);
        let x_max = region.x_min.max(region.x_max);
        let y_min = region.y_min.min(region.y_max);
        let y_max = region.y_min.max(region.y_max);
        (point[0] as f64) >= x_min
            && (point[0] as f64) <= x_max
            && (point[1] as f64) >= y_min
            && (point[1] as f64) <= y_max
    })
}

fn refined_boundary_contact_side(
    kind: &str,
    explicit_side: Option<crate::evidence_extract::BoundarySide>,
    point: [f32; 2],
    image_max: f64,
) -> Option<crate::evidence_extract::BoundarySide> {
    if kind == "boundary_contact" {
        return Some(explicit_side.unwrap_or_else(|| nearest_boundary_side(point, image_max)));
    }
    None
}

fn finite_refined_score(score: Option<f64>) -> f32 {
    score
        .filter(|value| value.is_finite())
        .unwrap_or(1.0)
        .clamp(0.0, 1.0) as f32
}

fn refined_side_coordinate(side_coordinate: Option<f64>) -> Option<f32> {
    side_coordinate
        .filter(|value| value.is_finite())
        .map(|value| value.clamp(0.0, 1.0) as f32)
}

fn refined_primitive_source(score: f32) -> crate::evidence_extract::PrimitiveSource {
    if score >= 0.62 {
        crate::evidence_extract::PrimitiveSource::ObservedStrong
    } else {
        crate::evidence_extract::PrimitiveSource::ObservedWeak
    }
}

fn refined_boundary_side(side: &str) -> Option<crate::evidence_extract::BoundarySide> {
    match side {
        "top" => Some(crate::evidence_extract::BoundarySide::Top),
        "right" => Some(crate::evidence_extract::BoundarySide::Right),
        "bottom" => Some(crate::evidence_extract::BoundarySide::Bottom),
        "left" => Some(crate::evidence_extract::BoundarySide::Left),
        _ => None,
    }
}

fn nearest_boundary_side(point: [f32; 2], image_max: f64) -> crate::evidence_extract::BoundarySide {
    let x = point[0] as f64;
    let y = point[1] as f64;
    [
        (crate::evidence_extract::BoundarySide::Top, y.abs()),
        (
            crate::evidence_extract::BoundarySide::Right,
            (image_max - x).abs(),
        ),
        (
            crate::evidence_extract::BoundarySide::Bottom,
            (image_max - y).abs(),
        ),
        (crate::evidence_extract::BoundarySide::Left, x.abs()),
    ]
    .into_iter()
    .min_by(|left, right| left.1.total_cmp(&right.1))
    .map(|(side, _)| side)
    .unwrap_or(crate::evidence_extract::BoundarySide::Top)
}

fn boundary_side_coordinate(
    point: [f32; 2],
    side: crate::evidence_extract::BoundarySide,
    image_max: f64,
) -> f32 {
    let denom = image_max.max(1.0);
    match side {
        crate::evidence_extract::BoundarySide::Top
        | crate::evidence_extract::BoundarySide::Bottom => point[0] as f64 / denom,
        crate::evidence_extract::BoundarySide::Right
        | crate::evidence_extract::BoundarySide::Left => point[1] as f64 / denom,
    }
    .clamp(0.0, 1.0) as f32
}

struct CompilerBackendContext {
    backend: DecoderBackend,
    architecture: &'static str,
    mode: &'static str,
    legacy_dependency: bool,
    evidence_report: Option<serde_json::Value>,
}

fn compiler_from_program_with_context(
    program: oristudio_cp_compiler::CandidateProgram,
    config: DecodeConfig,
    context: CompilerBackendContext,
) -> Result<DecodedFold, DecodeError> {
    let compiler_started = StageTimer::start();
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
    let evidence_extraction_seconds = context
        .evidence_report
        .as_ref()
        .and_then(|report| report.get("extraction_seconds"))
        .cloned();
    let compiler_seconds = compiler_started.elapsed_seconds();
    let stage_ids = compiler_stage_ids(context.evidence_report.is_some());
    let compiler_report = serde_json::json!({
        "backend": oristudio_cp_compiler::COMPILER_BACKEND_ID,
        "compiler_architecture": context.architecture,
        "mode": context.mode,
        "legacy_dependency": context.legacy_dependency,
        "stage_ids": stage_ids,
        "evidence": context.evidence_report,
        "timings": {
            "evidence_extraction_seconds": evidence_extraction_seconds,
            "compiler_seconds": compiler_seconds
        },
        "output": {
            "selected": "compiled",
            "reason": "compiler_backend_always_emits_compiled_candidate",
            "verified_clean": candidate_clean
        },
        "summary": summary,
        "candidate_pool": compiler_candidate_pool_summary(&program),
        "locked_border": locked_border.report,
        "edits": {
            "locked_border": compiler_edit_accounting(&program, &final_program)
        },
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
                serde_json::json!(context.backend.id()),
            );
            detector_object.insert("compiler_report".to_owned(), compiler_report.clone());
        } else {
            object.insert(
                "cp_detector".to_owned(),
                serde_json::json!({
                    "decoder_backend": context.backend.id(),
                    "compiler_report": compiler_report.clone()
                }),
            );
        }
    }
    let status = compiler_status(&compiler_report, topology_changed, assignment_changed);
    let warnings = compiler_warnings(&compiler_report);
    let repair_actions = compiler_repair_actions(&compiler_report);
    let quality_report = serde_json::json!({
        "decoder_backend": context.backend.id(),
        "compiler_report": compiler_report
    });
    Ok(DecodedFold {
        fold_json: serde_json::to_string_pretty(&fold)?,
        report: DecodeReport {
            status,
            decoder_backend: context.backend,
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

fn compiler_stage_ids(has_native_evidence: bool) -> Vec<&'static str> {
    let mut stages = Vec::new();
    if has_native_evidence {
        stages.push("evidence_extract");
    }
    stages.extend([
        "candidate_program_adapter",
        "lock_square_border",
        "verify_initial",
        "verify_final",
        "fold_export",
    ]);
    stages
}

fn product_export_verification_options() -> oristudio_cp_compiler::verify::GlobalVerificationOptions
{
    oristudio_cp_compiler::verify::GlobalVerificationOptions {
        run_oristudio_checks: false,
        run_flat_folder: false,
        ..oristudio_cp_compiler::verify::GlobalVerificationOptions::default()
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
struct ExactExportSummary {
    vertices: usize,
    edges: usize,
    border_edges: usize,
    interior_edges: usize,
}

fn exact_export_summary(input: &oristudio_cp_compiler::ExactSolveInput) -> ExactExportSummary {
    let mut used_vertices = input
        .selected_spans
        .iter()
        .flat_map(|span| span.vertices)
        .collect::<Vec<_>>();
    used_vertices.sort_unstable();
    used_vertices.dedup();
    let border_edges = input
        .selected_spans
        .iter()
        .filter(|span| {
            span.boundary_role()
                == oristudio_cp_compiler::candidate_graph::CandidateCreaseBoundaryRole::PaperBoundary
        })
        .count();
    let edges = input.selected_spans.len();
    ExactExportSummary {
        vertices: used_vertices.len(),
        edges,
        border_edges,
        interior_edges: edges.saturating_sub(border_edges),
    }
}

fn exact_moved_vertex_count(exact: &oristudio_cp_compiler::ExactSolvedGraph) -> usize {
    exact
        .movement_report
        .get("moved_vertices")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len)
}

#[derive(Clone)]
struct TopologyStageOutput {
    stage: CompilerAblationStage,
    program: oristudio_cp_compiler::CandidateProgram,
    result: oristudio_cp_compiler::optimizer::TopologyOptimizationResult,
}

#[derive(Clone)]
struct TopologyAblationVariant {
    id: &'static str,
    options: oristudio_cp_compiler::optimizer::TopologyOptimizerOptions,
}

fn topology_stage(
    id: &'static str,
    program: &oristudio_cp_compiler::CandidateProgram,
    config: &DecodeConfig,
    context_report: serde_json::Value,
    options: oristudio_cp_compiler::optimizer::TopologyOptimizerOptions,
) -> Result<TopologyStageOutput, DecodeError> {
    let result = oristudio_cp_compiler::optimizer::optimize_topology(program, options);
    let stage = ablation_program_stage(
        id,
        &result.program,
        config,
        serde_json::json!({
            "context": context_report,
            "topology": {
                "cost": result.cost,
                "accepted_moves": result.accepted_moves.clone(),
                "rejected_move_count": result.rejected_moves.len(),
                "exhausted_budget": result.exhausted_budget,
                "ambiguous": result.ambiguous
            },
            "edits": compiler_edit_accounting(program, &result.program)
        }),
    )?;
    Ok(TopologyStageOutput {
        stage,
        program: result.program.clone(),
        result,
    })
}

fn topology_ablation_variants() -> Vec<TopologyAblationVariant> {
    vec![
        TopologyAblationVariant {
            id: "topology_locked_border_select_weak_only",
            options: topology_options_for_repair_mask(true, false, false, false, false, false),
        },
        TopologyAblationVariant {
            id: "topology_locked_border_add_missing_only",
            options: topology_options_for_repair_mask(false, true, false, false, false, false),
        },
        TopologyAblationVariant {
            id: "topology_locked_border_drop_weak_only",
            options: topology_options_for_repair_mask(false, false, true, false, false, false),
        },
        TopologyAblationVariant {
            id: "topology_locked_border_merge_only",
            options: topology_options_for_repair_mask(false, false, false, true, false, false),
        },
        TopologyAblationVariant {
            id: "topology_locked_border_split_only",
            options: topology_options_for_repair_mask(false, false, false, false, true, false),
        },
        TopologyAblationVariant {
            id: "topology_locked_border_with_exactize",
            options: oristudio_cp_compiler::optimizer::TopologyOptimizerOptions {
                exactize_each_state: true,
                ..oristudio_cp_compiler::optimizer::TopologyOptimizerOptions::default()
            },
        },
    ]
}

fn topology_options_for_repair_mask(
    select_weak: bool,
    add_missing: bool,
    drop_weak: bool,
    merge: bool,
    split: bool,
    assignments: bool,
) -> oristudio_cp_compiler::optimizer::TopologyOptimizerOptions {
    oristudio_cp_compiler::optimizer::TopologyOptimizerOptions {
        repair_options: oristudio_cp_compiler::repair::RepairCandidateOptions {
            allow_select_weak_creases: select_weak,
            allow_add_missing_creases: add_missing,
            allow_drop_weak_creases: drop_weak,
            allow_merge_vertices: merge,
            allow_split_intersections: split,
            allow_assignment_changes: assignments,
            ..oristudio_cp_compiler::repair::RepairCandidateOptions::default()
        },
        ..oristudio_cp_compiler::optimizer::TopologyOptimizerOptions::default()
    }
}

fn compiler_edit_accounting(
    before: &oristudio_cp_compiler::CandidateProgram,
    after: &oristudio_cp_compiler::CandidateProgram,
) -> serde_json::Value {
    let before_selected = selected_edge_ids(before);
    let after_selected = selected_edge_ids(after);
    let added_selected = after_selected
        .difference(&before_selected)
        .copied()
        .collect::<Vec<_>>();
    let removed_selected = before_selected
        .difference(&after_selected)
        .copied()
        .collect::<Vec<_>>();
    let changed_assignments = before
        .edges
        .iter()
        .filter_map(|edge| {
            let other = after
                .edges
                .iter()
                .find(|candidate| candidate.id == edge.id)?;
            (edge.assignment.label != other.assignment.label).then_some(edge.id)
        })
        .collect::<Vec<_>>();
    let mut moved_vertices = 0usize;
    let mut moved_boundary_vertices = 0usize;
    let mut total_move = 0.0;
    let mut max_move = 0.0;
    for vertex in &before.vertices {
        let Some(other) = after
            .vertices
            .iter()
            .find(|candidate| candidate.id == vertex.id)
        else {
            continue;
        };
        let distance = point_distance(vertex.position, other.position);
        if distance > 1e-9 {
            moved_vertices += 1;
            total_move += distance;
            max_move = f64::max(max_move, distance);
            if vertex.kind != oristudio_cp_compiler::VertexKind::Interior
                || other.kind != oristudio_cp_compiler::VertexKind::Interior
            {
                moved_boundary_vertices += 1;
            }
        }
    }
    serde_json::json!({
        "vertices_before": before.vertices.len(),
        "vertices_after": after.vertices.len(),
        "edges_before": before.edges.len(),
        "edges_after": after.edges.len(),
        "selected_edges_before": before_selected.len(),
        "selected_edges_after": after_selected.len(),
        "selected_edges_added": added_selected.len(),
        "selected_edges_removed": removed_selected.len(),
        "selected_edge_ids_added": added_selected,
        "selected_edge_ids_removed": removed_selected,
        "selected_border_edges_before": selected_border_edge_count(before),
        "selected_border_edges_after": selected_border_edge_count(after),
        "selected_interior_edges_before": selected_interior_edge_count(before),
        "selected_interior_edges_after": selected_interior_edge_count(after),
        "assignments_changed": changed_assignments.len(),
        "assignment_edge_ids_changed": changed_assignments,
        "vertices_moved": moved_vertices,
        "boundary_vertices_moved": moved_boundary_vertices,
        "max_vertex_move": max_move,
        "mean_vertex_move": if moved_vertices == 0 { 0.0 } else { total_move / moved_vertices as f64 },
    })
}

fn selected_edge_ids(program: &oristudio_cp_compiler::CandidateProgram) -> BTreeSet<usize> {
    program
        .edges
        .iter()
        .filter(|edge| edge.selection == oristudio_cp_compiler::EdgeSelection::Selected)
        .map(|edge| edge.id)
        .collect()
}

fn selected_border_edge_count(program: &oristudio_cp_compiler::CandidateProgram) -> usize {
    program
        .edges
        .iter()
        .filter(|edge| {
            edge.selection == oristudio_cp_compiler::EdgeSelection::Selected
                && edge.assignment.label == oristudio_cp_compiler::AssignmentLabel::Boundary
        })
        .count()
}

fn selected_interior_edge_count(program: &oristudio_cp_compiler::CandidateProgram) -> usize {
    program
        .edges
        .iter()
        .filter(|edge| {
            edge.selection == oristudio_cp_compiler::EdgeSelection::Selected
                && edge.assignment.label != oristudio_cp_compiler::AssignmentLabel::Boundary
                && edge.assignment.label != oristudio_cp_compiler::AssignmentLabel::Flat
        })
        .count()
}

fn point_distance(
    left: oristudio_cp_compiler::Point2,
    right: oristudio_cp_compiler::Point2,
) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
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
        .pointer("/exact_solve/status")
        .and_then(serde_json::Value::as_str)
        .map(|status| status == "ambiguous" || status == "failed")
        .unwrap_or(false)
        || compiler_report
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
    fn refined_vertex_boundary_contacts_require_explicit_kind() {
        let top = crate::evidence_extract::BoundarySide::Top;
        let right = crate::evidence_extract::BoundarySide::Right;

        assert_eq!(
            refined_boundary_contact_side("interior_junction", Some(top), [42.0, 1.5], 99.0),
            None
        );
        assert_eq!(
            refined_boundary_contact_side("interior_junction", Some(top), [42.0, 8.0], 99.0),
            None
        );
        assert_eq!(
            refined_boundary_contact_side("boundary_contact", None, [99.0, 42.0], 99.0),
            Some(right)
        );
    }

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

        let outputs = DenseOutputs::from_legacy_heads(
            &line_logits,
            &junction_logits,
            &assignment_logits,
            &non_crease_logits,
            &line_style_logits,
            &boundary_contact_logits,
        );
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

    #[test]
    fn compiler_v2_backend_uses_native_evidence_path() {
        let (outputs, config) = square_cross_fixture();
        let compiler = decode_dense_outputs_with_backend(
            outputs,
            config,
            DecoderBackend::ConstraintCompilerV2,
        )
        .expect("compiler v2 decode");
        let compiler_fold: Value =
            serde_json::from_str(&compiler.fold_json).expect("compiler fold");

        assert_eq!(
            compiler.report.decoder_backend,
            DecoderBackend::ConstraintCompilerV2
        );
        assert_eq!(
            compiler.report.quality_report["compiler_report"]["compiler_architecture"],
            "v2"
        );
        assert_eq!(
            compiler.report.quality_report["compiler_report"]["legacy_dependency"],
            false
        );
        assert_eq!(
            compiler.report.quality_report["compiler_report"]["evidence"]["legacy_dependency"],
            false
        );
        assert!(
            compiler.report.quality_report["compiler_report"]["evidence"]["line_primitives"]
                .as_u64()
                .expect("line primitives")
                > 0
        );
        assert!(
            compiler.report.quality_report["compiler_report"]["timings"]
                ["evidence_extraction_seconds"]
                .as_f64()
                .expect("evidence extraction seconds")
                >= 0.0
        );
        assert!(
            compiler.report.quality_report["compiler_report"]["timings"]["compiler_seconds"]
                .as_f64()
                .expect("compiler seconds")
                >= 0.0
        );
        assert!(
            compiler.report.quality_report["compiler_report"]["stage_ids"]
                .as_array()
                .expect("stage ids")
                .iter()
                .any(|stage| stage == "evidence_extract")
        );
        assert_eq!(
            compiler_fold["cp_detector"]["decoder_backend"],
            "constraint_compiler_v2"
        );
        assert_compiler_output_contract(&compiler, &compiler_fold);
    }

    #[test]
    fn legacy_candidate_exact_solve_backend_exports_exact_solved_fold() {
        let (outputs, config) = square_cross_fixture();
        let compiler = decode_dense_outputs_with_backend(
            outputs,
            config,
            DecoderBackend::LegacyCandidateExactSolveV1,
        )
        .expect("legacy candidate exact solve decode");
        let compiler_fold: Value =
            serde_json::from_str(&compiler.fold_json).expect("compiler fold");

        assert_eq!(
            compiler.report.decoder_backend,
            DecoderBackend::LegacyCandidateExactSolveV1
        );
        assert_eq!(
            compiler.report.quality_report["compiler_report"]["mode"],
            "candidate_generation_beam_selection_exact_solve"
        );
        assert_eq!(
            compiler.report.quality_report["compiler_report"]["legacy_dependency"],
            false
        );
        assert_eq!(
            compiler.report.quality_report["candidate_strategy"],
            "junction-first-v1"
        );
        assert_eq!(
            compiler_fold["cp_detector"]["decoder_backend"],
            "legacy_candidate_exact_solve_v1"
        );
        assert_eq!(
            compiler_fold["cp_detector"]["candidate_strategy"],
            "junction-first-v1"
        );
        assert_eq!(compiler_fold["cp_detector"]["source"], "exact_solve");
        assert_eq!(
            compiler_fold["cp_detector"]["compiler_report"]["output"]["selected"],
            "exact_solved"
        );
        assert!(
            compiler_fold["cp_detector"]["compiler_report"]["exact_solve"]["status"].is_string()
        );
        assert_eq!(
            compiler_fold["cp_detector"]["edge_span_ids"]
                .as_array()
                .expect("span ids")
                .len(),
            compiler_fold["edges_vertices"]
                .as_array()
                .expect("edges")
                .len()
        );
    }

    #[test]
    fn legacy_candidate_exact_solve_emits_the_pre_solve_exact_solve_input() {
        let (outputs, config) = square_cross_fixture();
        let timeout_seconds = config.exact_solve_timeout_seconds;
        let compiler = decode_dense_outputs_with_backend(
            outputs,
            config,
            DecoderBackend::LegacyCandidateExactSolveV1,
        )
        .expect("legacy candidate exact solve decode");
        let compiler_fold: Value =
            serde_json::from_str(&compiler.fold_json).expect("compiler fold");

        // Emitted **once**, in the decode report, and it must deserialize back
        // into the type `solve_exact` consumes — that is the whole point of
        // emitting it. The FOLD document used to carry a second copy inside its
        // `fold_json` string; see
        // `the_pre_solve_exact_solve_input_crosses_the_bridge_once` for why it
        // no longer does.
        let from_report = &compiler.report.quality_report["compiler_report"]["exact_solve_input"];
        let recovered: oristudio_cp_compiler::ExactSolveInput =
            serde_json::from_value(from_report.clone()).expect("exact solve input round-trip");

        assert_eq!(
            recovered.schema,
            "oristudio/cp-compiler/exact-solve-input-v1"
        );
        assert!(!recovered.vertices.is_empty());
        assert!(!recovered.selected_spans.is_empty());
        assert_eq!(
            recovered.selected_spans.len(),
            compiler_fold["edges_vertices"]
                .as_array()
                .expect("edges")
                .len()
        );
        // Vertex ids index the vertex table; `solve_exact` and the FOLD export
        // both address vertices by `span.vertices`, so a client editing the
        // graph has to preserve this.
        for (index, vertex) in recovered.vertices.iter().enumerate() {
            assert_eq!(vertex.id, index);
        }
        // Pre-solve, not post-solve: the emitted coordinates are the candidate
        // ones, and `exact_solve.vertices_exact` is what the solver moved them
        // to. On this fixture the solve does move at least one vertex, so the
        // two are distinguishable.
        let solved_points =
            compiler.report.quality_report["compiler_report"]["exact_solve"]["vertices_exact"]
                .as_array()
                .expect("solved vertices")
                .clone();
        assert_eq!(solved_points.len(), recovered.vertices.len());

        // Re-solving the recovered input reproduces the solve the decode ran,
        // which is the seam the browser repair flow stands on.
        let resolved = oristudio_cp_compiler::solve_exact(
            &recovered,
            oristudio_cp_compiler::ExactSolveOptions {
                timeout_seconds,
                ..oristudio_cp_compiler::ExactSolveOptions::default()
            },
        );
        assert_eq!(
            serde_json::to_value(resolved.status).expect("status"),
            compiler.report.quality_report["compiler_report"]["exact_solve"]["status"]
        );
        assert_eq!(
            serde_json::to_value(&resolved.vertices_exact).expect("resolved points"),
            Value::Array(solved_points)
        );
    }

    /// The test that forecloses divergence between the staged and fused paths,
    /// and the reason `recognize_from_generation` exists as a shared step
    /// rather than as a convention.
    ///
    /// `recognize_only` lets the browser put the recognized creases on screen,
    /// let the user repair them, and solve afterwards. That is only sound while
    /// the candidate the staged path hands to `solve_exact` is the candidate
    /// the fused path solved. So: the seam byte for byte, the solve byte for
    /// byte, and the exported geometry byte for byte. If this ever fails, the
    /// staged flow is solving something the 307/563 baseline never measured,
    /// and it should fail loudly rather than drift quietly.
    ///
    /// Byte comparisons go through `to_string` of a `serde_json::Value` on both
    /// sides so the two are in the same canonical form: `Value`'s map is a
    /// `BTreeMap` here (no `preserve_order` feature), while a struct serializes
    /// in declaration order, so comparing a struct's JSON against a stored
    /// `Value`'s would compare key orders rather than content.
    #[test]
    fn recognize_then_solve_is_byte_identical_to_the_fused_decode() {
        let (outputs, config) = solvable_cross_fixture();
        let timeout_seconds = config.exact_solve_timeout_seconds;
        let fused = decode_dense_outputs_with_backend(
            outputs,
            config.clone(),
            DecoderBackend::LegacyCandidateExactSolveV1,
        )
        .expect("fused decode");
        let recognized = decode_dense_outputs_with_backend(
            outputs,
            DecodeConfig {
                recognize_only: true,
                ..config
            },
            DecoderBackend::LegacyCandidateExactSolveV1,
        )
        .expect("recognize-only decode");

        // 1. The seam is the same value. Everything below rests on this one.
        let fused_seam = &fused.report.quality_report["compiler_report"]["exact_solve_input"];
        let staged_seam = &recognized.report.quality_report["compiler_report"]["exact_solve_input"];
        assert!(fused_seam.is_object(), "fused decode emitted no seam");
        assert_eq!(json_bytes(staged_seam), json_bytes(fused_seam));

        // 2. Solving that seam reproduces the fused solve exactly. Same input,
        //    same options, and `solve_exact` is a pure function of the two.
        //    Verified on a fixture where the solve has real work to do — see
        //    `solvable_cross_fixture` for why the 64 px one will not do.
        let staged_input: oristudio_cp_compiler::ExactSolveInput =
            serde_json::from_value(staged_seam.clone()).expect("staged seam round-trip");
        let staged_solve = oristudio_cp_compiler::solve_exact(
            &staged_input,
            oristudio_cp_compiler::ExactSolveOptions {
                timeout_seconds,
                ..oristudio_cp_compiler::ExactSolveOptions::default()
            },
        );
        let fused_solve = &fused.report.quality_report["compiler_report"]["exact_solve"];
        assert!(
            fused_solve["movement_report"]["trace"]["vertex_parameters"]["free"]
                .as_u64()
                .expect("free vertex parameters")
                > 0,
            "fixture pins every vertex, so this asserts nothing about the solve"
        );
        assert_eq!(
            json_bytes(&without_solve_wall_clock(
                &serde_json::to_value(&staged_solve).expect("staged solve value")
            )),
            json_bytes(&without_solve_wall_clock(fused_solve))
        );

        // 3. And the document the user ends up with is the same document. The
        //    two `fold_json`s are not comparable whole — the fused one embeds a
        //    compiler report carrying wall-clock timings — so this compares the
        //    geometry, which is what the staged path must not change.
        let staged_fold = serde_json::to_value(
            oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document(
                &staged_input,
                &staged_solve,
            )
            .expect("staged fold export"),
        )
        .expect("staged fold value");
        let fused_fold: Value = serde_json::from_str(&fused.fold_json).expect("fused fold");
        for key in ["vertices_coords", "edges_vertices", "edges_assignment"] {
            assert!(fused_fold[key].is_array(), "fused fold has no {key}");
            assert_eq!(
                json_bytes(&staged_fold[key]),
                json_bytes(&fused_fold[key]),
                "{key} diverged between the staged and fused paths"
            );
        }

        // 4. The recognize-only result is not a solve that failed. It carries
        //    the candidate at pre-solve coordinates, self-identified, with no
        //    `exact_solve` block to be misread as a verdict.
        let recognized_fold: Value =
            serde_json::from_str(&recognized.fold_json).expect("recognized fold");
        assert_eq!(recognized_fold["frame_title"], "candidate crease pattern");
        assert_eq!(
            recognized_fold["cp_detector"]["source"],
            "exact_solve_candidate"
        );
        assert!(
            recognized.report.quality_report["compiler_report"]
                .get("exact_solve")
                .is_none(),
            "recognize-only emitted an exact_solve block"
        );
    }

    #[test]
    fn recognize_only_reports_topology_diagnostics_and_an_unattempted_solve() {
        let (outputs, config) = solvable_cross_fixture();
        let timeout_seconds = config.exact_solve_timeout_seconds;
        let recognized = decode_dense_outputs_with_backend(
            outputs,
            DecodeConfig {
                recognize_only: true,
                ..config
            },
            DecoderBackend::LegacyCandidateExactSolveV1,
        )
        .expect("recognize-only decode");
        let compiler_report = &recognized.report.quality_report["compiler_report"];

        assert_eq!(recognized.report.status, "recognized");
        assert_eq!(
            compiler_report["mode"],
            "candidate_generation_beam_selection_recognize_only"
        );
        assert_eq!(
            compiler_report["output"]["selected"],
            "recognized_candidate"
        );

        // The worklist, as the type the compiler owns rather than as loose
        // JSON: a client deserializes it back into `TopologyDiagnostics`.
        let diagnostics: oristudio_cp_compiler::TopologyDiagnostics =
            serde_json::from_value(compiler_report["topology_diagnostics"].clone())
                .expect("topology diagnostics round-trip");
        assert_eq!(
            diagnostics.schema,
            "oristudio/cp-compiler/topology-diagnostics-v1"
        );
        assert!(
            diagnostics.blockers.is_empty(),
            "candidate was too malformed to analyze: {:?}",
            diagnostics.blockers
        );

        // Not attempted, and said so positively rather than by omission. This
        // is the distinction `exact_solve_timeout_seconds: 0.0` would have
        // destroyed: that path runs the solver and reports a *failure*.
        assert_eq!(compiler_report["solve"]["attempted"], false);
        assert_eq!(compiler_report["solve"]["reason"], "recognize_only");
        assert_eq!(
            compiler_report["solve"]["budget"]["total_seconds"]
                .as_f64()
                .expect("solve budget"),
            timeout_seconds,
            "the staged flow must be handed the same total budget the fused solve had"
        );
        assert!(compiler_report.get("exact_solve").is_none());
        assert!(compiler_report.get("final_verification").is_none());
        assert!(recognized.report.warnings.is_empty());
        assert!(recognized.report.repair_actions.is_empty());
    }

    /// Regression guard for the duplicated seam.
    ///
    /// `exact_solve_input` used to be emitted twice per detection — in
    /// `report.quality_report` and again inside the `fold_json` string — up to
    /// ~0.5 MB duplicated across the wasm bridge. The report copy is the one
    /// that stays.
    #[test]
    fn the_pre_solve_exact_solve_input_crosses_the_bridge_once() {
        let (outputs, config) = square_cross_fixture();
        for recognize_only in [false, true] {
            let decoded = decode_dense_outputs_with_backend(
                outputs,
                DecodeConfig {
                    recognize_only,
                    ..config.clone()
                },
                DecoderBackend::LegacyCandidateExactSolveV1,
            )
            .expect("decode");
            let fold: Value = serde_json::from_str(&decoded.fold_json).expect("fold");
            let in_fold = &fold["cp_detector"]["compiler_report"];

            assert!(
                decoded.report.quality_report["compiler_report"]["exact_solve_input"].is_object(),
                "recognize_only={recognize_only}: the report lost the seam"
            );
            assert!(
                in_fold.get("exact_solve_input").is_none(),
                "recognize_only={recognize_only}: the FOLD document carries a second copy"
            );
            // The FOLD is otherwise the same report, and it says where the seam
            // went so a reader does not conclude there wasn't one.
            assert_eq!(
                in_fold["exact_solve_input_location"],
                "report.quality_report.compiler_report.exact_solve_input"
            );
            assert_eq!(
                in_fold["mode"],
                decoded.report.quality_report["compiler_report"]["mode"]
            );
        }
    }

    fn json_bytes(value: &Value) -> String {
        serde_json::to_string(value).expect("json bytes")
    }

    /// `movement_report.elapsed_seconds` measures the wall clock of the run
    /// that produced it, so it is the single field two runs of the same solve
    /// cannot agree on. Blanked on both sides before comparison — and the
    /// pointer is asserted to exist, so a rename cannot silently turn this into
    /// a comparison that skips a field which genuinely diverged.
    /// The solve report with every wall-clock reading nulled: `elapsed_seconds`
    /// at the top of the movement report, and the `seconds` each polish round —
    /// the symmetry round included — records for itself. Those are the only
    /// fields two runs of a pure function are allowed to disagree on, and the
    /// symmetry round's used to slip through: microseconds that matched by luck.
    fn without_solve_wall_clock(solve: &Value) -> Value {
        fn scrub(value: &mut Value) {
            match value {
                Value::Object(map) => {
                    for (key, child) in map.iter_mut() {
                        if key == "seconds" || key == "elapsed_seconds" {
                            *child = Value::Null;
                        } else {
                            scrub(child);
                        }
                    }
                }
                Value::Array(items) => items.iter_mut().for_each(scrub),
                _ => {}
            }
        }
        let mut normalized = solve.clone();
        let report = normalized
            .pointer_mut("/movement_report")
            .expect("solve report should carry a movement_report");
        assert!(
            report.get("elapsed_seconds").is_some(),
            "solve report should carry movement_report.elapsed_seconds"
        );
        scrub(report);
        normalized
    }

    #[test]
    fn legacy_candidate_exact_solve_reports_real_stage_timings() {
        let (outputs, config) = square_cross_fixture();
        let compiler = decode_dense_outputs_with_backend(
            outputs,
            config,
            DecoderBackend::LegacyCandidateExactSolveV1,
        )
        .expect("legacy candidate exact solve decode");
        let timings = &compiler.report.quality_report["compiler_report"]["timings"];
        let compiler_seconds = timings["compiler_seconds"]
            .as_f64()
            .expect("compiler seconds");
        let exact_seconds = timings["exact_solve_seconds"]
            .as_f64()
            .expect("exact solve seconds");

        // The wasm arm of `StageTimer` used to return a hard 0.0, so these two
        // were identically zero in every browser run. Both clocks now measure;
        // the exact-solve stage is nested inside the compiler stage.
        assert!(compiler_seconds.is_finite() && compiler_seconds > 0.0);
        assert!(exact_seconds.is_finite() && exact_seconds >= 0.0);
        assert!(exact_seconds <= compiler_seconds);
    }

    #[test]
    fn legacy_candidate_exact_solve_accepts_refined_vertex_junction_source() {
        let (outputs, config) = square_cross_fixture();
        let refined_vertices = vec![
            RefinedVertexPrimitive {
                x: 32.0,
                y: 32.0,
                score: Some(0.93),
                kind: Some("interior_junction".to_owned()),
                boundary_side: None,
                side_coordinate: None,
            },
            RefinedVertexPrimitive {
                x: 32.0,
                y: 0.0,
                score: Some(0.91),
                kind: Some("boundary_contact".to_owned()),
                boundary_side: Some("top".to_owned()),
                side_coordinate: Some(32.0 / 63.0),
            },
            RefinedVertexPrimitive {
                x: 63.0,
                y: 32.0,
                score: Some(0.91),
                kind: Some("boundary_contact".to_owned()),
                boundary_side: Some("right".to_owned()),
                side_coordinate: Some(32.0 / 63.0),
            },
            RefinedVertexPrimitive {
                x: 32.0,
                y: 63.0,
                score: Some(0.91),
                kind: Some("boundary_contact".to_owned()),
                boundary_side: Some("bottom".to_owned()),
                side_coordinate: Some(32.0 / 63.0),
            },
            RefinedVertexPrimitive {
                x: 0.0,
                y: 32.0,
                score: Some(0.91),
                kind: Some("boundary_contact".to_owned()),
                boundary_side: Some("left".to_owned()),
                side_coordinate: Some(32.0 / 63.0),
            },
        ];
        let compiler = decode_dense_outputs_with_backend_and_refined_vertices(
            outputs,
            config,
            DecoderBackend::LegacyCandidateExactSolveV1,
            Some(&refined_vertices),
        )
        .expect("refined vertex candidate exact solve decode");
        let compiler_fold: Value =
            serde_json::from_str(&compiler.fold_json).expect("compiler fold");

        assert_eq!(
            compiler.report.quality_report["junction_source"],
            "vertex-refiner-v3"
        );
        assert_eq!(
            compiler.report.quality_report["refined_vertices"]["accepted_junction_primitives"],
            1
        );
        assert_eq!(
            compiler.report.quality_report["refined_vertices"]["accepted_boundary_contact_primitives"],
            4
        );
        assert_eq!(
            compiler_fold["cp_detector"]["compiler_report"]["junction_source"],
            "vertex-refiner-v3"
        );
    }

    #[test]
    fn refined_vertex_regions_preserve_dense_evidence_outside_region() {
        let (outputs, config) = square_cross_fixture();
        let refined_vertices = vec![RefinedVertexPrimitive {
            x: 32.0,
            y: 32.0,
            score: Some(0.93),
            kind: Some("interior_junction".to_owned()),
            boundary_side: None,
            side_coordinate: None,
        }];
        let refined_regions = vec![RefinedVertexRegion {
            x_min: 24.0,
            y_min: 24.0,
            x_max: 40.0,
            y_max: 40.0,
        }];

        let compiler =
            decode_dense_outputs_with_backend_junction_source_and_refined_vertices_in_regions(
                outputs,
                config,
                DecoderBackend::LegacyCandidateExactSolveV1,
                crate::evidence_extract::JunctionEvidenceSource::Model,
                Some(&refined_vertices),
                Some(&refined_regions),
            )
            .expect("selective refined vertex decode");
        let report = &compiler.report.quality_report["refined_vertices"];

        assert_eq!(report["refinement_regions"], 1);
        assert!(
            report["preserved_boundary_contact_primitives"]
                .as_u64()
                .expect("preserved boundary contacts")
                > 0
        );
        assert_eq!(report["input_vertices"], 1);
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
            DenseOutputs::from_legacy_heads(
                line_logits,
                junction_logits,
                assignment_logits,
                non_crease_logits,
                line_style_logits,
                boundary_contact_logits,
            ),
            DecodeConfig {
                image_size: size as u32,
                threshold: 0.65,
                carrier_extent_padding_px: size as f32,
                ..DecodeConfig::default()
            },
        )
    }

    /// The same drawing as [`square_cross_fixture`], rasterized at 256 px.
    ///
    /// Scale is the whole point. The decoder's default merge radii and vertex
    /// distances are tuned for the 1024 px product input, and at 64 px they
    /// swallow the centre junction entirely: `square_cross_fixture` decodes to
    /// four corner vertices and five spans, every vertex pinned, so the solve
    /// runs with **zero** free parameters. A parity test on that fixture would
    /// pass even if the two paths handed `solve_exact` different options,
    /// because there would be nothing for the options to change.
    ///
    /// At 256 px the same cross survives: 9 vertices, 12 spans, one free
    /// interior vertex and four boundary parameters, so the solver actually
    /// runs. Still ~10 ms.
    fn solvable_cross_fixture() -> (DenseOutputs<'static>, DecodeConfig) {
        let size = 256usize;
        let last = size - 1;
        let mid = size / 2;
        let pixels = size * size;
        let line_logits = Box::leak(vec![-8.0; pixels].into_boxed_slice());
        let junction_logits = Box::leak(vec![-8.0; pixels].into_boxed_slice());
        let assignment_logits = Box::leak(vec![-4.0; pixels * 4].into_boxed_slice());
        let non_crease_logits = Box::leak(vec![-8.0; pixels].into_boxed_slice());
        let line_style_logits = Box::leak(vec![-4.0; pixels * 4].into_boxed_slice());
        let boundary_contact_logits = Box::leak(vec![-8.0; pixels].into_boxed_slice());

        draw_line(line_logits, size, (mid, 0), (mid, last), 8.0);
        draw_line(line_logits, size, (0, mid), (last, mid), 8.0);
        draw_line(line_logits, size, (0, 0), (last, 0), 8.0);
        draw_line(line_logits, size, (last, 0), (last, last), 8.0);
        draw_line(line_logits, size, (0, last), (last, last), 8.0);
        draw_line(line_logits, size, (0, 0), (0, last), 8.0);
        junction_logits[mid * size + mid] = 8.0;
        boundary_contact_logits[mid] = 8.0;
        boundary_contact_logits[last * size + mid] = 8.0;
        boundary_contact_logits[mid * size] = 8.0;
        boundary_contact_logits[mid * size + last] = 8.0;
        for y in 0..size {
            assignment_logits[y * size + mid] = 8.0;
        }
        for x in 0..size {
            assignment_logits[pixels + mid * size + x] = 8.0;
            assignment_logits[2 * pixels + x] = 8.0;
            assignment_logits[2 * pixels + last * size + x] = 8.0;
        }
        for y in 0..size {
            assignment_logits[2 * pixels + y * size] = 8.0;
            assignment_logits[2 * pixels + y * size + last] = 8.0;
        }

        (
            DenseOutputs::from_legacy_heads(
                line_logits,
                junction_logits,
                assignment_logits,
                non_crease_logits,
                line_style_logits,
                boundary_contact_logits,
            ),
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
