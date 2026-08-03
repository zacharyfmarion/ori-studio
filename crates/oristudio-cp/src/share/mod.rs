//! Share links: a crease pattern compressed into a base64url payload small
//! enough to live in a URL fragment.
//!
//! ```text
//! https://<host>/edit#c=<base64url, unpadded>
//! ```
//!
//! The fragment, never the query: RFC 3986 §3.5 means the payload is never sent
//! to a server, so request-line limits do not apply, it never lands in an access
//! log, and it is stripped from cross-origin `Referer`.
//!
//! # What survives a share link
//!
//! Creases (all thirteen `LineColor` variants, fold magnitudes, custom colours),
//! aux lines, circles, texts, standalone points, the grid, and the title.
//!
//! Deliberately **not** carried: `operation_frame` (transient tool state),
//! `metadata` (which re-embeds the entire source FOLD), and per-segment `active`
//! and `selected` (session state — Oriedita's own importer ignores `active`).
//! Opening a share link produces a *new* document, and the UI should say so.
//!
//! # Precision
//!
//! The only lossy step is the coordinate quantum, chosen per document from an
//! analytic bound on the Kawasaki residual and floored at a measured minimum
//! (see [`canon`]). Every payload is then decoded by the shipped decoder and
//! compared against the source before it is emitted; see [`verify`].

pub mod bitio;
pub mod canon;
pub mod error;
pub mod frame;
pub mod v1;
pub mod varint;
pub mod verify;

pub use error::{Result, ShareError};
pub use frame::Compressor;

use crate::CreasePatternDocument;
use crate::model::CreasePatternModel;

/// Body grammars this build can decode. Old versions are never removed: a link
/// shared today must still open in five years.
const SUPPORTED_VERSIONS: &[u8] = &[v1::VERSION];

/// Grammars the encoder will emit. Kept as a list because the mode-comparison
/// loop below is the mechanism by which a future grammar is introduced safely:
/// every candidate is verified, and the smallest verified payload wins, so a new
/// grammar can never make a link larger or wronger than the one it joins.
const ENCODE_VERSIONS: &[u8] = &[v1::VERSION];

#[derive(Debug, Clone, Copy)]
pub struct ShareOptions {
    /// Run the full CAMV/closure comparison in the encoder's self-check.
    ///
    /// On by default. Turning it off makes encoding cheaper for benchmarks that
    /// measure size only; it must stay on for anything a user will open.
    pub verify_diagnostics: bool,
    /// Quantum bumps before giving up on the index codec and emitting `.fold`.
    pub max_rounds: usize,
}

