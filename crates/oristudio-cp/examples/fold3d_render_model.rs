//! Emit a [`Folded3dRenderModel`] as JSON, so the frontend projector can be
//! tested against the kernel's real output rather than against a hand-written
//! stand-in.
//!
//! The projector (`apps/web/src/cp-workspace/folded/foldedFigure3dProjection.ts`)
//! is a pure function of this payload, so its tests want the payload and nothing
//! else — no wasm, no store, no canvas. A fixture nobody can regenerate is a
//! fixture that rots, so this is the one command that produces them and the
//! README beside them quotes it.
//!
//! ```bash
//! cargo run -p oristudio-cp --release --example fold3d_render_model -- \
//!     --out apps/web/src/cp-workspace/folded/__fixtures__
//! ```
//!
//! Two of the cases are built here rather than read from a file, because no
//! naturally authored design has their shape and neither belongs in
//! `tests/fixtures/fold-angle-3d/` (which is owner-authored material only — see
//! its README):
//!
//! - `strip_coupled` — the 1x4 strip at (-90, +180, +90). Two planes whose
//!   ordering variables are *coupled*, because creases 1 and 3 land on one 3D
//!   line. A renderer that resolves depth per plane gets this definitely wrong
//!   half the time, so it has to appear in what gets drawn.
//! - `pinwheel` / `pinwheel_cyclic` — a square centre with four arms folded flat
//!   back across it, at solutions 1 and 5 of its stream. Its overlap graph is
//!   the four-cycle He and Guest's square twist needs; solution 1 resolves that
//!   cycle acyclically and **solution 5 does not** — `0 > 4 > 3 > 2 > 0` — which
//!   is the state no per-face scalar layer index can express and the one a
//!   renderer that topologically sorts has to fail on.

use std::path::{Path, PathBuf};

use oristudio_cp::folding::FoldedFigureModel;
use oristudio_cp::folding3d::Fold3dSession;
use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::io::fold::import_fold_document;
use treemaker_fold::FoldDocument;

fn main() {
    let mut out: Option<PathBuf> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--out" => out = args.next().map(PathBuf::from),
            other => {
                eprintln!("unknown argument {other}");
                std::process::exit(2);
            }
        }
    }

    for (name, segments, case) in cases() {
        let mut session = match Fold3dSession::new(&segments, 1, FoldedFigureModel::default()) {
            Ok(session) => session,
            Err(error) => {
                eprintln!("{name}: {error}");
                std::process::exit(1);
            }
        };
        for _ in 1..case {
            if let Err(error) = session.advance() {
                eprintln!("{name}: advance: {error}");
                std::process::exit(1);
            }
        }
        if session.snapshot().current_fold_case != case {
            eprintln!("{name}: wanted case {case}, the stream wrapped first");
            std::process::exit(1);
        }
        let render = session.render_model();
        let json = match serde_json::to_string(render) {
            Ok(json) => json,
            Err(error) => {
                eprintln!("{name}: {error}");
                std::process::exit(1);
            }
        };
        match &out {
            Some(directory) => {
                let path = directory.join(format!("{name}.rendermodel.json"));
                if let Err(error) = std::fs::write(&path, format!("{json}\n")) {
                    eprintln!("write {}: {error}", path.display());
                    std::process::exit(1);
                }
                println!(
                    "{name}: case {case}, {} faces, {} planes, {} cells, {} edges, {} bytes",
                    render.face_count,
                    render.plane_count,
                    render.cell_count,
                    render.edge_count,
                    json.len() + 1,
                );
            }
            None => println!("{json}"),
        }
    }
}

/// `(fixture name, segments, 1-based solution to emit)`.
fn cases() -> Vec<(String, Vec<LineSegment>, usize)> {
    let mut cases = vec![
        ("strip_coupled".to_string(), strip(&[-90.0, 180.0, 90.0]), 1),
        ("pinwheel".to_string(), pinwheel(), 1),
        ("pinwheel_cyclic".to_string(), pinwheel(), 5),
    ];
    for name in ["hinge_90", "box_90", "spikes_small"] {
        cases.push((name.to_string(), fixture(name), 1));
    }
    cases
}

