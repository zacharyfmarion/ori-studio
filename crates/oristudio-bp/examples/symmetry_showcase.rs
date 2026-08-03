//! Emits synthetic symmetric-layout results as JSON, for visual inspection
//! while the Optimize Layout UI does not exist yet.
//!
//! For each synthetic tree it solves the packing unconstrained and then under
//! each mirror axis, and reports the fitted grid layout plus the sheet size.

use oristudio_bp::optimizer::kernel::{
    BpRandom, KernelFlap, KernelHierarchy, KernelSymmetry, OptimizerSheet,
    greedy_solve_integer_rssl, greedy_solve_integer_symmetric, pack_rssl, pack_rssl_symmetric,
    setup_initial_scale, symmetrize,
};
use oristudio_bp::optimizer::{OptimizerSymmetry, SymmetryAxis};
use std::time::Instant;

/// Fewer restarts as the problem grows: SLSQP here works on finite-difference
/// gradients, so a solve costs roughly O(flaps^2) constraints x O(flaps)
/// evaluations per gradient.
fn trials_for(flaps: usize) -> u32 {
    match flaps {
        0..=8 => 24,
        9..=12 => 16,
        13..=16 => 10,
        17..=22 => 6,
        _ => 4,
    }
}

const AXES: [SymmetryAxis; 4] = [
    SymmetryAxis::VerticalHalf,
    SymmetryAxis::HorizontalHalf,
    SymmetryAxis::MainDiagonal,
    SymmetryAxis::AntiDiagonal,
];

#[derive(Clone)]
struct Leaf {
    id: u32,
    label: String,
    length: i32,
    width: i32,
    height: i32,
}

struct Case {
    name: String,
    note: String,
    sheet: OptimizerSheet,
    leaves: Vec<Leaf>,
    dist: Vec<(usize, usize, i32)>,
    partners: Vec<(u32, u32)>,
}

/// What a mirror axis means *on the paper*, which depends on the grid.
///
/// A diagonal-grid sheet is the paper turned 45 degrees against the box-pleating
/// grid, so its corners point along the grid axes. A fold joining two of those
/// corners therefore runs along a grid line — it is a diagonal fold of the paper
/// drawn as a vertical or horizontal line. On a rectangular sheet the paper and
/// the grid share axes, so the roles are exactly swapped.
fn axis_label(sheet: OptimizerSheet, axis: SymmetryAxis) -> String {
    let orientation = match axis {
        SymmetryAxis::VerticalHalf => "vertical",
        SymmetryAxis::HorizontalHalf => "horizontal",
        SymmetryAxis::MainDiagonal => "rising",
        SymmetryAxis::AntiDiagonal => "falling",
    };
    let axis_aligned = matches!(
        axis,
        SymmetryAxis::VerticalHalf | SymmetryAxis::HorizontalHalf
    );
    let kind = match (sheet, axis_aligned) {
        (OptimizerSheet::Rect, true) | (OptimizerSheet::Diag, false) => "book",
        _ => "diagonal",
    };
    format!("{kind} fold, {orientation}")
}

fn leaf(id: u32, label: &str, length: i32) -> Leaf {
    Leaf {
        id,
        label: label.to_string(),
        length,
        width: 0,
        height: 0,
    }
}

fn sized(id: u32, label: &str, length: i32, width: i32, height: i32) -> Leaf {
    Leaf {
        id,
        label: label.to_string(),
        length,
        width,
        height,
    }
}

