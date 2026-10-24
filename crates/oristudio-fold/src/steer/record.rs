//! The saved form of a chosen layer order (`implementation-plans/layer-order-dialog.md`,
//! approach 6): one compact JSON string a host keeps beside its own data, the
//! same for an Edit figure and a Diagram step.
//!
//! ```json
//! {"v":1,"faces":[{"at":[x,y],"area":a}],"constraints":[[s,o,1]],"order":[[f,g,-1]]}
//! ```
//!
//! - `faces`: the faces the constraints and the order name, each by a point
//!   strictly inside it on the paper and its paper area, in the crease
//!   pattern's coordinates (a host maps its own frame at its seam,
//!   `apps/web/src/lib/layerOrder/paperFrame.ts`);
//! - `constraints`: as built, in the order made, `[subject, object, sign]`;
//! - `order`: the order on screen at Apply, only its pairs the creases leave
//!   free;
//! - `attention`: set by a host after an edit, never by the engine.
//!
//! A sign is FOLD's `faceOrders` sign, so it is relative to the paper and
//! turning the view over never changes it: `1` when the first face lies on
//! the second's front side, `-1` when on its back.
//!
//! # One codec in two languages
//!
//! This is the Rust half of `apps/web/src/lib/layerOrder/layerOrderRecord.ts`
//! (H1), and it reads and writes the same strings: the same field names in the
//! same order, `"v":1` first, numbers as JavaScript's `JSON.stringify` writes
//! them ([`js_number`]), the same validation in the same order, and the same
//! 1 MB budget. A record a newer build wrote ([`RecordRead::Newer`]: a later
//! version, or a field or an attention reason this build has no name for) is
//! carried, never read; damage ([`RecordRead::Damaged`]) is dropped. The
//! shared golden string is `tests/fixtures/layer-order/record-v1.json`, which
//! a Rust test holds this codec to and the TypeScript test is to hold the
//! other to.
//!
//! The JSON is parsed by `serde_json` (with the workspace's `float_roundtrip`,
//! so every number reads back bit for bit), where the TypeScript side calls
//! `JSON.parse`. The two read every string a codec writes, and every damaged
//! one either test names, alike; three kinds of hand-made string read as
//! [`RecordDamage::NotJson`] here and otherwise there: a number past `f64`'s
//! range (`1e400`, which `JSON.parse` reads as `Infinity`), a lone UTF-16
//! surrogate escape (`"\ud800"`), and arrays or objects nested more than 128
//! deep. No writer produces any of them: `JSON.stringify` writes an infinite
//! number as `null`. A host reads a record with its own codec before the
//! engine sees it, so none of them reaches the engine from a file.
//!
//! Ori Studio original work, not a port.

use std::fmt::Write as _;

use serde::Serialize;
use serde_json::{Map, Value};
use thiserror::Error;

use crate::witness;

/// The version this build reads and writes.
pub const RECORD_VERSION: u32 = 1;

/// The most a record may be, as its JSON (approach 6's budget). Writing past
/// it is refused with the size; a stored string past it is a newer build's,
/// which may keep more.
pub const RECORD_MAX_BYTES: usize = 1024 * 1024;

/// A face as a record names it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RecordFace {
    /// A point strictly inside the face on the paper, in the crease pattern's
    /// coordinates.
    pub at: [f64; 2],
    /// The face's area on the paper, above 0: what tells a split or merged
    /// face from the one the record saved.
    pub area: f64,
}

/// FOLD's `faceOrders` sign of one face against another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FoldSign {
    /// `1`: the first face lies on the second's front side.
    Front,
    /// `-1`: the first face lies on the second's back side.
    Back,
}

impl FoldSign {
    /// `1` or `-1`.
    pub fn value(self) -> i8 {
        match self {
            FoldSign::Front => 1,
            FoldSign::Back => -1,
        }
    }

    /// The sign of `1` or `-1`; `None` for any other value.
    pub fn of_value(value: i8) -> Option<FoldSign> {
        match value {
            1 => Some(FoldSign::Front),
            -1 => Some(FoldSign::Back),
            _ => None,
        }
    }

