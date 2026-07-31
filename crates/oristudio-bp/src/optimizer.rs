use crate::error::{BpError, BpResult};
use crate::model::{DesignMode, Flap, GridType, Point, Project, Sheet};
use crate::shared::MAX_SHEET_SIZE;
use crate::tree::Hierarchy;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const UINT_MAX: u64 = 4_294_967_295;
const PACKING_TOLERANCE: f64 = 1e-7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutMode {
    View,
    Random,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OptimizerCommand {
    Buffer,
    Start,
    Skip,
    Stop,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizerOptionsBase {
    pub layout: LayoutMode,
    #[serde(rename = "useBH")]
    pub use_bh: bool,
    pub random: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizerOptions {
    #[serde(flatten)]
    pub base: OptimizerOptionsBase,
    #[serde(rename = "useDimension")]
    pub use_dimension: bool,
    #[serde(rename = "openNew")]
    pub open_new: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlapRequest {
    pub id: u32,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlapResult {
    pub id: u32,
    pub x: f64,
    pub y: f64,
}

/// A mirror axis, named by where it sits in the optimizer's **normalized** unit
/// sheet rather than by what it means on paper.
///
/// These are the four symmetry axes of the square, and they are constants: the
/// optimizer always works in a unit sheet, so none of them depends on the
/// sheet-size variable. What they *mean* on paper depends on the sheet type,
/// because a diagonal-grid sheet is the paper rotated 45° against the grid — see
/// [`SymmetryAxis::for_preset`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SymmetryAxis {
    /// `x = 1/2`
    VerticalHalf,
    /// `y = 1/2`
    HorizontalHalf,
    /// `y = x`
    MainDiagonal,
    /// `y = 1 - x`
    AntiDiagonal,
}

/// How the user names a symmetry: relative to the paper, not the grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymmetryPreset {
    /// Fold the paper in half edge to edge.
    Book,
    /// Fold the paper corner to corner.
    Diagonal,
}

impl SymmetryAxis {
    /// The two normalized axes a paper-relative preset maps to on a given sheet.
    ///
    /// On a rectangular sheet the paper axes are the grid axes, so book folds are
    /// axis-aligned. On a diagonal sheet the paper is rotated 45°, so the roles
    /// swap: a book fold of the paper runs diagonally in grid coordinates.
    pub fn for_preset(preset: SymmetryPreset, grid_type: GridType) -> [Self; 2] {
        let axis_aligned = [Self::VerticalHalf, Self::HorizontalHalf];
        let diagonal = [Self::MainDiagonal, Self::AntiDiagonal];
        match (preset, grid_type) {
            (SymmetryPreset::Book, GridType::Rectangular) => axis_aligned,
            (SymmetryPreset::Book, GridType::Diagonal) => diagonal,
            (SymmetryPreset::Diagonal, GridType::Rectangular) => diagonal,
            (SymmetryPreset::Diagonal, GridType::Diagonal) => axis_aligned,
        }
    }

    /// Whether the mirrored flap's width and height are exchanged.
    pub fn swaps_dimensions(self) -> bool {
        matches!(self, Self::MainDiagonal | Self::AntiDiagonal)
    }
}

/// A mirror-symmetry requirement for the optimizer.
///
/// `partners` must be a **total involution** over the request's flaps: every flap
/// id appears exactly once as a key, and `partners[partners[i]] == i`. A flap
/// mapped to itself sits on the axis. Totality is deliberate — inferring that an
/// unmentioned flap belongs on the axis would silently produce a layout the user
/// did not ask for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizerSymmetry {
    pub axis: SymmetryAxis,
    /// `(flap id, mirror partner id)` for every flap.
    pub partners: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizerProblem {
    #[serde(rename = "type")]
    pub grid_type: GridType,
    pub flaps: Vec<FlapRequest>,
    pub hierarchies: Vec<Hierarchy>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizerRequest {
    pub command: OptimizerCommand,
    #[serde(rename = "useBH")]
    pub use_bh: bool,
    pub layout: LayoutMode,
    pub random: usize,
    pub problem: OptimizerProblem,
    pub vec: Option<Vec<Point>>,
    /// Mirror symmetry to enforce. `None` runs the upstream Box Pleating Studio
    /// algorithm unchanged, which is what the oracle parity test relies on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symmetry: Option<OptimizerSymmetry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizerResult {
    pub width: f64,
    pub height: f64,
    pub flaps: Vec<FlapResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OptimizerSolveReport {
    pub result: OptimizerResult,
    pub events: Vec<OptimizerEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", content = "data", rename_all = "lowercase")]
pub enum OptimizerEvent {
    Loading(usize),
    Start,
    Pack(usize),
    Candidate((usize, usize)),
    Flap(usize),
    Cont((usize, usize, usize)),
    Fit((usize, usize)),
}

/// Build the optimizer request for a project.
///
/// `jitter_seed` only matters in view mode, and only when two flaps share a
/// coordinate — see [`make_initial_vector`]. Callers with distinct flaps get the
/// same request for any seed.
pub fn create_optimizer_request(
    project: &Project,
    hierarchies: Vec<Hierarchy>,
    options: OptimizerOptionsBase,
    use_dimension: bool,
    jitter_seed: u32,
) -> BpResult<OptimizerRequest> {
    let Some(last_hierarchy) = hierarchies.last() else {
        return Err(BpError::InvalidInput(
            "optimizer request requires at least one hierarchy".to_string(),
        ));
    };
    let mut flap_map = project
        .design
        .layout
        .flaps
        .iter()
        .cloned()
        .map(|flap| (flap.id, flap))
        .collect::<BTreeMap<_, _>>();
    let mut ordered = Vec::new();
    for id in &last_hierarchy.leaves {
        let Some(mut flap) = flap_map.remove(id) else {
            return Err(BpError::InvalidInput(format!(
                "optimizer hierarchy references missing flap {id}"
            )));
        };
        if !use_dimension {
            flap.width = 0.0;
            flap.height = 0.0;
        }
        ordered.push(flap);
    }
    // Upstream mutates the flap objects in place while jittering, so the
    // coordinates the vector is built from are the jittered ones.
    let vec = match options.layout {
        LayoutMode::View => Some(make_initial_vector(
            &mut ordered,
            &project.design.layout.sheet,
            jitter_seed,
        )?),
        LayoutMode::Random => None,
    };
    Ok(OptimizerRequest {
        command: OptimizerCommand::Start,
        use_bh: options.use_bh,
        layout: options.layout,
        random: options.random,
        problem: OptimizerProblem {
            grid_type: project.design.layout.sheet.grid_type,
            flaps: ordered
                .iter()
                .map(|flap| FlapRequest {
                    id: flap.id,
                    width: flap.width,
                    height: flap.height,
                })
                .collect(),
            hierarchies,
        },
        vec,
        symmetry: None,
    })
}

pub fn solve(request: &OptimizerRequest, seed: Option<u64>) -> BpResult<OptimizerResult> {
    solve_with_progress(request, seed, || false, |_| {})
}

pub fn solve_report(
    request: &OptimizerRequest,
    seed: Option<u64>,
) -> BpResult<OptimizerSolveReport> {
    let mut events = Vec::new();
    let result = solve_with_progress(request, seed, || false, |event| events.push(event))?;
    Ok(OptimizerSolveReport { result, events })
}

pub fn solve_with_progress(
    request: &OptimizerRequest,
    seed: Option<u64>,
    mut should_cancel: impl FnMut() -> bool,
    mut on_event: impl FnMut(OptimizerEvent),
) -> BpResult<OptimizerResult> {
    if let Some(seed) = seed
        && seed > UINT_MAX
    {
        return Err(BpError::InvalidInput(format!(
            "optimizer seed exceeds unsigned int max: {seed}"
        )));
    }
    on_event(OptimizerEvent::Start);
    check_cancelled(&mut should_cancel)?;
    let problem = kernel::KernelProblem::from_request(request)?;
    let Some(main) = problem.hierarchies.last() else {
        return Err(BpError::InvalidInput(
            "optimizer problem requires at least one hierarchy".to_string(),
        ));
    };
    let seed = seed.unwrap_or(0) as u32;
    let symmetry = request
        .symmetry
        .as_ref()
        .map(|symmetry| kernel::KernelSymmetry::from_request(symmetry, main))
        .transpose()?;
    let packed = if request.layout == LayoutMode::Random {
        kernel::solve_global_symmetric_with_progress(
            &problem,
            request.random,
            seed,
            &mut should_cancel,
            &mut on_event,
            symmetry.as_ref(),
        )?
    } else {
        let mut x0 = kernel::read_initial_vector(request, main)?;
        if let Some(symmetry) = &symmetry {
            kernel::symmetrize(&mut x0, main, symmetry);
        }
        if request.use_bh {
            kernel::basin_hopping_symmetric_with_progress(
                x0,
                main,
                seed,
                &mut should_cancel,
                &mut on_event,
                symmetry.as_ref(),
            )?
        } else {
            on_event(OptimizerEvent::Pack(0));
            check_cancelled(&mut should_cancel)?;
            kernel::pack_rssl_symmetric(x0, main, None, None, symmetry.as_ref())?
        }
    };
    if !packed.success {
        return Err(BpError::OptimizationFailed(format!(
            "optimizer pack failed with status {:?}",
            packed.status
        )));
    }
    let vector = match &symmetry {
        Some(symmetry) => kernel::greedy_solve_integer_symmetric(
            &packed.x,
            main,
            symmetry,
            &mut should_cancel,
            &mut on_event,
        )?,
        None => kernel::greedy_solve_integer_rssl_with_progress(
            &packed.x,
            main,
            &mut should_cancel,
            &mut on_event,
        )?,
    };
    optimizer_result_from_vector(request, &vector)
}

fn check_cancelled(should_cancel: &mut impl FnMut() -> bool) -> BpResult<()> {
    if should_cancel() {
        Err(BpError::OptimizationCancelled)
    } else {
        Ok(())
    }
}

pub fn check_optimizer_result(result: &OptimizerResult) -> BpResult<()> {
    if !result.width.is_finite()
        || !result.height.is_finite()
        || result
            .flaps
            .iter()
            .any(|flap| !flap.x.is_finite() || !flap.y.is_finite())
    {
        return Err(BpError::OptimizationFailed(
            "Optimizer returns a non-finite result.".to_string(),
        ));
    }
    if !is_integer(result.width)
        || !is_integer(result.height)
        || result
            .flaps
            .iter()
            .any(|flap| !is_integer(flap.x) || !is_integer(flap.y))
    {
        return Err(BpError::OptimizationFailed(
            "Optimizer returns a non-integer result.".to_string(),
        ));
    }
    if result.width > MAX_SHEET_SIZE as f64 || result.height > MAX_SHEET_SIZE as f64 {
        return Err(BpError::OptimizationFailed(
            "Solution exceeds maximal sheet size.".to_string(),
        ));
    }
    Ok(())
}

pub fn validate_optimizer_packing(
    request: &OptimizerRequest,
    result: &OptimizerResult,
) -> BpResult<()> {
    check_optimizer_result(result)?;
    if result.width <= 0.0 || result.height <= 0.0 {
        return Err(BpError::OptimizationFailed(
            "Optimizer returns a non-positive sheet dimension.".to_string(),
        ));
    }
    if request.problem.grid_type == GridType::Diagonal
        && (result.width - result.height).abs() > PACKING_TOLERANCE
    {
        return Err(BpError::OptimizationFailed(
            "Optimizer returns a non-square diagonal packing sheet.".to_string(),
        ));
    }
    if result.flaps.len() != request.problem.flaps.len() {
        return Err(BpError::OptimizationFailed(format!(
            "Optimizer returns {} flaps for {} requested flaps.",
            result.flaps.len(),
            request.problem.flaps.len()
        )));
    }

    let request_flaps = request_flap_map(request)?;
    let result_flaps = result_flap_map(result)?;
    for id in request_flaps.keys() {
        if !result_flaps.contains_key(id) {
            return Err(BpError::OptimizationFailed(format!(
                "Optimizer result is missing flap {id}."
            )));
        }
    }

    validate_anchor_bounds(request, result, &request_flaps, &result_flaps)?;
    validate_distance_constraints(request, &request_flaps, &result_flaps)
}

pub fn write_to_template(
    project: &Project,
    request: &OptimizerRequest,
    result: &OptimizerResult,
) -> BpResult<Project> {
    validate_optimizer_packing(request, result)?;
    let request_flaps = request
        .problem
        .flaps
        .iter()
        .map(|flap| (flap.id, flap))
        .collect::<BTreeMap<_, _>>();
    let mut next = project.clone();
    next.design.layout.sheet.width = result.width;
    next.design.layout.sheet.height = result.height;
    next.design.layout.flaps = result
        .flaps
        .iter()
        .map(|result_flap| {
            let Some(request_flap) = request_flaps.get(&result_flap.id) else {
                return Err(BpError::InvalidInput(format!(
                    "optimizer result references missing flap {}",
                    result_flap.id
                )));
            };
            Ok(Flap {
                id: result_flap.id,
                x: result_flap.x,
                y: result_flap.y,
                width: request_flap.width,
                height: request_flap.height,
            })
        })
        .collect::<BpResult<Vec<_>>>()?;
    next.design.layout.stretches.clear();
    next.design.mode = DesignMode::Layout;
    Ok(next)
}

/// Upstream's `OFFSET`, which centres the jitter on the flap's own position.
const JITTER_OFFSET: f64 = 0.5;

/// Port of upstream's `makeInitialVector`
/// (`src/client/plugins/optimizer/index.ts`).
///
/// Coincident flaps make a degenerate starting point — SLSQP has no direction to
/// push them apart, and `infer_scale` bails to `MAX_INIT_SCALE` on a zero
/// separation — so upstream nudges every *duplicate* into a random spot within
/// half a grid unit of where it sat. This matters far more than it sounds: every
/// leaf added to a design gets its flap at the same default position, so without
/// the jitter view mode fails on essentially any freshly authored tree.
///
/// Faithful to upstream in the parts that are observable: only duplicates move,
/// the first occupant of a coordinate keeps its exact position, each retry
/// re-jitters from the *original* position rather than compounding, and the
/// offset is uniform over `[-0.5, 0.5)` per axis.
///
/// The one deliberate difference is where the entropy comes from. Upstream calls
/// `Math.random()` directly; here the caller passes a seed, and the wasm bridge
/// feeds it `Math.random()` so the browser behaves exactly as upstream does. That
/// keeps this crate a pure function of its inputs, which is what lets the oracle
/// harness and capture-replay reproduce a run from its seed.
fn make_initial_vector(
    flaps: &mut [Flap],
    sheet: &Sheet,
    jitter_seed: u32,
) -> BpResult<Vec<Point>> {
    if sheet.width == 0.0 || sheet.height == 0.0 {
        return Err(BpError::InvalidInput(
            "optimizer view vector requires non-zero sheet dimensions".to_string(),
        ));
    }
    let mut rng = kernel::BpRandom::new(jitter_seed);
    let mut seen = BTreeSet::new();
    let mut vector = Vec::with_capacity(flaps.len());
    for flap in flaps.iter_mut() {
        let (x, y) = (flap.x, flap.y);
        let mut key = format!("{},{}", flap.x, flap.y);
        while !seen.insert(key) {
            flap.x = x + rng.random01() - JITTER_OFFSET;
            flap.y = y + rng.random01() - JITTER_OFFSET;
            key = format!("{},{}", flap.x, flap.y);
        }
        vector.push(Point {
            x: flap.x / sheet.width,
            y: flap.y / sheet.height,
        });
    }
    Ok(vector)
}

fn is_integer(value: f64) -> bool {
    value.fract() == 0.0
}

fn request_flap_map(request: &OptimizerRequest) -> BpResult<BTreeMap<u32, &FlapRequest>> {
    let mut flaps = BTreeMap::new();
    for flap in &request.problem.flaps {
        if !flap.width.is_finite()
            || !flap.height.is_finite()
            || flap.width < 0.0
            || flap.height < 0.0
        {
            return Err(BpError::InvalidInput(format!(
                "optimizer request has invalid dimensions for flap {}",
                flap.id
            )));
        }
        if flaps.insert(flap.id, flap).is_some() {
            return Err(BpError::InvalidInput(format!(
                "optimizer request has duplicate flap {}",
                flap.id
            )));
        }
    }
    Ok(flaps)
}

fn result_flap_map(result: &OptimizerResult) -> BpResult<BTreeMap<u32, &FlapResult>> {
    let mut flaps = BTreeMap::new();
    for flap in &result.flaps {
        if flaps.insert(flap.id, flap).is_some() {
            return Err(BpError::OptimizationFailed(format!(
                "Optimizer result has duplicate flap {}.",
                flap.id
            )));
        }
    }
    Ok(flaps)
}

fn validate_anchor_bounds(
    request: &OptimizerRequest,
    result: &OptimizerResult,
    request_flaps: &BTreeMap<u32, &FlapRequest>,
    result_flaps: &BTreeMap<u32, &FlapResult>,
) -> BpResult<()> {
    match request.problem.grid_type {
        GridType::Rectangular => {
            for flap in result_flaps.values() {
                if flap.x < -PACKING_TOLERANCE
                    || flap.y < -PACKING_TOLERANCE
                    || flap.x > result.width + PACKING_TOLERANCE
                    || flap.y > result.height + PACKING_TOLERANCE
                {
                    return Err(BpError::OptimizationFailed(format!(
                        "Optimizer result places flap {} outside the rectangular sheet.",
                        flap.id
                    )));
                }
            }
        }
        GridType::Diagonal => {
            let radius = result.width / 2.0;
            for flap in result_flaps.values() {
                let Some(request_flap) = request_flaps.get(&flap.id) else {
                    continue;
                };
                let x = flap.x / result.width;
                let y = flap.y / result.height;
                let m = 1.0 / result.width;
                let vector = vec![x, y, m];
                let offset = request_flap.width.min(request_flap.height) as i32;
                let evaluated = kernel::diag_bound_constraints(&vector, 0, offset);
                if evaluated
                    .values
                    .iter()
                    .any(|value| *value > PACKING_TOLERANCE)
                    || (flap.x - radius).abs() + (flap.y - radius).abs()
                        > radius + request_flap.width.min(request_flap.height) + PACKING_TOLERANCE
                {
                    return Err(BpError::OptimizationFailed(format!(
                        "Optimizer result places flap {} outside the diagonal sheet.",
                        flap.id
                    )));
                }
            }
        }
    }
    Ok(())
}

fn validate_distance_constraints(
    request: &OptimizerRequest,
    request_flaps: &BTreeMap<u32, &FlapRequest>,
    result_flaps: &BTreeMap<u32, &FlapResult>,
) -> BpResult<()> {
    let Some(hierarchy) = request.problem.hierarchies.last() else {
        return Err(BpError::InvalidInput(
            "optimizer validation requires at least one hierarchy".to_string(),
        ));
    };
    for &(a, b, dist) in &hierarchy.dist_map {
        let Some(request_a) = request_flaps.get(&a) else {
            return Err(BpError::InvalidInput(format!(
                "optimizer hierarchy references missing flap {a}"
            )));
        };
        let Some(request_b) = request_flaps.get(&b) else {
            return Err(BpError::InvalidInput(format!(
                "optimizer hierarchy references missing flap {b}"
            )));
        };
        let Some(result_a) = result_flaps.get(&a) else {
            return Err(BpError::OptimizationFailed(format!(
                "Optimizer result is missing flap {a}."
            )));
        };
        let Some(result_b) = result_flaps.get(&b) else {
            return Err(BpError::OptimizationFailed(format!(
                "Optimizer result is missing flap {b}."
            )));
        };
        let dx =
            kernel::interval_distance(result_a.x, request_a.width, result_b.x, request_b.width);
        let dy =
            kernel::interval_distance(result_a.y, request_a.height, result_b.y, request_b.height);
        let violation = dist * dist - dx * dx - dy * dy;
        if violation > PACKING_TOLERANCE {
            return Err(BpError::OptimizationFailed(format!(
                "Optimizer result violates distance {} between flaps {} and {}.",
                dist, a, b
            )));
        }
    }
    Ok(())
}

fn optimizer_result_from_vector(
    request: &OptimizerRequest,
    vector: &[i32],
) -> BpResult<OptimizerResult> {
    let expected = request.problem.flaps.len() * 2 + 1;
    if vector.len() != expected {
        return Err(BpError::OptimizationFailed(format!(
            "optimizer returned {} values for {} flaps",
            vector.len(),
            request.problem.flaps.len()
        )));
    }
    let grid = f64::from(vector[vector.len() - 1]);
    Ok(OptimizerResult {
        width: grid,
        height: grid,
        flaps: request
            .problem
            .flaps
            .iter()
            .enumerate()
            .map(|(index, flap)| FlapResult {
                id: flap.id,
                x: f64::from(vector[index * 2]),
                y: f64::from(vector[index * 2 + 1]),
            })
            .collect(),
    })
}

pub mod kernel {
    use super::{OptimizerEvent, OptimizerRequest, OptimizerSymmetry, SymmetryAxis};
    use crate::error::{BpError, BpResult};
    use crate::model::GridType;
    use std::collections::BTreeMap;
    use std::f64::consts::PI;

    pub const MIN_SHEET_SIZE: i32 = 4;
    pub const MAX_SHEET_SIZE: i32 = 8192;
    pub const MAX_INIT_SCALE: i32 = 1024;

    const GRID_ERROR: f64 = 1e-4;
    const PACK_MAX_EVAL: usize = 200;
    const PACK_XTOL_ABS: f64 = 1e-6;
    const PACK_FTOL_ABS: f64 = 1e-5;
    const BP_RAND_MAX: f64 = 2_147_483_647.0;
    const BP_RAND_MULTIPLIER: u64 = 6_364_136_223_846_793_005;
    const BH_NITER: usize = 50;
    const BH_NITER_SUCCESS: usize = 16;
    const BH_T: f64 = 0.01;
    const BH_STEPSIZE: f64 = 0.01;
    const BH_ACCEPT_RATE: f64 = 0.5;
    const BH_INTERVAL: usize = 5;
    const BH_FACTOR: f64 = 0.9;
    const DIAG_FX: [f64; 4] = [-1.0, 1.0, -1.0, 1.0];
    const DIAG_FY: [f64; 4] = [-1.0, 1.0, 1.0, -1.0];
    const DIAG_V: [f64; 4] = [0.5, -1.5, -0.5, -0.5];

    #[derive(Debug, Clone, PartialEq)]
    pub struct ScalarConstraintEvaluation {
        pub value: f64,
        pub gradient: Vec<f64>,
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct VectorConstraintEvaluation {
        pub values: Vec<f64>,
        pub gradients: Vec<Vec<f64>>,
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct PackResult {
        pub x: Vec<f64>,
        pub success: bool,
        pub status: PackStatus,
        pub fun: f64,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum PackStatus {
        Success,
        StopValReached,
        FtolReached,
        XtolReached,
        MaxEvalReached,
        MaxTimeReached,
        Failure,
        InvalidArgs,
        OutOfMemory,
        RoundoffLimited,
        ForcedStop,
        UnexpectedError,
        IterationLimitExceeded,
        MoreEqualityConstraints,
        IterationLimitExceededLsq,
        IncompatibleConstraints,
        SingularMatrixE,
        SingularMatrixC,
        RankDeficientHfti,
        PositiveDirectionalDerivative,
        Unknown(i32),
    }

    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct KernelPoint {
        pub x: f64,
        pub y: f64,
    }

    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct KernelCircle {
        pub x: f64,
        pub y: f64,
        pub radius: f64,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct BpRandom {
        seed: u64,
    }

    impl BpRandom {
        pub fn new(seed: u32) -> Self {
            Self {
                seed: u64::from(seed.wrapping_sub(1)),
            }
        }

        pub fn next_int(&mut self) -> u32 {
            self.seed = self.seed.wrapping_mul(BP_RAND_MULTIPLIER).wrapping_add(1);
            (self.seed >> 33) as u32
        }

        pub fn random01(&mut self) -> f64 {
            f64::from(self.next_int()) / BP_RAND_MAX
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum OptimizerSheet {
        Rect,
        Diag,
    }

    impl OptimizerSheet {
        pub fn from_grid_type(grid_type: GridType) -> Self {
            match grid_type {
                GridType::Rectangular => Self::Rect,
                GridType::Diagonal => Self::Diag,
            }
        }

        pub fn offset(self) -> f64 {
            match self {
                Self::Rect => 0.0,
                Self::Diag => 0.5,
            }
        }

        pub fn check_bounds(self, xk: &[f64], n: usize) -> bool {
            match self {
                Self::Rect => xk[n * 2] >= 0.0 && xk[n * 2 + 1] >= 0.0,
                Self::Diag => true,
            }
        }

        pub fn enlarge_if_necessary(self, xk: &mut [f64], x: f64, y: f64) {
            let last = xk.len() - 1;
            match self {
                Self::Rect => {
                    if x > xk[last] {
                        xk[last] = x;
                    }
                    if y > xk[last] {
                        xk[last] = y;
                    }
                }
                Self::Diag => {
                    let radius = 2.0 * (x.abs() + y.abs());
                    if radius > xk[last] {
                        xk[last] = radius;
                    }
                }
            }
        }

        pub fn output(self, solution: &[f64]) -> Vec<i32> {
            let last = solution.len() - 1;
            match self {
                Self::Rect => {
                    let mut result = Vec::with_capacity(solution.len());
                    let mut max = 0;
                    for value in solution.iter().take(last) {
                        let rounded = value.round() as i32;
                        result.push(rounded);
                        if rounded > max {
                            max = rounded;
                        }
                    }
                    result.push(max);
                    result
                }
                Self::Diag => {
                    let mut result = solution
                        .iter()
                        .take(last)
                        .map(|value| value.round() as i32)
                        .collect::<Vec<_>>();
                    let mut grid = 0;
                    for pair in result.chunks_exact(2) {
                        let radius = pair[0].abs() + pair[1].abs();
                        if radius > grid {
                            grid = radius;
                        }
                    }
                    for value in &mut result {
                        *value += grid;
                    }
                    result.push(2 * grid);
                    result
                }
            }
        }
    }

    // ---------------------------------------------------------------- symmetry

    impl SymmetryAxis {
        /// Which grid axes must be measured from the sheet centre so the mirror
        /// map does not depend on the (still floating) sheet size.
        ///
        /// In absolute grid coordinates a book mirror is `x -> s - x - w`, which
        /// moves as the greedy grows `s`, silently breaking every already-pinned
        /// pair. Measured from the centre it becomes `x -> -x - w`, which does
        /// not. `y = x` needs no centring at all: on a rectangular sheet that
        /// axis passes through the origin corner.
        pub fn centered(self) -> (bool, bool) {
            match self {
                Self::VerticalHalf => (true, false),
                Self::HorizontalHalf => (false, true),
                Self::MainDiagonal => (false, false),
                Self::AntiDiagonal => (true, true),
            }
        }

        /// Mirror of a flap anchor in normalized (unit sheet) coordinates.
        ///
        /// A flap's anchor is its lower-left corner and its box is `w*m` by
        /// `h*m`, so mirroring the flap is not the same as mirroring the anchor —
        /// the reflected box's lower-left corner picks up the size term.
        pub fn mirror_norm(self, x: f64, y: f64, width: f64, height: f64, m: f64) -> (f64, f64) {
            match self {
                Self::VerticalHalf => (1.0 - x - width * m, y),
                Self::HorizontalHalf => (x, 1.0 - y - height * m),
                Self::MainDiagonal => (y, x),
                Self::AntiDiagonal => (1.0 - y - height * m, 1.0 - x - width * m),
            }
        }

        /// Mirror of a flap anchor in grid coordinates, using this axis's
        /// offsets. Independent of the sheet size by construction.
        pub fn mirror_grid(self, x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
            match self {
                Self::VerticalHalf => (-x - width, y),
                Self::HorizontalHalf => (x, -y - height),
                Self::MainDiagonal => (y, x),
                Self::AntiDiagonal => (-y - height, -x - width),
            }
        }

        /// The grid origin offsets in normalized coordinates: 0.5 means "measure
        /// this axis from the sheet centre".
        pub fn offsets(self) -> (f64, f64) {
            let (cx, cy) = self.centered();
            (if cx { 0.5 } else { 0.0 }, if cy { 0.5 } else { 0.0 })
        }

        /// The point on the axis at parameter `t`, for a flap of this size.
        pub fn axis_point(self, t: f64, width: f64, height: f64) -> (f64, f64) {
            match self {
                Self::VerticalHalf => (-width / 2.0, t),
                Self::HorizontalHalf => (t, -height / 2.0),
                Self::MainDiagonal => (t, t),
                Self::AntiDiagonal => (-t - height, t),
            }
        }

        /// The free parameter of an on-axis placement, given a grid position.
        pub fn axis_parameter(self, x: f64, y: f64) -> f64 {
            match self {
                Self::VerticalHalf | Self::AntiDiagonal => y,
                Self::HorizontalHalf => x,
                Self::MainDiagonal => (x + y) / 2.0,
            }
        }
    }

    /// Symmetry resolved against a hierarchy: an involution on flap *indices*.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct KernelSymmetry {
        pub axis: SymmetryAxis,
        /// `partner[i] == i` means flap `i` sits on the axis.
        pub partner: Vec<usize>,
    }

    impl KernelSymmetry {
        pub fn on_axis(&self, i: usize) -> bool {
            self.partner[i] == i
        }

        /// One index per orbit: on-axis flaps, plus the lower index of each pair.
        pub fn representatives(&self) -> Vec<usize> {
            (0..self.partner.len())
                .filter(|&i| self.partner[i] >= i)
                .collect()
        }

        /// Resolve a request's symmetry against a hierarchy, validating that it is
        /// a total involution whose flap dimensions can actually be mirrored.
        pub fn from_request(
            symmetry: &OptimizerSymmetry,
            hierarchy: &KernelHierarchy,
        ) -> BpResult<Self> {
            let index_of = hierarchy
                .flaps
                .iter()
                .enumerate()
                .map(|(index, flap)| (flap.id, index))
                .collect::<BTreeMap<_, _>>();

            let mut partner = vec![usize::MAX; hierarchy.flaps.len()];
            for &(id, mate) in &symmetry.partners {
                let Some(&i) = index_of.get(&id) else {
                    return Err(BpError::InvalidInput(format!(
                        "optimizer symmetry references unknown flap {id}"
                    )));
                };
                let Some(&j) = index_of.get(&mate) else {
                    return Err(BpError::InvalidInput(format!(
                        "optimizer symmetry pairs flap {id} with unknown flap {mate}"
                    )));
                };
                if partner[i] != usize::MAX && partner[i] != j {
                    return Err(BpError::InvalidInput(format!(
                        "optimizer symmetry gives flap {id} more than one partner"
                    )));
                }
                partner[i] = j;
            }

            let unpaired = hierarchy
                .flaps
                .iter()
                .zip(&partner)
                .filter(|(_, mate)| **mate == usize::MAX)
                .map(|(flap, _)| flap.id.to_string())
                .collect::<Vec<_>>();
            if !unpaired.is_empty() {
                return Err(BpError::InvalidInput(format!(
                    "optimizer symmetry does not say what mirrors flap(s) {}; \
                     pair them or place them on the axis",
                    unpaired.join(", ")
                )));
            }
            for (i, &j) in partner.iter().enumerate() {
                if partner[j] != i {
                    return Err(BpError::InvalidInput(format!(
                        "optimizer symmetry is not a mirror: flap {} pairs with {} \
                         but {} does not pair back",
                        hierarchy.flaps[i].id, hierarchy.flaps[j].id, hierarchy.flaps[j].id
                    )));
                }
            }

            let resolved = Self {
                axis: symmetry.axis,
                partner,
            };
            resolved.validate_dimensions(hierarchy)?;
            Ok(resolved)
        }

        /// A mirrored flap must be the mirror image of its partner as a *box*, not
        /// just as a point, and an on-axis flap must be its own mirror image.
        fn validate_dimensions(&self, hierarchy: &KernelHierarchy) -> BpResult<()> {
            for (i, &j) in self.partner.iter().enumerate() {
                let a = hierarchy.flaps[i];
                let b = hierarchy.flaps[j];
                if i == j {
                    let ok = match self.axis {
                        SymmetryAxis::VerticalHalf => a.width % 2 == 0,
                        SymmetryAxis::HorizontalHalf => a.height % 2 == 0,
                        SymmetryAxis::MainDiagonal | SymmetryAxis::AntiDiagonal => {
                            a.width == a.height
                        }
                    };
                    if !ok {
                        return Err(BpError::InvalidInput(format!(
                            "flap {} sits on the symmetry axis, so it must be its own \
                             mirror image; a {}x{} flap cannot be",
                            a.id, a.width, a.height
                        )));
                    }
                    continue;
                }
                let (want_width, want_height) = if self.axis.swaps_dimensions() {
                    (a.height, a.width)
                } else {
                    (a.width, a.height)
                };
                if b.width != want_width || b.height != want_height {
                    return Err(BpError::InvalidInput(format!(
                        "flaps {} ({}x{}) and {} ({}x{}) are paired across the symmetry \
                         axis but are not mirror images of each other",
                        a.id, a.width, a.height, b.id, b.width, b.height
                    )));
                }
            }
            Ok(())
        }
    }

    /// Which `(flap, component)` pairs contribute a symmetry equality, where
    /// component 0 is x and 1 is y.
    ///
    /// A pair contributes two equations; a flap on the axis contributes one, on
    /// whichever component the axis actually constrains. Orbits whose members are
    /// all pinned contribute none — their pins already imply the symmetry.
    pub fn symmetry_residuals(
        hierarchy: &KernelHierarchy,
        symmetry: &KernelSymmetry,
        fixed: Option<&[bool]>,
    ) -> Vec<(usize, usize)> {
        let is_fixed = |k: usize| fixed.map(|f| f[k]).unwrap_or(false);
        let mut out = Vec::new();
        for i in 0..hierarchy.flaps.len() {
            let j = symmetry.partner[i];
            if j < i || (is_fixed(i) && is_fixed(j)) {
                continue;
            }
            if i == j {
                out.push(match symmetry.axis {
                    SymmetryAxis::HorizontalHalf => (i, 1),
                    _ => (i, 0),
                });
            } else {
                out.push((i, 0));
                out.push((i, 1));
            }
        }
        out
    }

    /// How far off the axis a mirror pair is pushed when folding would land both
    /// members on it, as a fraction of the sheet.
    const SYMMETRIZE_MIN_SPLIT: f64 = 0.05;

    /// The unit normal of an axis in normalized coordinates.
    fn axis_normal(axis: SymmetryAxis) -> (f64, f64) {
        let diagonal = std::f64::consts::FRAC_1_SQRT_2;
        match axis {
            SymmetryAxis::VerticalHalf => (1.0, 0.0),
            SymmetryAxis::HorizontalHalf => (0.0, 1.0),
            SymmetryAxis::MainDiagonal => (diagonal, -diagonal),
            SymmetryAxis::AntiDiagonal => (diagonal, diagonal),
        }
    }

    /// Fold a starting vector onto the symmetry manifold, so SLSQP starts feasible.
    ///
    /// Each partner is overwritten with the mirror of its representative; an
    /// on-axis flap is moved to the midpoint of itself and its own mirror, which
    /// is the nearest point of the axis.
    ///
    /// A mirror *pair* whose representative already sits on the axis is a special
    /// case: folding would put both members at the same point, and a separation
    /// constraint evaluated at zero separation has a zero gradient, so SLSQP
    /// reports incompatible constraints rather than pushing them apart. Such a
    /// pair is nudged off the axis first.
    pub fn symmetrize(x: &mut [f64], hierarchy: &KernelHierarchy, symmetry: &KernelSymmetry) {
        let m = x[x.len() - 1];
        for i in 0..hierarchy.flaps.len() {
            let j = symmetry.partner[i];
            if j < i {
                continue;
            }
            let width = f64::from(hierarchy.flaps[i].width);
            let height = f64::from(hierarchy.flaps[i].height);
            let (mut mx, mut my) =
                symmetry
                    .axis
                    .mirror_norm(x[i * 2], x[i * 2 + 1], width, height, m);
            if i == j {
                x[i * 2] = (x[i * 2] + mx) / 2.0;
                x[i * 2 + 1] = (x[i * 2 + 1] + my) / 2.0;
                continue;
            }
            if meg(x[i * 2] - mx, x[i * 2 + 1] - my) < SYMMETRIZE_MIN_SPLIT {
                let (nx, ny) = axis_normal(symmetry.axis);
                x[i * 2] += nx * SYMMETRIZE_MIN_SPLIT;
                x[i * 2 + 1] += ny * SYMMETRIZE_MIN_SPLIT;
                (mx, my) = symmetry
                    .axis
                    .mirror_norm(x[i * 2], x[i * 2 + 1], width, height, m);
            }
            x[j * 2] = mx;
            x[j * 2 + 1] = my;
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct KernelFlap {
        pub id: u32,
        pub width: i32,
        pub height: i32,
    }

    impl KernelFlap {
        pub fn has_dimension(self) -> bool {
            self.width != 0 && self.height != 0
        }
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct KernelHierarchy {
        pub sheet: OptimizerSheet,
        pub flaps: Vec<KernelFlap>,
        pub dist_map: Vec<(usize, usize, i32)>,
        pub parents: Vec<KernelParent>,
        pub parent_map: BTreeMap<u32, usize>,
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct KernelParent {
        pub id: u32,
        pub radius: f64,
        pub children: Vec<u32>,
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct KernelProblem {
        pub sheet: OptimizerSheet,
        pub hierarchies: Vec<KernelHierarchy>,
    }

    impl KernelProblem {
        pub fn from_request(request: &OptimizerRequest) -> BpResult<Self> {
            let sheet = OptimizerSheet::from_grid_type(request.problem.grid_type);
            let mut hierarchies = request
                .problem
                .hierarchies
                .iter()
                .map(|hierarchy| KernelHierarchy::from_request_hierarchy(hierarchy, sheet))
                .collect::<BpResult<Vec<_>>>()?;
            let Some(last) = hierarchies.last_mut() else {
                return Err(BpError::InvalidInput(
                    "optimizer problem requires at least one hierarchy".to_string(),
                ));
            };
            last.flaps = request
                .problem
                .flaps
                .iter()
                .map(|flap| KernelFlap {
                    id: flap.id,
                    width: flap.width as i32,
                    height: flap.height as i32,
                })
                .collect();
            Ok(Self { sheet, hierarchies })
        }
    }

    impl KernelHierarchy {
        fn from_request_hierarchy(
            hierarchy: &crate::tree::Hierarchy,
            sheet: OptimizerSheet,
        ) -> BpResult<Self> {
            let flaps = hierarchy
                .leaves
                .iter()
                .copied()
                .map(|id| KernelFlap {
                    id,
                    width: 0,
                    height: 0,
                })
                .collect::<Vec<_>>();
            let id_map = flaps
                .iter()
                .enumerate()
                .map(|(index, flap)| (flap.id, index))
                .collect::<BTreeMap<_, _>>();
            let dist_map = hierarchy
                .dist_map
                .iter()
                .map(|&(a, b, dist)| {
                    let Some(&i) = id_map.get(&a) else {
                        return Err(BpError::InvalidInput(format!(
                            "optimizer hierarchy distMap references missing flap {a}"
                        )));
                    };
                    let Some(&j) = id_map.get(&b) else {
                        return Err(BpError::InvalidInput(format!(
                            "optimizer hierarchy distMap references missing flap {b}"
                        )));
                    };
                    Ok((i, j, dist as i32))
                })
                .collect::<BpResult<Vec<_>>>()?;
            let parents = hierarchy
                .parents
                .iter()
                .map(|parent| KernelParent {
                    id: parent.id,
                    radius: parent.radius,
                    children: parent.children.clone(),
                })
                .collect::<Vec<_>>();
            let mut parent_map = BTreeMap::new();
            for (index, parent) in parents.iter().enumerate() {
                for &child in &parent.children {
                    parent_map.insert(child, index);
                }
            }
            Ok(Self {
                sheet,
                flaps,
                dist_map,
                parents,
                parent_map,
            })
        }

        pub fn parent_for(&self, id: u32) -> Option<&KernelParent> {
            self.parent_map
                .get(&id)
                .and_then(|&index| self.parents.get(index))
        }

        pub fn check(&self, xk: &[f64], n: usize, fixed: &[bool]) -> bool {
            if !self.sheet.check_bounds(xk, n) {
                return false;
            }
            for &(i, j, dist) in &self.dist_map {
                if ((i == n && fixed.get(j).copied().unwrap_or(false))
                    || (j == n && fixed.get(i).copied().unwrap_or(false)))
                    && rounded_exact(xk, i, j, dist, &self.flaps) > 0.0
                {
                    return false;
                }
            }
            true
        }
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct BranchingContext<'a> {
        pub hierarchy: &'a KernelHierarchy,
        pub fixed: Vec<bool>,
        pub solution: Vec<f64>,
    }

    impl<'a> BranchingContext<'a> {
        pub fn new(x0: &[f64], hierarchy: &'a KernelHierarchy) -> Self {
            let fixed = vec![false; hierarchy.flaps.len()];
            let solution = to_grid(x0, hierarchy.sheet, &fixed);
            Self {
                hierarchy,
                fixed,
                solution,
            }
        }

        pub fn get(&self, i: usize) -> KernelPoint {
            KernelPoint {
                x: convert_if_almost_integer(self.solution[i * 2]),
                y: convert_if_almost_integer(self.solution[i * 2 + 1]),
            }
        }

        pub fn branch(
            &self,
            vec: Option<&[f64]>,
            x: f64,
            y: f64,
            i: usize,
            q: usize,
        ) -> Option<Vec<f64>> {
            if (is_integer(x) && q % 2 == 1) || (is_integer(y) && q > 1) {
                return None;
            }
            self.make_xk(vec, branch_value(x, q & 1), branch_value(y, q >> 1), i)
        }

        pub fn make_xk(&self, vec: Option<&[f64]>, x: f64, y: f64, i: usize) -> Option<Vec<f64>> {
            let mut xk = vec.map_or_else(|| self.solution.clone(), <[f64]>::to_vec);
            xk[i * 2] = x;
            xk[i * 2 + 1] = y;
            if !self.hierarchy.check(&xk, i, &self.fixed) {
                return None;
            }
            self.hierarchy.sheet.enlarge_if_necessary(&mut xk, x, y);
            Some(xk)
        }

        pub fn output(&self) -> Vec<i32> {
            self.hierarchy.sheet.output(&self.solution)
        }
    }

    pub fn get_scale(x: &[f64]) -> f64 {
        1.0 / x[x.len() - 1]
    }

    pub fn int_scale(scale: f64) -> i32 {
        (scale - GRID_ERROR).ceil() as i32
    }

    pub fn setup_initial_scale(x0: &mut [f64], hierarchy: &KernelHierarchy) {
        let mut grid = MIN_SHEET_SIZE;
        for &(i, j, dist) in &hierarchy.dist_map {
            let scale = infer_scale(x0, i, j, dist, &hierarchy.flaps);
            if scale >= MAX_INIT_SCALE as f64 {
                grid = MAX_INIT_SCALE;
                break;
            }
            grid = grid.max(scale.ceil() as i32);
        }
        let last = x0.len() - 1;
        x0[last] = 1.0 / f64::from(grid);
    }

    pub fn read_initial_vector(
        request: &OptimizerRequest,
        hierarchy: &KernelHierarchy,
    ) -> BpResult<Vec<f64>> {
        let Some(points) = &request.vec else {
            return Err(BpError::InvalidInput(
                "view-mode optimizer request requires an initial vector".to_string(),
            ));
        };
        if points.len() < hierarchy.flaps.len() {
            return Err(BpError::InvalidInput(format!(
                "optimizer initial vector has {} points for {} flaps",
                points.len(),
                hierarchy.flaps.len()
            )));
        }
        let mut x = Vec::with_capacity(hierarchy.flaps.len() * 2 + 1);
        for point in points.iter().take(hierarchy.flaps.len()) {
            x.push(point.x);
            x.push(point.y);
        }
        x.push(0.0);
        setup_initial_scale(&mut x, hierarchy);
        Ok(x)
    }

    pub fn pack(mut x: Vec<f64>, hierarchy: &KernelHierarchy) -> BpResult<PackResult> {
        let dim = hierarchy.flaps.len() * 2 + 1;
        if x.len() != dim {
            return Err(BpError::InvalidInput(format!(
                "optimizer pack vector has {} values for {} flaps",
                x.len(),
                hierarchy.flaps.len()
            )));
        }

        let mut bounds = vec![(0.0, 1.0); dim];
        let last = dim - 1;
        bounds[last] = (
            1.0 / f64::from(MAX_SHEET_SIZE),
            1.0 / f64::from(MIN_SHEET_SIZE),
        );
        clip_to_bounds(&mut x, &bounds);

        let objective = |x: &[f64], gradient: Option<&mut [f64]>, _data: &mut ()| {
            if let Some(gradient) = gradient {
                reset_gradient_slice(gradient, -1.0);
            }
            -x[x.len() - 1]
        };

        let pack_constraints = make_pack_constraints(hierarchy);
        let constraint_fns = pack_constraints
            .iter()
            .map(|constraint| {
                Box::new(
                    move |x: &[f64], gradient: Option<&mut [f64]>, _data: &mut ()| {
                        constraint.evaluate(x, hierarchy, gradient)
                    },
                ) as Box<dyn slsqp::Func<()> + '_>
            })
            .collect::<Vec<_>>();
        let constraints = constraint_fns
            .iter()
            .map(|constraint| constraint.as_ref())
            .collect::<Vec<_>>();

        let stop_tol = slsqp::StopTols {
            ftol_abs: PACK_FTOL_ABS,
            xtol_abs: vec![PACK_XTOL_ABS; dim],
            ..Default::default()
        };
        let result = slsqp::minimize(
            objective,
            &x,
            &bounds,
            &constraints,
            (),
            PACK_MAX_EVAL,
            Some(stop_tol),
        );

        Ok(match result {
            Ok((status, x, fun)) => PackResult {
                x,
                success: true,
                status: PackStatus::from_success(status),
                fun,
            },
            Err((status, x, fun)) => PackResult {
                x,
                success: false,
                status: PackStatus::from_failure(status),
                fun,
            },
        })
    }

    pub fn pack_rssl(
        x: Vec<f64>,
        hierarchy: &KernelHierarchy,
        fixed: Option<&[bool]>,
        fixed_solution: Option<&[f64]>,
    ) -> BpResult<PackResult> {
        pack_rssl_symmetric(x, hierarchy, fixed, fixed_solution, None)
    }

    /// `pack_rssl` with optional mirror-symmetry equalities. Passing `None` for
    /// `symmetry` is byte-identical to the upstream algorithm.
    pub fn pack_rssl_symmetric(
        mut x: Vec<f64>,
        hierarchy: &KernelHierarchy,
        fixed: Option<&[bool]>,
        fixed_solution: Option<&[f64]>,
        symmetry: Option<&KernelSymmetry>,
    ) -> BpResult<PackResult> {
        let dim = hierarchy.flaps.len() * 2 + 1;
        if x.len() != dim {
            return Err(BpError::InvalidInput(format!(
                "optimizer pack vector has {} values for {} flaps",
                x.len(),
                hierarchy.flaps.len()
            )));
        }
        validate_fixed_inputs(dim, hierarchy.flaps.len(), fixed, fixed_solution)?;

        let mut bounds = vec![(0.0, 1.0); dim];
        let last = dim - 1;
        bounds[last] = (
            1.0 / f64::from(MAX_SHEET_SIZE),
            1.0 / f64::from(MIN_SHEET_SIZE),
        );
        clip_to_bounds(&mut x, &bounds);

        let objective = |x: &[f64]| -x[x.len() - 1];
        let mut constraints = make_rssl_constraints(hierarchy, fixed, fixed_solution);
        if let Some(symmetry) = symmetry {
            constraints.extend(make_rssl_symmetry_constraints(hierarchy, symmetry, fixed));
        }
        let result = slsqp_rssl::fmin_slsqp(
            objective,
            &x,
            &bounds,
            constraints,
            PACK_MAX_EVAL,
            PACK_XTOL_ABS,
            None,
        );
        let success = result.status == slsqp_rssl::SlsqpMode::Success as i32;

        Ok(PackResult {
            x: result.x,
            success,
            status: PackStatus::from_rssl_status(result.status),
            fun: result.fun,
        })
    }

    // ------------------------------------------------ symmetric grid fitting

    /// How many grid steps the fallback searches outward before giving up.
    const MAX_FALLBACK_STEPS: i32 = 200;

    /// Grid origins for the symmetric fit, in normalized coordinates.
    ///
    /// A diagonal sheet already measures both axes from the sheet centre — its
    /// diamond is centred there — so it keeps that whatever the axis. A
    /// rectangular sheet centres only the axes the mirror needs, because
    /// centring an axis the layout is *not* symmetric about would force the
    /// sheet to be symmetric about the layout's own extent and waste paper.
    pub fn symmetric_offsets(sheet: OptimizerSheet, axis: SymmetryAxis) -> (f64, f64) {
        match sheet {
            OptimizerSheet::Diag => (0.5, 0.5),
            OptimizerSheet::Rect => axis.offsets(),
        }
    }

    /// Which axes the symmetric fit measures from the sheet centre.
    fn symmetric_centered(sheet: OptimizerSheet, axis: SymmetryAxis) -> (bool, bool) {
        match sheet {
            OptimizerSheet::Diag => (true, true),
            OptimizerSheet::Rect => axis.centered(),
        }
    }

    fn to_grid_offset(x: &[f64], offsets: (f64, f64)) -> Vec<f64> {
        let grid = get_scale(x);
        let last = x.len() - 1;
        let mut out = Vec::with_capacity(x.len());
        for (index, value) in x.iter().enumerate().take(last) {
            let offset = if index % 2 == 0 { offsets.0 } else { offsets.1 };
            out.push((value - offset) * grid);
        }
        out.push(grid);
        out
    }

    fn to_double_offset(x: &[f64], offsets: (f64, f64)) -> Vec<f64> {
        let grid = get_scale(x);
        let last = x.len() - 1;
        let mut out = Vec::with_capacity(x.len());
        for (index, value) in x.iter().enumerate().take(last) {
            let offset = if index % 2 == 0 { offsets.0 } else { offsets.1 };
            out.push(value * grid + offset);
        }
        out.push(grid);
        out
    }

    /// The smallest sheet that contains this flap's box, given which axes are
    /// measured from the centre.
    fn symmetric_required_size(
        sheet: OptimizerSheet,
        axis: SymmetryAxis,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> f64 {
        match sheet {
            OptimizerSheet::Diag => {
                let mut need: f64 = 0.0;
                for (cx, cy) in [
                    (x, y),
                    (x + width, y),
                    (x, y + height),
                    (x + width, y + height),
                ] {
                    need = need.max(2.0 * (cx.abs() + cy.abs()));
                }
                need
            }
            OptimizerSheet::Rect => {
                let (center_x, center_y) = axis.centered();
                let need_x = if center_x {
                    (-2.0 * x).max(2.0 * (x + width))
                } else {
                    x + width
                };
                let need_y = if center_y {
                    (-2.0 * y).max(2.0 * (y + height))
                } else {
                    y + height
                };
                need_x.max(need_y)
            }
        }
    }

    /// A centred axis has no lower bound of its own — negative coordinates are
    /// the other side of the sheet — so only absolute axes get the `>= 0` check.
    fn symmetric_bounds_ok(sheet: OptimizerSheet, axis: SymmetryAxis, x: f64, y: f64) -> bool {
        let (center_x, center_y) = symmetric_centered(sheet, axis);
        (center_x || x >= 0.0) && (center_y || y >= 0.0)
    }

    /// Exact integer separation of flap `n` from every already-pinned flap.
    ///
    /// This is `KernelHierarchy::check` without its sheet-bounds test, which
    /// assumes an absolute origin and would reject legitimate negative centred
    /// coordinates.
    fn symmetric_distances_ok(
        xk: &[f64],
        hierarchy: &KernelHierarchy,
        n: usize,
        fixed: &[bool],
    ) -> bool {
        for &(i, j, dist) in &hierarchy.dist_map {
            let touches = (i == n && fixed[j]) || (j == n && fixed[i]);
            if touches && rounded_exact(xk, i, j, dist, &hierarchy.flaps) > 0.0 {
                return false;
            }
        }
        true
    }

    /// Candidate grid placements for an orbit representative.
    ///
    /// A pair branches over the four surrounding grid points and derives its
    /// partner; a flap on the axis has a single degree of freedom, so it gets the
    /// two nearest placements along the axis.
    fn symmetric_candidates(
        symmetry: &KernelSymmetry,
        rep: usize,
        px: f64,
        py: f64,
        width: f64,
        height: f64,
    ) -> Vec<(f64, f64)> {
        let mut out = Vec::new();
        if symmetry.on_axis(rep) {
            let t = symmetry.axis.axis_parameter(px, py);
            for t in [t.floor(), t.ceil()] {
                let point = symmetry.axis.axis_point(t, width, height);
                if !out.contains(&point) {
                    out.push(point);
                }
            }
        } else {
            for q in 0..4 {
                let point = (branch_value(px, q & 1), branch_value(py, q >> 1));
                if !out.contains(&point) {
                    out.push(point);
                }
            }
        }
        out
    }

    /// Place a whole orbit at once and re-solve the free flaps around it.
    ///
    /// Returns the packed solution in normalized space, or `None` when this
    /// placement is not viable.
    /// The parts of a symmetric fit that do not change as orbits are placed.
    struct SymmetricFit<'a> {
        hierarchy: &'a KernelHierarchy,
        symmetry: &'a KernelSymmetry,
        offsets: (f64, f64),
    }

    fn try_orbit_placement(
        fit: &SymmetricFit<'_>,
        fixed: &[bool],
        solution: &[f64],
        rep: usize,
        (gx, gy): (f64, f64),
    ) -> BpResult<Option<Vec<f64>>> {
        let SymmetricFit {
            hierarchy,
            symmetry,
            offsets,
        } = *fit;
        let mate = symmetry.partner[rep];
        let width = f64::from(hierarchy.flaps[rep].width);
        let height = f64::from(hierarchy.flaps[rep].height);
        let (mx, my) = symmetry.axis.mirror_grid(gx, gy, width, height);
        if !symmetric_bounds_ok(hierarchy.sheet, symmetry.axis, gx, gy)
            || !symmetric_bounds_ok(hierarchy.sheet, symmetry.axis, mx, my)
        {
            return Ok(None);
        }

        let mut xk = solution.to_vec();
        xk[rep * 2] = gx;
        xk[rep * 2 + 1] = gy;
        xk[mate * 2] = mx;
        xk[mate * 2 + 1] = my;

        // Both orbit members are already marked fixed, so this also covers the
        // pair colliding with itself across the axis.
        if !symmetric_distances_ok(&xk, hierarchy, rep, fixed) {
            return Ok(None);
        }
        if mate != rep && !symmetric_distances_ok(&xk, hierarchy, mate, fixed) {
            return Ok(None);
        }

        let mate_width = f64::from(hierarchy.flaps[mate].width);
        let mate_height = f64::from(hierarchy.flaps[mate].height);
        let need = symmetric_required_size(hierarchy.sheet, symmetry.axis, gx, gy, width, height)
            .max(symmetric_required_size(
                hierarchy.sheet,
                symmetry.axis,
                mx,
                my,
                mate_width,
                mate_height,
            ));
        let last = xk.len() - 1;
        if need > xk[last] {
            xk[last] = need;
        }

        let start = to_double_offset(&xk, offsets);
        let mut bounds = vec![(0.0, 1.0); xk.len()];
        bounds[last] = (
            1.0 / f64::from(MAX_SHEET_SIZE),
            1.0 / f64::from(MIN_SHEET_SIZE),
        );
        let mut start = start;
        clip_to_bounds(&mut start, &bounds);

        let mut constraints =
            make_rssl_constraints_with_offsets(hierarchy, Some(fixed), Some(&xk), offsets);
        constraints.extend(make_rssl_symmetry_constraints(
            hierarchy,
            symmetry,
            Some(fixed),
        ));
        let result = slsqp_rssl::fmin_slsqp(
            |x: &[f64]| -x[x.len() - 1],
            &start,
            &bounds,
            constraints,
            PACK_MAX_EVAL,
            PACK_XTOL_ABS,
            None,
        );
        if result.status == slsqp_rssl::SlsqpMode::Success as i32 {
            Ok(Some(result.x))
        } else {
            Ok(None)
        }
    }

    /// Round the fitted grid coordinates into a sheet, centring the axes that
    /// need it.
    fn symmetric_output(
        solution: &[f64],
        hierarchy: &KernelHierarchy,
        axis: SymmetryAxis,
    ) -> Vec<i32> {
        let count = hierarchy.flaps.len();
        let mut need = f64::from(MIN_SHEET_SIZE);
        for i in 0..count {
            need = need.max(symmetric_required_size(
                hierarchy.sheet,
                axis,
                solution[i * 2].round(),
                solution[i * 2 + 1].round(),
                f64::from(hierarchy.flaps[i].width),
                f64::from(hierarchy.flaps[i].height),
            ));
        }
        let mut size = need.ceil() as i32;
        let (center_x, center_y) = symmetric_centered(hierarchy.sheet, axis);
        // A centred axis puts the sheet centre on a grid point, which needs an
        // even size. This is the rule the diagonal sheet already lives by.
        if (center_x || center_y) && size % 2 != 0 {
            size += 1;
        }
        let half = size / 2;
        let mut out = Vec::with_capacity(count * 2 + 1);
        for i in 0..count {
            let x = solution[i * 2].round() as i32 + if center_x { half } else { 0 };
            let y = solution[i * 2 + 1].round() as i32 + if center_y { half } else { 0 };
            out.push(x);
            out.push(y);
        }
        out.push(size);
        out
    }

    /// Fit a symmetric continuous solution onto the grid, one orbit at a time.
    ///
    /// The upstream greedy pins flaps at absolute grid coordinates and grows the
    /// sheet lazily. That cannot work here: in absolute coordinates a book mirror
    /// is `x -> s - x - w`, so every growth step would move the axis out from
    /// under the already-pinned pairs. Measuring the mirrored axes from the sheet
    /// centre makes the mirror map independent of the sheet size, and growth
    /// becomes symmetric margin.
    pub fn greedy_solve_integer_symmetric(
        x0: &[f64],
        hierarchy: &KernelHierarchy,
        symmetry: &KernelSymmetry,
        should_cancel: &mut dyn FnMut() -> bool,
        on_event: &mut dyn FnMut(OptimizerEvent),
    ) -> BpResult<Vec<i32>> {
        let offsets = symmetric_offsets(hierarchy.sheet, symmetry.axis);
        let fit = SymmetricFit {
            hierarchy,
            symmetry,
            offsets,
        };
        let count = hierarchy.flaps.len();
        let mut solution = to_grid_offset(x0, offsets);
        let mut fixed = vec![false; count];
        let mut pins: Vec<Option<(f64, f64)>> = vec![None; count];
        let representatives = symmetry.representatives();
        let mut placed = 0usize;

        while placed < count {
            check_cancelled(should_cancel)?;
            on_event(OptimizerEvent::Fit((placed, count)));

            let Some(rep) = representatives
                .iter()
                .copied()
                .filter(|&i| !fixed[i])
                .min_by(|&a, &b| {
                    meg(solution[a * 2], solution[a * 2 + 1])
                        .total_cmp(&meg(solution[b * 2], solution[b * 2 + 1]))
                })
            else {
                break;
            };
            let mate = symmetry.partner[rep];
            fixed[rep] = true;
            fixed[mate] = true;

            let width = f64::from(hierarchy.flaps[rep].width);
            let height = f64::from(hierarchy.flaps[rep].height);
            let px = convert_if_almost_integer(solution[rep * 2]);
            let py = convert_if_almost_integer(solution[rep * 2 + 1]);

            let mut chosen: Option<Vec<f64>> = None;
            let mut chosen_scale = f64::NEG_INFINITY;
            let consider = |placement: Option<Vec<f64>>,
                            chosen: &mut Option<Vec<f64>>,
                            chosen_scale: &mut f64,
                            pins: &mut Vec<Option<(f64, f64)>>,
                            gx: f64,
                            gy: f64|
             -> bool {
                let Some(packed) = placement else {
                    return false;
                };
                let scale = packed[packed.len() - 1];
                if scale > *chosen_scale {
                    *chosen_scale = scale;
                    *chosen = Some(packed);
                    let (mx, my) = symmetry.axis.mirror_grid(gx, gy, width, height);
                    pins[rep] = Some((gx, gy));
                    pins[mate] = Some((mx, my));
                }
                true
            };

            for (gx, gy) in symmetric_candidates(symmetry, rep, px, py, width, height) {
                let placement = try_orbit_placement(&fit, &fixed, &solution, rep, (gx, gy))?;
                consider(placement, &mut chosen, &mut chosen_scale, &mut pins, gx, gy);
            }

            if chosen.is_none() {
                if symmetry.on_axis(rep) {
                    // One degree of freedom, so scan outward *along* the axis.
                    // Projecting a 2-D annulus onto the axis would retry the same
                    // handful of placements thousands of times.
                    let t0 = symmetry.axis.axis_parameter(px, py);
                    'axis: for step in 1..MAX_FALLBACK_STEPS {
                        for direction in [-1.0, 1.0] {
                            let t = (t0 + direction * f64::from(step)).round();
                            let (gx, gy) = symmetry.axis.axis_point(t, width, height);
                            let placement =
                                try_orbit_placement(&fit, &fixed, &solution, rep, (gx, gy))?;
                            if consider(
                                placement,
                                &mut chosen,
                                &mut chosen_scale,
                                &mut pins,
                                gx,
                                gy,
                            ) {
                                break 'axis;
                            }
                        }
                    }
                } else {
                    'annulus: for radius in 1..MAX_FALLBACK_STEPS {
                        let mut points = annulus(radius, px.round(), py.round());
                        points.sort_by(|a, b| {
                            meg(a.x - px, a.y - py).total_cmp(&meg(b.x - px, b.y - py))
                        });
                        for point in points {
                            let placement = try_orbit_placement(
                                &fit,
                                &fixed,
                                &solution,
                                rep,
                                (point.x, point.y),
                            )?;
                            if consider(
                                placement,
                                &mut chosen,
                                &mut chosen_scale,
                                &mut pins,
                                point.x,
                                point.y,
                            ) {
                                break 'annulus;
                            }
                        }
                    }
                }
            }

            let Some(packed) = chosen else {
                return Err(BpError::OptimizationFailed(format!(
                    "could not place flap {} symmetrically within {MAX_FALLBACK_STEPS} grid steps",
                    hierarchy.flaps[rep].id
                )));
            };

            solution = to_grid_offset(&packed, offsets);
            for (i, pin) in pins.iter().enumerate() {
                if let Some((x, y)) = *pin {
                    solution[i * 2] = x;
                    solution[i * 2 + 1] = y;
                }
            }
            placed += if mate == rep { 1 } else { 2 };
        }

        on_event(OptimizerEvent::Fit((count, count)));
        Ok(symmetric_output(&solution, hierarchy, symmetry.axis))
    }

    pub fn greedy_solve_integer_rssl(
        x0: &[f64],
        hierarchy: &KernelHierarchy,
    ) -> BpResult<Vec<i32>> {
        greedy_solve_integer_rssl_with_progress(x0, hierarchy, &mut || false, &mut |_| {})
    }

    pub fn greedy_solve_integer_rssl_with_progress(
        x0: &[f64],
        hierarchy: &KernelHierarchy,
        should_cancel: &mut dyn FnMut() -> bool,
        on_event: &mut dyn FnMut(OptimizerEvent),
    ) -> BpResult<Vec<i32>> {
        let mut context = BranchingContext::new(x0, hierarchy);
        let mut depth = 0;
        let flap_count = hierarchy.flaps.len();
        while depth < hierarchy.flaps.len() {
            check_cancelled(should_cancel)?;
            on_event(OptimizerEvent::Fit((depth, flap_count)));
            let branch_at = select_meg(&context.solution, &context.fixed);
            context.fixed[branch_at] = true;
            let next = branch_rssl(branch_at, &mut context, &mut depth)?;
            context.solution = to_grid(&next, hierarchy.sheet, &context.fixed);
        }
        on_event(OptimizerEvent::Fit((flap_count, flap_count)));
        Ok(context.output())
    }

    pub fn basin_hopping_rssl(
        x0: Vec<f64>,
        hierarchy: &KernelHierarchy,
        seed: u32,
    ) -> BpResult<PackResult> {
        basin_hopping_rssl_with_progress(x0, hierarchy, seed, &mut || false, &mut |_| {})
    }

    pub fn basin_hopping_rssl_with_progress(
        x0: Vec<f64>,
        hierarchy: &KernelHierarchy,
        seed: u32,
        should_cancel: &mut dyn FnMut() -> bool,
        on_event: &mut dyn FnMut(OptimizerEvent),
    ) -> BpResult<PackResult> {
        basin_hopping_symmetric_with_progress(x0, hierarchy, seed, should_cancel, on_event, None)
    }

    /// `basin_hopping_rssl_with_progress` with optional mirror symmetry.
    pub fn basin_hopping_symmetric_with_progress(
        x0: Vec<f64>,
        hierarchy: &KernelHierarchy,
        seed: u32,
        should_cancel: &mut dyn FnMut() -> bool,
        on_event: &mut dyn FnMut(OptimizerEvent),
        symmetry: Option<&KernelSymmetry>,
    ) -> BpResult<PackResult> {
        let mut rng = BpRandom::new(seed);
        basin_hopping_with_rng(
            x0,
            hierarchy,
            &mut rng,
            should_cancel,
            on_event,
            0,
            symmetry,
        )
    }

    pub fn solve_global_rssl(
        problem: &KernelProblem,
        target: usize,
        seed: u32,
    ) -> BpResult<PackResult> {
        solve_global_rssl_with_progress(problem, target, seed, &mut || false, &mut |_| {})
    }

    pub fn solve_global_rssl_with_progress(
        problem: &KernelProblem,
        target: usize,
        seed: u32,
        should_cancel: &mut dyn FnMut() -> bool,
        on_event: &mut dyn FnMut(OptimizerEvent),
    ) -> BpResult<PackResult> {
        solve_global_symmetric_with_progress(problem, target, seed, should_cancel, on_event, None)
    }

    /// `solve_global_rssl_with_progress` with optional mirror symmetry.
    ///
    /// The coarse hierarchy levels stay unconstrained: they only produce starting
    /// points, and a simplified tree need not admit the same mirror. Each
    /// candidate is folded onto the manifold before its final-level solve.
    pub fn solve_global_symmetric_with_progress(
        problem: &KernelProblem,
        target: usize,
        seed: u32,
        should_cancel: &mut dyn FnMut() -> bool,
        on_event: &mut dyn FnMut(OptimizerEvent),
        symmetry: Option<&KernelSymmetry>,
    ) -> BpResult<PackResult> {
        let Some(main) = problem.hierarchies.last() else {
            return Err(BpError::InvalidInput(
                "optimizer problem requires at least one hierarchy".to_string(),
            ));
        };
        let mut rng = BpRandom::new(seed);
        let initial_vectors = generate_candidates_rssl_with_progress(
            target,
            problem,
            &mut rng,
            should_cancel,
            on_event,
        )?;
        let mut best_scale = f64::from(MAX_SHEET_SIZE);
        let mut best_result = None;
        for (index, vector) in initial_vectors.into_iter().enumerate() {
            check_cancelled(should_cancel)?;
            let result = basin_hopping_with_rng(
                vector,
                main,
                &mut rng,
                should_cancel,
                on_event,
                index,
                symmetry,
            )?;
            if result.success {
                let scale = get_scale(&result.x);
                if scale < best_scale {
                    best_scale = scale;
                    best_result = Some(result);
                }
            }
        }
        best_result.ok_or_else(|| {
            BpError::OptimizationFailed("optimizer fails to solve the layout".to_string())
        })
    }

    pub fn generate_candidates_rssl(
        target: usize,
        problem: &KernelProblem,
        rng: &mut BpRandom,
    ) -> BpResult<Vec<Vec<f64>>> {
        if problem.hierarchies.is_empty() {
            return Err(BpError::InvalidInput(
                "optimizer problem requires at least one hierarchy".to_string(),
            ));
        }

        let growth = (target as f64).powf(1.0 / problem.hierarchies.len() as f64);
        let mut num = growth;
        let mut vectors = Vec::new();
        let mut last_hierarchy = None;

        for hierarchy in &problem.hierarchies {
            if vectors.is_empty() {
                vectors = generate_candidate_level(num.floor() as usize, hierarchy, None, rng)?;
            } else if let Some(previous) = last_hierarchy {
                vectors =
                    generate_next_level_rssl(&vectors, hierarchy, previous, num, target, rng)?;
            }
            last_hierarchy = Some(hierarchy);
            num *= growth;
        }

        if vectors.len() > target {
            vectors.sort_by(|a, b| b[b.len() - 1].total_cmp(&a[a.len() - 1]));
            vectors.truncate(target);
        }
        Ok(vectors)
    }

    pub fn generate_candidates_rssl_with_progress(
        target: usize,
        problem: &KernelProblem,
        rng: &mut BpRandom,
        should_cancel: &mut dyn FnMut() -> bool,
        on_event: &mut dyn FnMut(OptimizerEvent),
    ) -> BpResult<Vec<Vec<f64>>> {
        if problem.hierarchies.is_empty() {
            return Err(BpError::InvalidInput(
                "optimizer problem requires at least one hierarchy".to_string(),
            ));
        }

        let growth = (target as f64).powf(1.0 / problem.hierarchies.len() as f64);
        let mut num = growth;
        let mut vectors = Vec::new();
        let mut last_hierarchy = None;

        for (level, hierarchy) in problem.hierarchies.iter().enumerate() {
            check_cancelled(should_cancel)?;
            on_event(OptimizerEvent::Candidate((level, target)));
            if vectors.is_empty() {
                vectors = generate_candidate_level(num.floor() as usize, hierarchy, None, rng)?;
            } else if let Some(previous) = last_hierarchy {
                vectors =
                    generate_next_level_rssl(&vectors, hierarchy, previous, num, target, rng)?;
            }
            last_hierarchy = Some(hierarchy);
            num *= growth;
        }

        if vectors.len() > target {
            vectors.sort_by(|a, b| b[b.len() - 1].total_cmp(&a[a.len() - 1]));
            vectors.truncate(target);
        }
        Ok(vectors)
    }

    fn basin_hopping_with_rng(
        x0: Vec<f64>,
        hierarchy: &KernelHierarchy,
        rng: &mut BpRandom,
        should_cancel: &mut dyn FnMut() -> bool,
        on_event: &mut dyn FnMut(OptimizerEvent),
        range: usize,
        symmetry: Option<&KernelSymmetry>,
    ) -> BpResult<PackResult> {
        let mut runner = BasinHoppingRunner::new(x0, hierarchy, symmetry)?;
        let mut stale_count = 0;
        for minor in 0..BH_NITER {
            check_cancelled(should_cancel)?;
            on_event(OptimizerEvent::Cont((0, minor, range)));
            let new_global_min = runner.one_cycle(rng)?;
            stale_count += 1;
            if new_global_min {
                stale_count = 0;
            } else if stale_count > BH_NITER_SUCCESS {
                break;
            }
        }
        Ok(runner.lowest)
    }

    fn check_cancelled(should_cancel: &mut dyn FnMut() -> bool) -> BpResult<()> {
        if should_cancel() {
            Err(BpError::OptimizationCancelled)
        } else {
            Ok(())
        }
    }

    fn generate_next_level_rssl(
        vectors: &[Vec<f64>],
        hierarchy: &KernelHierarchy,
        last_hierarchy: &KernelHierarchy,
        num: f64,
        target: usize,
        rng: &mut BpRandom,
    ) -> BpResult<Vec<Vec<f64>>> {
        let mut next_level = Vec::new();
        let num_per_vec = (num / vectors.len() as f64).ceil() as usize;
        for (index, vector) in vectors.iter().enumerate() {
            let n = num_per_vec.min(target.saturating_sub(index * num_per_vec));
            if n == 0 {
                continue;
            }
            let circles = make_circles(vector, hierarchy, last_hierarchy)?;
            let candidates = generate_candidate_level(n, hierarchy, Some(&circles), rng)?;
            next_level.extend(candidates);
        }
        Ok(next_level)
    }

    fn generate_candidate_level(
        target: usize,
        hierarchy: &KernelHierarchy,
        circles: Option<&[KernelCircle]>,
        rng: &mut BpRandom,
    ) -> BpResult<Vec<Vec<f64>>> {
        let mut vectors = Vec::new();
        while vectors.len() < target {
            let mut vec = generate_random_candidate(hierarchy, circles, rng);
            let result = pack_rssl(vec, hierarchy, None, None)?;
            if !result.success {
                continue;
            }
            vec = result.x;
            vectors.push(vec);
        }
        Ok(vectors)
    }

    fn generate_random_candidate(
        hierarchy: &KernelHierarchy,
        circles: Option<&[KernelCircle]>,
        rng: &mut BpRandom,
    ) -> Vec<f64> {
        let mut result = Vec::new();
        for _ in 0..4 {
            let mut vec = if let Some(circles) = circles {
                generate_in_circles(circles, || rng.random01())
            } else {
                generate_random_vector(hierarchy.flaps.len() * 2 + 1, || rng.random01())
            };
            setup_initial_scale(&mut vec, hierarchy);
            if result.is_empty() || get_scale(&vec) < get_scale(&result) {
                result = vec;
            }
        }
        result
    }

    pub fn infer_scale(x: &[f64], i: usize, j: usize, dist: i32, flaps: &[KernelFlap]) -> f64 {
        let x1 = x[i * 2];
        let y1 = x[i * 2 + 1];
        let x2 = x[j * 2];
        let y2 = x[j * 2 + 1];
        let w = if x2 > x1 { flaps[i] } else { flaps[j] }.width;
        let h = if y2 > y1 { flaps[i] } else { flaps[j] }.height;
        let dx = (x2 - x1).abs();
        let dy = (y2 - y1).abs();
        let dh = f64::from(dist + h);
        let dw = f64::from(dist + w);
        let w = f64::from(w);
        let h = f64::from(h);
        let dist = f64::from(dist);

        if dx == 0.0 && dy == 0.0 {
            return f64::from(MAX_INIT_SCALE);
        }
        if dx == 0.0 || dy * w > dh * dx {
            return dh / dy;
        }
        if dy == 0.0 || dx * h > dw * dy {
            return dw / dx;
        }
        solve_quadratic(dx, dy, w, h, dist)
    }

    pub fn to_grid(x: &[f64], sheet: OptimizerSheet, fixed: &[bool]) -> Vec<f64> {
        let grid = get_scale(x);
        let offset = sheet.offset();
        let last = x.len() - 1;
        let mut result = Vec::with_capacity(x.len());
        for (index, coordinate) in x.iter().enumerate().take(last) {
            let mut value = (*coordinate - offset) * grid;
            if fixed.get(index).copied().unwrap_or(false) {
                value = value.round();
            }
            result.push(value);
        }
        result.push(grid);
        result
    }

    pub fn to_double(x: &[f64], sheet: OptimizerSheet) -> Vec<f64> {
        let grid = get_scale(x);
        let offset = sheet.offset();
        let last = x.len() - 1;
        let mut result = Vec::with_capacity(x.len());
        for value in x.iter().take(last) {
            result.push(value * grid + offset);
        }
        result.push(grid);
        result
    }

    pub fn circle_constraint(
        x: &[f64],
        i: usize,
        j: usize,
        dist: i32,
    ) -> ScalarConstraintEvaluation {
        let d = f64::from(dist) * x[x.len() - 1];
        let dx = x[i * 2] - x[j * 2];
        let dy = x[i * 2 + 1] - x[j * 2 + 1];
        let mut gradient = reset_gradient(x.len(), 2.0 * f64::from(dist) * d);
        gradient[i * 2] = -2.0 * dx;
        gradient[j * 2] = 2.0 * dx;
        gradient[i * 2 + 1] = -2.0 * dy;
        gradient[j * 2 + 1] = 2.0 * dy;
        ScalarConstraintEvaluation {
            value: d * d - dx * dx - dy * dy,
            gradient,
        }
    }

    pub fn rounded_constraint(
        x: &[f64],
        i: usize,
        j: usize,
        dist: i32,
        flaps: &[KernelFlap],
    ) -> ScalarConstraintEvaluation {
        let m = x[x.len() - 1];
        let d = f64::from(dist) * m;
        let fi = flaps[i];
        let fj = flaps[j];
        let dx = interval_distance(
            x[i * 2],
            m * f64::from(fi.width),
            x[j * 2],
            m * f64::from(fj.width),
        );
        let dy = interval_distance(
            x[i * 2 + 1],
            m * f64::from(fi.height),
            x[j * 2 + 1],
            m * f64::from(fj.height),
        );
        let dx_s = if dx > 0.0 {
            -fj.width
        } else if dx < 0.0 {
            fi.width
        } else {
            0
        };
        let dy_s = if dy > 0.0 {
            -fj.height
        } else if dy < 0.0 {
            fi.height
        } else {
            0
        };
        let mut gradient = reset_gradient(
            x.len(),
            2.0 * f64::from(dist) * d - 2.0 * dx * f64::from(dx_s) - 2.0 * dy * f64::from(dy_s),
        );
        gradient[i * 2] = -2.0 * dx;
        gradient[j * 2] = 2.0 * dx;
        gradient[i * 2 + 1] = -2.0 * dy;
        gradient[j * 2 + 1] = 2.0 * dy;
        ScalarConstraintEvaluation {
            value: d * d - dx * dx - dy * dy,
            gradient,
        }
    }

    pub fn rounded_exact(x: &[f64], i: usize, j: usize, dist: i32, flaps: &[KernelFlap]) -> f64 {
        let dx = interval_distance(
            x[i * 2],
            f64::from(flaps[i].width),
            x[j * 2],
            f64::from(flaps[j].width),
        );
        let dy = interval_distance(
            x[i * 2 + 1],
            f64::from(flaps[i].height),
            x[j * 2 + 1],
            f64::from(flaps[j].height),
        );
        f64::from(dist * dist) - dx * dx - dy * dy
    }

    pub fn fixed_constraint(
        x: &[f64],
        coordinate_index: usize,
        vx: f64,
        vy: f64,
        offset: f64,
    ) -> VectorConstraintEvaluation {
        let mut gx = reset_gradient(x.len(), -vx);
        gx[coordinate_index] = 1.0;
        let mut gy = reset_gradient(x.len(), -vy);
        gy[coordinate_index + 1] = 1.0;
        VectorConstraintEvaluation {
            values: vec![
                x[coordinate_index] - offset - vx * x[x.len() - 1],
                x[coordinate_index + 1] - offset - vy * x[x.len() - 1],
            ],
            gradients: vec![gx, gy],
        }
    }

    pub fn rect_bound_constraint(
        x: &[f64],
        coordinate_index: usize,
        dimension: i32,
    ) -> ScalarConstraintEvaluation {
        let mut gradient = reset_gradient(x.len(), f64::from(dimension));
        gradient[coordinate_index] = 1.0;
        ScalarConstraintEvaluation {
            value: x[coordinate_index] + f64::from(dimension) * x[x.len() - 1] - 1.0,
            gradient,
        }
    }

    pub fn diag_bound_constraints(
        x: &[f64],
        flap_index: usize,
        offset: i32,
    ) -> VectorConstraintEvaluation {
        let ix = flap_index * 2;
        let iy = ix + 1;
        let off = [-offset, offset, offset, offset];
        let mut values = Vec::with_capacity(4);
        let mut gradients = Vec::with_capacity(4);
        for index in 0..4 {
            let mut gradient = reset_gradient(x.len(), f64::from(off[index]));
            gradient[ix] = DIAG_FX[index];
            gradient[iy] = DIAG_FY[index];
            gradients.push(gradient);
            values.push(
                DIAG_FX[index] * x[ix]
                    + DIAG_FY[index] * x[iy]
                    + f64::from(off[index]) * x[x.len() - 1]
                    + DIAG_V[index],
            );
        }
        VectorConstraintEvaluation { values, gradients }
    }

    pub fn interval_distance(l1: f64, w1: f64, l2: f64, w2: f64) -> f64 {
        (l1 - l2 - w2).max(0.0) + (l1 + w1 - l2).min(0.0)
    }

    pub fn meg(x: f64, y: f64) -> f64 {
        (x * x + y * y).sqrt()
    }

    pub fn select_meg(solution: &[f64], fixed: &[bool]) -> usize {
        let flap_count = (solution.len() - 1) / 2;
        let mut min_meg = 2.0 * solution[solution.len() - 1];
        let mut min_n = 0;
        for n in 0..flap_count {
            if fixed.get(n).copied().unwrap_or(false) {
                continue;
            }
            let value = meg(solution[n * 2], solution[n * 2 + 1]);
            if value < min_meg {
                min_meg = value;
                min_n = n;
            }
        }
        min_n
    }

    pub fn annulus(r: i32, cx: f64, cy: f64) -> Vec<KernelPoint> {
        let mut result = Vec::new();
        for x in -r..=r {
            let low = f64::from(r * r - x * x).sqrt().ceil() as i32;
            let high = f64::from((r + 1) * (r + 1) - x * x).sqrt().ceil() as i32;
            for y in low..high {
                result.push(KernelPoint {
                    x: cx + f64::from(x),
                    y: cy + f64::from(y),
                });
                if y > 0 {
                    result.push(KernelPoint {
                        x: cx + f64::from(x),
                        y: cy - f64::from(y),
                    });
                }
            }
        }
        result
    }

    pub fn convert_if_almost_integer(x: f64) -> f64 {
        let rounded = x.round();
        if (x - rounded).abs() < 1e-5 {
            rounded
        } else {
            x
        }
    }

    pub fn make_circles(
        vec: &[f64],
        hierarchy: &KernelHierarchy,
        last_hierarchy: &KernelHierarchy,
    ) -> BpResult<Vec<KernelCircle>> {
        let mut circles = Vec::with_capacity(hierarchy.flaps.len());
        for flap in &hierarchy.flaps {
            if let Some(parent) = hierarchy.parent_for(flap.id) {
                let index = find_index_by_id(&last_hierarchy.flaps, parent.id)?;
                circles.push(KernelCircle {
                    x: vec[index * 2],
                    y: vec[index * 2 + 1],
                    radius: parent.radius * vec[vec.len() - 1],
                });
            } else {
                let index = find_index_by_id(&last_hierarchy.flaps, flap.id)?;
                circles.push(KernelCircle {
                    x: vec[index * 2],
                    y: vec[index * 2 + 1],
                    radius: 0.0,
                });
            }
        }
        Ok(circles)
    }

    pub fn generate_in_circles(
        circles: &[KernelCircle],
        mut random01: impl FnMut() -> f64,
    ) -> Vec<f64> {
        let mut vec = Vec::with_capacity(circles.len() * 2 + 1);
        for circle in circles {
            if circle.radius == 0.0 {
                vec.push(circle.x);
                vec.push(circle.y);
            } else {
                let theta = random01() * 2.0 * PI;
                let radius = circle.radius * random01().sqrt();
                vec.push(circle.x + radius * theta.cos());
                vec.push(circle.y + radius * theta.sin());
            }
        }
        vec.push(0.0);
        vec
    }

    pub fn generate_random_vector(size: usize, mut random01: impl FnMut() -> f64) -> Vec<f64> {
        let mut result = Vec::with_capacity(size);
        for _ in 0..size {
            result.push(random01());
        }
        result
    }

    pub fn estimate_total(target: usize, growth: f64, rounds: usize) -> usize {
        let mut total = 0;
        let mut vectors = 0;
        let mut num = growth;
        for i in 0..rounds {
            if i == 0 {
                vectors = num.floor() as usize;
            } else {
                let mut next_vec = 0;
                let num_per_vec = (num / vectors as f64).ceil() as usize;
                for j in 0..vectors {
                    let n = num_per_vec.min(target.saturating_sub(num_per_vec * j));
                    if n == 0 {
                        continue;
                    }
                    next_vec += n;
                }
                vectors = next_vec;
            }
            total += vectors;
            num *= growth;
        }
        total
    }

    fn is_integer(value: f64) -> bool {
        value == value.floor()
    }

    fn branch_value(x: f64, direction: usize) -> f64 {
        if direction != 0 { x.ceil() } else { x.floor() }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum PackConstraint {
        Circle {
            i: usize,
            j: usize,
            dist: i32,
        },
        Rounded {
            i: usize,
            j: usize,
            dist: i32,
        },
        RectBound {
            coordinate_index: usize,
            dimension: i32,
        },
        DiagBound {
            flap_index: usize,
            offset: i32,
            bound_index: usize,
        },
    }

    impl PackConstraint {
        fn evaluate(
            self,
            x: &[f64],
            hierarchy: &KernelHierarchy,
            gradient: Option<&mut [f64]>,
        ) -> f64 {
            match self {
                Self::Circle { i, j, dist } => {
                    let evaluated = circle_constraint(x, i, j, dist);
                    copy_gradient(gradient, &evaluated.gradient);
                    evaluated.value
                }
                Self::Rounded { i, j, dist } => {
                    let evaluated = rounded_constraint(x, i, j, dist, &hierarchy.flaps);
                    copy_gradient(gradient, &evaluated.gradient);
                    evaluated.value
                }
                Self::RectBound {
                    coordinate_index,
                    dimension,
                } => {
                    let evaluated = rect_bound_constraint(x, coordinate_index, dimension);
                    copy_gradient(gradient, &evaluated.gradient);
                    evaluated.value
                }
                Self::DiagBound {
                    flap_index,
                    offset,
                    bound_index,
                } => {
                    let evaluated = diag_bound_constraints(x, flap_index, offset);
                    if let Some(row) = evaluated.gradients.get(bound_index) {
                        copy_gradient(gradient, row);
                    }
                    evaluated.values.get(bound_index).copied().unwrap_or(0.0)
                }
            }
        }
    }

    impl PackStatus {
        fn from_success(status: slsqp::SuccessStatus) -> Self {
            match status {
                slsqp::SuccessStatus::Success => Self::Success,
                slsqp::SuccessStatus::StopValReached => Self::StopValReached,
                slsqp::SuccessStatus::FtolReached => Self::FtolReached,
                slsqp::SuccessStatus::XtolReached => Self::XtolReached,
                slsqp::SuccessStatus::MaxEvalReached => Self::MaxEvalReached,
                slsqp::SuccessStatus::MaxTimeReached => Self::MaxTimeReached,
            }
        }

        fn from_failure(status: slsqp::FailStatus) -> Self {
            match status {
                slsqp::FailStatus::Failure => Self::Failure,
                slsqp::FailStatus::InvalidArgs => Self::InvalidArgs,
                slsqp::FailStatus::OutOfMemory => Self::OutOfMemory,
                slsqp::FailStatus::RoundoffLimited => Self::RoundoffLimited,
                slsqp::FailStatus::ForcedStop => Self::ForcedStop,
                slsqp::FailStatus::UnexpectedError => Self::UnexpectedError,
            }
        }

        fn from_rssl_status(status: i32) -> Self {
            match status {
                0 => Self::Success,
                2 => Self::MoreEqualityConstraints,
                3 => Self::IterationLimitExceededLsq,
                4 => Self::IncompatibleConstraints,
                5 => Self::SingularMatrixE,
                6 => Self::SingularMatrixC,
                7 => Self::RankDeficientHfti,
                8 => Self::PositiveDirectionalDerivative,
                9 => Self::IterationLimitExceeded,
                other => Self::Unknown(other),
            }
        }
    }

    fn make_pack_constraints(hierarchy: &KernelHierarchy) -> Vec<PackConstraint> {
        make_pack_constraints_with_fixed(hierarchy, None)
    }

    fn make_pack_constraints_with_fixed(
        hierarchy: &KernelHierarchy,
        fixed: Option<&[bool]>,
    ) -> Vec<PackConstraint> {
        let mut constraints = Vec::new();
        for (index, flap) in hierarchy.flaps.iter().enumerate() {
            if fixed
                .and_then(|fixed| fixed.get(index))
                .copied()
                .unwrap_or(false)
            {
                continue;
            }
            match hierarchy.sheet {
                OptimizerSheet::Rect => {
                    if flap.width != 0 {
                        constraints.push(PackConstraint::RectBound {
                            coordinate_index: index * 2,
                            dimension: flap.width,
                        });
                    }
                    if flap.height != 0 {
                        constraints.push(PackConstraint::RectBound {
                            coordinate_index: index * 2 + 1,
                            dimension: flap.height,
                        });
                    }
                }
                OptimizerSheet::Diag => {
                    let offset = flap.width.min(flap.height);
                    for bound_index in 0..4 {
                        constraints.push(PackConstraint::DiagBound {
                            flap_index: index,
                            offset,
                            bound_index,
                        });
                    }
                }
            }
        }
        for &(i, j, dist) in &hierarchy.dist_map {
            if fixed
                .and_then(|fixed| fixed.get(i))
                .copied()
                .unwrap_or(false)
                && fixed
                    .and_then(|fixed| fixed.get(j))
                    .copied()
                    .unwrap_or(false)
            {
                continue;
            }
            if hierarchy.flaps[i].has_dimension() || hierarchy.flaps[j].has_dimension() {
                constraints.push(PackConstraint::Rounded { i, j, dist });
            } else {
                constraints.push(PackConstraint::Circle { i, j, dist });
            }
        }
        constraints
    }

    fn make_rssl_constraints<'a>(
        hierarchy: &'a KernelHierarchy,
        fixed: Option<&'a [bool]>,
        fixed_solution: Option<&'a [f64]>,
    ) -> Vec<slsqp_rssl::Constraint<'a>> {
        let offset = hierarchy.sheet.offset();
        make_rssl_constraints_with_offsets(hierarchy, fixed, fixed_solution, (offset, offset))
    }

    /// `make_rssl_constraints` with the grid origin given per axis.
    ///
    /// The symmetric fit measures one or both axes from the sheet centre, so a
    /// pin has to be expressed against the same origin the grid coordinates use.
    fn make_rssl_constraints_with_offsets<'a>(
        hierarchy: &'a KernelHierarchy,
        fixed: Option<&'a [bool]>,
        fixed_solution: Option<&'a [f64]>,
        offsets: (f64, f64),
    ) -> Vec<slsqp_rssl::Constraint<'a>> {
        let mut constraints = Vec::new();
        for constraint in make_pack_constraints_with_fixed(hierarchy, fixed) {
            constraints.push(slsqp_rssl::Constraint::Ineq(Box::new(move |x| {
                -constraint.evaluate(x, hierarchy, None)
            })));
        }
        if let (Some(fixed), Some(fixed_solution)) = (fixed, fixed_solution) {
            let (offset_x, offset_y) = offsets;
            for i in 0..hierarchy.flaps.len() {
                if !fixed.get(i).copied().unwrap_or(false) {
                    continue;
                }
                let coordinate_index = i * 2;
                let vx = fixed_solution[coordinate_index];
                let vy = fixed_solution[coordinate_index + 1];
                constraints.push(slsqp_rssl::Constraint::Eq(Box::new(move |x| {
                    x[coordinate_index] - offset_x - vx * x[x.len() - 1]
                })));
                constraints.push(slsqp_rssl::Constraint::Eq(Box::new(move |x| {
                    x[coordinate_index + 1] - offset_y - vy * x[x.len() - 1]
                })));
            }
        }
        constraints
    }

    /// One linear equality per symmetry residual.
    ///
    /// Each closure evaluates only its own orbit. Recomputing the whole residual
    /// vector per residual would be O(n^2) per evaluation, which dominates
    /// runtime under finite-difference gradients.
    fn make_rssl_symmetry_constraints<'a>(
        hierarchy: &'a KernelHierarchy,
        symmetry: &'a KernelSymmetry,
        fixed: Option<&'a [bool]>,
    ) -> Vec<slsqp_rssl::Constraint<'a>> {
        symmetry_residuals(hierarchy, symmetry, fixed)
            .into_iter()
            .map(|(i, component)| {
                let axis = symmetry.axis;
                let partner = symmetry.partner[i];
                let width = f64::from(hierarchy.flaps[i].width);
                let height = f64::from(hierarchy.flaps[i].height);
                slsqp_rssl::Constraint::Eq(Box::new(move |x: &[f64]| {
                    let m = x[x.len() - 1];
                    let (mx, my) = axis.mirror_norm(x[i * 2], x[i * 2 + 1], width, height, m);
                    let target = if component == 0 { mx } else { my };
                    let source = x[partner * 2 + component];
                    source - target
                }))
            })
            .collect()
    }

    #[derive(Debug, Clone)]
    struct AdaptiveStepSize {
        stepsize: f64,
        nstep: usize,
        naccept: usize,
    }

    impl AdaptiveStepSize {
        fn new() -> Self {
            Self {
                stepsize: BH_STEPSIZE,
                nstep: 0,
                naccept: 0,
            }
        }

        fn take_step(
            &mut self,
            mut x: Vec<f64>,
            rng: &mut BpRandom,
            symmetry: Option<(&KernelHierarchy, &KernelSymmetry)>,
        ) -> Vec<f64> {
            self.nstep += 1;
            if self.nstep.is_multiple_of(BH_INTERVAL) {
                self.adjust_step_size();
            }
            let last = x.len() - 1;
            let Some((hierarchy, symmetry)) = symmetry else {
                for coordinate in x.iter_mut().take(last) {
                    *coordinate += rng.random01() * 2.0 * self.stepsize - self.stepsize;
                }
                return x;
            };
            // Displace one member of each orbit and mirror the displacement, so
            // the jiggle stays on the symmetry manifold instead of spending half
            // of every step being pulled back onto it.
            for i in symmetry.representatives() {
                x[i * 2] += rng.random01() * 2.0 * self.stepsize - self.stepsize;
                x[i * 2 + 1] += rng.random01() * 2.0 * self.stepsize - self.stepsize;
            }
            symmetrize(&mut x, hierarchy, symmetry);
            x
        }

        fn report(&mut self, accept: bool) {
            if accept {
                self.naccept += 1;
            }
        }

        fn adjust_step_size(&mut self) {
            let accept_rate = self.naccept as f64 / self.nstep as f64;
            if accept_rate > BH_ACCEPT_RATE {
                self.stepsize /= BH_FACTOR;
            } else {
                self.stepsize *= BH_FACTOR;
            }
        }
    }

    #[derive(Debug, Clone)]
    struct BasinHoppingRunner<'a> {
        hierarchy: &'a KernelHierarchy,
        symmetry: Option<&'a KernelSymmetry>,
        step_taking: AdaptiveStepSize,
        incumbent: PackResult,
        lowest: PackResult,
        x: Vec<f64>,
    }

    impl<'a> BasinHoppingRunner<'a> {
        fn new(
            mut x0: Vec<f64>,
            hierarchy: &'a KernelHierarchy,
            symmetry: Option<&'a KernelSymmetry>,
        ) -> BpResult<Self> {
            if let Some(symmetry) = symmetry {
                symmetrize(&mut x0, hierarchy, symmetry);
            }
            let minres = pack_rssl_symmetric(x0, hierarchy, None, None, symmetry)?;
            Ok(Self {
                hierarchy,
                symmetry,
                step_taking: AdaptiveStepSize::new(),
                x: minres.x.clone(),
                incumbent: minres.clone(),
                lowest: minres,
            })
        }

        fn one_cycle(&mut self, rng: &mut BpRandom) -> BpResult<bool> {
            let x_after_step = self.step_taking.take_step(
                self.x.clone(),
                rng,
                self.symmetry.map(|symmetry| (self.hierarchy, symmetry)),
            );
            let minres =
                pack_rssl_symmetric(x_after_step, self.hierarchy, None, None, self.symmetry)?;
            let accept = metropolis_accept(&minres, &self.incumbent, rng);
            self.step_taking.report(accept);
            let mut new_global_min = false;
            if accept {
                self.x = minres.x.clone();
                self.incumbent = minres.clone();
                if minres.success && (minres.fun < self.lowest.fun || !self.lowest.success) {
                    self.lowest = minres;
                    new_global_min = true;
                }
            }
            Ok(new_global_min)
        }
    }

    fn metropolis_accept(res_new: &PackResult, res_old: &PackResult, rng: &mut BpRandom) -> bool {
        let beta = if BH_T != 0.0 {
            1.0 / BH_T
        } else {
            f64::INFINITY
        };
        let prod = -(res_new.fun - res_old.fun) * beta;
        let weight = prod.min(0.0).exp();
        weight >= rng.random01() && (res_new.success || !res_old.success)
    }

    fn branch_rssl(
        branch_at: usize,
        context: &mut BranchingContext<'_>,
        depth: &mut usize,
    ) -> BpResult<Vec<f64>> {
        let mut children = Vec::new();
        let point = context.get(branch_at);

        for q in 0..4 {
            let Some(xk) = context.branch(None, point.x, point.y, branch_at, q) else {
                continue;
            };
            let result = pack_rssl(
                to_double(&xk, context.hierarchy.sheet),
                context.hierarchy,
                Some(&context.fixed),
                Some(&xk),
            )?;
            if result.success {
                children.push(result.x);
            }
        }

        if !children.is_empty() {
            let mut best = 0;
            for index in 1..children.len() {
                if children[index][children[index].len() - 1]
                    > children[best][children[best].len() - 1]
                {
                    best = index;
                }
            }
            *depth += 1;
            return Ok(children.swap_remove(best));
        }

        let rounded_x = point.x.round();
        let rounded_y = point.y.round();
        let mut radius = 1;
        loop {
            let mut points = annulus(radius, rounded_x, rounded_y);
            points.sort_by(|a, b| {
                meg(a.x - point.x, a.y - point.y).total_cmp(&meg(b.x - point.x, b.y - point.y))
            });
            for point in points {
                let Some(xk) = context.make_xk(None, point.x, point.y, branch_at) else {
                    continue;
                };
                let result = pack_rssl(
                    to_double(&xk, context.hierarchy.sheet),
                    context.hierarchy,
                    Some(&context.fixed),
                    Some(&xk),
                )?;
                if result.success {
                    *depth += 1;
                    return Ok(result.x);
                }
            }
            radius += 1;
        }
    }

    fn clip_to_bounds(x: &mut [f64], bounds: &[(f64, f64)]) {
        for (value, &(lower, upper)) in x.iter_mut().zip(bounds) {
            *value = (*value).clamp(lower, upper);
        }
    }

    fn validate_fixed_inputs(
        dim: usize,
        flap_count: usize,
        fixed: Option<&[bool]>,
        fixed_solution: Option<&[f64]>,
    ) -> BpResult<()> {
        if let Some(fixed) = fixed
            && fixed.len() != flap_count
        {
            return Err(BpError::InvalidInput(format!(
                "optimizer fixed vector has {} entries for {} flaps",
                fixed.len(),
                flap_count
            )));
        }
        if let Some(fixed_solution) = fixed_solution
            && fixed_solution.len() != dim
        {
            return Err(BpError::InvalidInput(format!(
                "optimizer fixed solution has {} values for {} dimensions",
                fixed_solution.len(),
                dim
            )));
        }
        let has_fixed = fixed
            .map(|fixed| fixed.iter().any(|value| *value))
            .unwrap_or(false);
        if has_fixed && fixed_solution.is_none() {
            return Err(BpError::InvalidInput(
                "optimizer fixed constraints require a fixed solution vector".to_string(),
            ));
        }
        Ok(())
    }

    fn copy_gradient(target: Option<&mut [f64]>, source: &[f64]) {
        if let Some(target) = target {
            for (target, source) in target.iter_mut().zip(source) {
                *target = *source;
            }
        }
    }

    fn reset_gradient_slice(gradient: &mut [f64], scale: f64) {
        let Some((last, prefix)) = gradient.split_last_mut() else {
            return;
        };
        for value in prefix {
            *value = 0.0;
        }
        *last = scale;
    }

    fn find_index_by_id(flaps: &[KernelFlap], id: u32) -> BpResult<usize> {
        flaps.iter().position(|flap| flap.id == id).ok_or_else(|| {
            BpError::InvalidInput(format!("optimizer hierarchy references missing flap {id}"))
        })
    }

    fn reset_gradient(dim: usize, scale: f64) -> Vec<f64> {
        let mut gradient = vec![0.0; dim];
        gradient[dim - 1] = scale;
        gradient
    }

    fn solve_quadratic(dx: f64, dy: f64, w: f64, h: f64, dist: f64) -> f64 {
        let a = dx * dx + dy * dy;
        let b = -2.0 * (w * dx + h * dy);
        let c = w * w + h * h - dist * dist;
        let d = b * b - 4.0 * a * c;
        (-b + d.sqrt()) / 2.0 / a
    }
}

#[cfg(test)]
mod tests {
    use super::kernel::PackStatus;
    use super::kernel::{
        BpRandom, BranchingContext, KernelCircle, KernelFlap, KernelHierarchy, KernelParent,
        KernelPoint, OptimizerSheet, annulus, circle_constraint, convert_if_almost_integer,
        diag_bound_constraints, estimate_total, fixed_constraint, generate_in_circles,
        generate_random_vector, get_scale, greedy_solve_integer_rssl, infer_scale, int_scale,
        interval_distance, make_circles, pack, pack_rssl, read_initial_vector,
        rect_bound_constraint, rounded_constraint, rounded_exact, select_meg, setup_initial_scale,
        to_double, to_grid,
    };
    use super::{
        FlapRequest, LayoutMode, OptimizerCommand, OptimizerProblem, OptimizerRequest,
        kernel::KernelProblem,
    };
    use crate::model::{GridType, Point};
    use crate::tree::{Hierarchy, ParentMap};

    #[test]
    fn kernel_initial_scale_matches_bp_circle_and_degenerate_cases() {
        let flaps = vec![
            KernelFlap {
                id: 1,
                width: 0,
                height: 0,
            },
            KernelFlap {
                id: 2,
                width: 0,
                height: 0,
            },
        ];
        let mut x = vec![0.0, 0.0, 0.3, 0.4, 0.0];
        let hierarchy = kernel_hierarchy(flaps.clone(), vec![(0, 1, 10)]);

        assert_eq!(infer_scale(&x, 0, 1, 10, &flaps), 20.0);
        setup_initial_scale(&mut x, &hierarchy);
        assert_eq!(get_scale(&x), 20.0);

        let same_position = vec![0.0, 0.0, 0.0, 0.0, 0.0];
        assert_eq!(
            infer_scale(&same_position, 0, 1, 10, &flaps),
            super::kernel::MAX_INIT_SCALE as f64
        );
    }

    #[test]
    fn kernel_initial_scale_matches_bp_rounded_constraint_formula() {
        let flaps = vec![
            KernelFlap {
                id: 1,
                width: 2,
                height: 5,
            },
            KernelFlap {
                id: 2,
                width: 7,
                height: 3,
            },
        ];
        let x = vec![0.0, 0.0, 0.8, 0.6, 0.0];

        assert!((infer_scale(&x, 0, 1, 10, &flaps) - 14.2).abs() < 1e-10);
    }

    #[test]
    fn kernel_sheet_output_and_enlarge_match_bp_rect_and_diag() {
        assert_eq!(
            OptimizerSheet::Rect.output(&[1.2, 3.7, 2.1, 4.2, 10.0]),
            vec![1, 4, 2, 4, 4]
        );
        assert_eq!(
            OptimizerSheet::Diag.output(&[-1.2, 2.6, 3.2, -1.4, 10.0]),
            vec![3, 7, 7, 3, 8]
        );

        let mut rect = vec![1.0, 2.0, 3.0];
        OptimizerSheet::Rect.enlarge_if_necessary(&mut rect, 5.0, 4.0);
        assert_eq!(rect[2], 5.0);

        let mut diag = vec![1.0, 2.0, 3.0];
        OptimizerSheet::Diag.enlarge_if_necessary(&mut diag, -2.0, 3.0);
        assert_eq!(diag[2], 10.0);
    }

    #[test]
    fn kernel_branching_coordinate_conversions_match_bp_offsets() {
        let rect_grid = to_grid(&[0.25, 0.75, 0.2], OptimizerSheet::Rect, &[true, false]);
        assert_eq!(rect_grid, vec![1.0, 3.75, 5.0]);
        assert_eq!(
            to_double(&rect_grid, OptimizerSheet::Rect),
            vec![0.2, 0.75, 0.2]
        );

        let diag_grid = to_grid(&[0.75, 0.25, 0.5], OptimizerSheet::Diag, &[false, false]);
        assert_eq!(diag_grid, vec![0.5, -0.5, 2.0]);
        assert_eq!(
            to_double(&diag_grid, OptimizerSheet::Diag),
            vec![0.75, 0.25, 0.5]
        );
    }

    #[test]
    fn kernel_int_scale_preserves_bp_grid_error_quirk() {
        assert_eq!(int_scale(4.0), 4);
        assert_eq!(int_scale(4.00005), 4);
        assert_eq!(int_scale(4.0002), 5);
    }

    #[test]
    fn kernel_problem_conversion_matches_bp_problem_loader() {
        let request = OptimizerRequest {
            command: OptimizerCommand::Start,
            use_bh: false,
            layout: LayoutMode::Random,
            random: 1,
            problem: OptimizerProblem {
                grid_type: GridType::Diagonal,
                flaps: vec![
                    FlapRequest {
                        id: 1,
                        width: 4.9,
                        height: 5.1,
                    },
                    FlapRequest {
                        id: 2,
                        width: 6.0,
                        height: 7.0,
                    },
                ],
                hierarchies: vec![Hierarchy {
                    leaves: vec![1, 2],
                    dist_map: vec![(1, 2, 10.9)],
                    parents: vec![ParentMap {
                        id: 9,
                        radius: 3.5,
                        children: vec![1, 2],
                    }],
                }],
            },
            vec: None,
            symmetry: None,
        };

        let problem = KernelProblem::from_request(&request).unwrap();
        let hierarchy = &problem.hierarchies[0];

        assert_eq!(problem.sheet, OptimizerSheet::Diag);
        assert_eq!(hierarchy.sheet, OptimizerSheet::Diag);
        assert_eq!(hierarchy.dist_map, vec![(0, 1, 10)]);
        assert_eq!(hierarchy.flaps[0].width, 4);
        assert_eq!(hierarchy.flaps[0].height, 5);
        assert_eq!(hierarchy.parent_for(1).unwrap().id, 9);
        assert_eq!(hierarchy.parent_for(2).unwrap().radius, 3.5);
    }

    #[test]
    fn kernel_read_initial_vector_matches_bp_view_scale_setup() {
        let request = OptimizerRequest {
            command: OptimizerCommand::Start,
            use_bh: false,
            layout: LayoutMode::View,
            random: 0,
            problem: OptimizerProblem {
                grid_type: GridType::Rectangular,
                flaps: vec![
                    FlapRequest {
                        id: 1,
                        width: 0.0,
                        height: 0.0,
                    },
                    FlapRequest {
                        id: 2,
                        width: 0.0,
                        height: 0.0,
                    },
                ],
                hierarchies: vec![Hierarchy {
                    leaves: vec![1, 2],
                    dist_map: vec![(1, 2, 10.0)],
                    parents: Vec::new(),
                }],
            },
            vec: Some(vec![Point { x: 0.0, y: 0.0 }, Point { x: 0.3, y: 0.4 }]),
            symmetry: None,
        };
        let problem = KernelProblem::from_request(&request).unwrap();

        let x = read_initial_vector(&request, &problem.hierarchies[0]).unwrap();

        assert_eq!(x, vec![0.0, 0.0, 0.3, 0.4, 0.05]);
        assert_eq!(get_scale(&x), 20.0);
    }

    #[test]
    fn kernel_pack_uses_bp_slsqp_bounds_and_objective() {
        let hierarchy = kernel_hierarchy(
            vec![KernelFlap {
                id: 1,
                width: 0,
                height: 0,
            }],
            Vec::new(),
        );

        let result = pack(vec![0.2, 0.3, 0.025], &hierarchy).unwrap();

        assert!(result.success, "{:?}", result.status);
        assert!(
            matches!(
                result.status,
                PackStatus::Success
                    | PackStatus::FtolReached
                    | PackStatus::XtolReached
                    | PackStatus::MaxEvalReached
            ),
            "{:?}",
            result.status
        );
        assert_eq!(result.x, vec![0.2, 0.3, 0.25]);
        assert_eq!(result.fun, -0.25);
    }

    #[test]
    fn kernel_pack_rejects_mismatched_vectors_with_typed_error() {
        let hierarchy = kernel_hierarchy(
            vec![KernelFlap {
                id: 1,
                width: 0,
                height: 0,
            }],
            Vec::new(),
        );

        let err = pack(vec![0.0, 0.0], &hierarchy).unwrap_err();

        assert!(err.to_string().contains("optimizer pack vector"));
    }

    #[test]
    fn kernel_rssl_pack_solves_active_circle_constraint_candidate() {
        let hierarchy = kernel_hierarchy(
            vec![
                KernelFlap {
                    id: 1,
                    width: 0,
                    height: 0,
                },
                KernelFlap {
                    id: 2,
                    width: 0,
                    height: 0,
                },
            ],
            vec![(0, 1, 10)],
        );

        let result = pack_rssl(vec![0.0, 0.0, 0.3, 0.4, 0.025], &hierarchy, None, None).unwrap();

        assert!(result.success, "{:?}", result);
        assert_eq!(result.status, PackStatus::Success);
        assert!(circle_constraint(&result.x, 0, 1, 10).value.abs() < 1e-5);
        assert!((result.x[4] - 1.0 / 2.0_f64.sqrt() / 5.0).abs() < 1e-5);
    }

    #[test]
    fn kernel_rssl_pack_supports_fixed_coordinate_equalities() {
        let hierarchy = kernel_hierarchy(
            vec![KernelFlap {
                id: 1,
                width: 0,
                height: 0,
            }],
            Vec::new(),
        );

        let result = pack_rssl(
            vec![0.1, 0.2, 0.025],
            &hierarchy,
            Some(&[true]),
            Some(&[2.0, 3.0, 4.0]),
        )
        .unwrap();

        assert!(result.success, "{:?}", result);
        assert_eq!(result.status, PackStatus::Success);
        assert!((result.x[0] - 0.5).abs() < 1e-5, "{:?}", result.x);
        assert!((result.x[1] - 0.75).abs() < 1e-5, "{:?}", result.x);
        assert!((result.x[2] - 0.25).abs() < 1e-5, "{:?}", result.x);
    }

    #[test]
    fn kernel_rssl_greedy_integer_fitting_matches_simple_bp_oracle_case() {
        let hierarchy = kernel_hierarchy(
            vec![
                KernelFlap {
                    id: 1,
                    width: 0,
                    height: 0,
                },
                KernelFlap {
                    id: 2,
                    width: 0,
                    height: 0,
                },
            ],
            vec![(0, 1, 10)],
        );
        let continuous = pack_rssl(vec![0.0, 0.0, 0.3, 0.4, 0.05], &hierarchy, None, None).unwrap();

        let result = greedy_solve_integer_rssl(&continuous.x, &hierarchy).unwrap();

        assert_eq!(result, vec![0, 0, 8, 7, 8]);
    }

    #[test]
    fn kernel_circle_constraint_matches_bp_value_and_gradient() {
        let evaluated = circle_constraint(&[0.2, 0.3, 0.7, 0.3, 0.1], 0, 1, 5);

        assert!(evaluated.value.abs() < 1e-10);
        assert_vec_close(&evaluated.gradient, &[1.0, -0.0, -1.0, 0.0, 5.0]);
    }

    #[test]
    fn kernel_rounded_constraint_matches_bp_value_gradient_and_exact_check() {
        let flaps = vec![
            KernelFlap {
                id: 1,
                width: 2,
                height: 3,
            },
            KernelFlap {
                id: 2,
                width: 4,
                height: 5,
            },
        ];
        let evaluated = rounded_constraint(&[0.1, 0.2, 0.7, 0.8, 0.1], 0, 1, 10, &flaps);

        assert!((evaluated.value - 0.75).abs() < 1e-10);
        assert_vec_close(&evaluated.gradient, &[0.8, 0.6, -0.8, -0.6, 23.4]);
        assert_eq!(
            rounded_exact(&[1.0, 2.0, 7.0, 8.0, 0.0], 0, 1, 10, &flaps),
            75.0
        );
        assert_eq!(interval_distance(1.0, 2.0, 7.0, 4.0), -4.0);
    }

    #[test]
    fn kernel_fixed_and_sheet_bound_constraints_match_bp_gradients() {
        let fixed = fixed_constraint(&[0.4, 0.6, 0.2], 0, 1.0, 2.0, 0.5);
        assert_vec_close(&fixed.values, &[-0.3, -0.3]);
        assert_matrix_close(&fixed.gradients, &[&[1.0, 0.0, -1.0], &[0.0, 1.0, -2.0]]);

        let rect = rect_bound_constraint(&[0.8, 0.0, 0.1], 0, 2);
        assert_eq!(rect.value, 0.0);
        assert_vec_close(&rect.gradient, &[1.0, 0.0, 2.0]);

        let diag = diag_bound_constraints(&[0.5, 0.5, 0.1], 0, 2);
        assert_vec_close(&diag.values, &[-0.7, -0.3, -0.3, -0.3]);
        assert_matrix_close(
            &diag.gradients,
            &[
                &[-1.0, -1.0, -2.0],
                &[1.0, 1.0, 2.0],
                &[-1.0, 1.0, 2.0],
                &[1.0, -1.0, 2.0],
            ],
        );
    }

    #[test]
    fn kernel_branching_selection_and_annulus_match_bp_ordering() {
        assert_eq!(select_meg(&[3.0, 4.0, 1.0, 1.0, 10.0], &[false, false]), 1);
        assert_eq!(select_meg(&[3.0, 4.0, 1.0, 1.0, 10.0], &[false, true]), 0);
        assert_eq!(
            annulus(1, 10.0, 20.0),
            vec![
                KernelPoint { x: 9.0, y: 20.0 },
                KernelPoint { x: 9.0, y: 21.0 },
                KernelPoint { x: 9.0, y: 19.0 },
                KernelPoint { x: 10.0, y: 21.0 },
                KernelPoint { x: 10.0, y: 19.0 },
                KernelPoint { x: 11.0, y: 20.0 },
                KernelPoint { x: 11.0, y: 21.0 },
                KernelPoint { x: 11.0, y: 19.0 },
            ]
        );
    }

    #[test]
    fn kernel_branching_context_matches_bp_branch_rules_and_checks() {
        let hierarchy = kernel_hierarchy(
            vec![KernelFlap {
                id: 1,
                width: 0,
                height: 0,
            }],
            Vec::new(),
        );
        let context = BranchingContext::new(&[0.25, 0.75, 0.2], &hierarchy);

        assert_eq!(context.solution, vec![1.25, 3.75, 5.0]);
        assert_eq!(context.get(0), KernelPoint { x: 1.25, y: 3.75 });
        assert_eq!(
            context.branch(None, 1.25, 3.75, 0, 0).unwrap(),
            vec![1.0, 3.0, 5.0]
        );
        assert_eq!(
            context.branch(None, 1.25, 3.75, 0, 3).unwrap(),
            vec![2.0, 4.0, 5.0]
        );
        assert!(context.branch(None, 1.0, 3.75, 0, 1).is_none());
        assert!(context.make_xk(None, -1.0, 3.0, 0).is_none());
        assert_eq!(context.output(), vec![1, 4, 4]);
        assert_eq!(convert_if_almost_integer(2.000001), 2.0);
        assert_eq!(convert_if_almost_integer(2.00002), 2.00002);
    }

    #[test]
    fn kernel_hierarchy_check_matches_bp_fixed_distance_filter() {
        let hierarchy = kernel_hierarchy(
            vec![
                KernelFlap {
                    id: 1,
                    width: 0,
                    height: 0,
                },
                KernelFlap {
                    id: 2,
                    width: 0,
                    height: 0,
                },
            ],
            vec![(0, 1, 10)],
        );

        assert!(!hierarchy.check(&[0.0, 0.0, 3.0, 4.0, 5.0], 1, &[true, false]));
        assert!(hierarchy.check(&[0.0, 0.0, 6.0, 8.0, 10.0], 1, &[true, false]));
        assert!(!hierarchy.check(&[-1.0, 0.0, 6.0, 8.0, 10.0], 0, &[false, false]));
    }

    #[test]
    fn kernel_heuristic_circle_generation_matches_bp_parent_lookup() {
        let mut hierarchy = kernel_hierarchy(
            vec![
                KernelFlap {
                    id: 1,
                    width: 0,
                    height: 0,
                },
                KernelFlap {
                    id: 8,
                    width: 0,
                    height: 0,
                },
            ],
            Vec::new(),
        );
        hierarchy.parents = vec![KernelParent {
            id: 9,
            radius: 2.0,
            children: vec![1],
        }];
        hierarchy.parent_map.insert(1, 0);
        let last_hierarchy = kernel_hierarchy(
            vec![
                KernelFlap {
                    id: 9,
                    width: 0,
                    height: 0,
                },
                KernelFlap {
                    id: 8,
                    width: 0,
                    height: 0,
                },
            ],
            Vec::new(),
        );

        let circles =
            make_circles(&[0.25, 0.5, 0.75, 0.9, 0.1], &hierarchy, &last_hierarchy).unwrap();

        assert_eq!(
            circles,
            vec![
                KernelCircle {
                    x: 0.25,
                    y: 0.5,
                    radius: 0.2
                },
                KernelCircle {
                    x: 0.75,
                    y: 0.9,
                    radius: 0.0
                },
            ]
        );
    }

    #[test]
    fn kernel_heuristic_random_helpers_accept_injected_bp_random_streams() {
        let mut randoms = [0.0, 0.25].into_iter();
        let vec = generate_in_circles(
            &[
                KernelCircle {
                    x: 1.0,
                    y: 2.0,
                    radius: 4.0,
                },
                KernelCircle {
                    x: 9.0,
                    y: 8.0,
                    radius: 0.0,
                },
            ],
            || randoms.next().unwrap(),
        );

        assert_vec_close(&vec, &[3.0, 2.0, 9.0, 8.0, 0.0]);

        let mut randoms = [0.1, 0.2, 0.3].into_iter();
        assert_eq!(
            generate_random_vector(3, || randoms.next().unwrap()),
            vec![0.1, 0.2, 0.3]
        );
        assert_eq!(estimate_total(8, 2.0, 3), 14);
    }

    #[test]
    fn kernel_bp_random_matches_emscripten_musl_rand_sequence() {
        let mut rng = BpRandom::new(0);

        assert_eq!(
            [rng.next_int(), rng.next_int(), rng.next_int()],
            [2_049_033_599, 2_025_915_578, 1_407_788_582]
        );

        let mut rng = BpRandom::new(1);
        assert_eq!([rng.next_int(), rng.next_int()], [0, 740_882_966]);
    }

    fn assert_vec_close(actual: &[f64], expected: &[f64]) {
        assert_eq!(actual.len(), expected.len());
        for (actual, expected) in actual.iter().zip(expected) {
            assert!((actual - expected).abs() < 1e-10, "{actual} != {expected}");
        }
    }

    fn assert_matrix_close(actual: &[Vec<f64>], expected: &[&[f64]]) {
        assert_eq!(actual.len(), expected.len());
        for (actual, expected) in actual.iter().zip(expected) {
            assert_vec_close(actual, expected);
        }
    }

    fn kernel_hierarchy(
        flaps: Vec<KernelFlap>,
        dist_map: Vec<(usize, usize, i32)>,
    ) -> KernelHierarchy {
        KernelHierarchy {
            sheet: OptimizerSheet::Rect,
            flaps,
            dist_map,
            parents: Vec::new(),
            parent_map: Default::default(),
        }
    }
}
