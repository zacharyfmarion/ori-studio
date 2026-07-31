//! SPIKE — throwaway exploration, not production code.
//!
//! Explores adding mirror-symmetry constraints (book / diagonal) to the BP
//! Studio optimizer port. Measures:
//!   1. whether SLSQP converges with the symmetry equalities added,
//!   2. what symmetry costs in sheet size vs an unconstrained solve,
//!   3. whether an orbit-based greedy fit works, and how often it needs the
//!      annulus fallback,
//!   4. what forcing an even sheet size (centered coordinates) costs.

#![allow(dead_code, unused_imports, clippy::all)]

mod detect;

use detect::{Involution, Tree};
use oristudio_bp::optimizer::kernel::{
    BpRandom, KernelFlap, KernelHierarchy, KernelPoint, MAX_SHEET_SIZE, MIN_SHEET_SIZE,
    OptimizerSheet, annulus, get_scale, greedy_solve_integer_rssl, int_scale, interval_distance,
    meg, pack_rssl, rounded_exact, setup_initial_scale,
};

// ---------------------------------------------------------------- axes

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Axis {
    /// x = 1/2 in normalized space (paper book fold, rect sheet).
    BookV,
    /// y = 1/2.
    BookH,
    /// y = x (paper diagonal, rect sheet). Passes through the origin corner.
    Diag,
    /// y = 1 - x.
    AntiDiag,
}

impl Axis {
    fn name(self) -> &'static str {
        match self {
            Self::BookV => "book-v",
            Self::BookH => "book-h",
            Self::Diag => "diag",
            Self::AntiDiag => "antidiag",
        }
    }

    /// Which grid axes must be measured from the sheet centre so that the
    /// mirror map is independent of the (still-floating) sheet size.
    fn centered(self) -> (bool, bool) {
        match self {
            Self::BookV => (true, false),
            Self::BookH => (false, true),
            Self::Diag => (false, false),
            Self::AntiDiag => (true, true),
        }
    }

    /// Mirror of a flap anchor in normalized space (unit sheet).
    fn mirror_norm(self, x: f64, y: f64, w: f64, h: f64, m: f64) -> (f64, f64) {
        match self {
            Self::BookV => (1.0 - x - w * m, y),
            Self::BookH => (x, 1.0 - y - h * m),
            Self::Diag => (y, x),
            Self::AntiDiag => (1.0 - y - h * m, 1.0 - x - w * m),
        }
    }

    /// Mirror of a flap anchor in grid space, using this axis's offsets.
    /// Independent of the sheet size by construction.
    fn mirror_grid(self, x: f64, y: f64, w: f64, h: f64) -> (f64, f64) {
        match self {
            Self::BookV => (-x - w, y),
            Self::BookH => (x, -y - h),
            Self::Diag => (y, x),
            Self::AntiDiag => (-y - h, -x - w),
        }
    }

    /// Does the mirrored flap swap width and height?
    fn swaps_dims(self) -> bool {
        matches!(self, Self::Diag | Self::AntiDiag)
    }
}

#[derive(Debug, Clone)]
struct Symmetry {
    axis: Axis,
    /// Involution on flap indices. `partner[i] == i` means "sits on the axis".
    partner: Vec<usize>,
}

impl Symmetry {
    fn on_axis(&self, i: usize) -> bool {
        self.partner[i] == i
    }

    /// Orbit representatives: on-axis flaps, plus the lower index of each pair.
    fn representatives(&self) -> Vec<usize> {
        (0..self.partner.len())
            .filter(|&i| self.partner[i] >= i)
            .collect()
    }
}

// ---------------------------------------------------------------- symmetric pack

fn dim_of(h: &KernelHierarchy) -> usize {
    h.flaps.len() * 2 + 1
}