/// A "bug": a spine carrying a left/right leg per vertebra, plus a head and a
/// tail on the spine ends. The mirror swaps left and right legs and leaves the
/// head and tail on the axis.
fn bug(vertebrae: usize, spine: i32, leg: i32, head: i32) -> Case {
    let mut leaves = vec![leaf(1, "head", head), leaf(2, "tail", head)];
    let mut partners = vec![(1, 1), (2, 2)];
    // spine offset of each leaf from the head end
    let mut offset = vec![0, spine * (vertebrae as i32 - 1)];
    for v in 0..vertebrae {
        let left = 10 + 2 * v as u32;
        let right = left + 1;
        leaves.push(leaf(left, &format!("L{v}"), leg));
        leaves.push(leaf(right, &format!("R{v}"), leg));
        partners.push((left, right));
        partners.push((right, left));
        offset.push(spine * v as i32);
        offset.push(spine * v as i32);
    }
    let mut dist = Vec::new();
    for i in 0..leaves.len() {
        for j in (i + 1)..leaves.len() {
            let along = (offset[i] - offset[j]).abs();
            dist.push((i, j, leaves[i].length + along + leaves[j].length));
        }
    }
    Case {
        name: format!("Bug, {vertebrae} vertebrae"),
        sheet: OptimizerSheet::Rect,
        note: "Head and tail sit on the axis; each pair of legs mirrors.".to_string(),
        leaves,
        dist,
        partners,
    }
}

/// `n` equal flaps off one branch point, with one left on the axis when `n` is odd.
fn star(n: usize, leg: i32) -> Case {
    let leaves = (0..n)
        .map(|i| leaf(i as u32 + 1, &format!("f{i}"), leg))
        .collect::<Vec<_>>();
    let mut partners = Vec::new();
    let pairs = n / 2;
    for p in 0..pairs {
        let a = leaves[2 * p].id;
        let b = leaves[2 * p + 1].id;
        partners.push((a, b));
        partners.push((b, a));
    }
    if n % 2 == 1 {
        let last = leaves[n - 1].id;
        partners.push((last, last));
    }
    let mut dist = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            dist.push((i, j, 2 * leg));
        }
    }
    Case {
        name: format!("Star, {n} flaps"),
        sheet: OptimizerSheet::Rect,
        note: if n % 2 == 1 {
            "An odd flap count leaves one flap on the axis.".to_string()
        } else {
            "Every flap has a mirror partner; none sits on the axis.".to_string()
        },
        leaves,
        dist,
        partners,
    }
}

/// A creature with legs of several different lengths plus antennae, so the tree
/// is not a uniform comb. Legs mirror in pairs; head and tail sit on the axis.
fn creature(segments: &[(i32, i32)], spine: i32, head: i32, tail: i32) -> Case {
    let mut leaves = vec![leaf(1, "head", head), leaf(2, "tail", tail)];
    let mut partners = vec![(1, 1), (2, 2)];
    let span = spine * (segments.len() as i32 - 1);
    let mut offset = vec![0, span];
    for (v, &(length, _)) in segments.iter().enumerate() {
        let left = 10 + 2 * v as u32;
        let right = left + 1;
        leaves.push(leaf(left, &format!("a{v}"), length));
        leaves.push(leaf(right, &format!("b{v}"), length));
        partners.push((left, right));
        partners.push((right, left));
        offset.push(spine * v as i32);
        offset.push(spine * v as i32);
    }
    let mut dist = Vec::new();
    for i in 0..leaves.len() {
        for j in (i + 1)..leaves.len() {
            let along = (offset[i] - offset[j]).abs();
            dist.push((i, j, leaves[i].length + along + leaves[j].length));
        }
    }
    Case {
        name: format!("Creature, {} leg pairs", segments.len()),
        sheet: OptimizerSheet::Rect,
        note: "Leg pairs of several different lengths; head and tail on the axis.".to_string(),
        leaves,
        dist,
        partners,
    }
}

/// Two square flaps with real width and height, mirrored across a book axis.
fn sized_pair() -> Case {
    let leaves = vec![
        sized(1, "wing L", 10, 6, 3),
        sized(2, "wing R", 10, 6, 3),
        leaf(3, "head", 8),
        leaf(4, "tail", 8),
    ];
    let mut dist = Vec::new();
    for i in 0..leaves.len() {
        for j in (i + 1)..leaves.len() {
            dist.push((i, j, leaves[i].length + leaves[j].length));
        }
    }
    Case {
        name: "Winged, with flap dimensions".to_string(),
        sheet: OptimizerSheet::Rect,
        note: "The wings are 6x3 rectangles; a book mirror keeps their dimensions.".to_string(),
        leaves,
        dist,
        partners: vec![(1, 2), (2, 1), (3, 3), (4, 4)],
    }
}

