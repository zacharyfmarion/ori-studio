//! `format_version = 1` — the index codec.
//!
//! A crease pattern becomes two strictly-ascending integer coordinate alphabets,
//! a vertex table of `(xi, yi)` index pairs, and an integer-indexed crease list.
//! Every predictor lives in exact integer space, so delta chains reconstruct by
//! prefix sum with no accumulated error, and vertex identity is an integer
//! comparison rather than a tolerance question.
//!
//! ```text
//! HEADER      u8 version_echo | u8 flags | <block> | SECTION F extensions
//! <block>     i8 F | counts | A x-alphabet | B y-alphabet | C vertices
//!             | D adjacency | E colours | P standalone points
//! ```

use super::bitio::{BitReader, BitWriter, bit_width};
use super::canon::{Quantised, quantise};
use super::error::{Result, ShareError};
use super::varint::{Cursor, write_svarint, write_uvarint};
use crate::geometry::{
    Circle, FoldDirection, FoldMagnitude, LineColor, LineSegment, Point, RgbColor,
};
use crate::model::{CreasePatternModel, TextElement};

pub const VERSION: u8 = 1;

/// Body is a length-prefixed `.fold` document rather than the index codec.
pub const FLAG_RAW: u8 = 1 << 7;
const FLAG_MASK: u8 = FLAG_RAW;

// Ancillary extensions: an unknown tag is skipped and counted.
const TAG_TITLE: u16 = 0x0001;
const TAG_GRID: u16 = 0x0002;
const TAG_AUX: u16 = 0x0003;
const TAG_CIRCLES: u16 = 0x0004;
const TAG_TEXTS: u16 = 0x0005;
// Critical extensions: an unknown tag in this range is a hard reject, because
// omitting it would make the geometry wrong rather than merely incomplete.
const TAG_FOLD_MAGNITUDE: u16 = 0x8001;
const TAG_FOLD_DIRECTION_HINT: u16 = 0x8003;
const TAG_CUSTOM_COLOUR: u16 = 0x8002;
const CRITICAL_TAG_FLOOR: u16 = 0x8000;

/// Colour code = `LineColor` discriminant + 2, giving `0..=12`.
///
/// All thirteen variants are carried. `.cp`'s four-code scheme collapses ten of
/// them onto `Cyan3` (`io/cp.rs`), and `point_line_map` skips **only** `Cyan3` —
/// so a round trip through `.cp` codes deletes a vertex from the CAMV map and
/// with it a real Maekawa diagnostic. Every FOLD import carrying `U` edges hits
/// that, since `Assignment::Unassigned` maps to `LineColor::None`.
fn colour_code(colour: LineColor) -> u8 {
    (colour.number() + 2) as u8
}

fn colour_from_code(code: u8) -> Result<LineColor> {
    if code > 12 {
        return Err(ShareError::ReservedColour(code));
    }
    LineColor::from_number(i32::from(code) - 2).map_err(|_| ShareError::ReservedColour(code))
}

#[derive(Default)]
pub struct Decoded {
    pub model: CreasePatternModel,
    pub title: Option<String>,
    /// Ancillary extension tags this build did not recognise. Surfaced so the UI
    /// can say "this link came from a newer Ori Studio; some content was not
    /// loaded" instead of silently dropping it.
    pub skipped_extensions: usize,
}

// ---------------------------------------------------------------------------
// Segment block
// ---------------------------------------------------------------------------

/// Creases in canonical order: `(lo, hi)` vertex-index pairs with `lo <= hi`,
/// stable-sorted lexicographically. This order is the index space for every
/// per-crease side array (fold magnitudes, custom colours).
struct Block {
    q: Quantised,
    vertices: Vec<(u32, u32)>,
    creases: Vec<(u32, u32)>,
    order: Vec<usize>,
    points: Vec<u32>,
}

/// The per-crease counterpart of [`assert_model_fields_are_handled`]. Adding a
/// field to `LineSegment` stops the build here rather than silently dropping it
/// out of every share link.
fn assert_segment_fields_are_handled(segment: &LineSegment) {
    let LineSegment {
        a: _,                   // SECTION A/B/C
        b: _,                   // SECTION A/B/C
        color: _,               // SECTION E
        fold_magnitude: _,      // extension 0x8001
        fold_direction_hint: _, // extension 0x8003
        customized: _,          // extension 0x8002
        customized_color: _,    // extension 0x8002
        // Deliberately not carried: session state. A share link produces a new
        // document, so neither the sharer's selection nor Oriedita's transient
        // active-endpoint marker means anything to the recipient (Oriedita's own
        // importer ignores `active` too).
        active: _,
        selected: _,
    } = segment;
}

