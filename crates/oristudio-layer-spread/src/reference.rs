use crate::{
    Input, Reference, SpreadError,
    prepare::{Prepared, value},
};
use nalgebra::{Matrix2, Vector2};

/// Center first: the intercept cannot destabilize the fitted slopes. The
/// symmetric eigendecomposition supplies a minimum-norm degenerate fallback.
pub fn fit(samples: &[[f64; 3]], weights: &[f64]) -> Reference {
    let mass: f64 = weights.iter().sum();
    let mut center = [0.; 3];
    for (sample, &w) in samples.iter().zip(weights) {
        for k in 0..3 {
            center[k] += sample[k] * w / mass;
        }
    }
    let mut covariance = Matrix2::zeros();
    let mut target = Vector2::zeros();
    for (sample, &w) in samples.iter().zip(weights) {
        let d = Vector2::new(sample[0] - center[0], sample[1] - center[1]);
        covariance += d * d.transpose() * (w / mass);
        target += d * ((sample[2] - center[2]) * w / mass);
    }
    let eig = covariance.symmetric_eigen();
    let threshold = eig.eigenvalues.max().max(1e-30) * 1e-12;
    let mut slope = Vector2::zeros();
    for k in 0..2 {
        if eig.eigenvalues[k] > threshold {
            let axis = eig.eigenvectors.column(k);
            slope += axis * (axis.dot(&target) / eig.eigenvalues[k]);
        }
    }
    let plane = [
        slope[0],
        slope[1],
        center[2] - slope[0] * center[0] - slope[1] * center[1],
    ];
    let rms = (samples
        .iter()
        .zip(weights)
        .map(|(p, &w)| {
            let r = p[2] - plane[0] * p[0] - plane[1] * p[1] - plane[2];
            w * r * r / mass
        })
        .sum::<f64>())
    .sqrt();
    Reference {
        plane,
        center,
        samples: samples.len(),
        rms,
    }
}

pub fn visible(
    input: &Input,
    p: &Prepared,
    z: &[f64],
    back: bool,
) -> Result<Reference, SpreadError> {
    let mut samples = Vec::new();
    let mut weights = Vec::new();
    for cell in &input.cells {
        let face = if back {
            cell.faces.last()
        } else {
            cell.faces.first()
        };
        let Some(&face) = face else {
            continue;
        };
        if cell.area <= 0. {
            continue;
        }
        let height = value(&p.at_face(input, face, cell.point)?, z);
        samples.push([cell.point[0], cell.point[1], height]);
        weights.push(cell.area);
    }
    if samples.is_empty() {
        return Err(SpreadError::Invalid("no visible surface".into()));
    }
    Ok(fit(&samples, &weights))
}
