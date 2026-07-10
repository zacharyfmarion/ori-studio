use crate::math::geometry::{PathPoint, map_directions};
use crate::shared::{QuadrantDirection, SlashDirection};

#[derive(Debug, Clone, PartialEq)]
pub struct HingeSegment {
    pub q: QuadrantDirection,
    pub points: Vec<PathPoint>,
}

pub fn create_hinge_segments(hinges: &[PathPoint], dir: SlashDirection) -> Vec<HingeSegment> {
    let len = hinges.len();
    if len == 0 {
        return Vec::new();
    }

    let directions = map_directions(hinges);
    let Some(start) = directions
        .iter()
        .position(|direction| direction % 2 != dir as u8)
    else {
        return Vec::new();
    };

    let mut results = Vec::new();
    let mut current_segment: Option<HingeSegment> = None;
    for i in 0..len {
        let index = (start + i) % len;
        let point = hinges[index];
        if let Some(segment) = current_segment.as_mut() {
            segment.points.push(point);
            if directions[index] != segment.q as u8
                && let Some(segment) = current_segment.take()
            {
                results.push(segment);
            }
        }
        if current_segment.is_none() {
            let next_dir = directions[(start + i + 1) % len];
            if next_dir % 2 == dir as u8 {
                current_segment = Some(HingeSegment {
                    q: quadrant_direction(next_dir),
                    points: vec![point],
                });
            }
        }
    }

    if let Some(mut segment) = current_segment {
        segment.points.push(hinges[start]);
        results.push(segment);
    }
    results
}

fn quadrant_direction(value: u8) -> QuadrantDirection {
    match value {
        0 => QuadrantDirection::Ur,
        1 => QuadrantDirection::Ul,
        2 => QuadrantDirection::Ll,
        _ => QuadrantDirection::Lr,
    }
}