fn build_block(segments: &[LineSegment], points: &[Point], f_bits: i32) -> Result<Block> {
    if let Some(first) = segments.first() {
        assert_segment_fields_are_handled(first);
    }
    let q = quantise(segments, points, f_bits)?;

    let mut vertex_set: Vec<(u32, u32)> = Vec::with_capacity(segments.len() * 2 + points.len());
    let push = |p: Point, out: &mut Vec<(u32, u32)>| -> Result<(u32, u32)> {
        let key = (q.x.index_of(p.x)?, q.y.index_of(p.y)?);
        out.push(key);
        Ok(key)
    };
    let mut endpoints = Vec::with_capacity(segments.len());
    for s in segments {
        let a = push(s.a, &mut vertex_set)?;
        let b = push(s.b, &mut vertex_set)?;
        endpoints.push((a, b));
    }
    let mut point_keys = Vec::with_capacity(points.len());
    for p in points {
        point_keys.push(push(*p, &mut vertex_set)?);
    }
    vertex_set.sort_unstable();
    vertex_set.dedup();

    let vid = |key: (u32, u32), set: &[(u32, u32)]| -> u32 {
        set.binary_search(&key)
            .expect("every key came from vertex_set") as u32
    };

    // Stable sort so the permutation is deterministic for equal pairs, and keep
    // the permutation so side arrays can be reordered to match.
    let mut indexed: Vec<(u32, u32, usize)> = endpoints
        .iter()
        .enumerate()
        .map(|(i, &(a, b))| {
            let (a, b) = (vid(a, &vertex_set), vid(b, &vertex_set));
            (a.min(b), a.max(b), i)
        })
        .collect();
    indexed.sort_by_key(|&(lo, hi, _)| (lo, hi));

    let points = point_keys
        .into_iter()
        .map(|k| vid(k, &vertex_set))
        .collect();

    Ok(Block {
        q,
        vertices: vertex_set,
        creases: indexed.iter().map(|&(a, b, _)| (a, b)).collect(),
        order: indexed.iter().map(|&(_, _, i)| i).collect(),
        points,
    })
}

fn write_block(out: &mut Vec<u8>, block: &Block, segments: &[LineSegment]) -> Result<()> {
    let Block {
        q,
        vertices,
        creases,
        order,
        points,
    } = block;

    out.push(q.f_bits as u8);
    for n in [
        q.x.len() as u64,
        q.y.len() as u64,
        vertices.len() as u64,
        creases.len() as u64,
        points.len() as u64,
    ] {
        write_uvarint(out, n);
    }

    // A / B: alphabets as a signed base plus strictly-positive deltas.
    for axis in [&q.x, &q.y] {
        if let Some(&first) = axis.values.first() {
            write_svarint(out, first);
            for w in axis.values.windows(2) {
                write_uvarint(out, (w[1] - w[0]) as u64);
            }
        }
    }

    // C: vertex table as runs down each occupied column.
    let mut columns: Vec<(u32, Vec<u32>)> = Vec::new();
    for &(xi, yi) in vertices {
        match columns.last_mut() {
            Some((cx, ys)) if *cx == xi => ys.push(yi),
            _ => columns.push((xi, vec![yi])),
        }
    }
    write_uvarint(out, columns.len() as u64);
    let mut prev = 0u32;
    for (i, (xi, _)) in columns.iter().enumerate() {
        if i == 0 {
            write_uvarint(out, u64::from(*xi));
        } else {
            write_uvarint(out, u64::from(xi - prev));
        }
        prev = *xi;
    }
    for (_, ys) in &columns {
        write_uvarint(out, ys.len() as u64);
    }
    for (_, ys) in &columns {
        let mut prev = 0u32;
        for (j, &yi) in ys.iter().enumerate() {
            if j == 0 {
                write_uvarint(out, u64::from(yi));
            } else {
                write_uvarint(out, u64::from(yi - prev));
            }
            prev = yi;
        }
    }

    // D: per-vertex out-degree, then the high endpoints as ascending gaps.
    let mut degree = vec![0u32; vertices.len()];
    for &(lo, _) in creases {
        degree[lo as usize] += 1;
    }
    for d in &degree {
        write_uvarint(out, u64::from(*d));
    }
    let mut idx = 0usize;
    for (v, &d) in degree.iter().enumerate() {
        let mut prev = v as u32;
        for _ in 0..d {
            let (_, hi) = creases[idx];
            write_uvarint(out, u64::from(hi - prev));
            prev = hi;
            idx += 1;
        }
    }

    // E: 1 bit per mountain/valley crease, with everything else in a 4-bit
    // escape list. Real patterns are overwhelmingly M/V, so the common case
    // costs one bit and the rare colours cost a nibble plus an index.
    let colours: Vec<LineColor> = order.iter().map(|&i| segments[i].color).collect();
    let escapes: Vec<(usize, u8)> = colours
        .iter()
        .enumerate()
        .filter(|(_, c)| !matches!(c, LineColor::Red1 | LineColor::Blue2))
        .map(|(i, c)| (i, colour_code(*c)))
        .collect();
    write_uvarint(out, escapes.len() as u64);
    let mut prev = 0usize;
    for (n, (i, _)) in escapes.iter().enumerate() {
        write_uvarint(out, (if n == 0 { *i } else { i - prev }) as u64);
        prev = *i;
    }
    let mut nibbles = BitWriter::new();
    for (_, code) in &escapes {
        nibbles.write_bits(u32::from(*code), 4);
    }
    out.extend_from_slice(&nibbles.finish());
    let mut mv = BitWriter::new();
    for c in &colours {
        match c {
            LineColor::Red1 => mv.write_bit(false),
            LineColor::Blue2 => mv.write_bit(true),
            _ => {}
        }
    }
    out.extend_from_slice(&mv.finish());

    // P: standalone points, as ascending vertex indices.
    let mut sorted = points.clone();
    sorted.sort_unstable();
    let mut prev = 0u32;
    for (i, &p) in sorted.iter().enumerate() {
        write_uvarint(out, u64::from(if i == 0 { p } else { p - prev }));
        prev = p;
    }
    Ok(())
}

