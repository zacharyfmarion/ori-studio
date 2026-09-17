//! Refine an already-detected paper outline to the center of its dark stroke.
//! This does not search for another panel or alter a user's manual crop.
use super::*;

fn neutral_ink(analysis: &ImageAnalysis, p: Point) -> f64 {
    if p.x < 0.
        || p.y < 0.
        || p.x > (analysis.width - 1) as f32
        || p.y > (analysis.height - 1) as f32
    {
        return 0.;
    }
    let rgb = sample_rgb(analysis, p.x, p.y);
    let hi = f64::from(*rgb.iter().max().unwrap_or(&255)) / 255.;
    let lo = f64::from(*rgb.iter().min().unwrap_or(&255)) / 255.;
    (1. - hi - (hi - lo)).max(0.)
}

pub(super) fn refine(analysis: &ImageAnalysis, quad: Quad) -> Option<(Quad, Value)> {
    let points = quad.points();
    let mut lines = Vec::new();
    let mut reports = Vec::new();
    for side in 0..4 {
        let a = points[side];
        let b = points[(side + 1) % 4];
        let dx = f64::from(b.x - a.x);
        let dy = f64::from(b.y - a.y);
        let length = dx.hypot(dy);
        if length < 40. {
            return None;
        }
        let normal = [-dy / length, dx / length];
        let mut profile = Vec::new();
        for k in 0..=120 {
            let offset = -3. + f64::from(k) * 0.05;
            let mut sum = 0.;
            let mut covered = 0;
            for j in 0..200 {
                let t = 0.03 + 0.94 * f64::from(j) / 199.;
                let value = neutral_ink(
                    analysis,
                    Point {
                        x: (f64::from(a.x) + dx * t + normal[0] * offset) as f32,
                        y: (f64::from(a.y) + dy * t + normal[1] * offset) as f32,
                    },
                );
                sum += value;
                covered += usize::from(value > 0.2);
            }
            profile.push((offset, sum / 200., covered));
        }
        let best = profile.iter().max_by(|a, b| a.1.total_cmp(&b.1))?;
        let mut values: Vec<_> = profile.iter().map(|p| p.1).collect();
        values.sort_by(f64::total_cmp);
        let background = values[values.len() / 5];
        if best.1 - background < 0.15 || best.2 < 160 || best.0.abs() > 2.5 {
            return None;
        }
        let mass: f64 = profile.iter().map(|p| (p.1 - background).max(0.)).sum();
        if mass < 1e-6 {
            return None;
        }
        let shift = profile
            .iter()
            .map(|p| p.0 * (p.1 - background).max(0.))
            .sum::<f64>()
            / mass;
        let variance = profile
            .iter()
            .map(|p| (p.0 - shift).powi(2) * (p.1 - background).max(0.))
            .sum::<f64>()
            / mass;
        // A broad/multiline cross-section does not locate one unambiguous edge.
        if variance > 1.5 || shift.abs() > 2. {
            return None;
        }
        lines.push((
            normal,
            normal[0] * f64::from(a.x) + normal[1] * f64::from(a.y) + shift,
        ));
        reports.push(
            json!({"offset_px":shift,"contrast":best.1-background,"coverage":best.2 as f64/200.}),
        );
    }
    let mut corners = Vec::new();
    for i in 0..4 {
        let (a, x) = lines[(i + 3) % 4];
        let (b, y) = lines[i];
        let det = a[0] * b[1] - a[1] * b[0];
        if det.abs() < 0.5 {
            return None;
        }
        corners.push(Point {
            x: ((x * b[1] - a[1] * y) / det) as f32,
            y: ((a[0] * y - x * b[0]) / det) as f32,
        });
    }
    let refined = Quad {
        top_left: corners[0],
        top_right: corners[1],
        bottom_right: corners[2],
        bottom_left: corners[3],
    };
    Some((refined, json!({"before":quad,"sides":reports})))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outline(color: [u8; 3]) -> ImageAnalysis {
        let mut rgb = vec![255; 128 * 128 * 3];
        for y in 10..=116 {
            for x in 11..=117 {
                if x == 11 || x == 117 || y == 10 || y == 116 {
                    rgb[(y * 128 + x) * 3..(y * 128 + x) * 3 + 3].copy_from_slice(&color);
                }
            }
        }
        ImageAnalysis {
            rgb,
            edges: vec![false; 128 * 128],
            width: 128,
            height: 128,
            padding_rgb: [255; 3],
            edge_density: 0.,
        }
    }

    #[test]
    fn centers_the_outline_instead_of_its_inside_edge() {
        let quad = Quad {
            top_left: Point { x: 12., y: 11. },
            top_right: Point { x: 116., y: 11. },
            bottom_right: Point { x: 116., y: 115. },
            bottom_left: Point { x: 12., y: 115. },
        };
        let (q, _) = refine(&outline([0, 0, 0]), quad).unwrap();
        for (actual, expected) in
            q.points()
                .iter()
                .zip([[11., 10.], [117., 10.], [117., 116.], [11., 116.]])
        {
            assert!((actual.x - expected[0]).abs() < 0.02);
            assert!((actual.y - expected[1]).abs() < 0.02);
        }
    }

    #[test]
    fn colored_creases_do_not_redefine_the_paper_outline() {
        assert!(refine(&outline([255, 0, 0]), Quad::square(12., 115.)).is_none());
    }
}
