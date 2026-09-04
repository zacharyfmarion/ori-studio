//! Pleat runs — parallel creases stacked with clean strips between them — and
//! the spacing groups inside them that a solve can hold equal.
//!
//! The criterion, validated by eye over the real detection set (see
//! `implementation-plans/pleat-run-spacing-pin.md`). Walking from a crease to
//! the nearest parallel crease that overlaps it along its length:
//!
//! - the two share at least [`MIN_OVERLAP`] of the shorter one's length;
//! - the strip between them is at least [`MIN_ASPECT`] pitches long, and a run
//!   of exactly three creases at least [`ASPECT_FOR_THREE`];
//! - nothing lies inside the strip over that shared length. A crease that
//!   crosses the whole strip, in at one neighbour and out at the other, is a
//!   transversal and allowed — a box-pleated grid is pleats crossed by pleats.
//!   A crease that starts or ends inside the strip breaks the pair.
//!
//! Collinear creases are chained by contact, so a crease far along the same
//! line as a pleat is not part of it. Spacing plays no part in membership:
//! inside a run, consecutive spacings that agree within tolerance form a
//! [`SpacingGroup`], and only a group of two or more is evidence of a designed
//! equality. Pleats of alternating width get two groups, not a lattice.
//!
//! The foldability gate cannot catch a wrong spacing — an unevenly spaced pleat
//! folds — so this criterion is the whole of the safety, which is why it is
//! conservative and why it was validated before it was wired in.

use std::collections::BTreeMap;
use std::f64::consts::PI;

use crate::Point2;

/// Creases within this of one another are parallel. Degrees.
pub const ANGLE_CLUSTER_DEGREES: f64 = 0.5;
/// Equal spacing: within this fraction of the pitch, or [`ABS_TOL_PX`] pixels,
/// whichever is larger.
pub const REL_TOL: f64 = 0.04;
/// See [`REL_TOL`]. Pixels.
pub const ABS_TOL_PX: f64 = 0.75;
/// Collinear creases closer than this along their line are one chain. Pixels.
pub const CHAIN_GAP_PX: f64 = 1.5;
/// A crease this close to a neighbour is on it, not inside the strip. Pixels.
pub const STRIP_EPS_PX: f64 = 1.5;
/// Neighbours must share at least this fraction of the shorter one's length.
pub const MIN_OVERLAP: f64 = 0.6;
/// The shared length of two neighbours must be at least this many pitches.
pub const MIN_ASPECT: f64 = 4.0;
/// A run of exactly three creases must be at least this many pitches long.
pub const ASPECT_FOR_THREE: f64 = 8.0;
/// Fewer creases than this is not a run.
pub const MIN_CREASES: usize = 3;

/// One line creases lie on: the solver's carrier parameters — normal angle
/// `theta` and offset `rho`, with `n = (cos θ, sin θ)` and `n·p = rho` on the
/// line — and the creases on it, each by the index the caller knows it by and
/// its two endpoints.
#[derive(Debug, Clone)]
pub struct PleatLine {
    pub theta: f64,
    pub rho: f64,
    pub segments: Vec<(usize, Point2, Point2)>,
}

/// A crease that can block a strip, by the same index the lines use.
#[derive(Debug, Clone, Copy)]
pub struct Obstacle {
    pub segment: usize,
    pub a: Point2,
    pub b: Point2,
}

/// A crease of a run: which line it is on, and how that line's normal relates
/// to the run's — `+1` when they point the same way, `-1` when opposite — so
/// that the spacing between members `k` and `k + 1` is
/// `sign[k+1]·rho[k+1] − sign[k]·rho[k]` in the lines' own parameters.
#[derive(Debug, Clone, PartialEq)]
pub struct PleatMember {
    pub line: usize,
    pub sign: f64,
    /// The creases of the chain, by the caller's index.
    pub segments: Vec<usize>,
}