/// Symmetry residuals that must equal zero. Skips orbits whose members are all
/// pinned (their pins already imply the symmetry).
fn symmetry_residuals(
    x: &[f64],
    h: &KernelHierarchy,
    sym: &Symmetry,
    fixed: Option<&[bool]>,
) -> Vec<f64> {
    let m = x[x.len() - 1];
    let mut out = Vec::new();
    for i in 0..h.flaps.len() {
        let j = sym.partner[i];
        if j < i {
            continue;
        }
        let is_fixed = |k: usize| fixed.map(|f| f[k]).unwrap_or(false);
        if is_fixed(i) && is_fixed(j) {
            continue;
        }
        let (w, hh) = (f64::from(h.flaps[i].width), f64::from(h.flaps[i].height));
        let (mx, my) = sym.axis.mirror_norm(x[i * 2], x[i * 2 + 1], w, hh, m);
        if i == j {
            // On the axis: only the non-trivial residual.
            match sym.axis {
                Axis::BookV => out.push(x[i * 2] - mx),
                Axis::BookH => out.push(x[i * 2 + 1] - my),
                Axis::Diag => out.push(x[i * 2] - x[i * 2 + 1]),
                Axis::AntiDiag => out.push(x[i * 2] - mx),
            }
        } else {
            out.push(x[j * 2] - mx);
            out.push(x[j * 2 + 1] - my);
        }
    }
    out
}

/// Which (flap, component) pairs contribute a symmetry equality.
/// component 0 = x, 1 = y. On-axis flaps contribute exactly one.
fn residual_descriptors(
    h: &KernelHierarchy,
    sym: &Symmetry,
    fixed: Option<&[bool]>,
) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for i in 0..h.flaps.len() {
        let j = sym.partner[i];
        if j < i {
            continue;
        }
        let is_fixed = |k: usize| fixed.map(|f| f[k]).unwrap_or(false);
        if is_fixed(i) && is_fixed(j) {
            continue;
        }
        if i == j {
            // one equation; pick the component the axis actually constrains
            out.push(match sym.axis {
                Axis::BookH => (i, 1),
                _ => (i, 0),
            });
        } else {
            out.push((i, 0));
            out.push((i, 1));
        }
    }
    out
}

struct Pins {
    /// grid coordinates keyed by flap index
    coords: Vec<Option<(f64, f64)>>,
    off_x: f64,
    off_y: f64,
}