impl Default for ShareOptions {
    fn default() -> Self {
        Self {
            verify_diagnostics: true,
            max_rounds: 3,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ShareDecoded {
    pub document: CreasePatternDocument,
    /// Ancillary extension tags this build did not understand, so the UI can
    /// distinguish "opened, but this link is from a newer Ori Studio" from a
    /// clean load.
    pub skipped_extensions: usize,
}

/// What the encoder did, for benchmarks and diagnostics.
///
/// A fallback is a correctness success and a size failure, so the reason has to
/// be observable — an encoder that quietly emits `.fold` for a fifth of a corpus
/// looks fine on every correctness metric while the payloads are 10x too big.
#[derive(Debug, Clone)]
pub struct EncodeReport {
    pub payload: Vec<u8>,
    /// Quantum bumps taken before success.
    pub rounds: usize,
    pub used_fallback: bool,
    pub fallback_reason: Option<String>,
}

/// Encode a document into a complete share payload (frame + body).
///
/// Never returns a payload it has not decoded and checked itself.
pub fn encode_share(document: &CreasePatternDocument, options: ShareOptions) -> Result<Vec<u8>> {
    encode_share_reported(document, options).map(|r| r.payload)
}

/// [`encode_share`], with the self-check outcome attached.
pub fn encode_share_reported(
    document: &CreasePatternDocument,
    options: ShareOptions,
) -> Result<EncodeReport> {
    let model = &document.crease_pattern;
    let title = document.title.as_deref();

    let f_min = if has_non_classic(model) {
        canon::F_MIN_SPATIAL
    } else {
        canon::F_MIN_FLAT
    };
    let mut f_bits = canon::choose_f(&model.line_segments, f_min);
    let aux_f = canon::choose_f(&model.aux_line_segments, f_min);

    let mut last_reason = String::from("index codec did not reproduce the document");
    for round in 0..options.max_rounds {
        // Try every grammar at this quantum and keep the smallest that verifies.
        // A quantum bump is the fallback for *correctness*, not for size, so it
        // only happens when no grammar reproduced the document.
        //
        // Compared *after* framing and compression, because that is what ships:
        // the topology layer emits fewer bytes but a less repetitive stream, so
        // uncompressed body length is not a reliable proxy for the final size and
        // picking on it chooses wrong on small documents.
        let mut best: Option<Vec<u8>> = None;
        for &version in ENCODE_VERSIONS {
            match attempt(model, title, f_bits, aux_f, version, options) {
                Ok(body) => {
                    let framed = frame::write(version, &body);
                    if best.as_ref().is_none_or(|b| framed.len() < b.len()) {
                        best = Some(framed);
                    }
                }
                Err(reason) => last_reason = reason,
            }
        }
        if let Some(payload) = best {
            return Ok(EncodeReport {
                payload,
                rounds: round,
                used_fallback: false,
                fallback_reason: None,
            });
        }
        f_bits += 2;
        if f_bits > canon::F_WIRE_MAX {
            break;
        }
    }

    // Fallback: a lossless `.fold` body. Bigger, but it always round-trips, and
    // a large link beats a wrong one.
    let fold = crate::io::fold::export_fold_file_document_json(document)
        .map_err(|_| ShareError::NotRepresentable("document could not be exported as .fold"))?;
    Ok(EncodeReport {
        payload: frame::write(v1::VERSION, &v1::encode_raw(&fold)),
        rounds: options.max_rounds,
        used_fallback: true,
        fallback_reason: Some(last_reason),
    })
}

/// One encode + self-check round. `Err` carries why it failed, so the caller can
/// decide between bumping the quantum and falling back.
fn attempt(
    model: &CreasePatternModel,
    title: Option<&str>,
    f_bits: i32,
    aux_f: i32,
    version: u8,
    options: ShareOptions,
) -> std::result::Result<Vec<u8>, String> {
    let body =
        v1::encode(model, title, f_bits, aux_f).map_err(|e| format!("v{version} encode: {e}"))?;
    let decoded = v1::decode(&body).map_err(|e| format!("v{version} decode of own output: {e}"))?;

    // The encoder's *intent* is the quantised geometry, so compare against a
    // re-encoded reference rather than the raw source: this asserts the decoder
    // reproduces what the encoder meant, bit for bit.
    let reference =
        reference_model(model, f_bits, aux_f).map_err(|e| format!("reference build: {e}"))?;
    if !verify::creases_match(&reference.line_segments, &decoded.model.line_segments) {
        return Err(format!("v{version} crease multiset changed"));
    }
    if !verify::creases_match(
        &reference.aux_line_segments,
        &decoded.model.aux_line_segments,
    ) {
        return Err(format!("v{version} aux crease multiset changed"));
    }
    if options.verify_diagnostics && !verify::diagnostics_match(model, &decoded.model) {
        return Err(format!("v{version} foldability diagnostics changed"));
    }
    Ok(body)
}

/// The geometry the encoder intends to transmit: the source model with every
/// coordinate canonicalised and quantised exactly as the wire format will.
fn reference_model(
    model: &CreasePatternModel,
    f_bits: i32,
    aux_f: i32,
) -> Result<CreasePatternModel> {
    let mut out = model.clone();
    snap(&mut out.line_segments, &mut out.points, f_bits)?;
    let mut no_points = Vec::new();
    snap(&mut out.aux_line_segments, &mut no_points, aux_f)?;
    Ok(out)
}

fn snap(
    segments: &mut [crate::geometry::LineSegment],
    points: &mut [crate::geometry::Point],
    f_bits: i32,
) -> Result<()> {
    if segments.is_empty() && points.is_empty() {
        return Ok(());
    }
    let q = canon::quantise(segments, points, f_bits)?;
    for s in segments.iter_mut() {
        s.a = crate::geometry::Point::new(
            q.dequantise(q.x.values[q.x.index_of(s.a.x)? as usize]),
            q.dequantise(q.y.values[q.y.index_of(s.a.y)? as usize]),
        );
        s.b = crate::geometry::Point::new(
            q.dequantise(q.x.values[q.x.index_of(s.b.x)? as usize]),
            q.dequantise(q.y.values[q.y.index_of(s.b.y)? as usize]),
        );
    }
    for p in points.iter_mut() {
        *p = crate::geometry::Point::new(
            q.dequantise(q.x.values[q.x.index_of(p.x)? as usize]),
            q.dequantise(q.y.values[q.y.index_of(p.y)? as usize]),
        );
    }
    Ok(())
}

fn has_non_classic(model: &CreasePatternModel) -> bool {
    model
        .line_segments
        .iter()
        .any(|s| s.fold_magnitude.is_some())
}

/// Decode a complete share payload.
pub fn decode_share(bytes: &[u8]) -> Result<ShareDecoded> {
    let (header, body) = frame::read(bytes, SUPPORTED_VERSIONS)?;
    // Both grammars share one body decoder, which dispatches on the echoed
    // version. A future grammar that is not merely a section swap would get its
    // own module here.
    let decoded = match header.format_version {
        v1::VERSION => v1::decode(&body)?,
        other => return Err(ShareError::UnknownVersion(other)),
    };
    Ok(ShareDecoded {
        document: CreasePatternDocument {
            title: decoded.title,
            crease_pattern: decoded.model,
            ..Default::default()
        },
        skipped_extensions: decoded.skipped_extensions,
    })
}

/// Unpadded base64url (RFC 4648 §5) — exactly 6 bits per character, safe
/// unescaped in both a query and a fragment, and double-click selectable.
pub mod b64 {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    pub fn encode(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            let chars = [n >> 18, (n >> 12) & 63, (n >> 6) & 63, n & 63];
            for (i, c) in chars.iter().enumerate() {
                if i <= chunk.len() {
                    out.push(ALPHABET[*c as usize] as char);
                }
            }
        }
        out
    }

    pub fn decode(text: &str) -> Option<Vec<u8>> {
        let mut out = Vec::with_capacity(text.len() * 3 / 4);
        let mut acc = 0u32;
        let mut bits = 0u32;
        for ch in text.bytes() {
            let value = match ch {
                b'A'..=b'Z' => ch - b'A',
                b'a'..=b'z' => ch - b'a' + 26,
                b'0'..=b'9' => ch - b'0' + 52,
                b'-' => 62,
                b'_' => 63,
                b'=' => continue,
                _ => return None,
            };
            acc = (acc << 6) | u32::from(value);
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((acc >> bits) as u8);
            }
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_roundtrips_every_length_class() {
        for len in 0..64usize {
            let bytes: Vec<u8> = (0..len).map(|i| (i * 37 + 11) as u8).collect();
            let text = b64::encode(&bytes);
            assert!(
                !text.contains('=') && !text.contains('+') && !text.contains('/'),
                "alphabet must stay URL-safe and unpadded"
            );
            assert_eq!(b64::decode(&text).unwrap(), bytes, "len {len}");
            assert_eq!(
                text.len(),
                (4 * len).div_ceil(3),
                "unpadded length, len {len}"
            );
        }
    }

    #[test]
    fn base64url_rejects_foreign_characters() {
        assert!(b64::decode("abc!").is_none());
    }
}