/// Consecutive spacings of a run that agree within tolerance.
#[derive(Debug, Clone, PartialEq)]
pub struct SpacingGroup {
    /// Indices into [`PleatRun::gaps`], ascending.
    pub gaps: Vec<usize>,
    pub pitch: f64,
    /// The largest departure from `pitch` among the members.
    pub spread: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PleatRun {
    /// The run's direction as a normal angle, radians in `[0, π)`.
    pub theta: f64,
    /// In offset order along that normal.
    pub members: Vec<PleatMember>,
    /// `members.len() - 1` spacings, in that order.
    pub gaps: Vec<f64>,
    /// Largest first; singletons included so a run reads whole.
    pub groups: Vec<SpacingGroup>,
    /// The shortest length two neighbours share.
    pub strip_length: f64,
}

impl PleatRun {
    /// The groups a solve has evidence to hold equal.
    pub fn equal_groups(&self) -> impl Iterator<Item = &SpacingGroup> {
        self.groups.iter().filter(|group| group.gaps.len() >= 2)
    }

    /// The spacings a set of parameters gives this run, from each member's
    /// signed offset, for measuring a solve against its groups.
    pub fn gaps_from_offsets(&self, offset: impl Fn(&PleatMember) -> f64) -> Vec<f64> {
        self.members
            .windows(2)
            .map(|pair| pair[1].sign * offset(&pair[1]) - pair[0].sign * offset(&pair[0]))
            .collect()
    }
}

/// The largest departure from each group's mean over `gaps`, as a fraction of
/// the mean; zero for a run with no equal group.
pub fn worst_group_spread(run: &PleatRun, gaps: &[f64]) -> f64 {
    run.equal_groups()
        .filter_map(|group| {
            let values: Vec<f64> = group
                .gaps
                .iter()
                .filter_map(|&k| gaps.get(k).copied())
                .collect();
            if values.is_empty() {
                return None;
            }
            let mean = values.iter().sum::<f64>() / values.len() as f64;
            if mean.abs() <= f64::EPSILON {
                return None;
            }
            Some(
                values
                    .iter()
                    .map(|value| (value - mean).abs())
                    .fold(0.0_f64, f64::max)
                    / mean.abs(),
            )
        })
        .fold(0.0_f64, f64::max)
}

#[derive(Debug, Clone)]
struct Chain {
    line: usize,
    sign: f64,
    /// Offset along the family normal.
    rho: f64,
    t0: f64,
    t1: f64,
    segments: Vec<usize>,
}

impl Chain {
    fn length(&self) -> f64 {
        self.t1 - self.t0
    }
}

struct Family {
    normal: Point2,
    direction: Point2,
    lines: Vec<usize>,
}

fn wrap_pi(angle: f64) -> f64 {
    angle.rem_euclid(PI)
}

/// The angle between two directions read modulo π, in `[0, π/2]`.
fn line_angle_distance(a: f64, b: f64) -> f64 {
    let d = (a - b).rem_euclid(PI);
    d.min(PI - d)
}

fn dot(a: Point2, b: Point2) -> f64 {
    a.x * b.x + a.y * b.y
}

fn lerp(a: Point2, b: Point2, u: f64) -> Point2 {
    Point2::new(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)
}

/// Group lines by direction. Sorted by normal angle modulo π and clustered
/// within [`ANGLE_CLUSTER_DEGREES`]; the cluster's normal is the mean of the
/// doubled angles, which is well defined across the wrap at π.
fn families(lines: &[PleatLine]) -> Vec<Family> {
    let tolerance = ANGLE_CLUSTER_DEGREES.to_radians();
    let mut order: Vec<(f64, usize)> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| !line.segments.is_empty())
        .map(|(index, line)| (wrap_pi(line.theta), index))
        .collect();
    order.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut clusters: Vec<Vec<(f64, usize)>> = Vec::new();
    for entry in order {
        match clusters.last_mut() {
            Some(cluster)
                if line_angle_distance(entry.0, cluster[cluster.len() - 1].0) <= tolerance =>
            {
                cluster.push(entry);
            }
            _ => clusters.push(vec![entry]),
        }
    }
    if clusters.len() > 1 {
        let first = clusters[0][0].0;
        let last_cluster = clusters.last().map(|c| c[c.len() - 1].0);
        if last_cluster.is_some_and(|last| line_angle_distance(first, last) <= tolerance) {
            let mut tail = clusters.pop().unwrap_or_default();
            clusters[0].append(&mut tail);
        }
    }
    clusters
        .into_iter()
        .map(|cluster| {
            let (c, s) = cluster.iter().fold((0.0, 0.0), |(c, s), (phi, _)| {
                (c + (2.0 * phi).cos(), s + (2.0 * phi).sin())
            });
            let theta = wrap_pi(s.atan2(c) / 2.0);
            Family {
                normal: Point2::new(theta.cos(), theta.sin()),
                direction: Point2::new(-theta.sin(), theta.cos()),
                lines: cluster.into_iter().map(|(_, index)| index).collect(),
            }
        })
        .collect()
}