/// Pack with symmetry equalities (and optional grid pins) added.
fn sym_pack(
    mut x: Vec<f64>,
    h: &KernelHierarchy,
    sym: &Symmetry,
    fixed: Option<&[bool]>,
    pins: Option<&Pins>,
) -> Option<Vec<f64>> {
    let dim = dim_of(h);
    let last = dim - 1;
    let mut bounds = vec![(0.0, 1.0); dim];
    bounds[last] = (
        1.0 / f64::from(MAX_SHEET_SIZE),
        1.0 / f64::from(MIN_SHEET_SIZE),
    );
    for (index, value) in x.iter_mut().enumerate() {
        *value = value.max(bounds[index].0).min(bounds[index].1);
    }

    let mut constraints: Vec<slsqp_rssl::Constraint> = Vec::new();

    // pair separations (skip pairs where both endpoints are pinned)
    for &(i, j, dist) in &h.dist_map {
        let both_fixed = fixed.map(|f| f[i] && f[j]).unwrap_or(false);
        if both_fixed {
            continue;
        }
        let flaps = h.flaps.clone();
        constraints.push(slsqp_rssl::Constraint::Ineq(Box::new(
            move |x: &[f64]| {
                // rounded form (identical to the circle form when all dims are 0)
                let m = x[x.len() - 1];
                let dx = interval_distance(
                    x[i * 2],
                    m * f64::from(flaps[i].width),
                    x[j * 2],
                    m * f64::from(flaps[j].width),
                );
                let dy = interval_distance(
                    x[i * 2 + 1],
                    m * f64::from(flaps[i].height),
                    x[j * 2 + 1],
                    m * f64::from(flaps[j].height),
                );
                let d = f64::from(dist) * m;
                -(d * d - dx * dx - dy * dy)
            },
        )));
    }

    // sheet bounds for unpinned flaps
    for index in 0..h.flaps.len() {
        if fixed.map(|f| f[index]).unwrap_or(false) {
            continue;
        }
        let flap = h.flaps[index];
        if flap.width != 0 {
            let ci = index * 2;
            let d = f64::from(flap.width);
            constraints.push(slsqp_rssl::Constraint::Ineq(Box::new(
                move |x: &[f64]| -(x[ci] + d * x[x.len() - 1] - 1.0),
            )));
        }
        if flap.height != 0 {
            let ci = index * 2 + 1;
            let d = f64::from(flap.height);
            constraints.push(slsqp_rssl::Constraint::Ineq(Box::new(
                move |x: &[f64]| -(x[ci] + d * x[x.len() - 1] - 1.0),
            )));
        }
    }

    // symmetry equalities: one closure per residual, each evaluating only its
    // own orbit (recomputing the whole vector per residual is O(n^2) and
    // dominates runtime under finite-difference gradients)
    for (i, component) in residual_descriptors(h, sym, fixed) {
        let axis = sym.axis;
        let partner = sym.partner[i];
        let w = f64::from(h.flaps[i].width);
        let hh = f64::from(h.flaps[i].height);
        constraints.push(slsqp_rssl::Constraint::Eq(Box::new(move |x: &[f64]| {
            let m = x[x.len() - 1];
            let (mx, my) = axis.mirror_norm(x[i * 2], x[i * 2 + 1], w, hh, m);
            let target = if component == 0 { mx } else { my };
            let source = if partner == i {
                // on the axis: the flap is its own mirror image
                if component == 0 {
                    x[i * 2]
                } else {
                    x[i * 2 + 1]
                }
            } else if component == 0 {
                x[partner * 2]
            } else {
                x[partner * 2 + 1]
            };
            source - target
        })));
    }

    // grid pins
    if let (Some(fixed), Some(pins)) = (fixed, pins) {
        for index in 0..h.flaps.len() {
            if !fixed[index] {
                continue;
            }
            let Some((vx, vy)) = pins.coords[index] else {
                continue;
            };
            let (ci, ox, oy) = (index * 2, pins.off_x, pins.off_y);
            constraints.push(slsqp_rssl::Constraint::Eq(Box::new(move |x: &[f64]| {
                x[ci] - ox - vx * x[x.len() - 1]
            })));
            constraints.push(slsqp_rssl::Constraint::Eq(Box::new(move |x: &[f64]| {
                x[ci + 1] - oy - vy * x[x.len() - 1]
            })));
        }
    }

    let result = slsqp_rssl::fmin_slsqp(
        |x: &[f64]| -x[x.len() - 1],
        &x,
        &bounds,
        constraints,
        200,
        1e-6,
        None,
    );
    if result.status == slsqp_rssl::SlsqpMode::Success as i32 {
        Some(result.x)
    } else {
        None
    }
}

// ---------------------------------------------------------------- symmetric fit

struct FitStats {
    size: i32,
    fallbacks: usize,
    failed: bool,
}

fn to_grid(x: &[f64], off_x: f64, off_y: f64) -> Vec<f64> {
    let grid = get_scale(x);
    let last = x.len() - 1;
    let mut out = Vec::with_capacity(x.len());
    for (index, value) in x.iter().enumerate().take(last) {
        let off = if index % 2 == 0 { off_x } else { off_y };
        out.push((value - off) * grid);
    }
    out.push(grid);
    out
}

fn to_double(x: &[f64], off_x: f64, off_y: f64) -> Vec<f64> {
    let grid = get_scale(x);
    let last = x.len() - 1;
    let mut out = Vec::with_capacity(x.len());
    for (index, value) in x.iter().enumerate().take(last) {
        let off = if index % 2 == 0 { off_x } else { off_y };
        out.push(value * grid + off);
    }
    out.push(grid);
    out
}

