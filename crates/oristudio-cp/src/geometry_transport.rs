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
///
/// `Serialize`/`Deserialize` support the native (Tauri) IPC path; the wasm bridge
/// hand-builds typed arrays instead (`compact_to_js`). `camelCase` keeps the JSON
/// keys identical to the wasm-built object the frontend already consumes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// Magic + version header for [`CompactGeometry::to_bytes`] ("OCG1"). Bumping
/// the last byte is how the format version advances.
const COMPACT_GEOMETRY_MAGIC: u32 = 0x4f_43_47_31;

/// Single-buffer binary codec for the native (Tauri) IPC path.
///
/// The layout is a small, self-describing header followed by raw little-endian
/// array bytes, so the frontend receives one `ArrayBuffer` and slices it straight
/// into typed arrays — no JSON text serialize/parse (the hot desktop render
/// path). The wasm/web path is unaffected (it uses `compact_to_js`).
///
/// Layout (all integers little-endian `u32`):
/// ```text
/// magic(=OCG1) | 10 array element-counts (field order) | tail_byte_len
/// tail_bytes (serde_json of `CompactTail`)
/// seg_endpoints(f64) seg_attr(i32) seg_custom_color(u8)
/// aux_endpoints(f64) aux_attr(i32) aux_custom_color(u8)
/// point_coords(f64) circle_data(f64) circle_attr(i32) circle_custom_color(u8)
/// ```
/// The header carries every length, so [`CompactGeometry::from_bytes`] recomputes
/// the expected total and rejects any buffer whose size or magic disagrees —
/// making a Rust/TS format mismatch a loud error, never silent corruption.
impl CompactGeometry {
    const HEADER_U32S: usize = 12; // magic + 10 lengths + tail_len

    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        let tail = serde_json::to_vec(&self.tail).map_err(|error| error.to_string())?;
        let counts = [
            self.seg_endpoints.len(),
            self.seg_attr.len(),
            self.seg_custom_color.len(),
            self.aux_endpoints.len(),
            self.aux_attr.len(),
            self.aux_custom_color.len(),
            self.point_coords.len(),
            self.circle_data.len(),
            self.circle_attr.len(),
            self.circle_custom_color.len(),
        ];

        let capacity = Self::HEADER_U32S * 4
            + tail.len()
            + (self.seg_endpoints.len()
                + self.aux_endpoints.len()
                + self.point_coords.len()
                + self.circle_data.len())
                * 8
            + (self.seg_attr.len() + self.aux_attr.len() + self.circle_attr.len()) * 4
            + self.seg_custom_color.len()
            + self.aux_custom_color.len()
            + self.circle_custom_color.len();
        let mut out = Vec::with_capacity(capacity);

        out.extend_from_slice(&COMPACT_GEOMETRY_MAGIC.to_le_bytes());
        for count in counts {
            out.extend_from_slice(&(count as u32).to_le_bytes());
        }
        out.extend_from_slice(&(tail.len() as u32).to_le_bytes());
        out.extend_from_slice(&tail);

        let write_f64 = |out: &mut Vec<u8>, data: &[f64]| {
            for &v in data {
                out.extend_from_slice(&v.to_le_bytes());
            }
        };
        let write_i32 = |out: &mut Vec<u8>, data: &[i32]| {
            for &v in data {
                out.extend_from_slice(&v.to_le_bytes());
            }
        };
        write_f64(&mut out, &self.seg_endpoints);
        write_i32(&mut out, &self.seg_attr);
        out.extend_from_slice(&self.seg_custom_color);
        write_f64(&mut out, &self.aux_endpoints);
        write_i32(&mut out, &self.aux_attr);
        out.extend_from_slice(&self.aux_custom_color);
        write_f64(&mut out, &self.point_coords);
        write_f64(&mut out, &self.circle_data);
        write_i32(&mut out, &self.circle_attr);
        out.extend_from_slice(&self.circle_custom_color);
        Ok(out)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        let mut reader = ByteReader::new(bytes);
        if reader.read_u32()? != COMPACT_GEOMETRY_MAGIC {
            return Err("compact geometry: bad magic/version".to_string());
        }
        let counts: [usize; 10] = std::array::from_fn(|_| 0);
        let mut counts = counts;
        for count in &mut counts {
            *count = reader.read_u32()? as usize;
        }
        let tail_len = reader.read_u32()? as usize;

        // Validate the total length up front so a layout disagreement fails here.
        let [
            seg_e,
            seg_a,
            seg_c,
            aux_e,
            aux_a,
            aux_c,
            pt,
            circ_d,
            circ_a,
            circ_c,
        ] = counts;
        let expected = Self::HEADER_U32S * 4
            + tail_len
            + (seg_e + aux_e + pt + circ_d) * 8
            + (seg_a + aux_a + circ_a) * 4
            + seg_c
            + aux_c
            + circ_c;
        if bytes.len() != expected {
            return Err(format!(
                "compact geometry: length mismatch (expected {expected}, got {})",
                bytes.len()
            ));
        }

