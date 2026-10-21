//! Time deleting selected creases from a large `.osf`, the way the Delete key
//! does it: `LineSegmentDelete` with explicit `line_ids` (what `edit.delete`
//! sends), then the compact geometry and the sheet index the frontend asks for
//! after an edit.
//!
//! ```text
//! cargo run --release -p oristudio-cp --example delete_perf -- <file.osf> [sizes] [--compare]
//! ```
//!
//! `sizes` is a comma-separated list: a number of sheets (the first that many in
//! reading order, by the kernel's sheet index), `half` for half of them, or
//! `all` for every line. The default is `2,20,half,all`.
//!
//! `--compare` also runs the remove-one-at-a-time loop the kernel used before
//! (a scan and a `Vec::remove` per line) and checks the two leave the same
//! lines. It takes minutes on half a million lines.

use std::time::Instant;

use oristudio_cp::geometry::LineSegment;
use oristudio_cp::session::CpSession;
use oristudio_cp::sheets::sheet_index;
use oristudio_cp::{CreasePatternCommandPayload, CreasePatternDocument, OperationId};
use serde::Deserialize;

/// Just the path to the crease pattern inside an `.osf`.
#[derive(Deserialize)]
struct Osf {
    workspace: Workspace,
}

#[derive(Deserialize)]
struct Workspace {
    #[serde(rename = "creasePattern")]
    crease_pattern: Entry,
}

#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "creasePattern")]
    crease_pattern: Engine,
}

#[derive(Deserialize)]
struct Engine {
    document: CreasePatternDocument,
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

/// The loop the kernel used before, for `--compare`.
fn one_remove_per_line(lines: &mut Vec<LineSegment>, indices: &[usize]) {
    let targets: Vec<_> = indices
        .iter()
        .filter_map(|index| lines.get(*index).cloned())
        .collect();
    for target in targets {
        if let Some(index) = lines.iter().position(|line| line == &target) {
            lines.remove(index);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let compare = args.iter().any(|arg| arg == "--compare");
    let positional: Vec<&String> = args.iter().filter(|arg| !arg.starts_with("--")).collect();
    let Some(file) = positional.first() else {
        eprintln!("usage: delete_perf <file.osf> [sizes] [--compare]");
        std::process::exit(2);
    };
    let sizes: Vec<String> = positional
        .get(1)
        .map_or("2,20,half,all", |sizes| sizes.as_str())
        .split(',')
        .map(str::to_string)
        .collect();

    let started = Instant::now();
    let reader = std::io::BufReader::new(std::fs::File::open(file).expect("open the file"));
    let osf: Osf = serde_json::from_reader(reader).expect("read an .osf crease pattern");
    let document = osf.workspace.crease_pattern.crease_pattern.document;
    let line_count = document.crease_pattern.line_segments.len();
    let index = sheet_index(&document.crease_pattern);
    println!(
        "read {line_count} lines in {} sheets in {:.0} ms",
        index.sheets.len(),
        ms(started)
    );

    for size in sizes {
        let line_ids: Vec<usize> = if size == "all" {
            (1..=line_count).collect()
        } else {
            let sheets = if size == "half" {
                index.sheets.len() / 2
            } else {
                size.parse()
                    .expect("a size is a number of sheets, half or all")
            };
            index
                .line_sheet
                .iter()
                .enumerate()
                .filter(|(_, sheet)| usize::try_from(**sheet).is_ok_and(|sheet| sheet < sheets))
                .map(|(line, _)| line + 1)
                .collect()
        };

        let mut session = CpSession::new();
        let handle = session.load_document(document.clone());
        let started = Instant::now();
        session
            .execute_command(
                handle,
                OperationId::LineSegmentDelete,
                CreasePatternCommandPayload {
                    line_ids: line_ids.clone(),
                    ..Default::default()
                },
            )
            .expect("delete");
        let delete_ms = ms(started);
        let started = Instant::now();
        let geometry = session.document_geometry(handle).expect("geometry");
        let bytes = geometry.to_bytes().expect("geometry bytes");
        let geometry_ms = ms(started);
        let started = Instant::now();
        session.sheet_index(handle).expect("sheet index");
        let index_ms = ms(started);

        let compared = if compare {
            let after = session.document_snapshot(handle).expect("snapshot");
            let mut expected = document.crease_pattern.line_segments.clone();
            let indices: Vec<usize> = line_ids.iter().map(|id| id - 1).collect();
            let started = Instant::now();
            one_remove_per_line(&mut expected, &indices);
            format!(
                "; old loop {:.0} ms, same lines: {}",
                ms(started),
                expected == after.crease_pattern.line_segments
            )
        } else {
            String::new()
        };
        println!(
            "{size:>5}: {} lines deleted in {delete_ms:.1} ms; then geometry {geometry_ms:.0} ms ({} MB), sheet index {index_ms:.0} ms{compared}",
            line_ids.len(),
            bytes.len() / 1_000_000,
        );
    }
}