/// Grow the working sheet size so that this anchor (plus its flap box) fits,
/// honouring which axes are measured from the centre.
fn enlarge(xk: &mut [f64], axis: Axis, x: f64, y: f64, w: f64, h: f64) {
    let last = xk.len() - 1;
    let (cx, cy) = axis.centered();
    let need_x = if cx {
        (-2.0 * x).max(2.0 * (x + w))
    } else {
        x + w
    };
    let need_y = if cy {
        (-2.0 * y).max(2.0 * (y + h))
    } else {
        y + h
    };
    let need = need_x.max(need_y);
    if need > xk[last] {
        xk[last] = need;
    }
}

/// Exact integer validity of flap `n` against every already-pinned flap.
fn valid(xk: &[f64], h: &KernelHierarchy, n: usize, fixed: &[bool]) -> bool {
    for &(i, j, dist) in &h.dist_map {
        let touches = (i == n && fixed[j]) || (j == n && fixed[i]);
        if touches && rounded_exact(xk, i, j, dist, &h.flaps) > 0.0 {
            return false;
        }
    }
    true
}

/// Validity of a whole orbit placement: both members against the pinned set,
/// and (for a pair) against each other.
fn valid_orbit(xk: &[f64], h: &KernelHierarchy, rep: usize, mate: usize, fixed: &[bool]) -> bool {
    if !valid(xk, h, rep, fixed) {
        return false;
    }
    if mate != rep {
        if !valid(xk, h, mate, fixed) {
            return false;
        }
        for &(i, j, dist) in &h.dist_map {
            let pairwise = (i == rep && j == mate) || (i == mate && j == rep);
            if pairwise && rounded_exact(xk, i, j, dist, &h.flaps) > 0.0 {
                return false;
            }
        }
    }
    true
}

const MAX_FALLBACK_STEPS: i32 = 40;

/// The point on the axis at parameter `t` for a flap of size `w` x `h`.
fn axis_point(axis: Axis, t: f64, w: f64, h: f64) -> (f64, f64) {
    match axis {
        Axis::BookV => (-w / 2.0, t),
        Axis::BookH => (t, -h / 2.0),
        Axis::Diag => (t, t),
        Axis::AntiDiag => (-t - h, t),
    }
}

/// Candidate grid placements for an orbit representative.
fn candidates(sym: &Symmetry, rep: usize, px: f64, py: f64, w: f64, h: f64) -> Vec<(f64, f64)> {
    if !sym.on_axis(rep) {
        let mut out = Vec::new();
        for q in 0..4 {
            let x = if q & 1 == 1 { px.ceil() } else { px.floor() };
            let y = if q >> 1 == 1 { py.ceil() } else { py.floor() };
            if !out.contains(&(x, y)) {
                out.push((x, y));
            }
        }
        return out;
    }
    // On the axis: one degree of freedom.
    match sym.axis {
        Axis::BookV => vec![
            axis_point(sym.axis, py.floor(), w, h),
            axis_point(sym.axis, py.ceil(), w, h),
        ],
        Axis::BookH => vec![
            axis_point(sym.axis, px.floor(), w, h),
            axis_point(sym.axis, px.ceil(), w, h),
        ],
        Axis::Diag => {
            let t = (px + py) / 2.0;
            vec![
                axis_point(sym.axis, t.floor(), w, h),
                axis_point(sym.axis, t.ceil(), w, h),
            ]
        }
        Axis::AntiDiag => vec![
            axis_point(sym.axis, py.floor(), w, h),
            axis_point(sym.axis, py.ceil(), w, h),
        ],
    }
}