struct ReadBlock {
    segments: Vec<LineSegment>,
    points: Vec<Point>,
    /// The block's own quantum, so loose coordinates (circle centres, text
    /// anchors) can be dequantised without re-reading the header byte.
    quantum: f64,
}

fn read_block(cur: &mut Cursor) -> Result<ReadBlock> {
    let f_bits = i32::from(cur.u8("block quantum")? as i8);
    if !(super::canon::F_WIRE_MIN..=super::canon::F_WIRE_MAX).contains(&f_bits) {
        return Err(ShareError::BadQuantum(f_bits));
    }
    let quantum = 2f64.powi(-f_bits);

    // Every count is validated against the remaining byte budget before it is
    // used to allocate: nothing here can occupy less than one bit.
    let nx = cur.count("nx", 1)?;
    let ny = cur.count("ny", 1)?;
    let nv = cur.count("nv", 1)?;
    let ne = cur.count("ne", 1)?;
    let np = cur.count("np", 1)?;
    // Creases need somewhere to attach. One vertex is enough — a degenerate
    // zero-length crease is legal and joins a vertex to itself.
    if ne > 0 && nv == 0 {
        return Err(ShareError::ImplausibleCounts {
            counts: nv as u64,
            remaining: cur.remaining(),
        });
    }
    if nv > 2 * ne + np || nx > nv || ny > nv {
        return Err(ShareError::ImplausibleCounts {
            counts: nv as u64,
            remaining: cur.remaining(),
        });
    }

    let read_axis = |cur: &mut Cursor, n: usize, what: &'static str| -> Result<Vec<i64>> {
        let mut values = Vec::with_capacity(n);
        if n > 0 {
            let mut acc = cur.svarint(what)?;
            values.push(acc);
            for i in 1..n {
                let step = cur.uvarint(what)?;
                if step == 0 {
                    return Err(ShareError::NotAscending { what, index: i });
                }
                acc = acc
                    .checked_add(step as i64)
                    .ok_or(ShareError::NotAscending { what, index: i })?;
                values.push(acc);
            }
        }
        Ok(values)
    };
    let xs = read_axis(cur, nx, "x alphabet")?;
    let ys = read_axis(cur, ny, "y alphabet")?;

    // C
    let ncol = cur.count("ncol", 1)?;
    if ncol > nx {
        return Err(ShareError::IndexOutOfRange {
            what: "column count",
            index: ncol as u64,
            limit: nx as u64,
        });
    }
    let mut cols = Vec::with_capacity(ncol);
    let mut acc = 0u64;
    for i in 0..ncol {
        let step = cur.uvarint("column")?;
        if i > 0 && step == 0 {
            return Err(ShareError::NotAscending {
                what: "columns",
                index: i,
            });
        }
        acc = acc.saturating_add(step);
        if acc >= nx as u64 {
            return Err(ShareError::IndexOutOfRange {
                what: "column",
                index: acc,
                limit: nx as u64,
            });
        }
        cols.push(acc as u32);
    }
    let mut counts = Vec::with_capacity(ncol);
    let mut total = 0usize;
    for _ in 0..ncol {
        let c = cur.uvarint("column size")? as usize;
        if c == 0 {
            return Err(ShareError::ImplausibleCounts {
                counts: 0,
                remaining: cur.remaining(),
            });
        }
        total += c;
        counts.push(c);
    }
    if total != nv {
        return Err(ShareError::ImplausibleCounts {
            counts: total as u64,
            remaining: cur.remaining(),
        });
    }
    let mut vertices = Vec::with_capacity(nv);
    for (ci, &count) in counts.iter().enumerate() {
        let mut acc = 0u64;
        for j in 0..count {
            let step = cur.uvarint("row")?;
            if j > 0 && step == 0 {
                return Err(ShareError::NotAscending {
                    what: "rows",
                    index: j,
                });
            }
            acc = acc.saturating_add(step);
            if acc >= ny as u64 {
                return Err(ShareError::IndexOutOfRange {
                    what: "row",
                    index: acc,
                    limit: ny as u64,
                });
            }
            vertices.push((cols[ci], acc as u32));
        }
    }

    let point_at = |v: (u32, u32)| {
        Point::new(
            xs[v.0 as usize] as f64 * quantum,
            ys[v.1 as usize] as f64 * quantum,
        )
    };

    // D
    let creases = {
        let mut degrees = Vec::with_capacity(nv);
        let mut sum = 0usize;
        for _ in 0..nv {
            let d = cur.uvarint("degree")? as usize;
            sum += d;
            if sum > ne {
                return Err(ShareError::ImplausibleCounts {
                    counts: sum as u64,
                    remaining: cur.remaining(),
                });
            }
            degrees.push(d);
        }
        if sum != ne {
            return Err(ShareError::ImplausibleCounts {
                counts: sum as u64,
                remaining: cur.remaining(),
            });
        }
        let mut creases = Vec::with_capacity(ne);
        for (v, &d) in degrees.iter().enumerate() {
            let mut prev = v as u64;
            for _ in 0..d {
                // Zero gaps are legal: a zero-length crease repeats the low endpoint,
                // and a duplicate crease repeats the previous high endpoint.
                prev = prev.saturating_add(cur.uvarint("adjacency")?);
                if prev >= nv as u64 {
                    return Err(ShareError::IndexOutOfRange {
                        what: "crease endpoint",
                        index: prev,
                        limit: nv as u64,
                    });
                }
                creases.push((v as u32, prev as u32));
            }
        }
        creases
    };

    // E
    let nesc = cur.count("escape count", 4)?;
    if nesc > ne {
        return Err(ShareError::ImplausibleCounts {
            counts: nesc as u64,
            remaining: cur.remaining(),
        });
    }
    let mut esc_idx = Vec::with_capacity(nesc);
    let mut acc = 0u64;
    for i in 0..nesc {
        let step = cur.uvarint("escape index")?;
        if i > 0 && step == 0 {
            return Err(ShareError::NotAscending {
                what: "escape indices",
                index: i,
            });
        }
        acc = acc.saturating_add(step);
        if acc >= ne as u64 {
            return Err(ShareError::IndexOutOfRange {
                what: "escape index",
                index: acc,
                limit: ne as u64,
            });
        }
        esc_idx.push(acc as usize);
    }
    let nibble_bytes = cur.take(nesc.div_ceil(2), "escape values")?;
    let mut nibbles = BitReader::new(nibble_bytes);
    let mut colours = vec![LineColor::Red1; ne];
    let mut escaped = vec![false; ne];
    for &i in &esc_idx {
        let code = nibbles.read_bits(4, "escape value")? as u8;
        colours[i] = colour_from_code(code)?;
        escaped[i] = true;
    }
    let mv_count = ne - nesc;
    let mv_bytes = cur.take(mv_count.div_ceil(8), "mv bitmap")?;
    let mut mv = BitReader::new(mv_bytes);
    for i in 0..ne {
        if !escaped[i] {
            colours[i] = if mv.read_bit("mv bit")? {
                LineColor::Blue2
            } else {
                LineColor::Red1
            };
        }
    }

    let segments = creases
        .iter()
        .zip(colours)
        .map(|(&(lo, hi), colour)| {
            LineSegment::with_color(
                point_at(vertices[lo as usize]),
                point_at(vertices[hi as usize]),
                colour,
            )
        })
        .collect();

    // P
    let mut points = Vec::with_capacity(np);
    let mut acc = 0u64;
    for i in 0..np {
        let step = cur.uvarint("point index")?;
        if i > 0 && step == 0 {
            return Err(ShareError::NotAscending {
                what: "point indices",
                index: i,
            });
        }
        acc = acc.saturating_add(step);
        if acc >= nv as u64 {
            return Err(ShareError::IndexOutOfRange {
                what: "point index",
                index: acc,
                limit: nv as u64,
            });
        }
        points.push(point_at(vertices[acc as usize]));
    }

    Ok(ReadBlock {
        segments,
        points,
        quantum,
    })
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/// Compile-time guard: every field of the model must be consciously handled.
///
/// This is the single most important line in the codec's maintenance story. A
/// share link is a *stateful* promise — once one exists, it has to keep opening —
/// and the way that promise breaks silently is not a bug in this file, it is
/// someone adding a field to `CreasePatternModel` two years from now and this
/// codec quietly not carrying it. No test catches that, because the round trip
/// still passes for everything the codec already knows about.
///
/// Destructuring exhaustively turns that into a **compile error**: adding a field
/// stops the build, right here, with this comment attached. The author then has
/// to choose — carry it in a new extension tag, or add it to the ignore list
/// below and say why.
fn assert_model_fields_are_handled(model: &CreasePatternModel) {
    let CreasePatternModel {
        line_segments: _,     // SECTION D/E
        circles: _,           // extension 0x0004
        points: _,            // SECTION P
        aux_line_segments: _, // extension 0x0003
        texts: _,             // extension 0x0005
        grid: _,              // extension 0x0002
    } = model;
}