    /// The sign of `f` against `g`, given whether `f` lies above `g` (nearer
    /// a viewer at +z) and whether `g` shows its front: the stored choices'
    /// one rule ([`crate::witness::on_front_side`]).
    pub fn of_above(f_above_g: bool, g_front_up: bool) -> FoldSign {
        if witness::on_front_side(f_above_g, g_front_up) {
            FoldSign::Front
        } else {
            FoldSign::Back
        }
    }

    /// Whether `f` lies above `g` (nearer a viewer at +z) when this is `f`'s
    /// sign against `g` and `g` shows its front or not: the inverse of
    /// [`Self::of_above`] ([`crate::witness::above_by_side`]).
    pub fn above(self, g_front_up: bool) -> bool {
        witness::above_by_side(self == FoldSign::Front, g_front_up)
    }

    /// The sign of `g` against `f`, for the same order of the two.
    pub fn reversed_for(self, f_front_up: bool, g_front_up: bool) -> FoldSign {
        FoldSign::of_above(!self.above(g_front_up), f_front_up)
    }
}

/// Two of a record's faces, by index into its `faces`, and how the first lies
/// against the second.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RecordPair {
    pub f: u32,
    pub g: u32,
    pub sign: FoldSign,
}

/// Why a record needs looking at, as its host shows it without the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AttentionReason {
    Conflict,
    Unresolved,
    Timeout,
    Route3d,
    Detached,
}

impl AttentionReason {
    const ALL: [AttentionReason; 5] = [
        AttentionReason::Conflict,
        AttentionReason::Unresolved,
        AttentionReason::Timeout,
        AttentionReason::Route3d,
        AttentionReason::Detached,
    ];

    /// The word the record spells it with.
    pub fn word(self) -> &'static str {
        match self {
            AttentionReason::Conflict => "conflict",
            AttentionReason::Unresolved => "unresolved",
            AttentionReason::Timeout => "timeout",
            AttentionReason::Route3d => "route-3d",
            AttentionReason::Detached => "detached",
        }
    }

    fn of_word(word: &str) -> Option<AttentionReason> {
        AttentionReason::ALL.into_iter().find(|r| r.word() == word)
    }
}

/// A host's note that a record needs looking at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Attention {
    pub reason: AttentionReason,
    /// How many constraints it concerns: a whole number, at least 0. Held as
    /// JavaScript holds it, a double, so a record reads and writes back as the
    /// TypeScript codec reads and writes it whatever its size.
    pub count: f64,
}

/// A chosen layer order as a host saves it (see the module docs).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LayerOrderRecord {
    /// The faces the constraints and the order name.
    pub faces: Vec<RecordFace>,
    /// The constraints, as built, in the order made: `[subject, object, sign]`.
    pub constraints: Vec<RecordPair>,
    /// The order shown at Apply: only its pairs the creases leave free.
    pub order: Vec<RecordPair>,
    /// Set by a host after an edit left the record needing a look.
    pub attention: Option<Attention>,
}

/// The part of a record that does not read; the TypeScript codec's
/// `LayerOrderRecordPart`, serialised by the same word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordPart {
    Record,
    Faces,
    Constraints,
    Order,
    Attention,
}

impl RecordPart {
    /// The word the TypeScript codec names it by.
    pub fn word(self) -> &'static str {
        match self {
            RecordPart::Record => "record",
            RecordPart::Faces => "faces",
            RecordPart::Constraints => "constraints",
            RecordPart::Order => "order",
            RecordPart::Attention => "attention",
        }
    }
}

/// Why a stored record does not read; the TypeScript codec's
/// `LayerOrderRecordDamage` (whose `not-text`, a value that is no string, a
/// `&str` cannot be).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RecordDamage {
    /// Not JSON.
    NotJson,
    /// No version this build knows: none, or one that is no whole number of
    /// at least 1.
    Version,
    /// A part that does not read.
    Part(RecordPart),
}

impl RecordDamage {
    /// The word the TypeScript codec names it by.
    pub fn word(self) -> &'static str {
        match self {
            RecordDamage::NotJson => "not-json",
            RecordDamage::Version => "version",
            RecordDamage::Part(part) => part.word(),
        }
    }
}

/// A stored record read.
#[derive(Debug, Clone, PartialEq)]
pub enum RecordRead {
    /// As this build holds it, with its JSON as this build writes it, so a
    /// record read and written again keeps its bytes.
    Read {
        record: LayerOrderRecord,
        json: String,
    },
    /// A newer build's: a later version, a field or an attention reason this
    /// build has no name for, or more than [`RECORD_MAX_BYTES`]. Carried and
    /// written back as it came, never read.
    Newer,
    /// Damage, which is dropped.
    Damaged(RecordDamage),
}