/// A family's chains: each line's creases sorted along the family direction
/// and joined where they touch.
fn chains(lines: &[PleatLine], family: &Family, chain_gap: f64) -> Vec<Chain> {
    let mut out = Vec::new();
    for &index in &family.lines {
        let line = &lines[index];
        let line_normal = Point2::new(line.theta.cos(), line.theta.sin());
        let sign = if dot(line_normal, family.normal) >= 0.0 {
            1.0
        } else {
            -1.0
        };
        let mut segments: Vec<(f64, f64, usize, f64)> = line
            .segments
            .iter()
            .map(|&(id, a, b)| {
                let (ta, tb) = (dot(a, family.direction), dot(b, family.direction));
                let rho = (dot(a, family.normal) + dot(b, family.normal)) / 2.0;
                (ta.min(tb), ta.max(tb), id, rho)
            })
            .collect();
        segments.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut current: Option<(Chain, Vec<f64>)> = None;
        for (t0, t1, id, rho) in segments {
            match current.as_mut() {
                Some((chain, rhos)) if t0 <= chain.t1 + chain_gap => {
                    chain.t1 = chain.t1.max(t1);
                    chain.segments.push(id);
                    rhos.push(rho);
                }
                _ => {
                    if let Some((mut chain, rhos)) = current.take() {
                        chain.rho = rhos.iter().sum::<f64>() / rhos.len() as f64;
                        out.push(chain);
                    }
                    current = Some((
                        Chain {
                            line: index,
                            sign,
                            rho,
                            t0,
                            t1,
                            segments: vec![id],
                        },
                        vec![rho],
                    ));
                }
            }
        }
        if let Some((mut chain, rhos)) = current.take() {
            chain.rho = rhos.iter().sum::<f64>() / rhos.len() as f64;
            out.push(chain);
        }
    }
    out.sort_by(|a, b| a.rho.total_cmp(&b.rho).then(a.t0.total_cmp(&b.t0)));
    out
}

/// The parameter interval of `[0, 1]` on which the linear `f(u) = f0 + (f1 - f0)·u`
/// exceeds `eps`, or `None`.
fn above(f0: f64, f1: f64, eps: f64) -> Option<(f64, f64)> {
    match (f0 > eps, f1 > eps) {
        (true, true) => Some((0.0, 1.0)),
        (false, false) => None,
        (true, false) => Some((0.0, (eps - f0) / (f1 - f0))),
        (false, true) => Some(((eps - f0) / (f1 - f0), 1.0)),
    }
}

struct StripTest<'a> {
    lines: &'a [PleatLine],
    obstacles: &'a [Obstacle],
    family_direction: Point2,
    strip_eps: f64,
}

