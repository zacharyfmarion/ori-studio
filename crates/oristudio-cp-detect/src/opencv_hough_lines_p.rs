//! OpenCV-compatible CPU `HoughLinesP` port.
//!
//! This module is intentionally developed behind oracle parity tests. Until
//! `hough_lines_p_opencv_cpu` is complete, callers must treat it as unavailable.
//!
//! The implementation is derived from OpenCV's CPU HoughLinesP implementation:
//! `modules/imgproc/src/hough.cpp`, especially `HoughLinesProbabilistic`.
//! OpenCV is distributed under the Apache 2.0 license; keep this attribution
//! with any derived implementation.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use thiserror::Error;

const RNG_COEFF: u64 = 4_164_903_690;
const FIXED_POINT_SHIFT: i32 = 16;
const FIXED_POINT_HALF: i64 = 1 << (FIXED_POINT_SHIFT - 1);

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HoughLinesPConfig {
    pub rho: f32,
    pub theta: f32,
    pub threshold: i32,
    pub min_line_length: f64,
    pub max_line_gap: f64,
    pub lines_max: i32,
}

impl Default for HoughLinesPConfig {
    fn default() -> Self {
        Self {
            rho: 1.0,
            theta: std::f32::consts::PI / 720.0,
            threshold: 10,
            min_line_length: 6.0,
            max_line_gap: 4.0,
            lines_max: i32::MAX,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct HoughSegment {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
}

#[derive(Debug, Error)]
pub enum HoughError {
    #[error("OpenCV-compatible HoughLinesP port is not implemented yet")]
    NotImplemented,
    #[error("invalid HoughLinesP input: {0}")]
    InvalidInput(&'static str),
}

pub fn hough_lines_p_opencv_cpu(
    image: &[u8],
    width: usize,
    height: usize,
    config: &HoughLinesPConfig,
) -> Result<Vec<HoughSegment>, HoughError> {
    validate_config(image, width, height, config)?;
    let line_length = cv_round_f64(config.min_line_length);
    let line_gap = cv_round_f64(config.max_line_gap);
    let numangle = compute_numangle(0.0, std::f64::consts::PI, config.theta as f64);
    let numrho = compute_numrho(width, height, config.rho);
    let trig_table = build_trig_table(numangle, config.theta, config.rho);
    let mut accum = vec![0i32; numangle as usize * numrho as usize];
    let (mut mask, mut nzloc) = collect_nonzero_mask(image, width, height)?;
    let mut rng = OpenCvRng::new(u64::MAX);
    let mut lines = Vec::new();
    let mut count = nzloc.len();

    while count > 0 {
        let idx = rng.uniform(0, count as i32) as usize;
        let point = nzloc[idx];
        nzloc[idx] = nzloc[count - 1];
        count -= 1;

        let i = point.y;
        let j = point.x;
        if mask[point_index(point, width)] == 0 {
            continue;
        }

        let mut max_val = config.threshold - 1;
        let mut max_n = 0usize;
        for (n, trig) in trig_table.iter().enumerate() {
            let r = hough_rho_index(j, i, *trig, numrho);
            let accum_idx = accumulator_index(n, r, numrho).ok_or(HoughError::InvalidInput(
                "rho index out of accumulator range",
            ))?;
            accum[accum_idx] += 1;
            let val = accum[accum_idx];
            if max_val < val {
                max_val = val;
                max_n = n;
            }
        }

        if max_val < config.threshold {
            continue;
        }

        let setup = line_walk_setup(point, trig_table[max_n]);
        let line_end = find_line_ends(point, setup, &mask, width, height, line_gap);
        let good_line = (line_end[1].x - line_end[0].x).abs() >= line_length
            || (line_end[1].y - line_end[0].y).abs() >= line_length;

        clear_line_points(
            setup,
            line_end,
            good_line,
            &mut mask,
            &mut accum,
            &trig_table,
            width,
            numrho,
        )?;

        if good_line {
            lines.push(HoughSegment {
                x1: line_end[0].x,
                y1: line_end[0].y,
                x2: line_end[1].x,
                y2: line_end[1].y,
            });
            if lines.len() >= config.lines_max as usize {
                return Ok(lines);
            }
        }
    }

    Ok(lines)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TrigEntry {
    pub cos_irho: f32,
    pub sin_irho: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WalkSetup {
    pub xflag: bool,
    pub x0: i64,
    pub y0: i64,
    pub dx0: i64,
    pub dy0: i64,
}

pub(crate) fn cv_round_f64(value: f64) -> i32 {
    value.round_ties_even() as i32
}

pub(crate) fn cv_round_f32(value: f32) -> i32 {
    value.round_ties_even() as i32
}

pub(crate) fn cv_floor(value: f64) -> i32 {
    value.floor() as i32
}

pub(crate) fn compute_numangle(min_theta: f64, max_theta: f64, theta_step: f64) -> i32 {
    let mut numangle = cv_floor((max_theta - min_theta) / theta_step) + 1;
    if numangle > 1
        && (std::f64::consts::PI - (numangle - 1) as f64 * theta_step).abs() < theta_step / 2.0
    {
        numangle -= 1;
    }
    numangle
}

pub(crate) fn compute_numrho(width: usize, height: usize, rho: f32) -> i32 {
    cv_round_f32(((width + height) * 2 + 1) as f32 / rho)
}

pub(crate) fn build_trig_table(numangle: i32, theta: f32, rho: f32) -> Vec<TrigEntry> {
    let irho = 1.0 / rho;
    (0..numangle)
        .map(|n| {
            let angle = n as f64 * theta as f64;
            TrigEntry {
                cos_irho: (angle.cos() * irho as f64) as f32,
                sin_irho: (angle.sin() * irho as f64) as f32,
            }
        })
        .collect()
}

pub(crate) fn accumulator_index(theta_idx: usize, rho_idx: i32, numrho: i32) -> Option<usize> {
    if (0..numrho).contains(&rho_idx) {
        Some(theta_idx * numrho as usize + rho_idx as usize)
    } else {
        None
    }
}

pub(crate) fn hough_rho_index(x: i32, y: i32, trig: TrigEntry, numrho: i32) -> i32 {
    let r = cv_round_f32(x as f32 * trig.cos_irho + y as f32 * trig.sin_irho);
    r + (numrho - 1) / 2
}

pub(crate) fn collect_nonzero_mask(
    image: &[u8],
    width: usize,
    height: usize,
) -> Result<(Vec<u8>, Vec<Point>), HoughError> {
    if width == 0 || height == 0 {
        return Err(HoughError::InvalidInput(
            "width and height must be positive",
        ));
    }
    if image.len() != width * height {
        return Err(HoughError::InvalidInput(
            "image length must equal width * height",
        ));
    }
    let mut mask = vec![0u8; width * height];
    let mut points = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            if image[idx] != 0 {
                mask[idx] = 1;
                points.push(Point {
                    x: x as i32,
                    y: y as i32,
                });
            }
        }
    }
    Ok((mask, points))
}

pub(crate) fn line_walk_setup(seed: Point, trig: TrigEntry) -> WalkSetup {
    let a = -trig.sin_irho;
    let b = trig.cos_irho;
    let mut x0 = seed.x as i64;
    let mut y0 = seed.y as i64;
    if a.abs() > b.abs() {
        let dx0 = if a > 0.0 { 1 } else { -1 };
        let dy0 = cv_round_f32(b * (1 << FIXED_POINT_SHIFT) as f32 / a.abs()) as i64;
        y0 = (y0 << FIXED_POINT_SHIFT) + FIXED_POINT_HALF;
        WalkSetup {
            xflag: true,
            x0,
            y0,
            dx0,
            dy0,
        }
    } else {
        let dy0 = if b > 0.0 { 1 } else { -1 };
        let dx0 = cv_round_f32(a * (1 << FIXED_POINT_SHIFT) as f32 / b.abs()) as i64;
        x0 = (x0 << FIXED_POINT_SHIFT) + FIXED_POINT_HALF;
        WalkSetup {
            xflag: false,
            x0,
            y0,
            dx0,
            dy0,
        }
    }
}

fn validate_config(
    image: &[u8],
    width: usize,
    height: usize,
    config: &HoughLinesPConfig,
) -> Result<(), HoughError> {
    if width == 0 || height == 0 {
        return Err(HoughError::InvalidInput(
            "width and height must be positive",
        ));
    }
    if image.len() != width * height {
        return Err(HoughError::InvalidInput(
            "image length must equal width * height",
        ));
    }
    if !config.rho.is_finite() || config.rho <= 0.0 {
        return Err(HoughError::InvalidInput("rho must be positive"));
    }
    if !config.theta.is_finite() || config.theta <= 0.0 {
        return Err(HoughError::InvalidInput("theta must be positive"));
    }
    if config.threshold <= 0 {
        return Err(HoughError::InvalidInput("threshold must be positive"));
    }
    if config.lines_max <= 0 {
        return Err(HoughError::InvalidInput("lines_max must be positive"));
    }
    Ok(())
}

fn find_line_ends(
    seed: Point,
    setup: WalkSetup,
    mask: &[u8],
    width: usize,
    height: usize,
    line_gap: i32,
) -> [Point; 2] {
    let mut line_end = [seed, seed];
    for (k, end) in line_end.iter_mut().enumerate() {
        let mut gap = 0;
        let mut x = setup.x0;
        let mut y = setup.y0;
        let mut dx = setup.dx0;
        let mut dy = setup.dy0;
        if k > 0 {
            dx = -dx;
            dy = -dy;
        }
        loop {
            let point = walk_point(setup.xflag, x, y);
            if point.x < 0 || point.x >= width as i32 || point.y < 0 || point.y >= height as i32 {
                break;
            }
            if mask[point_index(point, width)] != 0 {
                gap = 0;
                *end = point;
            } else {
                gap += 1;
                if gap > line_gap {
                    break;
                }
            }
            x += dx;
            y += dy;
        }
    }
    line_end
}

#[expect(clippy::too_many_arguments)]
fn clear_line_points(
    setup: WalkSetup,
    line_end: [Point; 2],
    good_line: bool,
    mask: &mut [u8],
    accum: &mut [i32],
    trig_table: &[TrigEntry],
    width: usize,
    numrho: i32,
) -> Result<(), HoughError> {
    for (k, end) in line_end.iter().enumerate() {
        let mut x = setup.x0;
        let mut y = setup.y0;
        let mut dx = setup.dx0;
        let mut dy = setup.dy0;
        if k > 0 {
            dx = -dx;
            dy = -dy;
        }
        loop {
            let point = walk_point(setup.xflag, x, y);
            let idx = point_index(point, width);
            if mask[idx] != 0 {
                if good_line {
                    for (n, trig) in trig_table.iter().enumerate() {
                        let r = hough_rho_index(point.x, point.y, *trig, numrho);
                        let accum_idx = accumulator_index(n, r, numrho).ok_or(
                            HoughError::InvalidInput("rho index out of accumulator range"),
                        )?;
                        accum[accum_idx] -= 1;
                    }
                }
                mask[idx] = 0;
            }
            if point == *end {
                break;
            }
            x += dx;
            y += dy;
        }
    }
    Ok(())
}

fn walk_point(xflag: bool, x: i64, y: i64) -> Point {
    if xflag {
        Point {
            x: x as i32,
            y: (y >> FIXED_POINT_SHIFT) as i32,
        }
    } else {
        Point {
            x: (x >> FIXED_POINT_SHIFT) as i32,
            y: y as i32,
        }
    }
}

fn point_index(point: Point, width: usize) -> usize {
    point.y as usize * width + point.x as usize
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OpenCvRng {
    state: u64,
}

impl OpenCvRng {
    pub(crate) fn new(state: u64) -> Self {
        Self {
            state: if state == 0 { 0xffff_ffff } else { state },
        }
    }

    pub(crate) fn next(&mut self) -> u32 {
        self.state = (self.state as u32 as u64) * RNG_COEFF + (self.state >> 32);
        self.state as u32
    }

    pub(crate) fn uniform(&mut self, a: i32, b: i32) -> i32 {
        if a == b {
            a
        } else {
            (self.next() % (b - a) as u32) as i32 + a
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    use serde::Deserialize;

    #[test]
    fn cv_round_matches_ties_to_even() {
        assert_eq!(cv_round_f64(0.5), 0);
        assert_eq!(cv_round_f64(1.5), 2);
        assert_eq!(cv_round_f64(2.5), 2);
        assert_eq!(cv_round_f64(-0.5), 0);
        assert_eq!(cv_round_f64(-1.5), -2);
        assert_eq!(cv_round_f32(3.5), 4);
        assert_eq!(cv_round_f32(4.5), 4);
    }

    #[test]
    fn compute_numangle_removes_duplicate_pi_bin() {
        assert_eq!(
            compute_numangle(0.0, std::f64::consts::PI, std::f64::consts::PI / 720.0),
            720
        );
        assert_eq!(
            compute_numangle(0.0, std::f64::consts::PI, std::f64::consts::PI / 180.0),
            180
        );
        assert_eq!(compute_numangle(0.0, 1.0, 0.25), 5);
    }

    #[test]
    fn numrho_matches_opencv_formula() {
        assert_eq!(compute_numrho(32, 32, 1.0), 129);
        assert_eq!(compute_numrho(31, 17, 2.0), 48);
    }

    #[test]
    fn trig_table_and_rho_index_match_expected_bins() {
        let table = build_trig_table(720, std::f32::consts::PI / 720.0, 1.0);
        let numrho = compute_numrho(32, 32, 1.0);
        assert_eq!(table.len(), 720);
        assert_eq!(hough_rho_index(16, 4, table[0], numrho), 80);
        assert_eq!(accumulator_index(3, 7, numrho), Some(394));
        assert_eq!(accumulator_index(3, -1, numrho), None);
        assert_eq!(accumulator_index(3, numrho, numrho), None);
    }

    #[test]
    fn collect_nonzero_is_row_major_and_mask_is_binary() {
        let image = [
            0u8, 5, 0, //
            7, 0, 9,
        ];
        let (mask, points) = collect_nonzero_mask(&image, 3, 2).unwrap();
        assert_eq!(mask, vec![0, 1, 0, 1, 0, 1]);
        assert_eq!(
            points,
            vec![
                Point { x: 1, y: 0 },
                Point { x: 0, y: 1 },
                Point { x: 2, y: 1 },
            ]
        );
    }

    #[test]
    fn opencv_rng_matches_source_sequence() {
        let mut rng = OpenCvRng::new(u64::MAX);
        assert_eq!(rng.next(), 130_063_605);
        assert_eq!(rng.next(), 3_133_359_004);
        assert_eq!(rng.next(), 2_578_348_940);
        let mut rng = OpenCvRng::new(u64::MAX);
        assert_eq!(rng.uniform(0, 14), 7);
        assert_eq!(rng.uniform(0, 13), 9);
        assert_eq!(rng.uniform(0, 12), 8);
    }

    #[test]
    fn line_walk_setup_matches_axis_cases() {
        let table = build_trig_table(720, std::f32::consts::PI / 720.0, 1.0);
        let vertical = line_walk_setup(Point { x: 16, y: 4 }, table[0]);
        assert_eq!(
            vertical,
            WalkSetup {
                xflag: false,
                x0: (16 << FIXED_POINT_SHIFT) + FIXED_POINT_HALF,
                y0: 4,
                dx0: 0,
                dy0: 1,
            }
        );
        let horizontal = line_walk_setup(Point { x: 4, y: 16 }, table[360]);
        assert_eq!(
            horizontal,
            WalkSetup {
                xflag: true,
                x0: 4,
                y0: (16 << FIXED_POINT_SHIFT) + FIXED_POINT_HALF,
                dx0: -1,
                dy0: 0,
            }
        );
    }

    #[test]
    fn hough_lines_p_matches_tiny_opencv_oracle() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/houghlinesp_tiny");
        let manifest: TestManifest =
            serde_json::from_str(&fs::read_to_string(root.join("manifest.json")).unwrap()).unwrap();
        let config = HoughLinesPConfig {
            rho: manifest.config.rho,
            theta: manifest.config.theta,
            threshold: manifest.config.threshold,
            min_line_length: manifest.config.min_line_length,
            max_line_gap: manifest.config.max_line_gap,
            lines_max: i32::MAX,
        };
        for fixture in manifest.fixtures {
            let (width, height, mask) = read_test_pgm(&root.join(&fixture.mask_path));
            let oracle: Vec<HoughSegment> = serde_json::from_str::<Vec<[i32; 4]>>(
                &fs::read_to_string(root.join(&fixture.oracle_segments_path)).unwrap(),
            )
            .unwrap()
            .into_iter()
            .map(|row| HoughSegment {
                x1: row[0],
                y1: row[1],
                x2: row[2],
                y2: row[3],
            })
            .collect();
            let actual = hough_lines_p_opencv_cpu(&mask, width, height, &config)
                .unwrap_or_else(|error| panic!("{}: {error}", fixture.id));
            assert_eq!(actual, oracle, "fixture {}", fixture.id);
        }
    }

    #[derive(Debug, Deserialize)]
    struct TestManifest {
        config: TestConfig,
        fixtures: Vec<TestFixture>,
    }

    #[derive(Debug, Deserialize)]
    struct TestConfig {
        rho: f32,
        theta: f32,
        threshold: i32,
        min_line_length: f64,
        max_line_gap: f64,
    }

    #[derive(Debug, Deserialize)]
    struct TestFixture {
        id: String,
        mask_path: String,
        oracle_segments_path: String,
    }

    fn read_test_pgm(path: &Path) -> (usize, usize, Vec<u8>) {
        let bytes = fs::read(path).unwrap();
        let mut idx = 0usize;
        assert_eq!(next_token(&bytes, &mut idx).unwrap(), b"P5");
        let width: usize = std::str::from_utf8(next_token(&bytes, &mut idx).unwrap())
            .unwrap()
            .parse()
            .unwrap();
        let height: usize = std::str::from_utf8(next_token(&bytes, &mut idx).unwrap())
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(next_token(&bytes, &mut idx).unwrap(), b"255");
        while idx < bytes.len() && bytes[idx].is_ascii_whitespace() {
            idx += 1;
        }
        let data = bytes[idx..].to_vec();
        assert_eq!(data.len(), width * height);
        (width, height, data)
    }

    fn next_token<'a>(bytes: &'a [u8], idx: &mut usize) -> Option<&'a [u8]> {
        while *idx < bytes.len() && bytes[*idx].is_ascii_whitespace() {
            *idx += 1;
        }
        if *idx >= bytes.len() {
            return None;
        }
        let start = *idx;
        while *idx < bytes.len() && !bytes[*idx].is_ascii_whitespace() {
            *idx += 1;
        }
        Some(&bytes[start..*idx])
    }
}