pub fn encode(
    model: &CreasePatternModel,
    title: Option<&str>,
    f_bits: i32,
    aux_f_bits: i32,
) -> Result<Vec<u8>> {
    assert_model_fields_are_handled(model);
    let block = build_block(&model.line_segments, &model.points, f_bits)?;

    let mut out = Vec::with_capacity(1024);
    out.push(VERSION);
    out.push(0); // flags: RAW clear, all other bits reserved MBZ
    write_block(&mut out, &block, &model.line_segments)?;

    let mut extensions: Vec<(u16, Vec<u8>)> = Vec::new();

    if let Some(title) = title.filter(|t| !t.is_empty()) {
        extensions.push((TAG_TITLE, title.as_bytes().to_vec()));
    }

    if model.grid != crate::model::GridMetadata::default() {
        let mut buf = Vec::new();
        write_uvarint(&mut buf, model.grid.grid_size.max(0) as u64);
        write_uvarint(&mut buf, model.grid.base_state.state().max(0) as u64);
        extensions.push((TAG_GRID, buf));
    }

    if !model.aux_line_segments.is_empty() {
        let aux = build_block(&model.aux_line_segments, &[], aux_f_bits)?;
        let mut buf = Vec::new();
        write_block(&mut buf, &aux, &model.aux_line_segments)?;
        extensions.push((TAG_AUX, buf));
    }

    if !model.circles.is_empty() {
        let mut buf = Vec::new();
        write_uvarint(&mut buf, model.circles.len() as u64);
        for c in &model.circles {
            write_svarint(&mut buf, block.q.raw(c.x));
            write_svarint(&mut buf, block.q.raw(c.y));
            write_svarint(&mut buf, block.q.raw(c.r));
            buf.push(colour_code(c.color));
        }
        extensions.push((TAG_CIRCLES, buf));
    }

    if !model.texts.is_empty() {
        let mut buf = Vec::new();
        write_uvarint(&mut buf, model.texts.len() as u64);
        for t in &model.texts {
            write_svarint(&mut buf, block.q.raw(t.x.0));
            write_svarint(&mut buf, block.q.raw(t.y.0));
            let bytes = t.text.as_bytes();
            write_uvarint(&mut buf, bytes.len() as u64);
            buf.extend_from_slice(bytes);
        }
        extensions.push((TAG_TEXTS, buf));
    }

    if let Some(buf) = encode_fold_magnitudes(&block, &model.line_segments) {
        extensions.push((TAG_FOLD_MAGNITUDE, buf));
    }

    if let Some(buf) = encode_fold_direction_hints(&block, &model.line_segments) {
        extensions.push((TAG_FOLD_DIRECTION_HINT, buf));
    }

    let customs: Vec<(usize, RgbColor)> = block
        .order
        .iter()
        .enumerate()
        .filter(|&(_, &i)| model.line_segments[i].customized != 0)
        .map(|(pos, &i)| (pos, model.line_segments[i].customized_color))
        .collect();
    if !customs.is_empty() {
        let mut buf = Vec::new();
        write_uvarint(&mut buf, customs.len() as u64);
        let mut prev = 0usize;
        for (n, (pos, _)) in customs.iter().enumerate() {
            write_uvarint(&mut buf, (if n == 0 { *pos } else { pos - prev }) as u64);
            prev = *pos;
        }
        for (_, rgb) in &customs {
            buf.extend_from_slice(&[rgb.red, rgb.green, rgb.blue]);
        }
        extensions.push((TAG_CUSTOM_COLOUR, buf));
    }

    write_uvarint(&mut out, extensions.len() as u64);
    for (tag, payload) in extensions {
        write_uvarint(&mut out, u64::from(tag));
        write_uvarint(&mut out, payload.len() as u64);
        out.extend_from_slice(&payload);
    }
    Ok(out)
}

