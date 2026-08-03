//! The encoder's decode-and-compare self-check.
//!
//! This is the safety mechanism, not a debug aid. Every payload is decoded by
//! the *shipped decoder* and compared against the source before it is emitted;
//! a mismatch raises the quantum and retries, and a persistent mismatch falls
//! back to a lossless `.fold` body. That converts an entire class of
//! silent-wrongness bug into, at worst, a larger link.

use std::collections::BTreeMap;

use crate::checks_spatial::dispatched_camv;
use crate::geometry::LineSegment;
use crate::model::CreasePatternModel;

/// Vertex-identity tolerance for matching one document's diagnostics against the
/// other's. Far tighter than Oriedita's own 1e-6 clustering radius, and far
/// looser than any displacement the codec can introduce.
const MATCH_TOLERANCE: f64 = 1e-4;

/// Structural equality: same creases, same colours, same fold magnitudes.
///
/// Compared as a multiset keyed on exact reconstructed coordinates, because the
/// decoder is supposed to reproduce the encoder's intent *bit-identically* —
/// this is not a tolerance check and must not become one.
pub fn creases_match(source: &[LineSegment], decoded: &[LineSegment]) -> bool {
    if source.len() != decoded.len() {
        return false;
    }
    let key = |s: &LineSegment| {
        let (a, b) = if (s.a.x, s.a.y) <= (s.b.x, s.b.y) {
            (s.a, s.b)
        } else {
            (s.b, s.a)
        };
        (
            a.x.to_bits(),
            a.y.to_bits(),
            b.x.to_bits(),
            b.y.to_bits(),
            s.color.number(),
            crate::geometry::FoldMagnitude::to_transport(s.fold_magnitude),
        )
    };
    let mut counts: BTreeMap<_, i64> = BTreeMap::new();
    for s in source {
        *counts.entry(key(s)).or_insert(0) += 1;
    }
    for s in decoded {
        *counts.entry(key(s)).or_insert(0) -= 1;
    }
    counts.values().all(|&c| c == 0)
}

/// Diagnostic-set equality, in **both** directions: no violation created and
/// none removed.
///
/// The second direction matters as much as the first. Snapping coordinates can
/// accidentally "repair" a vertex, and a transport that quietly fixes the user's
/// pattern has changed their document just as surely as one that breaks it.
pub fn diagnostics_match(source: &CreasePatternModel, decoded: &CreasePatternModel) -> bool {
    let a = dispatched_camv(source);
    let b = dispatched_camv(decoded);

    if a.flat.len() != b.flat.len() || a.spatial.len() != b.spatial.len() {
        return false;
    }

    let mut used = vec![false; b.flat.len()];
    for va in &a.flat {
        let hit = b.flat.iter().enumerate().position(|(i, vb)| {
            !used[i]
                && vb.rule == va.rule
                && vb.color == va.color
                && (vb.point.x - va.point.x).abs() < MATCH_TOLERANCE
                && (vb.point.y - va.point.y).abs() < MATCH_TOLERANCE
        });
        match hit {
            Some(i) => used[i] = true,
            None => return false,
        }
    }

    // Spatial vertices carry a continuous residual rather than a verdict, so the
    // meaningful test is that no vertex crosses the closure bar in either
    // direction.
    let bar = 1e-6f64.to_radians();
    let mut used = vec![false; b.spatial.len()];
    for ra in &a.spatial {
        let hit = b.spatial.iter().enumerate().position(|(i, rb)| {
            !used[i]
                && (rb.point.x - ra.point.x).abs() < MATCH_TOLERANCE
                && (rb.point.y - ra.point.y).abs() < MATCH_TOLERANCE
        });
        let Some(i) = hit else { return false };
        used[i] = true;
        match (ra.residual, b.spatial[i].residual) {
            (Some(x), Some(y)) => {
                if (x < bar) != (y < bar) {
                    return false;
                }
            }
            (None, None) => {}
            _ => return false,
        }
    }
    true
}