impl StripTest<'_> {
    /// Whether `a` and `b` are neighbours in a pleat: stacked, a strip at least
    /// [`MIN_ASPECT`] pitches long, and nothing inside it.
    fn clean_pair(&self, a: &Chain, b: &Chain) -> bool {
        let (t_lo, t_hi) = (a.t0.max(b.t0), a.t1.min(b.t1));
        let shorter = a.length().min(b.length());
        if t_hi <= t_lo || t_hi - t_lo < MIN_OVERLAP * shorter {
            return false;
        }
        let gap = b.rho - a.rho;
        if gap <= 2.0 * self.strip_eps || t_hi - t_lo < MIN_ASPECT * gap {
            return false;
        }
        // Each line judges its own side of the strip in its own frame, so a
        // hair of non-parallelism between the two cannot read a crease that
        // ends on one of them as ending inside the strip.
        let side = |chain: &Chain, toward: &Chain| {
            let line = &self.lines[chain.line];
            let normal = Point2::new(line.theta.cos(), line.theta.sin());
            let toward_line = &self.lines[toward.line];
            let probe = toward_line
                .segments
                .first()
                .map_or(Point2::new(0.0, 0.0), |&(_, p, _)| p);
            let orientation = if dot(normal, probe) - line.rho >= 0.0 {
                1.0
            } else {
                -1.0
            };
            move |q: Point2| orientation * (dot(normal, q) - line.rho)
        };
        let from_a = side(a, b);
        let from_b = side(b, a);
        for obstacle in self.obstacles {
            if a.segments.contains(&obstacle.segment) || b.segments.contains(&obstacle.segment) {
                continue;
            }
            let (tp, tq) = (
                dot(obstacle.a, self.family_direction),
                dot(obstacle.b, self.family_direction),
            );
            if tp.max(tq) < t_lo || tp.min(tq) > t_hi {
                continue;
            }
            let (u0, u1) = if (tq - tp).abs() <= f64::EPSILON {
                (0.0, 1.0)
            } else {
                let u0 = ((t_lo - tp) / (tq - tp)).clamp(0.0, 1.0);
                let u1 = ((t_hi - tp) / (tq - tp)).clamp(0.0, 1.0);
                (u0.min(u1), u0.max(u1))
            };
            let (p0, p1) = (
                lerp(obstacle.a, obstacle.b, u0),
                lerp(obstacle.a, obstacle.b, u1),
            );
            let (fa0, fa1) = (from_a(p0), from_a(p1));
            let (fb0, fb1) = (from_b(p0), from_b(p1));
            let touches_a = fa0.min(fa1) <= self.strip_eps;
            let touches_b = fb0.min(fb1) <= self.strip_eps;
            if touches_a && touches_b {
                continue; // a transversal, crossing the whole strip
            }
            if let (Some(in_a), Some(in_b)) = (
                above(fa0, fa1, self.strip_eps),
                above(fb0, fb1, self.strip_eps),
            ) && in_a.0.max(in_b.0) < in_a.1.min(in_b.1)
            {
                return false; // some of it lies inside the strip
            }
        }
        true
    }
}

/// Cluster consecutive spacings that agree within tolerance, largest group first.
pub fn spacing_groups(gaps: &[f64], image_size_px: f64) -> Vec<SpacingGroup> {
    let abs_tol = ABS_TOL_PX / image_size_px;
    let mut order: Vec<usize> = (0..gaps.len()).collect();
    order.sort_by(|&a, &b| gaps[a].total_cmp(&gaps[b]));
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    for k in order {
        match clusters.last_mut() {
            Some(cluster)
                if (gaps[k] - gaps[cluster[0]]).abs()
                    <= (REL_TOL * gaps[cluster[0]]).max(abs_tol) =>
            {
                cluster.push(k);
            }
            _ => clusters.push(vec![k]),
        }
    }
    let mut groups: Vec<SpacingGroup> = clusters
        .into_iter()
        .map(|mut members| {
            members.sort_unstable();
            let pitch = members.iter().map(|&k| gaps[k]).sum::<f64>() / members.len() as f64;
            let spread = members
                .iter()
                .map(|&k| (gaps[k] - pitch).abs())
                .fold(0.0_f64, f64::max);
            SpacingGroup {
                gaps: members,
                pitch,
                spread,
            }
        })
        .collect();
    groups.sort_by(|a, b| {
        b.gaps
            .len()
            .cmp(&a.gaps.len())
            .then(a.pitch.total_cmp(&b.pitch))
    });
    groups
}