/// Why a record cannot be written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum EncodeRefusal {
    /// A part that would not read back as [`read_record`] reads it.
    #[error("the record's {} would not read back", part.word())]
    Invalid { part: RecordPart },
    /// More than [`RECORD_MAX_BYTES`].
    #[error("the record is {bytes} bytes, over the {budget}-byte budget")]
    OverBudget { bytes: usize, budget: usize },
}

/// Read a stored record (the TypeScript codec's `readLayerOrderRecord`).
pub fn read_record(text: &str) -> RecordRead {
    // `value.length` in JavaScript: UTF-16 code units, which a record's JSON,
    // numbers and ASCII words, has one per byte.
    if text.len() > RECORD_MAX_BYTES && text.encode_utf16().count() > RECORD_MAX_BYTES {
        return RecordRead::Newer;
    }
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return RecordRead::Damaged(RecordDamage::NotJson);
    };
    let Value::Object(map) = parsed else {
        return RecordRead::Damaged(RecordDamage::Part(RecordPart::Record));
    };
    let Some(version) = map
        .get("v")
        .and_then(Value::as_f64)
        .filter(|&v| is_whole(v) && v >= 1.0)
    else {
        return RecordRead::Damaged(RecordDamage::Version);
    };
    if version > f64::from(RECORD_VERSION) {
        return RecordRead::Newer;
    }
    match record_of(&map) {
        Reading::Read(record) => {
            let json = written(&record);
            RecordRead::Read { record, json }
        }
        Reading::Newer => RecordRead::Newer,
        Reading::Damaged(part) => RecordRead::Damaged(RecordDamage::Part(part)),
    }
}

/// A record as one compact string, `v` first and its fields in a fixed order
/// (the TypeScript codec's `encodeLayerOrderRecord`), or why it cannot be:
/// a part that would not read back, or more than [`RECORD_MAX_BYTES`]. The
/// JSON is numbers and this module's own words, so its length is its size in
/// bytes.
pub fn encode_record(record: &LayerOrderRecord) -> Result<String, EncodeRefusal> {
    if let Some(part) = invalid_part(record) {
        return Err(EncodeRefusal::Invalid { part });
    }
    let json = written(record);
    if json.len() > RECORD_MAX_BYTES {
        return Err(EncodeRefusal::OverBudget {
            bytes: json.len(),
            budget: RECORD_MAX_BYTES,
        });
    }
    Ok(json)
}

/// The first part of a typed record that would not read back, in the order
/// [`read_record`] checks them.
pub(crate) fn invalid_part(record: &LayerOrderRecord) -> Option<RecordPart> {
    let face_ok = |face: &RecordFace| {
        face.at.iter().all(|c| c.is_finite()) && face.area.is_finite() && face.area > 0.0
    };
    if !record.faces.iter().all(face_ok) {
        return Some(RecordPart::Faces);
    }
    let n = record.faces.len();
    let pair_ok =
        |pair: &RecordPair| (pair.f as usize) < n && (pair.g as usize) < n && pair.f != pair.g;
    if !record.constraints.iter().all(pair_ok) {
        return Some(RecordPart::Constraints);
    }
    if !record.order.iter().all(pair_ok) {
        return Some(RecordPart::Order);
    }
    if let Some(attention) = &record.attention
        && !(is_whole(attention.count) && attention.count >= 0.0)
    {
        return Some(RecordPart::Attention);
    }
    None
}

/// A reading of a part: as this build holds it, a newer build's, or damage.
enum Reading<T> {
    Read(T),
    Newer,
    Damaged(RecordPart),
}

const RECORD_KEYS: [&str; 5] = ["v", "faces", "constraints", "order", "attention"];
const FACE_KEYS: [&str; 2] = ["at", "area"];
const ATTENTION_KEYS: [&str; 2] = ["reason", "count"];

/// A key outside `known`: a field a newer build wrote.
fn has_newer_key(map: &Map<String, Value>, known: &[&str]) -> bool {
    map.keys().any(|key| !known.contains(&key.as_str()))
}