        let tail = serde_json::from_slice(reader.take(tail_len)?).map_err(|e| e.to_string())?;
        Ok(Self {
            seg_endpoints: reader.read_f64s(seg_e)?,
            seg_attr: reader.read_i32s(seg_a)?,
            seg_custom_color: reader.take(seg_c)?.to_vec(),
            aux_endpoints: reader.read_f64s(aux_e)?,
            aux_attr: reader.read_i32s(aux_a)?,
            aux_custom_color: reader.take(aux_c)?.to_vec(),
            point_coords: reader.read_f64s(pt)?,
            circle_data: reader.read_f64s(circ_d)?,
            circle_attr: reader.read_i32s(circ_a)?,
            circle_custom_color: reader.take(circ_c)?.to_vec(),
            tail,
        })
    }
}

struct ByteReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> ByteReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(len)
            .filter(|end| *end <= self.bytes.len())
            .ok_or("compact geometry: unexpected end of buffer")?;
        let slice = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(slice)
    }

    fn read_u32(&mut self) -> Result<u32, String> {
        let slice = self.take(4)?;
        Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
    }

    fn read_f64s(&mut self, count: usize) -> Result<Vec<f64>, String> {
        let slice = self.take(count * 8)?;
        Ok(slice
            .chunks_exact(8)
            .map(|c| f64::from_le_bytes(c.try_into().unwrap()))
            .collect())
    }

    fn read_i32s(&mut self, count: usize) -> Result<Vec<i32>, String> {
        let slice = self.take(count * 4)?;
        Ok(slice
            .chunks_exact(4)
            .map(|c| i32::from_le_bytes(c.try_into().unwrap()))
            .collect())
    }
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
    fn binary_codec_round_trips_the_battery_exactly() {
        for (index, doc) in battery().into_iter().enumerate() {
            let compact = encode(&doc);
            let bytes = compact.to_bytes().expect("to_bytes");
            let decoded = CompactGeometry::from_bytes(&bytes)
                .unwrap_or_else(|err| panic!("battery doc {index} bytes failed to decode: {err}"));
            assert_eq!(
                decoded, compact,
                "battery doc {index} binary codec mismatch"
            );
        }
    }

    #[test]
    fn binary_codec_rejects_corrupt_buffers() {
        let compact = encode(&battery()[1]);
        let bytes = compact.to_bytes().expect("to_bytes");

        // Wrong magic.
        let mut bad_magic = bytes.clone();
        bad_magic[0] ^= 0xff;
        assert!(CompactGeometry::from_bytes(&bad_magic).is_err());

        // Truncated (length no longer matches the header).
        assert!(CompactGeometry::from_bytes(&bytes[..bytes.len() - 1]).is_err());

        // Too short to even hold the header.
        assert!(CompactGeometry::from_bytes(&[0u8; 4]).is_err());
    }

    /// Pins the on-the-wire layout the TS decoder relies on: magic, then the ten
    /// element counts in field order, then the tail length, then the data.
    #[test]
    fn binary_codec_header_matches_the_spec() {
        let compact = CompactGeometry {
            seg_endpoints: vec![1.0, 2.0, 3.0, 4.0],
            seg_attr: vec![5, 6, 7, 8],
            seg_custom_color: vec![9, 10, 11],
            aux_endpoints: vec![],
            aux_attr: vec![],
            aux_custom_color: vec![],
            point_coords: vec![12.0, 13.0],
            circle_data: vec![],
            circle_attr: vec![],
            circle_custom_color: vec![],
            tail: CompactTail {
                title: None,
                texts: vec![],
                grid: GridMetadata::default(),
                operation_frame: OperationFrame::default(),
                metadata: BTreeMap::new(),
            },
        };
        let bytes = compact.to_bytes().expect("to_bytes");

        assert_eq!(&bytes[0..4], &COMPACT_GEOMETRY_MAGIC.to_le_bytes());
        let counts_at =
            |i: usize| u32::from_le_bytes(bytes[4 + i * 4..8 + i * 4].try_into().unwrap()) as usize;
        assert_eq!(counts_at(0), 4, "seg_endpoints count");
        assert_eq!(counts_at(1), 4, "seg_attr count");
        assert_eq!(counts_at(2), 3, "seg_custom_color count");
        assert_eq!(counts_at(6), 2, "point_coords count");
        // Round-trips regardless.
        assert_eq!(
            CompactGeometry::from_bytes(&bytes).expect("decode"),
            compact
        );
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