fn symmetric_fit(x0: &[f64], h: &KernelHierarchy, sym: &Symmetry) -> FitStats {
    let (cx, cy) = sym.axis.centered();
    let (off_x, off_y) = (if cx { 0.5 } else { 0.0 }, if cy { 0.5 } else { 0.0 });
    let n = h.flaps.len();
    let mut solution = to_grid(x0, off_x, off_y);
    let mut fixed = vec![false; n];
    let mut pins = Pins {
        coords: vec![None; n],
        off_x,
        off_y,
    };
    let mut fallbacks = 0usize;
    let mut placed = 0usize;

    while placed < n {
        // choose the unplaced orbit representative closest to the origin
        let mut best = usize::MAX;
        let mut best_d = f64::INFINITY;
        for &i in &sym.representatives() {
            if fixed[i] {
                continue;
            }
            let d = meg(solution[i * 2], solution[i * 2 + 1]);
            if d < best_d {
                best_d = d;
                best = i;
            }
        }
        if best == usize::MAX {
            break;
        }
        let rep = best;
        let mate = sym.partner[rep];
        fixed[rep] = true;
        fixed[mate] = true;

        let w = f64::from(h.flaps[rep].width);
        let hh = f64::from(h.flaps[rep].height);
        let px = solution[rep * 2];
        let py = solution[rep * 2 + 1];

        let mut chosen: Option<Vec<f64>> = None;
        let mut chosen_m = f64::NEG_INFINITY;

        let try_point = |gx: f64,
                         gy: f64,
                         solution: &Vec<f64>,
                         pins: &mut Pins,
                         chosen: &mut Option<Vec<f64>>,
                         chosen_m: &mut f64|
         -> bool {
            let mut xk = solution.clone();
            xk[rep * 2] = gx;
            xk[rep * 2 + 1] = gy;
            let (mx, my) = sym.axis.mirror_grid(gx, gy, w, hh);
            xk[mate * 2] = mx;
            xk[mate * 2 + 1] = my;
            if !valid_orbit(&xk, h, rep, mate, &fixed) {
                return false;
            }
            enlarge(&mut xk, sym.axis, gx, gy, w, hh);
            enlarge(&mut xk, sym.axis, mx, my, w, hh);
            pins.coords[rep] = Some((gx, gy));
            pins.coords[mate] = Some((mx, my));
            let start = to_double(&xk, off_x, off_y);
            let Some(sol) = sym_pack(start, h, sym, Some(&fixed), Some(pins)) else {
                return false;
            };
            let m = sol[sol.len() - 1];
            if m > *chosen_m {
                *chosen_m = m;
                *chosen = Some(sol);
            }
            true
        };

        for (gx, gy) in candidates(sym, rep, px, py, w, hh) {
            try_point(gx, gy, &solution, &mut pins, &mut chosen, &mut chosen_m);
        }

        if chosen.is_none() {
            fallbacks += 1;
            if sym.on_axis(rep) {
                // An on-axis flap has ONE degree of freedom, so the fallback is
                // a 1-D scan outward along the axis. Projecting a 2-D annulus
                // here would retry the same handful of points thousands of
                // times over.
                let t0 = match sym.axis {
                    Axis::BookV => py,
                    Axis::BookH => px,
                    Axis::Diag => (px + py) / 2.0,
                    Axis::AntiDiag => py,
                };
                'axis: for step in 1..MAX_FALLBACK_STEPS {
                    for sign in [-1.0, 1.0] {
                        let t = (t0 + sign * f64::from(step)).round();
                        let (gx, gy) = axis_point(sym.axis, t, w, hh);
                        if try_point(gx, gy, &solution, &mut pins, &mut chosen, &mut chosen_m) {
                            break 'axis;
                        }
                    }
                }
            } else {
                let mut r = 1;
                'outer: while r < MAX_FALLBACK_STEPS {
                    let mut pts = annulus(r, px.round(), py.round());
                    pts.sort_by(|a: &KernelPoint, b: &KernelPoint| {
                        meg(a.x - px, a.y - py)
                            .partial_cmp(&meg(b.x - px, b.y - py))
                            .unwrap()
                    });
                    for pt in pts {
                        if try_point(pt.x, pt.y, &solution, &mut pins, &mut chosen, &mut chosen_m) {
                            break 'outer;
                        }
                    }
                    r += 1;
                }
            }
        }

        let Some(sol) = chosen else {
            return FitStats {
                size: -1,
                fallbacks,
                failed: true,
            };
        };
        solution = to_grid(&sol, off_x, off_y);
        // re-snap the pinned coordinates
        for i in 0..n {
            if let (true, Some((vx, vy))) = (fixed[i], pins.coords[i]) {
                solution[i * 2] = vx;
                solution[i * 2 + 1] = vy;
            }
        }
        placed += if mate == rep { 1 } else { 2 };
    }

    // final sheet size
    let mut need: f64 = f64::from(MIN_SHEET_SIZE);
    for i in 0..n {
        let w = f64::from(h.flaps[i].width);
        let hh = f64::from(h.flaps[i].height);
        let (x, y) = (solution[i * 2], solution[i * 2 + 1]);
        let nx = if cx {
            (-2.0 * x).max(2.0 * (x + w))
        } else {
            x + w
        };
        let ny = if cy {
            (-2.0 * y).max(2.0 * (y + hh))
        } else {
            y + hh
        };
        need = need.max(nx).max(ny);
    }
    let mut size = need.ceil() as i32;
    if (cx || cy) && size % 2 != 0 {
        size += 1; // centre must land on a grid point
    }
    FitStats {
        size,
        fallbacks,
        failed: false,
    }
}

