//! Native timing harness for a flat folded figure's *appearance* round trip.
//!
//! A colour or style change on a folded figure is two kernel calls per slider
//! tick: `folded_figure_set_model` and `folded_figure_render_snapshot`. This
//! folds one figure — out of an Ori Studio `.osf` project the way the app does
//! (a stored figure's `sourceLineIds` and starting face), or the whole of an
//! Oriedita `.ori` — then times those two calls over many ticks and prints the
//! medians: the number the Properties pane's write queue lives with.
//!
//! ```bash
//! cargo run -p oristudio-cp --release --example folded_render_profile -- \
//!   tests/fixtures/simulation/iguana_24.osf --figure generated-29 --loops 20
//! cargo run -p oristudio-cp --release --example folded_render_profile -- \
//!   /path/to/slow_fold_iguana.ori --loops 20
//! ```
//!
//! Without `--figure` the largest ready figure in an `.osf` is used.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::folding::{
    DisplayStyle, EstimationOrder, FoldedFigureModel, FoldedFigureRenderOptions,
};
use oristudio_cp::io::ori::import_ori_json;
use oristudio_cp::session::CpSession;
use std::time::{Duration, Instant};

struct StoredFigure {
    id: String,
    line_ids: Vec<usize>,
    starting_face_id: i32,
}

/// The editable crease pattern and the stored figures of an `.osf` project.
///
/// Both project layouts are read: the single `workspace.creasePattern` node of
/// older files and the `workspace.documents[]` list of newer ones. The
/// `creasePattern.document` node is the kernel's own serde form of
/// [`CreasePatternDocument`].
fn load_osf(text: &str) -> (CreasePatternDocument, Vec<StoredFigure>) {
    let root = serde_json::from_str::<serde_json::Value>(text).expect("parse .osf JSON");
    let node = root
        .pointer("/workspace/creasePattern")
        .cloned()
        .or_else(|| {
            root.pointer("/workspace/documents")?
                .as_array()?
                .iter()
                .find(|document| {
                    document.get("kind").and_then(|kind| kind.as_str()) == Some("crease-pattern")
                })
                .cloned()
        })
        .expect("no crease-pattern document in this .osf");
    let document = serde_json::from_value::<CreasePatternDocument>(
        node.pointer("/creasePattern/document")
            .cloned()
            .expect("crease-pattern document"),
    )
    .expect("deserialize crease pattern document");
    let figures = node
        .pointer("/viewState/foldedFigures")
        .and_then(|figures| figures.as_array())
        .map(|figures| {
            figures
                .iter()
                .filter(|figure| figure.get("status").and_then(|s| s.as_str()) == Some("ready"))
                .filter_map(|figure| {
                    Some(StoredFigure {
                        id: figure.get("id")?.as_str()?.to_string(),
                        line_ids: figure
                            .get("sourceLineIds")?
                            .as_array()?
                            .iter()
                            .filter_map(|id| id.as_u64().map(|id| id as usize))
                            .collect(),
                        starting_face_id: figure
                            .get("startingFaceId")
                            .and_then(|id| id.as_i64())
                            .unwrap_or(1) as i32,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    (document, figures)
}

fn median(samples: &mut [Duration]) -> Duration {
    samples.sort();
    samples[samples.len() / 2]
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut path = None;
    let mut figure_id = None;
    let mut loops = 10usize;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--figure" => figure_id = args.next(),
            "--loops" => loops = args.next().and_then(|v| v.parse().ok()).unwrap_or(10),
            other => path = Some(other.to_string()),
        }
    }
    let path = path.expect("usage: folded_render_profile <file.osf> [--figure ID] [--loops N]");
    let text = std::fs::read_to_string(&path).expect("read project");
    let (document, figure) = if path.to_ascii_lowercase().ends_with(".ori") {
        // An `.ori` is one crease pattern; fold all of it from face 1.
        let document = import_ori_json(&text).expect("import .ori");
        let figure = StoredFigure {
            id: "whole".to_string(),
            line_ids: (0..document.crease_pattern.line_segments.len()).collect(),
            starting_face_id: 1,
        };
        (document, figure)
    } else {
        let (document, mut figures) = load_osf(&text);
        figures.sort_by_key(|figure| std::cmp::Reverse(figure.line_ids.len()));
        let figure = match figure_id {
            Some(id) => figures
                .into_iter()
                .find(|figure| figure.id == id)
                .expect("no ready figure with that id"),
            None => figures
                .into_iter()
                .next()
                .expect("no ready figure in this file"),
        };
        (document, figure)
    };
    println!(
        "{}: figure {} from {} creases (of {}), starting face {}",
        path,
        figure.id,
        figure.line_ids.len(),
        document.crease_pattern.line_segments.len(),
        figure.starting_face_id
    );

    let mut session = CpSession::new();
    let handle = session.load_document(document);
    let started = Instant::now();
    let folded = session
        .folded_figure_fold_selected(
            handle,
            &figure.line_ids,
            figure.starting_face_id,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("fold");
    println!(
        "fold: {:.1} ms ({} folded points)",
        started.elapsed().as_secs_f64() * 1e3,
        folded
            .snapshot
            .wireframe
            .as_ref()
            .map_or(0, |w| w.points.len())
    );

    let mut set_model = Vec::with_capacity(loops);
    let mut render = Vec::with_capacity(loops);
    let mut primitives = 0usize;
    for tick in 0..loops {
        // Alternate a colour so every tick is a real change.
        let mut model = FoldedFigureModel::default();
        model.front_color.red = (tick % 2 * 100) as u8;

        let started = Instant::now();
        session
            .folded_figure_set_model(folded.handle, model)
            .expect("set model");
        set_model.push(started.elapsed());

        let started = Instant::now();
        let snapshot = session
            .folded_figure_render_snapshot(
                folded.handle,
                Some(DisplayStyle::Paper5),
                FoldedFigureRenderOptions::default(),
            )
            .expect("render");
        render.push(started.elapsed());
        primitives = snapshot.map(|s| s.primitives.len()).unwrap_or(0);
    }
    println!(
        "per tick over {loops}: set_model {:.2} ms, render (Paper5) {:.2} ms — {primitives} primitives",
        median(&mut set_model).as_secs_f64() * 1e3,
        median(&mut render).as_secs_f64() * 1e3,
    );
}
