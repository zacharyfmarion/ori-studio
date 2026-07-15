//! Compact, typed-array-friendly encoding of a crease-pattern document's geometry.
//!
//! The bulk geometry (line segments, aux segments, standalone points, circles) packs into
//! flat numeric vectors that cross the wasm boundary as JS typed arrays; the low-count /
//! non-numeric remainder (title, texts, grid, operation frame, metadata) rides in a small
//! serde "tail". This replaces `document_snapshot`'s O(n) JS-object-graph build + structured
//! clone on the hot render/interaction path with a flat, transfer-friendly encoding.
//!
//! It is **lossless and round-trippable**: `decode(&encode(doc)) == doc`. Coordinates are
//! kept as `f64` (they become `Float64Array` on the wire — never `f32`), so nothing on this
//! path loses precision. Correctness is guarded by the round-trip test below; `restore_from`
//! (the wasm side) uses `decode` so undo/redo restore an exact model.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use crate::CreasePatternDocument;
use crate::geometry::{ActiveState, Circle, LineColor, LineSegment, Point, RgbColor};
use crate::model::{CreasePatternModel, GridMetadata, TextElement};
use crate::operations::transform::OperationFrame;

/// Per-segment attribute stride: `[color, active, selected, customized]`.
const SEG_ATTR_STRIDE: usize = 4;
/// Per-circle attribute stride: `[color, customized]`.
const CIRCLE_ATTR_STRIDE: usize = 2;

/// Flat geometry buffers (destined for JS typed arrays) plus a small structured tail.
#[derive(Debug, Clone, PartialEq)]
pub struct CompactGeometry {
    /// `[ax, ay, bx, by]` per line segment.
    pub seg_endpoints: Vec<f64>,
    /// `[color, active, selected, customized]` per line segment.
    pub seg_attr: Vec<i32>,
    /// `[r, g, b]` per line segment (only meaningful when `customized`).
    pub seg_custom_color: Vec<u8>,
    pub aux_endpoints: Vec<f64>,
    pub aux_attr: Vec<i32>,
    pub aux_custom_color: Vec<u8>,
    /// `[x, y]` per standalone point.
    pub point_coords: Vec<f64>,
    /// `[x, y, r]` per circle.
    pub circle_data: Vec<f64>,
    /// `[color, customized]` per circle.
    pub circle_attr: Vec<i32>,
    /// `[r, g, b]` per circle.
    pub circle_custom_color: Vec<u8>,
    pub tail: CompactTail,
}

/// Low-count / non-numeric document remainder (serde-serialized; always small).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompactTail {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub texts: Vec<TextElement>,
    #[serde(default)]
    pub grid: GridMetadata,
    #[serde(default)]
    pub operation_frame: OperationFrame,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

fn active_state_code(active: ActiveState) -> i32 {
    active as i32
}

fn active_state_from_code(code: i32) -> ActiveState {
    match code {
        1 => ActiveState::ActiveA1,
        2 => ActiveState::ActiveB2,
        3 => ActiveState::ActiveBoth3,
        _ => ActiveState::Inactive0,
    }
}

fn encode_segments(segments: &[LineSegment]) -> (Vec<f64>, Vec<i32>, Vec<u8>) {
    let mut endpoints = Vec::with_capacity(segments.len() * 4);
    let mut attr = Vec::with_capacity(segments.len() * SEG_ATTR_STRIDE);
    let mut custom = Vec::with_capacity(segments.len() * 3);
    for segment in segments {
        endpoints.push(segment.a.x);
        endpoints.push(segment.a.y);
        endpoints.push(segment.b.x);
        endpoints.push(segment.b.y);
        attr.push(segment.color.number());
        attr.push(active_state_code(segment.active));
        attr.push(segment.selected);
        attr.push(segment.customized);
        custom.push(segment.customized_color.red);
        custom.push(segment.customized_color.green);
        custom.push(segment.customized_color.blue);
    }
    (endpoints, attr, custom)
}

fn decode_segments(
    endpoints: &[f64],
    attr: &[i32],
    custom: &[u8],
) -> Result<Vec<LineSegment>, String> {
    let count = endpoints.len() / 4;
    if endpoints.len() != count * 4
        || attr.len() != count * SEG_ATTR_STRIDE
        || custom.len() != count * 3
    {
        return Err("compact segment buffers have inconsistent lengths".to_string());
    }
    let mut segments = Vec::with_capacity(count);
    for i in 0..count {
        let e = i * 4;
        let a = i * SEG_ATTR_STRIDE;
        let c = i * 3;
        let color = LineColor::from_number(attr[a]).map_err(|err| err.to_string())?;
        segments.push(LineSegment {
            a: Point {
                x: endpoints[e],
                y: endpoints[e + 1],
            },
            b: Point {
                x: endpoints[e + 2],
                y: endpoints[e + 3],
            },
            active: active_state_from_code(attr[a + 1]),
            color,
            selected: attr[a + 2],
            customized: attr[a + 3],
            customized_color: RgbColor::new(custom[c], custom[c + 1], custom[c + 2]),
        });
    }
    Ok(segments)
}