// ---------------------------------------------------------------- driver

fn random_start(h: &KernelHierarchy, rng: &mut BpRandom) -> Vec<f64> {
    let mut x = Vec::with_capacity(dim_of(h));
    for _ in 0..h.flaps.len() {
        x.push(rng.random01());
        x.push(rng.random01());
    }
    x.push(0.0);
    setup_initial_scale(&mut x, h);
    x
}

/// Fold an arbitrary start onto the symmetry manifold so SLSQP starts feasible.
fn symmetrize(x: &mut [f64], h: &KernelHierarchy, sym: &Symmetry) {
    let m = x[x.len() - 1];
    for i in 0..h.flaps.len() {
        let j = sym.partner[i];
        if j < i {
            continue;
        }
        let w = f64::from(h.flaps[i].width);
        let hh = f64::from(h.flaps[i].height);
        if i == j {
            let (mx, my) = sym.axis.mirror_norm(x[i * 2], x[i * 2 + 1], w, hh, m);
            x[i * 2] = (x[i * 2] + mx) / 2.0;
            x[i * 2 + 1] = (x[i * 2 + 1] + my) / 2.0;
        } else {
            let (mx, my) = sym.axis.mirror_norm(x[i * 2], x[i * 2 + 1], w, hh, m);
            x[j * 2] = mx;
            x[j * 2 + 1] = my;
        }
    }
}

fn baseline(h: &KernelHierarchy, x0: &[f64]) -> (i32, i32) {
    let cont = pack_rssl(x0.to_vec(), h, None, None).ok();
    let cont_size = cont
        .as_ref()
        .filter(|r| r.success)
        .map(|r| int_scale(get_scale(&r.x)))
        .unwrap_or(-1);
    let fit = cont
        .as_ref()
        .filter(|r| r.success)
        .and_then(|r| greedy_solve_integer_rssl(&r.x, h).ok())
        .map(|v| v[v.len() - 1])
        .unwrap_or(-1);
    (cont_size, fit)
}