/// Sparse fold magnitudes with an angle alphabet.
///
/// `FoldMagnitude` already stores 1e-7-degree units in a `u32`, so transmitting
/// the integer is exactly lossless — a shared angle contributes zero
/// reconstruction error and only coordinates remain lossy. Absent means classic
/// +/-180, so an all-classic document (every Oriedita-compatible pattern) pays
/// nothing at all.
fn encode_fold_magnitudes(block: &Block, segments: &[LineSegment]) -> Option<Vec<u8>> {
    let magnitudes: Vec<Option<FoldMagnitude>> = block
        .order
        .iter()
        .map(|&i| segments[i].fold_magnitude)
        .collect();
    if magnitudes.iter().all(Option::is_none) {
        return None;
    }

    let mut alphabet: Vec<u32> = magnitudes
        .iter()
        .flatten()
        .map(|m| FoldMagnitude::to_transport(Some(*m)))
        .collect();
    alphabet.sort_unstable();
    alphabet.dedup();
    let width = bit_width(alphabet.len());

    let mut buf = Vec::new();
    let present: Vec<(usize, u32)> = magnitudes
        .iter()
        .enumerate()
        .filter_map(|(i, m)| m.map(|m| (i, FoldMagnitude::to_transport(Some(m)))))
        .collect();

    // Sparse costs an index per carrier; dense costs a reference per crease.
    // Emit both and keep the smaller rather than guessing with a heuristic.
    let sparse_bits = present.len() * (8 + width as usize) + 8;
    let dense_bits = magnitudes.len() * (bit_width(alphabet.len() + 1) as usize);
    let dense = dense_bits < sparse_bits;

    write_uvarint(&mut buf, u64::from(dense));
    write_uvarint(&mut buf, alphabet.len() as u64);
    let mut prev = 0u32;
    for (i, &a) in alphabet.iter().enumerate() {
        write_uvarint(&mut buf, u64::from(if i == 0 { a } else { a - prev }));
        prev = a;
    }

    if dense {
        let w = bit_width(alphabet.len() + 1);
        let mut bits = BitWriter::new();
        for m in &magnitudes {
            let code = match m {
                None => 0,
                Some(m) => {
                    alphabet
                        .binary_search(&FoldMagnitude::to_transport(Some(*m)))
                        .expect("in alphabet") as u32
                        + 1
                }
            };
            bits.write_bits(code, w);
        }
        buf.extend_from_slice(&bits.finish());
    } else {
        write_uvarint(&mut buf, present.len() as u64);
        let mut prev = 0usize;
        for (n, (i, _)) in present.iter().enumerate() {
            write_uvarint(&mut buf, (if n == 0 { *i } else { i - prev }) as u64);
            prev = *i;
        }
        let mut bits = BitWriter::new();
        for (_, units) in &present {
            let code = alphabet.binary_search(units).expect("in alphabet") as u32;
            bits.write_bits(code, width);
        }
        buf.extend_from_slice(&bits.finish());
    }
    Some(buf)
}

