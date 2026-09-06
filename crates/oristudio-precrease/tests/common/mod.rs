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

/// Plan one component fully and return the planner and its sequence.
pub fn plan_component(component: &Component, opts: PlannerOptions) -> (Planner, Sequence) {
    let mut planner = Planner::new(component, opts);
    planner.plan().expect("plan");
    let seq = planner.sequence(false);
    (planner, seq)
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
