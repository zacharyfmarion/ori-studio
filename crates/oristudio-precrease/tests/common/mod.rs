//! Shared helpers for the planner's integration tests.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use oristudio_precrease::clock::frozen_clock;
use oristudio_precrease::fixture_io::{LoadedCp, load_path};
use oristudio_precrease::planner::{Planner, PlannerOptions};
use oristudio_precrease::sequence::Sequence;
use oristudio_precrease::{Component, Line, SheetAnalysis, analyze};

pub const ORIEDITA_PAPER: [f64; 4] = [-200.0, -200.0, 200.0, 200.0];

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

pub fn fixture_dir() -> PathBuf {
    repo_root().join("tests/fixtures/precrease")
}

/// Load a file given relative to the repo root.
pub fn load(relative: &str) -> LoadedCp {
    let path = repo_root().join(relative);
    load_path(&path, None).unwrap_or_else(|e| panic!("{e}"))
}

pub fn analyze_cp(cp: &LoadedCp) -> SheetAnalysis {
    analyze(&cp.segments, &cp.colors, Some(ORIEDITA_PAPER)).expect("analysis")
}

/// Deterministic options: a frozen clock, unbounded budgets.
pub fn unbounded_options() -> PlannerOptions {
    PlannerOptions {
        clock: frozen_clock(),
        stuck_budget_ms: 0.0,
        total_budget_ms: 0.0,
        ..PlannerOptions::default()
    }
}

/// The same, with the precrease grid off: the plan folds every line one at
/// a time, which is what the per-line schedule tests pin.
pub fn grid_off_options() -> PlannerOptions {
    PlannerOptions {
        precrease_grid: false,
        ..unbounded_options()
    }
}

/// Plan one component fully and return the planner and its sequence.
pub fn plan_component(component: &Component, opts: PlannerOptions) -> (Planner, Sequence) {
    let mut planner = Planner::new(component, opts);
    planner.plan_without_reference_finder().expect("plan");
    let seq = planner.sequence(false);
    (planner, seq)
}

/// Nudge every crease off the lattice by about `amount` of the paper, leaving
/// the sheet's own outline exactly where it was.
///
/// Each non-border segment is translated as a rigid piece — so a crease stays
/// straight — and any endpoint coordinate that sat on the paper boundary is
/// put back, so the creases still run edge to edge. The offset is scaled by an
/// irrational factor to keep the result off any finer rational lattice, which
/// would make the design exact again. The recipe is `hand_built.rs`'s jittered
/// grid, generalised so a snappable component can be built out of a fixture's
/// real crease colours.
pub fn jitter_creases(segments: &[f64], colors: &[i32], amount: f64) -> Vec<f64> {
    let bound = |pick: fn(f64, f64) -> f64, k: usize| {
        segments
            .chunks(4)
            .flat_map(|s| [s[k], s[k + 2]])
            .fold(f64::NAN, |a, b| if a.is_nan() { b } else { pick(a, b) })
    };
    let (x0, x1) = (bound(f64::min, 0), bound(f64::max, 0));
    let (y0, y1) = (bound(f64::min, 1), bound(f64::max, 1));
    let span = (x1 - x0).max(y1 - y0);
    let scale = amount * span * std::f64::consts::PI / 3.0;
    let on = |v: f64, edge: f64| (v - edge).abs() < 1e-9;

    let mut out = Vec::with_capacity(segments.len());
    for (i, seg) in segments.chunks(4).enumerate() {
        let mut piece = [seg[0], seg[1], seg[2], seg[3]];
        if colors.get(i).copied().unwrap_or(0) != 0 {
            let mut rng = Rng((i as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
            rng.next_u64();
            let dx = (rng.unit() - 0.5) * 2.0 * scale;
            let dy = (rng.unit() - 0.5) * 2.0 * scale;
            for k in [0usize, 2] {
                piece[k] = if on(seg[k], x0) || on(seg[k], x1) {
                    seg[k]
                } else {
                    seg[k] + dx
                };
                piece[k + 1] = if on(seg[k + 1], y0) || on(seg[k + 1], y1) {
                    seg[k + 1]
                } else {
                    seg[k + 1] + dy
                };
            }
        }
        out.extend_from_slice(&piece);
    }
    out
}

/// A small deterministic xorshift generator for the property tests.
pub struct Rng(pub u64);

impl Rng {
    pub fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next_u64() % n as u64) as usize
        }
    }

    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i + 1);
            items.swap(i, j);
        }
    }
}

/// Permute the segments of a crease pattern (and their colours) by `rng`.
pub fn shuffled(cp: &LoadedCp, rng: &mut Rng) -> LoadedCp {
    let n = cp.colors.len();
    let mut order: Vec<usize> = (0..n).collect();
    rng.shuffle(&mut order);
    let mut segments = Vec::with_capacity(cp.segments.len());
    let mut colors = Vec::with_capacity(n);
    for &i in &order {
        segments.extend_from_slice(&cp.segments[4 * i..4 * i + 4]);
        colors.push(cp.colors[i]);
    }
    LoadedCp { segments, colors }
}

/// Duplicate every k-th non-border segment and split every j-th one into
/// two collinear halves: the same distinct lines, more segments.
pub fn with_duplicates_and_splits(cp: &LoadedCp, k: usize, j: usize) -> LoadedCp {
    let mut segments = cp.segments.clone();
    let mut colors = cp.colors.clone();
    for i in 0..cp.colors.len() {
        if cp.colors[i] == 0 {
            continue;
        }
        let s = &cp.segments[4 * i..4 * i + 4];
        if k > 0 && i % k == 0 {
            segments.extend_from_slice(s);
            colors.push(cp.colors[i]);
        }
        if j > 0 && i % j == 1 {
            let mid = [(s[0] + s[2]) / 2.0, (s[1] + s[3]) / 2.0];
            segments.extend_from_slice(&[s[0], s[1], mid[0], mid[1]]);
            colors.push(cp.colors[i]);
            segments.extend_from_slice(&[mid[0], mid[1], s[2], s[3]]);
            colors.push(cp.colors[i]);
        }
    }
    LoadedCp { segments, colors }
}

/// Sorted canonical keys of a set of lines, for set comparison.
pub fn line_keys(lines: impl Iterator<Item = Line>) -> Vec<u64> {
    let mut keys: Vec<u64> = lines.map(|l| l.key()).collect();
    keys.sort_unstable();
    keys
}

/// Whether two line sets are equal within tolerance.
pub fn same_line_set(a: &[Line], b: &[Line]) -> bool {
    a.len() == b.len() && a.iter().all(|l| b.iter().any(|m| m.approx_eq(l)))
}