pub fn decode(body: &[u8]) -> Result<Decoded> {
    let mut cur = Cursor::new(body);
    let echo = cur.u8("version echo")?;
    if echo != VERSION {
        return Err(ShareError::VersionEcho {
            echo,
            frame: VERSION,
        });
    }
    let flags = cur.u8("flags")?;
    if flags & !FLAG_MASK != 0 {
        return Err(ShareError::ReservedBodyFlags);
    }
    if flags & FLAG_RAW != 0 {
        let len = cur.count("raw length", 8)?;
        let bytes = cur.take(len, "raw body")?;
        let text = std::str::from_utf8(bytes).map_err(|_| ShareError::BadUtf8 { tag: 0 })?;
        let model = crate::io::fold::import_fold_json(text)
            .map_err(|_| ShareError::NotRepresentable("raw .fold body failed to parse"))?;
        return Ok(Decoded {
            model,
            title: None,
            skipped_extensions: 0,
        });
    }

    let block = read_block(&mut cur)?;
    let quantum = block.quantum;
    let mut model = CreasePatternModel {
        line_segments: block.segments,
        points: block.points,
        ..Default::default()
    };
    let mut out = Decoded::default();

    let n_ext = cur.count("extension count", 16)?;
    for _ in 0..n_ext {
        let tag = cur.uvarint("extension tag")?;
        let tag = u16::try_from(tag).map_err(|_| ShareError::UnknownCriticalExtension(u16::MAX))?;
        let len = cur.count("extension length", 8)?;
        let payload = cur.take(len, "extension payload")?;
        match tag {
            TAG_TITLE => {
                out.title = Some(
                    std::str::from_utf8(payload)
                        .map_err(|_| ShareError::BadUtf8 { tag })?
                        .to_string(),
                );
            }
            TAG_GRID => {
                let mut c = Cursor::new(payload);
                model.grid.grid_size = c.uvarint("grid size")? as i32;
                model.grid.base_state =
                    crate::model::GridState::from_state(c.uvarint("grid state")? as i32)
                        .unwrap_or_default();
            }
            TAG_AUX => {
                let mut c = Cursor::new(payload);
                model.aux_line_segments = read_block(&mut c)?.segments;
            }
            TAG_CIRCLES => {
                let mut c = Cursor::new(payload);
                let n = c.count("circle count", 32)?;
                let q = quantum;
                for _ in 0..n {
                    let x = c.svarint("circle x")? as f64 * q;
                    let y = c.svarint("circle y")? as f64 * q;
                    let r = c.svarint("circle r")? as f64 * q;
                    let colour = colour_from_code(c.u8("circle colour")?)?;
                    model.circles.push(Circle::new(x, y, r, colour));
                }
            }
            TAG_TEXTS => {
                let mut c = Cursor::new(payload);
                let n = c.count("text count", 24)?;
                let q = quantum;
                for _ in 0..n {
                    let x = c.svarint("text x")? as f64 * q;
                    let y = c.svarint("text y")? as f64 * q;
                    let len = c.count("text length", 8)?;
                    let bytes = c.take(len, "text")?;
                    let text = std::str::from_utf8(bytes)
                        .map_err(|_| ShareError::BadUtf8 { tag })?
                        .to_string();
                    model.texts.push(TextElement::new(x, y, text));
                }
            }
            TAG_FOLD_MAGNITUDE => decode_fold_magnitudes(payload, &mut model)?,
            TAG_FOLD_DIRECTION_HINT => decode_fold_direction_hints(payload, &mut model)?,
            TAG_CUSTOM_COLOUR => {
                let mut c = Cursor::new(payload);
                let n = c.count("custom colour count", 32)?;
                let mut idx = Vec::with_capacity(n);
                let mut acc = 0u64;
                for i in 0..n {
                    let step = c.uvarint("custom colour index")?;
                    if i > 0 && step == 0 {
                        return Err(ShareError::NotAscending {
                            what: "custom colour indices",
                            index: i,
                        });
                    }
                    acc = acc.saturating_add(step);
                    if acc >= model.line_segments.len() as u64 {
                        return Err(ShareError::IndexOutOfRange {
                            what: "custom colour index",
                            index: acc,
                            limit: model.line_segments.len() as u64,
                        });
                    }
                    idx.push(acc as usize);
                }
                for &i in &idx {
                    let rgb = c.take(3, "custom colour rgb")?;
                    model.line_segments[i].customized = 1;
                    model.line_segments[i].customized_color = RgbColor {
                        red: rgb[0],
                        green: rgb[1],
                        blue: rgb[2],
                    };
                }
            }
            other if other >= CRITICAL_TAG_FLOOR => {
                return Err(ShareError::UnknownCriticalExtension(other));
            }
            _ => out.skipped_extensions += 1,
        }
    }

    out.model = model;
    Ok(out)
}

