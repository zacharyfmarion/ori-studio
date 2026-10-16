//! Ori Studio composition of independent sheets. Oriedita's import_add stays unchanged.
use crate::geometry::{LineColor, Point};
use crate::geometry_transport::{self, CompactGeometry};
use crate::session::EngineError;
use crate::{CreasePatternDocument, CreasePatternModel};

type Bounds = [f64; 4];
fn bounds(model: &CreasePatternModel) -> Result<Option<Bounds>, EngineError> {
    let mut out: Option<Bounds> = None;
    let mut add = |x: f64, y: f64| -> Result<(), EngineError> {
        if !x.is_finite() || !y.is_finite() {
            return Err(EngineError::invalid_input("Non-finite batch geometry"));
        }
        match &mut out {
            None => out = Some([x, y, x, y]),
            Some(b) => {
                b[0] = b[0].min(x);
                b[1] = b[1].min(y);
                b[2] = b[2].max(x);
                b[3] = b[3].max(y);
            }
        }
        Ok(())
    };
    for line in model.line_segments.iter().chain(&model.aux_line_segments) {
        add(line.a.x, line.a.y)?;
        add(line.b.x, line.b.y)?;
    }
    for p in &model.points {
        add(p.x, p.y)?;
    }
    for c in &model.circles {
        add(c.x - c.r.abs(), c.y - c.r.abs())?;
        add(c.x + c.r.abs(), c.y + c.r.abs())?;
    }
    for t in &model.texts {
        let p = t.position();
        add(p.x, p.y)?;
    }
    Ok(out)
}
fn overlaps(a: Bounds, b: Bounds) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}
fn starter(model: &CreasePatternModel) -> bool {
    if !model.points.is_empty()
        || !model.circles.is_empty()
        || !model.texts.is_empty()
        || !model.aux_line_segments.is_empty()
    {
        return false;
    }
    if model.line_segments.is_empty() {
        return true;
    }
    if model.line_segments.len() != 4 {
        return false;
    }
    let corners = [
        Point::new(-200., -200.),
        Point::new(200., -200.),
        Point::new(200., 200.),
        Point::new(-200., 200.),
    ];
    (0..4).all(|i| {
        model.line_segments.iter().any(|l| {
            l.color == LineColor::Black0
                && ((l.a == corners[i] && l.b == corners[(i + 1) % 4])
                    || (l.b == corners[i] && l.a == corners[(i + 1) % 4]))
        })
    })
}
/// Decode and validate everything before touching the live model. Ranges are 1-based, inclusive.
pub(crate) fn append(
    target: &mut CreasePatternDocument,
    parts: &[CompactGeometry],
    replace_starter: bool,
) -> Result<Vec<[usize; 2]>, EngineError> {
    if parts.is_empty() {
        return Ok(vec![]);
    }
    if parts.len() > 1000 {
        return Err(EngineError::invalid_input(
            "At most 1000 sheets may be appended together",
        ));
    }
    if replace_starter && !starter(&target.crease_pattern) {
        return Err(EngineError::invalid_input(
            "The starter sheet was edited while importing",
        ));
    }
    let mut occupied = Vec::new();
    if !replace_starter && let Some(b) = bounds(&target.crease_pattern)? {
        occupied.push(b);
    }
    let mut decoded = Vec::with_capacity(parts.len());
    for part in parts {
        let doc = geometry_transport::decode(part).map_err(EngineError::invalid_input)?;
        let b = bounds(&doc.crease_pattern)?
            .ok_or_else(|| EngineError::invalid_input("An imported sheet is empty"))?;
        if occupied.iter().any(|other| overlaps(b, *other)) {
            return Err(EngineError::invalid_input(
                "Imported sheets overlap existing content or each other",
            ));
        }
        occupied.push(b);
        decoded.push(doc);
    }
    let target = &mut target.crease_pattern;
    if replace_starter {
        target.line_segments.clear();
    }
    let mut ranges = Vec::with_capacity(parts.len());
    for doc in decoded {
        let mut model = doc.crease_pattern;
        let first = target.line_segments.len() + 1;
        for line in &mut model.line_segments {
            line.selected = 0;
        }
        target.line_segments.extend(model.line_segments);
        ranges.push([first, target.line_segments.len()]);
        target.aux_line_segments.extend(model.aux_line_segments);
        target.points.extend(model.points);
        target.circles.extend(model.circles);
        target.texts.extend(model.texts);
    }
    Ok(ranges)
}

#[cfg(test)]
mod tests {
    use crate::session::CpSession;
    #[test]
    fn disjoint_append_is_atomic_and_retains_order() {
        let mut s = CpSession::new();
        let target = s.load_cp("1 0 0 1 0", "target").unwrap();
        let a = s.load_cp("2 10 0 11 0\n4 10 1 11 1", "a").unwrap();
        let b = s.load_cp("3 20 0 21 0", "b").unwrap();
        let parts = vec![
            s.document_geometry(a).unwrap(),
            s.document_geometry(b).unwrap(),
        ];
        assert_eq!(
            s.append_disjoint(target, &parts, false).unwrap(),
            vec![[2, 3], [4, 4]]
        );
        let before = s.document_snapshot(target).unwrap();
        assert!(s.append_disjoint(target, &parts, false).is_err());
        assert_eq!(s.document_snapshot(target).unwrap(), before);
        assert!(s.append_disjoint(target, &parts, true).is_err());
    }
    #[test]
    fn invalid_late_part_leaves_target_unchanged() {
        let mut s = CpSession::new();
        let target = s.load_cp("1 0 0 1 0", "target").unwrap();
        let a = s.load_cp("2 10 0 11 0", "a").unwrap();
        let good = s.document_geometry(a).unwrap();
        let mut bad = good.clone();
        bad.seg_endpoints[0] = f64::NAN;
        let before = s.document_snapshot(target).unwrap();
        assert!(s.append_disjoint(target, &[good, bad], false).is_err());
        assert_eq!(s.document_snapshot(target).unwrap(), before);
    }
}