/// The committed `.fold` fixtures, read through the same importer the editor
/// uses, so the segments are the ones `G` would fold.
fn fixture(name: &str) -> Vec<LineSegment> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("tests/fixtures/fold-angle-3d")
        .join(format!("{name}.fold"));
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let document: FoldDocument =
        serde_json::from_str(&raw).unwrap_or_else(|error| panic!("parse {name}: {error}"));
    import_fold_document(&document)
        .unwrap_or_else(|error| panic!("import {name}: {error}"))
        .line_segments
}

fn crease(a: Point, b: Point, degrees: f64) -> LineSegment {
    let mut segment = LineSegment::with_color(a, b, LineColor::Red1);
    segment.fold_magnitude = FoldMagnitude::from_degrees(degrees);
    segment
}

fn border(a: Point, b: Point) -> LineSegment {
    LineSegment::with_color(a, b, LineColor::Black0)
}

/// A horizontal strip of 100-unit panels hinged at each interior crease.
fn strip(angles: &[f64]) -> Vec<LineSegment> {
    let panels = angles.len() + 1;
    let width = 100.0;
    let far = width * panels as f64;
    let mut segments = vec![
        border(Point::new(0.0, 0.0), Point::new(0.0, width)),
        border(Point::new(far, 0.0), Point::new(far, width)),
    ];
    for index in 0..panels {
        let (x0, x1) = (width * index as f64, width * (index + 1) as f64);
        segments.push(border(Point::new(x0, 0.0), Point::new(x1, 0.0)));
        segments.push(border(Point::new(x0, width), Point::new(x1, width)));
    }
    for (index, &degrees) in angles.iter().enumerate() {
        let x = width * (index + 1) as f64;
        segments.push(crease(Point::new(x, 0.0), Point::new(x, width), degrees));
    }
    segments
}

/// A square centre with four arms, each folded flat back across it.
///
/// Centre `[0,100]^2`; the arms land at `[0,100]x[0,25]`, `[75,100]x[0,100]`,
/// `[0,100]x[75,100]` and `[0,25]x[0,100]`.
fn pinwheel() -> Vec<LineSegment> {
    let p = Point::new;
    vec![
        crease(p(0.0, 0.0), p(25.0, 0.0), 180.0),
        border(p(25.0, 0.0), p(100.0, 0.0)),
        crease(p(100.0, 0.0), p(100.0, 25.0), 180.0),
        border(p(100.0, 25.0), p(100.0, 100.0)),
        crease(p(75.0, 100.0), p(100.0, 100.0), 180.0),
        border(p(0.0, 100.0), p(75.0, 100.0)),
        crease(p(0.0, 75.0), p(0.0, 100.0), 180.0),
        border(p(0.0, 0.0), p(0.0, 75.0)),
        border(p(0.0, 0.0), p(0.0, -100.0)),
        border(p(0.0, -100.0), p(25.0, -100.0)),
        border(p(25.0, -100.0), p(25.0, 0.0)),
        border(p(100.0, 0.0), p(200.0, 0.0)),
        border(p(200.0, 0.0), p(200.0, 25.0)),
        border(p(200.0, 25.0), p(100.0, 25.0)),
        border(p(100.0, 100.0), p(100.0, 200.0)),
        border(p(100.0, 200.0), p(75.0, 200.0)),
        border(p(75.0, 200.0), p(75.0, 100.0)),
        border(p(0.0, 100.0), p(-100.0, 100.0)),
        border(p(-100.0, 100.0), p(-100.0, 75.0)),
        border(p(-100.0, 75.0), p(0.0, 75.0)),
    ]
}