/// Every field of a version-1 record, checked; the version is the caller's.
/// What a newer build wrote is looked for before damage, anywhere in the
/// record: a later build may mean something by what reads here as damage.
fn record_of(map: &Map<String, Value>) -> Reading<LayerOrderRecord> {
    if has_newer_key(map, &RECORD_KEYS) {
        return Reading::Newer;
    }
    let faces = faces_of(map.get("faces"));
    let attention = map.get("attention").map(attention_of);
    if matches!(faces, Reading::Newer) || matches!(attention, Some(Reading::Newer)) {
        return Reading::Newer;
    }
    let faces = match faces {
        Reading::Read(faces) => faces,
        Reading::Newer => return Reading::Newer,
        Reading::Damaged(part) => return Reading::Damaged(part),
    };
    let Some(constraints) = pairs_of(map.get("constraints"), faces.len()) else {
        return Reading::Damaged(RecordPart::Constraints);
    };
    let Some(order) = pairs_of(map.get("order"), faces.len()) else {
        return Reading::Damaged(RecordPart::Order);
    };
    let attention = match attention {
        None => None,
        Some(Reading::Read(attention)) => Some(attention),
        Some(Reading::Newer) => return Reading::Newer,
        Some(Reading::Damaged(part)) => return Reading::Damaged(part),
    };
    Reading::Read(LayerOrderRecord {
        faces,
        constraints,
        order,
        attention,
    })
}

fn faces_of(value: Option<&Value>) -> Reading<Vec<RecordFace>> {
    let damaged = Reading::Damaged(RecordPart::Faces);
    let Some(Value::Array(list)) = value else {
        return damaged;
    };
    if list
        .iter()
        .any(|face| matches!(face, Value::Object(map) if has_newer_key(map, &FACE_KEYS)))
    {
        return Reading::Newer;
    }
    let mut faces = Vec::with_capacity(list.len());
    for face in list {
        let Value::Object(map) = face else {
            return damaged;
        };
        let at = match map.get("at") {
            Some(Value::Array(at)) if at.len() == 2 => {
                match (finite_number(&at[0]), finite_number(&at[1])) {
                    (Some(x), Some(y)) => [x, y],
                    _ => return damaged,
                }
            }
            _ => return damaged,
        };
        let Some(area) = map.get("area").and_then(finite_number).filter(|&a| a > 0.0) else {
            return damaged;
        };
        faces.push(RecordFace { at, area });
    }
    Reading::Read(faces)
}

/// Pairs of distinct faces among `face_count`, each with a sign; `None` when
/// any is not one.
fn pairs_of(value: Option<&Value>, face_count: usize) -> Option<Vec<RecordPair>> {
    let Some(Value::Array(list)) = value else {
        return None;
    };
    let face = |index: &Value| {
        index
            .as_f64()
            .filter(|&i| is_whole(i) && i >= 0.0 && i < face_count as f64)
            // Whole and below a `Vec`'s length, so it fits.
            .map(|i| i as u32)
    };
    list.iter()
        .map(|pair| {
            let Value::Array(pair) = pair else {
                return None;
            };
            let [f, g, sign] = pair.as_slice() else {
                return None;
            };
            let (f, g) = (face(f)?, face(g)?);
            let sign = match sign.as_f64() {
                Some(1.0) => FoldSign::Front,
                Some(-1.0) => FoldSign::Back,
                _ => return None,
            };
            (f != g).then_some(RecordPair { f, g, sign })
        })
        .collect()
}

fn attention_of(value: &Value) -> Reading<Attention> {
    let damaged = Reading::Damaged(RecordPart::Attention);
    let Value::Object(map) = value else {
        return damaged;
    };
    // A field or a reason this build has no name for is a newer build's.
    if has_newer_key(map, &ATTENTION_KEYS) {
        return Reading::Newer;
    }
    let reason = match map.get("reason") {
        Some(Value::String(word)) => match AttentionReason::of_word(word) {
            Some(reason) => reason,
            None => return Reading::Newer,
        },
        _ => return damaged,
    };
    match map
        .get("count")
        .and_then(Value::as_f64)
        .filter(|&c| is_whole(c) && c >= 0.0)
    {
        Some(count) => Reading::Read(Attention { reason, count }),
        None => damaged,
    }
}