/// Encode a document's geometry into flat buffers + tail. Lossless.
pub fn encode(document: &CreasePatternDocument) -> CompactGeometry {
    let model = &document.crease_pattern;
    let (seg_endpoints, seg_attr, seg_custom_color) = encode_segments(&model.line_segments);
    let (aux_endpoints, aux_attr, aux_custom_color) = encode_segments(&model.aux_line_segments);

    let mut point_coords = Vec::with_capacity(model.points.len() * 2);
    for point in &model.points {
        point_coords.push(point.x);
        point_coords.push(point.y);
    }

    let mut circle_data = Vec::with_capacity(model.circles.len() * 3);
    let mut circle_attr = Vec::with_capacity(model.circles.len() * CIRCLE_ATTR_STRIDE);
    let mut circle_custom_color = Vec::with_capacity(model.circles.len() * 3);
    for circle in &model.circles {
        circle_data.push(circle.x);
        circle_data.push(circle.y);
        circle_data.push(circle.r);
        circle_attr.push(circle.color.number());
        circle_attr.push(circle.customized);
        circle_custom_color.push(circle.customized_color.red);
        circle_custom_color.push(circle.customized_color.green);
        circle_custom_color.push(circle.customized_color.blue);
    }

    CompactGeometry {
        seg_endpoints,
        seg_attr,
        seg_custom_color,
        aux_endpoints,
        aux_attr,
        aux_custom_color,
        point_coords,
        circle_data,
        circle_attr,
        circle_custom_color,
        tail: CompactTail {
            title: document.title.clone(),
            texts: model.texts.clone(),
            grid: model.grid,
            operation_frame: document.operation_frame.clone(),
            metadata: document.metadata.clone(),
        },
    }
}