/// Two bits per crease in block order: 0 none, 1 mountain, 2 valley.
///
/// A fixed-width bitmap rather than the sparse alphabet
/// [`encode_fold_magnitudes`] uses, because the value space is three, not a
/// range — an alphabet of three entries costs more than it saves. The tag is
/// omitted entirely when no crease is hinted, so an ordinary document pays
/// nothing at all, which is the property this codec's design turns on.
fn encode_fold_direction_hints(block: &Block, segments: &[LineSegment]) -> Option<Vec<u8>> {
    let hints: Vec<u8> = block
        .order
        .iter()
        .map(|&i| match segments[i].fold_direction_hint {
            None => 0u8,
            Some(FoldDirection::Mountain) => 1,
            Some(FoldDirection::Valley) => 2,
        })
        .collect();
    if hints.iter().all(|code| *code == 0) {
        return None;
    }

    let mut buf = Vec::with_capacity(hints.len().div_ceil(4) + 4);
    write_uvarint(&mut buf, hints.len() as u64);
    for chunk in hints.chunks(4) {
        let mut packed = 0u8;
        for (slot, code) in chunk.iter().enumerate() {
            packed |= code << (slot * 2);
        }
        buf.push(packed);
    }
    Some(buf)
}

fn decode_fold_direction_hints(payload: &[u8], model: &mut CreasePatternModel) -> Result<()> {
    let mut c = Cursor::new(payload);
    let count = c.count("fold direction hints", 1)?;
    let packed = c.take(count.div_ceil(4), "fold direction hints")?;
    for index in 0..count {
        let code = (packed[index / 4] >> ((index % 4) * 2)) & 0b11;
        let hint = match code {
            1 => Some(FoldDirection::Mountain),
            2 => Some(FoldDirection::Valley),
            _ => None,
        };
        if let Some(segment) = model.line_segments.get_mut(index) {
            // The invariant travels with the value: a hint is meaningful only on
            // an unassigned crease, and a link claiming otherwise is one we
            // decline to reproduce rather than one we trust.
            if hint.is_some() && segment.color != LineColor::None {
                continue;
            }
            segment.fold_direction_hint = hint;
        }
    }
    Ok(())
}