/// For one tree: enumerate involutions, cross them with the four axes, and
/// report whether ranking candidates by the *continuous* size picks the same
/// winner as ranking by the *fitted* size.
fn run_case(name: &str, tree: &Tree, trials: u32) {
    let h = tree.hierarchy(OptimizerSheet::Rect);
    let (_, involutions) = detect::enumerate_involutions(tree, 64);
    let axes = [Axis::BookV, Axis::BookH, Axis::Diag, Axis::AntiDiag];

    println!(
        "\n=== {name} ({} flaps, {} involutions) ===",
        h.flaps.len(),
        involutions.len()
    );

    // baseline
    let mut base_fit = i32::MAX;
    for trial in 0..trials {
        let mut rng = BpRandom::new(1000 + trial);
        let x0 = random_start(&h, &mut rng);
        let (_, f) = baseline(&h, &x0);
        if f > 0 {
            base_fit = base_fit.min(f);
        }
    }
    println!("  baseline (no symmetry): fitted {base_fit}");

    #[derive(Clone)]
    struct Candidate {
        label: String,
        cont: i32,
        fit: i32,
        fallbacks: usize,
    }
    let mut candidates: Vec<Candidate> = Vec::new();

    // Only the most-symmetric few are worth trying: the list is ranked by
    // fewest on-axis leaves then most swapped pairs, and the identity (every
    // flap on the axis) is never useful.
    const MAX_INVOLUTIONS: usize = 4;
    for (index, inv) in involutions
        .iter()
        .enumerate()
        .filter(|(_, i)| i.swapped_pairs > 0)
        .take(MAX_INVOLUTIONS)
    {
        let partner = tree.partner_indices(inv);
        for &axis in &axes {
            if !axis_is_compatible(&h, &partner, axis) {
                continue;
            }
            let sym = Symmetry {
                axis,
                partner: partner.clone(),
            };
            let mut best_cont = i32::MAX;
            let mut best_fit = i32::MAX;
            let mut fallbacks = 0;
            for trial in 0..trials {
                let mut rng = BpRandom::new(1000 + trial);
                let mut start = random_start(&h, &mut rng);
                symmetrize(&mut start, &h, &sym);
                let Some(sol) = sym_pack(start, &h, &sym, None, None) else {
                    continue;
                };
                best_cont = best_cont.min(int_scale(get_scale(&sol)));
                let stats = symmetric_fit(&sol, &h, &sym);
                if !stats.failed {
                    best_fit = best_fit.min(stats.size);
                }
                fallbacks += stats.fallbacks;
            }
            if best_fit == i32::MAX {
                continue;
            }
            candidates.push(Candidate {
                label: format!("inv[{index}]/{}", axis.name()),
                cont: best_cont,
                fit: best_fit,
                fallbacks,
            });
        }
    }

    candidates.sort_by_key(|c| c.fit);
    let best_fit_value = candidates.first().map(|c| c.fit).unwrap_or(-1);
    let mut by_cont = candidates.clone();
    by_cont.sort_by_key(|c| c.cont);
    let picked_by_cont = by_cont.first().cloned();

    for c in candidates.iter().take(5) {
        println!(
            "  {:<22} continuous {:>4}  fitted {:>4}  fallbacks {:>3}",
            c.label, c.cont, c.fit, c.fallbacks
        );
    }
    if let Some(p) = picked_by_cont {
        let regret = p.fit - best_fit_value;
        println!(
            "  -> continuous-ranking picks {} (fitted {}), best fitted is {} => regret {}",
            p.label, p.fit, best_fit_value, regret
        );
    }
}

/// An on-axis flap needs a grid point on the axis. With centred coordinates and
/// zero-size flaps that always works; with dimensions it needs matching parity.
fn axis_is_compatible(h: &KernelHierarchy, partner: &[usize], axis: Axis) -> bool {
    for i in 0..h.flaps.len() {
        if partner[i] != i {
            continue;
        }
        let (w, hh) = (h.flaps[i].width, h.flaps[i].height);
        match axis {
            Axis::BookV => {
                if w % 2 != 0 {
                    return false;
                }
            }
            Axis::BookH => {
                if hh % 2 != 0 {
                    return false;
                }
            }
            Axis::Diag | Axis::AntiDiag => {
                if w != hh {
                    return false;
                }
            }
        }
    }
    true
}

fn main() {
    let trials = 4;
    run_case("bug v=2", &detect::bug(2, 8.0, 10.0, 12.0), trials);
    run_case("bug v=3", &detect::bug(3, 8.0, 10.0, 12.0), trials);
    run_case("bug v=4", &detect::bug(4, 6.0, 14.0, 10.0), trials);
    run_case("star n=4", &detect::star(4, 10.0), trials);
    run_case("star n=6", &detect::star(6, 10.0), trials);
    run_case("star n=8", &detect::star(8, 10.0), trials);
    run_case("star n=5", &detect::star(5, 10.0), trials);
    run_case("lopsided", &detect::lopsided(), trials);
}