/// JavaScript's `typeof value === 'number' && Number.isFinite(value)`: a JSON
/// number always is.
fn finite_number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|v| v.is_finite())
}

/// JavaScript's `Number.isInteger`.
fn is_whole(value: f64) -> bool {
    value.is_finite() && value.trunc() == value
}

/// The record's JSON as both codecs write it.
fn written(record: &LayerOrderRecord) -> String {
    let mut out = String::with_capacity(
        64 + record.faces.len() * 48 + (record.constraints.len() + record.order.len()) * 12,
    );
    out.push_str("{\"v\":");
    let _ = write!(out, "{RECORD_VERSION}");
    out.push_str(",\"faces\":[");
    for (i, face) in record.faces.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"at\":[");
        out.push_str(&js_number(face.at[0]));
        out.push(',');
        out.push_str(&js_number(face.at[1]));
        out.push_str("],\"area\":");
        out.push_str(&js_number(face.area));
        out.push('}');
    }
    out.push_str("],\"constraints\":");
    write_pairs(&mut out, &record.constraints);
    out.push_str(",\"order\":");
    write_pairs(&mut out, &record.order);
    if let Some(attention) = &record.attention {
        out.push_str(",\"attention\":{\"reason\":\"");
        out.push_str(attention.reason.word());
        out.push_str("\",\"count\":");
        out.push_str(&js_number(attention.count));
        out.push('}');
    }
    out.push('}');
    out
}

fn write_pairs(out: &mut String, pairs: &[RecordPair]) {
    out.push('[');
    for (i, pair) in pairs.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "[{},{},{}]", pair.f, pair.g, pair.sign.value());
    }
    out.push(']');
}

/// A finite number as JavaScript's `JSON.stringify` writes it
/// (ECMAScript's `Number::toString`): the shortest digits that read back to
/// the same double, the nearest of those to it, and of two equally near the
/// even one; written plainly for exponents from -7 to 20 and in exponent form
/// (`1e+21`, `1.5e-7`) past them; `-0` as `0`.
///
/// The digits are Rust's own shortest round-trip digits (`{:e}`), which are
/// the fewest and the nearest too, but break a tie upward: a double exactly
/// halfway between two shortest decimals (`1896615650723110.25`, whose
/// shortest are `…110.2` and `…110.3`, about one random double in 1,700) is
/// written with the even one here, as V8 writes it. Checked against Node's
/// `JSON.stringify` on three million doubles, 600,000 of them halves,
/// quarters and eighths past 2⁴⁹ where ties are common: no difference. The
/// shared golden holds 147 of them. `NaN` and the infinities, which no
/// record holds, are `null`, as `JSON.stringify` writes them.
pub fn js_number(value: f64) -> String {
    if !value.is_finite() {
        return "null".to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }
    let (digits, n) = shortest_digits(value.abs());
    let k = digits.len() as i32;
    let mut out = String::with_capacity(k as usize + 8);
    if value < 0.0 {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let e = n - 1;
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        let _ = write!(out, "{}", e.abs());
    }
    out
}

/// The digits `d₁…d_k` and the exponent `n` of `x` (finite, above 0) as
/// ECMAScript picks them, `x ≈ 0.d₁…d_k × 10ⁿ`: the fewest digits that read
/// back to `x`, the nearest such decimal to it, and of two equally near the
/// even one.
fn shortest_digits(x: f64) -> (String, i32) {
    let (digits, exponent) = split_exponential(&format!("{x:e}"));
    let n = exponent + 1;
    let k = digits.len() as i32;
    // Rust's digits are the fewest and the nearest; only a tie can differ,
    // and only when Rust's last digit is odd.
    let odd = digits.bytes().last().is_some_and(|d| (d - b'0') % 2 == 1);
    let Some(d) = digits.parse::<u128>().ok().filter(|_| odd) else {
        return (digits, n);
    };
    // A tie lies halfway between two k-digit decimals, so it is exactly
    // a decimal of k + 1 digits, the last a 5.
    let Some((s, m)) = short_exact(x) else {
        return (digits, n);
    };
    for (halfway, other) in [(10 * d - 5, d - 1), (10 * d + 5, d + 1)] {
        if s != halfway || m != n - k - 1 + decimal_digits(halfway) {
            continue;
        }
        let other = other.to_string();
        let reads_back = format!("0.{other}e{n}").parse::<f64>() == Ok(x);
        if other.len() == digits.len() && !other.ends_with('0') && reads_back {
            return (other, n);
        }
    }
    (digits, n)
}