fn decode_fold_magnitudes(payload: &[u8], model: &mut CreasePatternModel) -> Result<()> {
    let mut c = Cursor::new(payload);
    let dense = c.uvarint("fold magnitude mode")? != 0;
    let na = c.count("angle alphabet", 8)?;
    let mut alphabet = Vec::with_capacity(na);
    let mut acc = 0u64;
    for i in 0..na {
        let step = c.uvarint("angle")?;
        if i > 0 && step == 0 {
            return Err(ShareError::NotAscending {
                what: "angle alphabet",
                index: i,
            });
        }
        acc = acc.saturating_add(step);
        let units = u32::try_from(acc).map_err(|_| ShareError::BadFoldMagnitude(u32::MAX))?;
        alphabet
            .push(FoldMagnitude::from_transport(units).ok_or(ShareError::BadFoldMagnitude(units))?);
    }

    let ne = model.line_segments.len();
    if dense {
        let w = bit_width(na + 1);
        let bytes = c.take((ne * w as usize).div_ceil(8), "fold magnitude bitmap")?;
        let mut bits = BitReader::new(bytes);
        for i in 0..ne {
            let code = bits.read_bits(w, "fold magnitude")? as usize;
            if code > na {
                return Err(ShareError::MalformedExtension {
                    tag: TAG_FOLD_MAGNITUDE,
                    reason: "angle index out of range",
                });
            }
            model.line_segments[i].fold_magnitude = (code > 0).then(|| alphabet[code - 1]);
        }
    } else {
        let k = c.count("fold magnitude count", 8)?;
        if k > ne {
            return Err(ShareError::MalformedExtension {
                tag: TAG_FOLD_MAGNITUDE,
                reason: "more magnitudes than creases",
            });
        }
        let mut idx = Vec::with_capacity(k);
        let mut acc = 0u64;
        for i in 0..k {
            let step = c.uvarint("fold magnitude index")?;
            if i > 0 && step == 0 {
                return Err(ShareError::NotAscending {
                    what: "fold magnitude indices",
                    index: i,
                });
            }
            acc = acc.saturating_add(step);
            if acc >= ne as u64 {
                return Err(ShareError::IndexOutOfRange {
                    what: "fold magnitude index",
                    index: acc,
                    limit: ne as u64,
                });
            }
            idx.push(acc as usize);
        }
        let w = bit_width(na);
        let bytes = c.take((k * w as usize).div_ceil(8), "fold magnitude refs")?;
        let mut bits = BitReader::new(bytes);
        for &i in &idx {
            let code = bits.read_bits(w, "fold magnitude ref")? as usize;
            if code >= na {
                return Err(ShareError::MalformedExtension {
                    tag: TAG_FOLD_MAGNITUDE,
                    reason: "angle index out of range",
                });
            }
            model.line_segments[i].fold_magnitude = Some(alphabet[code]);
        }
    }
    Ok(())
}

/// Body for the RAW fallback: a length-prefixed `.fold` document.
///
/// `.fold`, never `.cp` — `.cp` cannot represent circles, aux lines or texts,
/// collapses ten `LineColor` variants onto one code, and has nowhere to put a
/// non-classic fold magnitude, i.e. it cannot carry exactly the documents that
/// would need a fallback.
pub fn encode_raw(fold_text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(fold_text.len() + 8);
    out.push(VERSION);
    out.push(FLAG_RAW);
    write_uvarint(&mut out, fold_text.len() as u64);
    out.extend_from_slice(fold_text.as_bytes());
    out
}
