//! Reuse flat crease material in a partial precrease. Marks remain beside
//! the face graph; overlapping portions instead update its remembered
//! letters. A bounded reversal inserts collinear vertices in both incident
//! rings, retaining face identities, isometries, order and crease provenance.

use crate::crease_marks::{self, CreaseMark};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{Crease, CreaseKind, EdgeId, VertexId};
use crate::refusal::FoldRefusal;
use crate::state::State;

pub(super) fn land(state: &State, marks: Vec<CreaseMark>, step: u32) -> Result<State, FoldRefusal> {
    let mut parts = state.parts().clone();
    let mut next_edge = state.next_ids().1;
    let mut creases = Vec::new();
    let mut cuts = vec![Vec::new(); parts.creases.len()];
    let mut changed = false;
    for (k, crease) in parts.creases.iter().enumerate() {
        let CreaseKind::Flat(letter) = crease.kind else {
            creases.push(crease.clone());
            continue;
        };
        let [a, b] = crease.vertices.map(|v| parts.vertices[v.index()]);
        let material = CreaseMark {
            a,
            b,
            letter,
            made_at: crease.made_at,
        };
        let length = material.length();
        let intervals: Vec<_> = marks
            .iter()
            .filter(|m| m.letter != letter)
            .filter_map(|m| crease_marks::covered(&material, m.a, m.b).map(|span| (span, m.letter)))
            .collect();
        if intervals.is_empty() {
            creases.push(crease.clone());
            continue;
        }
        changed = true;
        let mut ts = vec![0.0, 1.0];
        for (span, _) in &intervals {
            ts.extend(
                span.iter()
                    .copied()
                    .filter(|t| *t * length > TOL && (1.0 - t) * length > TOL),
            );
        }
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|a, b| (*a - *b).abs() * length <= TOL);
        let mut chain = vec![crease.vertices[0]];
        for &t in &ts[1..ts.len() - 1] {
            let v = VertexId(parts.vertices.len() as u32);
            parts
                .vertices
                .push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
            chain.push(v);
            cuts[k].push(v);
        }
        chain.push(crease.vertices[1]);
        for (span, vertices) in ts.windows(2).zip(chain.windows(2)) {
            let vertices = [vertices[0], vertices[1]];
            let piece_length = (span[1] - span[0]) * length;
            if piece_length < MIN_FEATURE {
                return Err(FoldRefusal::ShortCrease {
                    vertices,
                    length: piece_length,
                });
            }
            let middle = (span[0] + span[1]) / 2.0;
            let remembered = intervals
                .iter()
                .find(|(s, _)| middle >= s[0] && middle <= s[1])
                .map_or(letter, |(_, l)| *l);
            let id = if ts.len() == 2 {
                crease.id
            } else {
                let id = EdgeId(next_edge);
                next_edge += 1;
                id
            };
            creases.push(Crease {
                id,
                vertices,
                kind: CreaseKind::Flat(remembered),
                ..crease.clone()
            });
        }
    }
    let marks = crease_marks::carry(&marks, &parts.vertices, &creases);
    let marks = crease_marks::add(state.crease_marks(), marks);
    if !changed {
        return state.with_marks(marks, step);
    }
    for (f, face) in parts.faces.iter_mut().enumerate() {
        let mut ring = Vec::new();
        for (i, &v) in face.ring.iter().enumerate() {
            ring.push(v);
            let k = state.topology().face_creases[f][i];
            if parts.creases[k].vertices[0] == v {
                ring.extend(cuts[k].iter().copied());
            } else {
                ring.extend(cuts[k].iter().rev().copied());
            }
        }
        face.ring = ring;
    }
    parts.creases = creases;
    parts.marks = marks;
    parts.step = step;
    State::make(parts)
}
