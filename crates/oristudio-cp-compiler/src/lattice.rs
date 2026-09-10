//! The square lattice a designed pattern is drawn on.
//!
//! A box-pleated design places every vertex on a grid of `cells` squares per
//! paper edge, or on the half-grid where its diagonals cross. A solve that has
//! converged near such a design sits within a pixel of the lattice at every
//! vertex, and a detection of a rendered one within a pixel or two: the
//! lattice explains the geometry to machine precision once it is read, and
//! reading it turns a solve that is right to a tenth of a pixel into one that
//! is exact. This module only reads and snaps; the judgement that a snapped
//! pattern still folds is the solver's.
//!
//! Reading it is a significance question, not a fit question. A band of a
//! pixel either side of every line of a fine lattice covers most of the edge,
//! so "every vertex is within a pixel of some line" is true of random points
//! for a fine enough lattice. A size is believed only when the chance of
//! every coordinate landing in its bands is negligible.

/// Coarsest lattice looked for, in cells per edge.
const MIN_CELLS: u32 = 4;
/// A lattice is not believed when as many random coordinates would all land
/// in its bands with more than this probability. Counted over the distinct
/// coordinate values: a design's vertices share lines, and forty vertices on
/// five lines are five readings, not eighty.
const MAX_CHANCE: f64 = 1e-6;
/// The bands either side of every line may cover at most this much of the
/// edge, whatever the count says: past it a lattice explains nothing.
const MAX_BAND: f64 = 0.5;
/// A cell narrower than this, in pixels, is not a lattice a crease pattern
/// is drawn on at that resolution: strokes are two or three pixels wide, and
/// the finest grids the detector resolves (128 cells on a 960 px paper) are
/// 7.5 px. It also bounds how fine a lattice a handful of readings can
/// vouch for — eighteen readings cannot tell a 224-cell grid from noise.
const MIN_CELL_PX: f64 = 6.0;
/// Fewer distinct coordinates than this are not evidence of a lattice.
const MIN_COORDINATES: usize = 8;
/// How far off the lattice a reading may sit and still be read as on it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Outliers {
    /// Every coordinate within the tolerance: what a converged solve of a
    /// design on the lattice looks like, and what a detection has to look
    /// like when a solve could still be run instead.
    None,
    /// A few readings further off — a junction the detector placed a couple
    /// of pixels off among hundreds it placed well (diamond sword: one vertex
    /// 3.0 px off its 112-grid, the next 1.5) — for a detection nothing else
    /// can solve. At most [`MAX_OUTLIER_FRACTION`] of the coordinates, and
    /// never fewer than [`MIN_OUTLIERS_ALLOWED`], each within
    /// [`MAX_OUTLIER_TOLERANCES`] tolerances and a third of a cell, where the
    /// nearest lattice point is still the right one. Hybrids with a few
    /// off-grid vertices sit at 1.3–1.8% (ant, ladybug, swan on the curated
    /// benchmark, whose truths are off the lattice read); designs on their
    /// grid at 0.1–0.4%.
    Few,
}

const MAX_OUTLIER_FRACTION: f64 = 0.005;
const MIN_OUTLIERS_ALLOWED: usize = 2;
const MAX_OUTLIER_TOLERANCES: f64 = 2.5;
/// Two coordinates closer than this, in the unit square, are one reading.
const DISTINCT_COORDINATE_EPSILON: f64 = 1e-6;

/// A lattice read from a set of coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SquareLattice {
    /// Cells per paper edge.
    pub cells: u32,
    /// The furthest any coordinate sat from its lattice line, in the unit
    /// square.
    pub max_offset: f64,
    /// The probability that as many random coordinates would all have sat
    /// within `tolerance` of a lattice line.
    pub chance: f64,
}

impl SquareLattice {
    /// The lattice value nearest `coordinate`.
    pub fn snap(&self, coordinate: f64) -> f64 {
        snap_to(coordinate, self.cells)
    }
}

/// The lattice value nearest `coordinate` on a grid of `cells` per unit.
pub fn snap_to(coordinate: f64, cells: u32) -> f64 {
    let cells = f64::from(cells);
    (coordinate * cells).round() / cells
}

