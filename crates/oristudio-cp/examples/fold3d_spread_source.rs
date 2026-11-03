//! Read-only input for the spatial spread experiment. No production wire API.
//! cargo run -p oristudio-cp --release --example fold3d_spread_source -- input.fold
//! `--strip` makes the synthetic two-plane, coupled-order hinge case.

use std::error::Error;
use std::io::{BufWriter, Error as IoError, ErrorKind};

use oristudio_cp::folding::FoldedFigureModel;
use oristudio_cp::folding3d::Fold3dSession;
use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::io::fold::import_fold_document;
use serde_json::json;
use treemaker_fold::FoldDocument;

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let source = args
        .next()
        .ok_or_else(|| IoError::new(ErrorKind::InvalidInput, "expected input.fold or --strip"))?;
    let case: usize = args.next().map_or(Ok(1), |value| value.parse())?;
    if case == 0 || args.next().is_some() {
        return Err(IoError::new(ErrorKind::InvalidInput, "expected a 1-based case").into());
    }
    let segments = if source == "--strip" {
        strip()
    } else {
        let document: FoldDocument = serde_json::from_str(&std::fs::read_to_string(source)?)?;
        import_fold_document(&document)?.line_segments
    };
    let mut session = Fold3dSession::new(&segments, 1, FoldedFigureModel::default())?;
    for _ in 1..case {
        session.advance()?;
    }
    if session.snapshot().current_fold_case != case {
        return Err(IoError::new(ErrorKind::InvalidInput, "solution stream wrapped").into());
    }
    let frame = session.folded_form_frame(None)?;
    let placement = &session.admission().placement;
    // Interchange keeps used vertices in increasing material-ID order, choosing
    // each vertex's lowest-face image. Use its geometry, not coordinate welding.
    let used: std::collections::BTreeSet<usize> =
        placement.rings.iter().flatten().copied().collect();
    let sheet: Vec<_> = used
        .iter()
        .map(|&v| [placement.points[v].x, placement.points[v].y])
        .collect();
    let result = json!({
        "version": "spatial-spread-experiment-1",
        "folded": frame,
        "sheet": sheet,
        "render": session.render_model(),
        "snapshot": session.snapshot(),
    });
    serde_json::to_writer(BufWriter::new(std::io::stdout().lock()), &result)?;
    Ok(())
}

fn strip() -> Vec<LineSegment> {
    let point = |x, y| Point::new(x, y);
    let border = |a, b| LineSegment::with_color(a, b, LineColor::Black0);
    let mut lines = vec![
        border(point(0., 0.), point(0., 100.)),
        border(point(400., 0.), point(400., 100.)),
    ];
    for panel in 0..4 {
        let x = f64::from(panel) * 100.;
        lines.push(border(point(x, 0.), point(x + 100., 0.)));
        lines.push(border(point(x, 100.), point(x + 100., 100.)));
    }
    for (i, angle) in [-90_f64, 180., 90.].into_iter().enumerate() {
        let x = (i + 1) as f64 * 100.;
        let color = if angle < 0. {
            LineColor::Red1
        } else {
            LineColor::Blue2
        };
        let mut line = LineSegment::with_color(point(x, 0.), point(x, 100.), color);
        line.fold_magnitude = FoldMagnitude::from_degrees(angle.abs());
        lines.push(line);
    }
    lines
}