/// Find the pleat runs among `lines`, with `obstacles` as everything that can
/// block a strip (normally every crease, the ones on the lines included).
/// Pixel tolerances are read at `image_size_px` pixels per unit of the
/// coordinates.
pub fn detect_pleat_runs(
    lines: &[PleatLine],
    obstacles: &[Obstacle],
    image_size_px: f64,
) -> Vec<PleatRun> {
    let px = image_size_px.max(1.0);
    let (eps_rho, chain_gap, strip_eps) = (ABS_TOL_PX / px, CHAIN_GAP_PX / px, STRIP_EPS_PX / px);
    let mut runs = Vec::new();
    for family in families(lines) {
        let chains = chains(lines, &family, chain_gap);
        if chains.len() < MIN_CREASES {
            continue;
        }
        let test = StripTest {
            lines,
            obstacles,
            family_direction: family.direction,
            strip_eps,
        };
        // Each chain links to the nearest line above it that overlaps it along
        // the run, and only if the strip between them is clean; a farther line
        // would have this one inside its strip.
        let mut next: Vec<Option<usize>> = vec![None; chains.len()];
        for ai in 0..chains.len() {
            for bi in ai + 1..chains.len() {
                let (a, b) = (&chains[ai], &chains[bi]);
                if b.rho - a.rho <= eps_rho {
                    continue;
                }
                if a.t1.min(b.t1) <= a.t0.max(b.t0) {
                    continue;
                }
                if test.clean_pair(a, b) {
                    next[ai] = Some(bi);
                }
                break;
            }
        }
        let is_target: Vec<bool> = {
            let mut targets = vec![false; chains.len()];
            for target in next.iter().flatten() {
                targets[*target] = true;
            }
            targets
        };
        let mut paths: Vec<Vec<usize>> = Vec::new();
        for (root, &target) in is_target.iter().enumerate() {
            if target {
                continue;
            }
            let mut path = vec![root];
            while let Some(following) = next[path[path.len() - 1]] {
                path.push(following);
            }
            if path.len() >= MIN_CREASES {
                paths.push(path);
            }
        }
        // Two chains on one line share the tail above them, so they share the
        // run: the longer path owns it and the other's chains join as extra
        // creases of the same members.
        paths.sort_by_key(|path| std::cmp::Reverse(path.len()));
        let mut owner: BTreeMap<usize, usize> = BTreeMap::new();
        let mut family_runs: Vec<PleatRun> = Vec::new();
        for path in paths {
            if let Some(&run_index) = path.iter().find_map(|k| owner.get(k)) {
                for &k in &path {
                    if owner.contains_key(&k) {
                        continue;
                    }
                    owner.insert(k, run_index);
                    let chain = &chains[k];
                    if let Some(member) = family_runs[run_index]
                        .members
                        .iter_mut()
                        .find(|member| member.line == chain.line)
                    {
                        member.segments.extend(chain.segments.iter().copied());
                    }
                }
                continue;
            }
            let members: Vec<&Chain> = path.iter().map(|&k| &chains[k]).collect();
            let gaps: Vec<f64> = members
                .windows(2)
                .map(|pair| pair[1].rho - pair[0].rho)
                .collect();
            let pitch = gaps.iter().sum::<f64>() / gaps.len() as f64;
            let strip_length = members
                .windows(2)
                .map(|pair| pair[0].t1.min(pair[1].t1) - pair[0].t0.max(pair[1].t0))
                .fold(f64::INFINITY, f64::min);
            if members.len() == MIN_CREASES && strip_length < ASPECT_FOR_THREE * pitch {
                continue;
            }
            let run_index = family_runs.len();
            for &k in &path {
                owner.insert(k, run_index);
            }
            family_runs.push(PleatRun {
                theta: family.normal.y.atan2(family.normal.x),
                members: members
                    .iter()
                    .map(|chain| PleatMember {
                        line: chain.line,
                        sign: chain.sign,
                        segments: chain.segments.clone(),
                    })
                    .collect(),
                groups: spacing_groups(&gaps, px),
                gaps,
                strip_length,
            });
        }
        runs.extend(family_runs);
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;

    const PX: f64 = 1024.0;

    /// A vertical crease from `(x, y0)` to `(x, y1)`, on the line `n = (1, 0)`.
    fn vertical(id: usize, x: f64, y0: f64, y1: f64) -> (PleatLine, Obstacle) {
        let (a, b) = (Point2::new(x, y0), Point2::new(x, y1));
        (
            PleatLine {
                theta: 0.0,
                rho: x,
                segments: vec![(id, a, b)],
            },
            Obstacle { segment: id, a, b },
        )
    }

    fn horizontal(id: usize, y: f64, x0: f64, x1: f64) -> (PleatLine, Obstacle) {
        let (a, b) = (Point2::new(x0, y), Point2::new(x1, y));
        (
            PleatLine {
                theta: std::f64::consts::FRAC_PI_2,
                rho: y,
                segments: vec![(id, a, b)],
            },
            Obstacle { segment: id, a, b },
        )
    }

    fn split(items: Vec<(PleatLine, Obstacle)>) -> (Vec<PleatLine>, Vec<Obstacle>) {
        items.into_iter().unzip()
    }

    #[test]
    fn noisy_full_height_pleats_are_one_run_with_one_group() {
        let xs = [0.1, 0.3 + 0.002, 0.5 - 0.001, 0.7 + 0.0015, 0.9];
        let (lines, obstacles) = split(
            xs.iter()
                .enumerate()
                .map(|(id, &x)| vertical(id, x, 0.0, 1.0))
                .collect(),
        );
        let runs = detect_pleat_runs(&lines, &obstacles, PX);
        assert_eq!(runs.len(), 1, "{runs:?}");
        let run = &runs[0];
        assert_eq!(run.members.len(), 5);
        assert_eq!(run.gaps.len(), 4);
        assert_eq!(run.equal_groups().count(), 1);
        assert_eq!(run.groups[0].gaps, vec![0, 1, 2, 3]);
        assert!((run.groups[0].pitch - 0.2).abs() < 0.002);
        assert!(run.members.iter().all(|member| member.sign == 1.0));
        assert!((run.strip_length - 1.0).abs() < 1e-12);
    }

    #[test]
    fn a_flipped_normal_reads_the_same_spacing_with_a_negative_sign() {
        let mut items: Vec<(PleatLine, Obstacle)> = [0.1, 0.3, 0.5, 0.7, 0.9]
            .iter()
            .enumerate()
            .map(|(id, &x)| vertical(id, x, 0.0, 1.0))
            .collect();
        // The middle line carries its normal the other way: n = (-1, 0), rho = -x.
        items[2].0.theta = PI;
        items[2].0.rho = -0.5;
        let (lines, obstacles) = split(items);
        let runs = detect_pleat_runs(&lines, &obstacles, PX);
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(run.members[2].sign, -1.0);
        let from_params = run.gaps_from_offsets(|member| lines[member.line].rho);
        for (a, b) in from_params.iter().zip(&run.gaps) {
            assert!((a - b).abs() < 1e-12, "{from_params:?} vs {:?}", run.gaps);
        }
    }

    #[test]
    fn transversals_do_not_break_a_run_but_a_crease_ending_inside_a_strip_does() {
        let mut items: Vec<(PleatLine, Obstacle)> = (0..6)
            .map(|id| vertical(id, 0.1 + 0.16 * id as f64, 0.0, 1.0))
            .collect();
        // Horizontals crossing every strip: a box-pleated grid.
        items.push(horizontal(10, 0.25, 0.0, 1.0));
        items.push(horizontal(11, 0.75, 0.0, 1.0));
        let (lines, obstacles) = split(items.clone());
        let runs = detect_pleat_runs(&lines, &obstacles, PX);
        let vertical_run = runs
            .iter()
            .find(|run| run.theta.abs() < 1e-9)
            .expect("the verticals are still one run under the transversals");
        assert_eq!(vertical_run.members.len(), 6);

        // A crease from the second line ending inside the strip to the third
        // splits the run there: two on one side, four on the other.
        let (a, b) = (Point2::new(0.26, 0.5), Point2::new(0.34, 0.5));
        items.push((
            PleatLine {
                theta: std::f64::consts::FRAC_PI_2,
                rho: 0.5,
                segments: vec![(12, a, b)],
            },
            Obstacle { segment: 12, a, b },
        ));
        let (lines, obstacles) = split(items);
        let runs = detect_pleat_runs(&lines, &obstacles, PX);
        let verticals: Vec<&PleatRun> = runs.iter().filter(|run| run.theta.abs() < 1e-9).collect();
        assert_eq!(verticals.len(), 1, "{runs:?}");
        assert_eq!(verticals[0].members.len(), 4);
        assert_eq!(verticals[0].members[0].line, 2);
    }

    #[test]
    fn three_short_creases_are_not_a_pleat_but_a_long_three_is() {
        let short = split(
            (0..3)
                .map(|id| vertical(id, 0.3 + 0.1 * id as f64, 0.2, 0.8))
                .collect(),
        );
        assert!(
            detect_pleat_runs(&short.0, &short.1, PX).is_empty(),
            "a strip 0.6 long at pitch 0.1 is six pitches, under the eight a triple needs"
        );
        let long = split(
            (0..3)
                .map(|id| vertical(id, 0.3 + 0.1 * id as f64, 0.0, 1.0))
                .collect(),
        );
        assert_eq!(detect_pleat_runs(&long.0, &long.1, PX).len(), 1);
    }

    #[test]
    fn alternating_widths_are_two_groups_not_one() {
        let xs = [0.1, 0.2, 0.4, 0.5, 0.7, 0.8];
        let (lines, obstacles) = split(
            xs.iter()
                .enumerate()
                .map(|(id, &x)| vertical(id, x, 0.0, 1.0))
                .collect(),
        );
        let runs = detect_pleat_runs(&lines, &obstacles, PX);
        assert_eq!(runs.len(), 1);
        let groups: Vec<&SpacingGroup> = runs[0].equal_groups().collect();
        assert_eq!(groups.len(), 2, "{:?}", runs[0].groups);
        assert_eq!(groups[0].gaps, vec![0, 2, 4]);
        assert_eq!(groups[1].gaps, vec![1, 3]);
    }

    #[test]
    fn a_crease_far_along_the_same_line_is_its_own_chain() {
        // Four pleats over the lower 0.7 of the square, plus a stub on the
        // second line's extension that does not touch it: the stub must not
        // stretch the second member, or the run's strip.
        let mut items: Vec<(PleatLine, Obstacle)> = (0..4)
            .map(|id| vertical(id, 0.3 + 0.1 * id as f64, 0.0, 0.7))
            .collect();
        let stub = vertical(4, 0.4, 0.9, 1.0);
        items[1].0.segments.push(stub.0.segments[0]);
        items.push((
            PleatLine {
                theta: 0.0,
                rho: 0.4,
                segments: Vec::new(),
            },
            stub.1,
        ));
        let (lines, obstacles) = split(items);
        let runs = detect_pleat_runs(&lines, &obstacles, PX);
        assert_eq!(runs.len(), 1, "{runs:?}");
        assert_eq!(runs[0].members.len(), 4);
        assert_eq!(runs[0].members[1].segments, vec![1]);
        assert!((runs[0].strip_length - 0.7).abs() < 1e-12);
    }

    #[test]
    fn spread_is_measured_against_a_group_mean() {
        let run = PleatRun {
            theta: 0.0,
            members: Vec::new(),
            gaps: vec![0.2, 0.2, 0.5],
            groups: vec![
                SpacingGroup {
                    gaps: vec![0, 1],
                    pitch: 0.2,
                    spread: 0.0,
                },
                SpacingGroup {
                    gaps: vec![2],
                    pitch: 0.5,
                    spread: 0.0,
                },
            ],
            strip_length: 1.0,
        };
        assert_eq!(worst_group_spread(&run, &[0.2, 0.2, 0.9]), 0.0);
        assert!((worst_group_spread(&run, &[0.19, 0.21, 0.5]) - 0.05).abs() < 1e-12);
    }
}