/// The coarsest square lattice, from [`MIN_CELLS`] cells up to a cell of
/// [`MIN_CELL_PX`] at `pixels_per_unit`, that `coordinates` (unit-square
/// values) sit within `tolerance` of — all of them, or all but the few
/// [`Outliers::Few`] allows — provided that could not have happened by
/// chance. `None` when there is no such lattice.
pub fn detect_square_lattice(
    coordinates: &[f64],
    tolerance: f64,
    pixels_per_unit: f64,
    outliers: Outliers,
) -> Option<SquareLattice> {
    let positive = |value: f64| value.is_finite() && value > 0.0;
    if !positive(tolerance) || !positive(pixels_per_unit) {
        return None;
    }
    let distinct = distinct_count(coordinates);
    if distinct < MIN_COORDINATES {
        return None;
    }
    let max_cells = (pixels_per_unit / MIN_CELL_PX).floor().max(0.0) as u32;
    // The coarsest lattice most of the pattern sits on, when some of it sits
    // beyond the outliers' reach: the vertices that lattice did not explain.
    // A finer lattice then has to earn its extra points on those alone — a
    // design mostly on 56 cells with a few dozen vertices on the 112 half-grid
    // earns it, one stray vertex that some fine lattice happens to pass near
    // does not.
    let allowed_outliers = match outliers {
        Outliers::None => 0,
        Outliers::Few => ((MAX_OUTLIER_FRACTION * coordinates.len() as f64).floor() as usize)
            .max(MIN_OUTLIERS_ALLOWED),
    };
    let mut unexplained: Option<Vec<f64>> = None;
    for cells in MIN_CELLS..=max_cells {
        let band = 2.0 * tolerance * f64::from(cells);
        if band >= MAX_BAND {
            break;
        }
        let reach = (tolerance * MAX_OUTLIER_TOLERANCES).min(1.0 / f64::from(cells) / 3.0);
        let mut max_offset = 0.0_f64;
        let mut off = 0usize;
        let mut far = Vec::new();
        for &coordinate in coordinates {
            let offset = (coordinate - snap_to(coordinate, cells)).abs();
            if offset > tolerance {
                off += 1;
            }
            if offset > tolerance.max(reach) {
                far.push(coordinate);
            }
            max_offset = max_offset.max(offset);
        }
        if off > allowed_outliers {
            continue;
        }
        let outliers = off;
        if !far.is_empty() {
            if unexplained.is_none() {
                unexplained = Some(far);
            }
            continue;
        }
        if let Some(unexplained) = &unexplained {
            let earned = distinct_count(
                &unexplained
                    .iter()
                    .copied()
                    .filter(|&c| (c - snap_to(c, cells)).abs() <= tolerance)
                    .collect::<Vec<_>>(),
            );
            if band.powi(i32::try_from(earned).unwrap_or(i32::MAX)) > MAX_CHANCE {
                return None;
            }
        }
        // Significance from the readings within tolerance; the outliers are
        // not evidence for the lattice, only tolerated by it.
        let on_lattice = distinct.saturating_sub(outliers);
        if on_lattice < MIN_COORDINATES {
            return None;
        }
        let chance = band.powi(i32::try_from(on_lattice).unwrap_or(i32::MAX));
        if chance > MAX_CHANCE {
            return None;
        }
        return Some(SquareLattice {
            cells,
            max_offset,
            chance,
        });
    }
    None
}