/// Rebuild an exact document from a compact encoding. Inverse of [`encode`].
pub fn decode(compact: &CompactGeometry) -> Result<CreasePatternDocument, String> {
    let line_segments = decode_segments(
        &compact.seg_endpoints,
        &compact.seg_attr,
        &compact.seg_custom_color,
    )?;
    let aux_line_segments = decode_segments(
        &compact.aux_endpoints,
        &compact.aux_attr,
        &compact.aux_custom_color,
    )?;

    let point_count = compact.point_coords.len() / 2;
    if compact.point_coords.len() != point_count * 2 {
        return Err("compact point buffer has an odd length".to_string());
    }
    let points = (0..point_count)
        .map(|i| Point {
            x: compact.point_coords[i * 2],
            y: compact.point_coords[i * 2 + 1],
        })
        .collect();

    let circle_count = compact.circle_data.len() / 3;
    if compact.circle_data.len() != circle_count * 3
        || compact.circle_attr.len() != circle_count * CIRCLE_ATTR_STRIDE
        || compact.circle_custom_color.len() != circle_count * 3
    {
        return Err("compact circle buffers have inconsistent lengths".to_string());
    }
    let mut circles = Vec::with_capacity(circle_count);
    for i in 0..circle_count {
        let d = i * 3;
        let a = i * CIRCLE_ATTR_STRIDE;
        let color =
            LineColor::from_number(compact.circle_attr[a]).map_err(|err| err.to_string())?;
        circles.push(Circle {
            x: compact.circle_data[d],
            y: compact.circle_data[d + 1],
            r: compact.circle_data[d + 2],
            color,
            customized: compact.circle_attr[a + 1],
            customized_color: RgbColor::new(
                compact.circle_custom_color[d],
                compact.circle_custom_color[d + 1],
                compact.circle_custom_color[d + 2],
            ),
        });
    }

    Ok(CreasePatternDocument {
        title: compact.tail.title.clone(),
        crease_pattern: CreasePatternModel {
            line_segments,
            circles,
            points,
            aux_line_segments,
            texts: compact.tail.texts.clone(),
            grid: compact.tail.grid,
        },
        operation_frame: compact.tail.operation_frame.clone(),
        metadata: compact.tail.metadata.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(
        a: (f64, f64),
        b: (f64, f64),
        color: LineColor,
        active: ActiveState,
        selected: i32,
        customized: i32,
        rgb: (u8, u8, u8),
    ) -> LineSegment {
        LineSegment {
            a: Point { x: a.0, y: a.1 },
            b: Point { x: b.0, y: b.1 },
            active,
            color,
            selected,
            customized,
            customized_color: RgbColor::new(rgb.0, rgb.1, rgb.2),
        }
    }

    /// A battery of documents that exercises every field the codec touches.
    fn battery() -> Vec<CreasePatternDocument> {
        let mut docs = Vec::new();

        // Empty.
        docs.push(CreasePatternDocument::default());

        // Every line color + a spread of active/selected/customized + custom colors.
        let colors = [
            LineColor::Angle,
            LineColor::None,
            LineColor::Black0,
            LineColor::Red1,
            LineColor::Blue2,
            LineColor::Cyan3,
            LineColor::Orange4,
            LineColor::Magenta5,
            LineColor::Green6,
            LineColor::Yellow7,
            LineColor::Purple8,
            LineColor::Other9,
            LineColor::Grey10,
        ];
        let actives = [
            ActiveState::Inactive0,
            ActiveState::ActiveA1,
            ActiveState::ActiveB2,
            ActiveState::ActiveBoth3,
        ];
        let mut mixed = CreasePatternDocument::default();
        for (i, color) in colors.iter().enumerate() {
            mixed.crease_pattern.line_segments.push(segment(
                (i as f64, -(i as f64)),
                (i as f64 + 0.123_456_789, 7.5),
                *color,
                actives[i % actives.len()],
                (i as i32) % 3, // 0, 1, 2 — exercises the rich `selected` value
                (i as i32) % 2,
                (i as u8, (255 - i) as u8, (i * 7) as u8),
            ));
        }
        // Aux segments, points, circles (plain + customized), texts (incl. unicode), grid.
        mixed.crease_pattern.aux_line_segments.push(segment(
            (-3.0, -3.0),
            (3.0, 3.0),
            LineColor::Cyan3,
            ActiveState::Inactive0,
            0,
            0,
            (0, 0, 0),
        ));
        mixed.crease_pattern.points.push(Point { x: 1.25, y: -2.5 });
        mixed.crease_pattern.points.push(Point { x: 0.0, y: 0.0 });
        mixed.crease_pattern.circles.push(Circle {
            x: 2.0,
            y: 3.0,
            r: 4.5,
            color: LineColor::Red1,
            customized: 0,
            customized_color: RgbColor::new(0, 0, 0),
        });
        mixed.crease_pattern.circles.push(Circle {
            x: -1.0,
            y: -1.0,
            r: 0.001,
            color: LineColor::Magenta5,
            customized: 1,
            customized_color: RgbColor::new(10, 20, 30),
        });
        mixed
            .crease_pattern
            .texts
            .push(TextElement::new(5.0, 6.0, "hello"));
        mixed
            .crease_pattern
            .texts
            .push(TextElement::new(-5.0, -6.0, "折り紙 🦀"));
        mixed.crease_pattern.grid.grid_size = 16;
        mixed.title = Some("mixed".to_string());
        mixed
            .metadata
            .insert("k".to_string(), serde_json::json!({ "a": [1, 2, 3] }));
        docs.push(mixed);

        // Extreme / degenerate coordinates.
        let mut extreme = CreasePatternDocument::default();
        extreme.crease_pattern.line_segments.push(segment(
            (1e12, -1e12),
            (1e-9, 1e-9),
            LineColor::Black0,
            ActiveState::Inactive0,
            0,
            0,
            (0, 0, 0),
        ));
        // Duplicate coordinate (a real coincident endpoint).
        extreme.crease_pattern.line_segments.push(segment(
            (1e-9, 1e-9),
            (1e-9, 1e-9),
            LineColor::Red1,
            ActiveState::Inactive0,
            0,
            0,
            (0, 0, 0),
        ));
        docs.push(extreme);

        docs
    }

    #[test]
    fn round_trips_the_battery_exactly() {
        for (index, doc) in battery().into_iter().enumerate() {
            let restored = decode(&encode(&doc))
                .unwrap_or_else(|err| panic!("battery doc {index} failed to decode: {err}"));
            assert_eq!(restored, doc, "battery doc {index} did not round-trip");
        }
    }

    #[test]
    fn every_line_color_round_trips_through_the_code() {
        for number in [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] {
            let color = LineColor::from_number(number).unwrap();
            assert_eq!(color.number(), number);
            assert_eq!(LineColor::from_number(color.number()).unwrap(), color);
        }
    }

    #[test]
    fn every_active_state_round_trips_through_the_code() {
        for state in [
            ActiveState::Inactive0,
            ActiveState::ActiveA1,
            ActiveState::ActiveB2,
            ActiveState::ActiveBoth3,
        ] {
            assert_eq!(active_state_from_code(active_state_code(state)), state);
        }
    }
}