/// Re-cast a case onto a diagonal-grid sheet: same tree, paper turned 45 degrees.
fn on_diagonal_sheet(mut case: Case, name: &str, note: &str) -> Case {
    case.sheet = OptimizerSheet::Diag;
    case.name = name.to_string();
    case.note = note.to_string();
    case
}

fn hierarchy(case: &Case) -> KernelHierarchy {
    KernelHierarchy {
        sheet: case.sheet,
        flaps: case
            .leaves
            .iter()
            .map(|leaf| KernelFlap {
                id: leaf.id,
                width: leaf.width,
                height: leaf.height,
            })
            .collect(),
        dist_map: case.dist.clone(),
        parents: Vec::new(),
        parent_map: Default::default(),
    }
}

fn random_start(hierarchy: &KernelHierarchy, rng: &mut BpRandom) -> Vec<f64> {
    let mut x = Vec::new();
    for _ in 0..hierarchy.flaps.len() {
        x.push(rng.random01());
        x.push(rng.random01());
    }
    x.push(0.0);
    setup_initial_scale(&mut x, hierarchy);
    x
}

#[expect(clippy::too_many_arguments, reason = "throwaway showcase generator")]
fn json_layout(
    label: &str,
    axis: Option<&str>,
    size: i32,
    coords: &[i32],
    case: &Case,
    trials: u32,
    solved: u32,
    presolve_us: u128,
    fit_us: u128,
) -> String {
    let flaps = case
        .leaves
        .iter()
        .enumerate()
        .map(|(index, leaf)| {
            let partner = case
                .partners
                .iter()
                .find(|(id, _)| *id == leaf.id)
                .map_or(leaf.id, |(_, mate)| *mate);
            format!(
                r#"{{"id":{},"label":"{}","x":{},"y":{},"radius":{},"width":{},"height":{},"partner":{}}}"#,
                leaf.id,
                leaf.label,
                coords[index * 2],
                coords[index * 2 + 1],
                leaf.length,
                leaf.width,
                leaf.height,
                partner
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let axis = axis.map_or("null".to_string(), |a| format!("\"{a}\""));
    let runs = solved.max(1) as f64;
    let presolve_ms = presolve_us as f64 / 1000.0 / runs;
    let fit_ms = fit_us as f64 / 1000.0 / runs;
    format!(
        r#"{{"label":"{label}","axis":{axis},"size":{size},"trials":{trials},"solved":{solved},"presolveMs":{presolve_ms:.2},"fitMs":{fit_ms:.2},"flaps":[{flaps}]}}"#
    )
}

fn main() {
    let cases = vec![
        bug(2, 8, 10, 12),
        bug(3, 8, 10, 12),
        star(5, 10),
        star(6, 10),
        sized_pair(),
        bug(4, 7, 12, 14),
        creature(&[(14, 0), (9, 0), (11, 0), (16, 0)], 6, 15, 9),
        star(12, 10),
        bug(6, 6, 11, 13),
        creature(
            &[(15, 0), (10, 0), (10, 0), (13, 0), (8, 0), (17, 0)],
            5,
            16,
            10,
        ),
        on_diagonal_sheet(
            star(6, 10),
            "Star, 6 flaps — diagonal grid",
            "Same tree on a diagonal-grid sheet: the paper is turned 45 degrees              against the grid, so it is drawn as a diamond.",
        ),
        on_diagonal_sheet(
            bug(3, 8, 10, 12),
            "Bug, 3 vertebrae — diagonal grid",
            "On a diamond the roles swap: a fold joining two paper corners runs              along a grid line.",
        ),
        on_diagonal_sheet(
            creature(&[(14, 0), (9, 0), (11, 0), (16, 0)], 6, 15, 9),
            "Creature, 4 leg pairs — diagonal grid",
            "Leg pairs of several different lengths, packed into a diamond.",
        ),
    ];
    let mut out = Vec::new();

    for case in &cases {
        let h = hierarchy(case);
        let flap_count = h.flaps.len();
        let trials = trials_for(flap_count);
        eprintln!("{} ({flap_count} flaps, {trials} trials)", case.name);
        let mut layouts = Vec::new();

        // unconstrained baseline
        let mut best: Option<(i32, Vec<i32>)> = None;
        let mut presolve = 0u128;
        let mut fit = 0u128;
        let mut ok = 0u32;
        for trial in 0..trials {
            let mut rng = BpRandom::new(1000 + trial);
            let x = random_start(&h, &mut rng);
            let t = Instant::now();
            let packed = pack_rssl(x, &h, None, None);
            presolve += t.elapsed().as_micros();
            let Ok(packed) = packed else { continue };
            if !packed.success {
                continue;
            }
            let t = Instant::now();
            let fitted = greedy_solve_integer_rssl(&packed.x, &h);
            fit += t.elapsed().as_micros();
            let Ok(fitted) = fitted else { continue };
            ok += 1;
            let size = fitted[fitted.len() - 1];
            if best.as_ref().is_none_or(|(b, _)| size < *b) {
                best = Some((size, fitted));
            }
        }
        if let Some((size, fitted)) = best {
            layouts.push(json_layout(
                "No symmetry",
                None,
                size,
                &fitted,
                case,
                trials,
                ok,
                presolve,
                fit,
            ));
        }

        for axis in AXES {
            let axis_label = axis_label(case.sheet, axis);
            let request = OptimizerSymmetry {
                axis,
                partners: case.partners.clone(),
            };
            let Ok(resolved) = KernelSymmetry::from_request(&request, &h) else {
                continue; // these flap dimensions cannot mirror across this axis
            };
            let mut best: Option<(i32, Vec<i32>)> = None;
            let mut presolve = 0u128;
            let mut fit = 0u128;
            let mut ok = 0u32;
            for trial in 0..trials {
                let mut rng = BpRandom::new(1000 + trial);
                let mut x = random_start(&h, &mut rng);
                symmetrize(&mut x, &h, &resolved);
                let t = Instant::now();
                let packed = pack_rssl_symmetric(x, &h, None, None, Some(&resolved));
                presolve += t.elapsed().as_micros();
                let Ok(packed) = packed else { continue };
                if !packed.success {
                    continue;
                }
                let t = Instant::now();
                let fitted = greedy_solve_integer_symmetric(
                    &packed.x,
                    &h,
                    &resolved,
                    &mut || false,
                    &mut |_| {},
                );
                fit += t.elapsed().as_micros();
                let Ok(fitted) = fitted else { continue };
                ok += 1;
                let size = fitted[fitted.len() - 1];
                if best.as_ref().is_none_or(|(b, _)| size < *b) {
                    best = Some((size, fitted));
                }
            }
            if let Some((size, fitted)) = best {
                layouts.push(json_layout(
                    &axis_label,
                    Some(&axis_label),
                    size,
                    &fitted,
                    case,
                    trials,
                    ok,
                    presolve,
                    fit,
                ));
            }
        }

        let sheet = match case.sheet {
            OptimizerSheet::Rect => "rect",
            OptimizerSheet::Diag => "diagonal",
        };
        out.push(format!(
            r#"{{"name":"{}","note":"{}","sheet":"{sheet}","flaps":{},"trials":{},"layouts":[{}]}}"#,
            case.name,
            case.note,
            flap_count,
            trials,
            layouts.join(",")
        ));
    }

    println!("[{}]", out.join(","));
}