/// How many distinct values `coordinates` holds, to
/// [`DISTINCT_COORDINATE_EPSILON`].
fn distinct_count(coordinates: &[f64]) -> usize {
    let mut sorted: Vec<f64> = coordinates
        .iter()
        .copied()
        .filter(|c| c.is_finite())
        .collect();
    sorted.sort_by(f64::total_cmp);
    let mut count = 0usize;
    let mut last: Option<f64> = None;
    for value in sorted {
        if last.is_none_or(|previous| value - previous > DISTINCT_COORDINATE_EPSILON) {
            count += 1;
            last = Some(value);
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    const PX: f64 = 1024.0;

    /// Pseudo-random unit coordinates from a linear congruential generator, so
    /// the sequence has no lattice of its own (multiples of one step do).
    fn scattered(count: usize) -> Vec<f64> {
        let mut state: u64 = 0x2545_f491_4f6c_dd1d;
        (0..count)
            .map(|_| {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                (state >> 11) as f64 / (1u64 << 53) as f64
            })
            .collect()
    }

    fn grid_coordinates(cells: u32, count: usize, noise: f64) -> Vec<f64> {
        (0..count)
            .map(|i| {
                let k = (i * 7 + 3) % (cells as usize + 1);
                let sign = if i % 2 == 0 { 1.0 } else { -1.0 };
                k as f64 / f64::from(cells) + sign * noise
            })
            .collect()
    }

    #[test]
    fn reads_the_grid_a_noisy_design_sits_on() {
        let coordinates = grid_coordinates(16, 60, 0.4 / PX);
        let lattice =
            detect_square_lattice(&coordinates, 1.5 / PX, PX, Outliers::None).expect("lattice");
        assert_eq!(lattice.cells, 16);
        assert!(lattice.max_offset <= 0.4 / PX + 1e-12);
        assert!(lattice.chance < 1e-6);
    }

    #[test]
    fn the_coarsest_lattice_that_explains_every_vertex_wins() {
        // Half-cell positions of an 8-grid: an 8-lattice fails, 16 fits.
        let mut coordinates = grid_coordinates(8, 30, 0.0);
        coordinates.push(1.0 / 16.0);
        coordinates.push(5.0 / 16.0);
        let lattice =
            detect_square_lattice(&coordinates, 1.0 / PX, PX, Outliers::None).expect("lattice");
        assert_eq!(lattice.cells, 16);
    }

    #[test]
    fn scattered_coordinates_have_no_lattice() {
        // Random positions: none within a pixel of a coarse grid, and a fine
        // grid that would catch them all is not believed.
        assert!(detect_square_lattice(&scattered(40), 1.0 / PX, PX, Outliers::Few).is_none());
        assert!(detect_square_lattice(&scattered(400), 1.5 / PX, PX, Outliers::Few).is_none());
    }

    #[test]
    fn repeated_coordinates_count_once() {
        // Twelve vertices on three lines are three readings: not enough.
        let coordinates: Vec<f64> = (0..12).map(|i| f64::from(i % 3) / 8.0).collect();
        assert!(detect_square_lattice(&coordinates, 1.0 / PX, PX, Outliers::None).is_none());
    }

    #[test]
    fn too_few_coordinates_are_no_evidence() {
        let coordinates = grid_coordinates(8, 6, 0.0);
        assert!(detect_square_lattice(&coordinates, 1.0 / PX, PX, Outliers::None).is_none());
    }

    #[test]
    fn a_vertex_off_the_grid_refuses_the_lattice() {
        let mut coordinates = grid_coordinates(16, 60, 0.0);
        coordinates.push(3.0 / 16.0 + 4.3 / PX);
        assert!(detect_square_lattice(&coordinates, 1.0 / PX, PX, Outliers::Few).is_none());
        assert!(detect_square_lattice(&coordinates, 1.0 / PX, PX, Outliers::None).is_none());
    }

    #[test]
    fn a_half_grid_used_by_a_few_vertices_earns_the_finer_lattice() {
        // Sixty coordinates on an 8-grid and six distinct ones on its half
        // grid: 8 cannot hold the six, and 16 explains them all.
        let mut coordinates = grid_coordinates(8, 60, 0.0);
        for k in [1, 3, 5, 7, 9, 11] {
            coordinates.push(k as f64 / 16.0);
        }
        let lattice =
            detect_square_lattice(&coordinates, 1.0 / PX, PX, Outliers::None).expect("lattice");
        assert_eq!(lattice.cells, 16);
    }

    #[test]
    fn a_few_vertices_a_little_further_off_are_tolerated() {
        // One coordinate in a hundred at 1.8 px, within the outlier reach:
        // the lattice is read when a few outliers are allowed, and the
        // reading reports it; not when none are.
        let mut coordinates = grid_coordinates(16, 100, 0.3 / PX);
        coordinates.push(5.0 / 16.0 + 1.8 / PX);
        let lattice =
            detect_square_lattice(&coordinates, 1.0 / PX, PX, Outliers::Few).expect("lattice");
        assert_eq!(lattice.cells, 16);
        assert!((lattice.max_offset - 1.8 / PX).abs() < 1e-12);
        assert!(detect_square_lattice(&coordinates, 1.0 / PX, PX, Outliers::None).is_none());
        // Three in a hundred is more than the few the lattice tolerates.
        for k in 1..3 {
            coordinates.push(k as f64 / 16.0 + 1.7 / PX);
        }
        assert!(detect_square_lattice(&coordinates, 1.0 / PX, PX, Outliers::Few).is_none());
    }

    #[test]
    fn snapping_lands_on_the_lattice() {
        let lattice = SquareLattice {
            cells: 32,
            max_offset: 0.0,
            chance: 0.0,
        };
        assert!((lattice.snap(0.5312) - 17.0 / 32.0).abs() < 1e-12);
        assert!((snap_to(0.999, 8) - 1.0).abs() < 1e-12);
    }
}