/// `x` (finite, above 0) exactly as `s` and `m` with `x = 0.s × 10ᵐ`, `s` with
/// no trailing zero, when `s` has at most 19 digits; `None` when it has more,
/// which no tie of at most 18 digits does.
///
/// `x` is `M × 2ᴱ` with `M` odd. Past the point (`E < 0`) it is
/// `M × 5⁻ᴱ × 10ᴱ`, and `M × 5⁻ᴱ` is odd, so has no trailing zero; at most 19
/// digits needs `-E ≤ 27`. A whole `x` ends in a 5 only when every factor of
/// two went into a factor of ten, so it has a tie only for `E ≤ 22` (`M`
/// below 2⁵³ holds at most 22 fives); `E ≤ 64` is checked.
fn short_exact(x: f64) -> Option<(u128, i32)> {
    let bits = x.to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1 << 52) - 1);
    let (mut mantissa, mut exponent) = if biased == 0 {
        (fraction, -1074)
    } else {
        (fraction | (1 << 52), biased - 1075)
    };
    if mantissa == 0 {
        return None;
    }
    let zeros = mantissa.trailing_zeros();
    mantissa >>= zeros;
    exponent += zeros as i32;
    let (mut s, mut tens) = if exponent < 0 {
        let fives = 5u128.checked_pow(exponent.unsigned_abs())?;
        (u128::from(mantissa).checked_mul(fives)?, exponent)
    } else if exponent <= 64 {
        (u128::from(mantissa) << exponent, 0)
    } else {
        return None;
    };
    while s % 10 == 0 {
        s /= 10;
        tens += 1;
    }
    (s < 10u128.pow(19)).then(|| (s, decimal_digits(s) + tens))
}

/// How many decimal digits `value` (above 0) has.
fn decimal_digits(value: u128) -> i32 {
    value.ilog10() as i32 + 1
}

/// The significant digits and the exponent of Rust's `{:e}` form,
/// `d.ddd…e±x`.
fn split_exponential(text: &str) -> (String, i32) {
    let (mantissa, exponent) = text.split_once('e').unwrap_or((text, "0"));
    (
        mantissa.chars().filter(char::is_ascii_digit).collect(),
        exponent.parse().unwrap_or(0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_written_as_javascript_writes_them() {
        // Each pair: the double, and what `JSON.stringify` writes for it
        // (checked in Node 22).
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-3.5, "-3.5"),
            (12.0, "12"),
            (0.125, "0.125"),
            (0.1, "0.1"),
            (0.6, "0.6"),
            (1.0 / 3.0, "0.3333333333333333"),
            (123.456, "123.456"),
            (1e20, "100000000000000000000"),
            (1.2345678901234568e20, "123456789012345680000"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (2f64.powi(60), "1152921504606847000"),
            (1e-6, "0.000001"),
            (1.2345e-6, "0.0000012345"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (-2.5e-8, "-2.5e-8"),
            (5e-324, "5e-324"),
            (f64::MAX, "1.7976931348623157e+308"),
            (f64::MIN_POSITIVE, "2.2250738585072014e-308"),
            (9007199254740993.0, "9007199254740992"),
            (111111.0, "111111"),
            (f64::NAN, "null"),
        ];
        for &(value, js) in cases {
            assert_eq!(js_number(value), js, "{value:e}");
        }
    }

    #[test]
    fn signs_follow_fold_s_rule() {
        for f_above in [true, false] {
            for g_up in [true, false] {
                let sign = FoldSign::of_above(f_above, g_up);
                assert_eq!(sign.above(g_up), f_above);
                assert_eq!(FoldSign::of_value(sign.value()), Some(sign));
                for f_up in [true, false] {
                    // g against f says the same order.
                    let back = sign.reversed_for(f_up, g_up);
                    assert_eq!(back.above(f_up), !f_above);
                }
            }
        }
        // A valley's two halves, the front-down face on top: +1 both ways.
        assert_eq!(FoldSign::of_above(true, true), FoldSign::Front);
        assert_eq!(FoldSign::of_value(0), None);
    }
}
