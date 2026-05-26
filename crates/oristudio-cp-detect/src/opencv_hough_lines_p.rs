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
    _image: &[u8],
    _width: usize,
    _height: usize,
    _config: &HoughLinesPConfig,
) -> Result<Vec<HoughSegment>, HoughError> {
    Err(HoughError::NotImplemented)
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
            let angle = n as f32 * theta;
            TrigEntry {
                cos_irho: angle.cos() * irho,
                sin_irho: angle.sin() * irho,
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
}
