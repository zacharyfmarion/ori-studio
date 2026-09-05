//! Native crease patterns (`.cp`, `.ori`) into curated-benchmark cases: each
//! one rendered the way the editor's Export PNG draws it, exported as FOLD
//! through the editor's own exporter, and kept only when it folds flat. See
//! `implementation-plans/cp-detect-rendered-corpus.md`.
//!
//! ```bash
//! cargo run --release -p oristudio-cp --example rendered_corpus -- \
//!     --from /path/to/raw/cpoogle --into /path/to/real_benchmark/cpoogle
//! ```
//!
//! Per file: import with the kernel's readers; fold the creases with
//! `FoldingEstimateSession` to `Order5`, the editor's Fold, under a per-case
//! deadline through the kernel's cooperative cancel; write `source.png`,
//! `topology.fold` and `truth.fold` (the same pattern: the file is its own
//! truth), and a row in the group's `README.md`. A pattern that does not fold,
//! or times out, gets a row in the excluded table and no case. `detected.fold`
//! is not made here: `curated_benchmark --write-detected` fills it, the same
//! pipeline that scores the case.
//!
//! Flags: `--only a,b` keeps files whose name contains one of the strings;
//! `--limit n` stops after `n` files; `--fold-seconds s` is the deadline
//! (20); `--jobs n` the worker threads (every core); `--force` remakes cases
//! that exist. Files sharing a cpoogle drive id, or the same segments, make
//! one case.
use std::collections::{BTreeMap, BTreeSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use image::imageops::{self, FilterType};
use image::{Rgb, RgbImage};
use imageproc::drawing::{draw_filled_circle_mut, draw_polygon_mut};
use imageproc::point::Point as PixelPoint;
use oristudio_cp::cancel::{self, CancelHandle, CancelSource, RunId};
use oristudio_cp::folding::{EstimationOrder, EstimationStep, FoldOutcome, FoldingEstimateSession};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::io::cp::import_cp_str;
use oristudio_cp::io::fold::export_fold_document;
use oristudio_cp::io::ori::import_ori_json;
use oristudio_cp::model::{CreasePatternModel, is_classic_crease};
use treemaker_fold::{Assignment, FoldDocument};

// --- the export's page, from `apps/web/src/lib/creaseExport.ts` ---------------

/// The export's page, in pixels.
const CANVAS: u32 = 1024;
/// The paper sits this far inside the page.
const MARGIN: f64 = 48.0;
/// Drawn at this multiple and downsampled, as the export is rasterised.
const SUPERSAMPLE: u32 = 3;
/// `DEFAULT_ORISTUDIO_CP_LINE_WIDTH * 1.5 * (1024 / 720)`: the export scales
/// the canvas stroke into its larger box.
const STROKE_PX: f64 = 1.0 * 1.5 * (CANVAS as f64 / 720.0);
/// The light export palette.
const CANVAS_COLOR: u32 = 0xffffff;
const PAPER_COLOR: u32 = 0xf8f5ec;
const MOUNTAIN_COLOR: u32 = 0xff4d5d;
const VALLEY_COLOR: u32 = 0x60a5fa;
const BORDER_COLOR: u32 = 0x111417;
const FLAT_COLOR: u32 = 0x64c8c8;
const UNASSIGNED_COLOR: u32 = 0x9aa4ad;

/// The editor's flat-foldability bar, in degrees.
const EXACT_KAWASAKI_DEGREES: f64 = 1e-6;

struct Args {
    from: PathBuf,
    into: PathBuf,
    only: Option<Vec<String>>,
    limit: Option<usize>,
    fold_seconds: f64,
    jobs: usize,
    force: bool,
}

fn parse_args() -> Args {
    let mut args = Args {
        from: PathBuf::new(),
        into: PathBuf::new(),
        only: None,
        limit: None,
        fold_seconds: 20.0,
        jobs: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4),
        force: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--from" => args.from = it.next().expect("--from <dir>").into(),
            "--into" => args.into = it.next().expect("--into <dir>").into(),
            "--only" => {
                args.only = Some(
                    it.next()
                        .expect("--only <a,b>")
                        .split(',')
                        .map(str::to_owned)
                        .collect(),
                )
            }
            "--limit" => args.limit = Some(it.next().expect("--limit <n>").parse().expect("limit")),
            "--fold-seconds" => {
                args.fold_seconds = it
                    .next()
                    .expect("--fold-seconds <s>")
                    .parse()
                    .expect("fold-seconds")
            }
            "--jobs" => args.jobs = it.next().expect("--jobs <n>").parse().expect("jobs"),
            "--force" => args.force = true,
            other => panic!("unknown argument {other}"),
        }
    }
    assert!(
        args.from.is_dir(),
        "--from must name a directory of .cp / .ori files"
    );
    assert!(
        !args.into.as_os_str().is_empty(),
        "--into <group directory>"
    );
    args
}

// --- one file ---------------------------------------------------------------

/// What became of one file.
#[derive(Debug, Clone)]
struct Record {
    file: String,
    slug: String,
    /// Why the file made no case; `None` when it did.
    excluded: Option<String>,
    segments: usize,
    aux: usize,
    fold: String,
    fold_seconds: f64,
    exact: Option<Exactness>,
}

#[derive(Debug, Clone, Copy)]
struct Exactness {
    exact: bool,
    worst_kawasaki_degrees: f64,
    odd_vertices: usize,
    creases: usize,
}

fn import(path: &Path) -> Result<CreasePatternModel, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    match path.extension().and_then(|e| e.to_str()) {
        Some("cp") => import_cp_str(&text).map_err(|e| format!("cp: {e:?}")),
        Some("ori") => import_ori_json(&text)
            .map(|document| document.crease_pattern)
            .map_err(|e| format!("ori: {e:?}")),
        other => Err(format!("unsupported extension {other:?}")),
    }
}

fn is_crease(color: LineColor) -> bool {
    matches!(
        color,
        LineColor::Black0 | LineColor::Red1 | LineColor::Blue2
    )
}

/// A cancel source that reads as cancelled once its deadline passes.
struct Deadline(Instant);

impl CancelSource for Deadline {
    fn cancelled_run(&self) -> u32 {
        u32::from(Instant::now() >= self.0)
    }
}

/// The editor's Fold on the creases: to `Order5`, under `seconds`.
fn fold(creases: &[LineSegment], seconds: f64) -> (String, f64) {
    let started = Instant::now();
    let handle = CancelHandle::new(
        Arc::new(Deadline(started + Duration::from_secs_f64(seconds))),
        RunId::new(1).expect("nonzero"),
    );
    let _guard = cancel::bind(Some(handle));
    let mut session = FoldingEstimateSession::new(creases, 1);
    let outcome = match session.folding_estimated(EstimationOrder::Order5) {
        Err(error) if error.is_cancelled() => "timeout".to_owned(),
        Err(error) => format!("error: {error:?}"),
        Ok(estimate) if estimate.estimation_step == EstimationStep::Step1 => {
            "faces_unresolved".to_owned()
        }
        Ok(estimate) => match estimate.outcome {
            FoldOutcome::Solved => "solved".to_owned(),
            FoldOutcome::NoSolutions => "no_solutions".to_owned(),
            FoldOutcome::Contradiction => "contradiction".to_owned(),
            FoldOutcome::NotAttempted => "not_attempted".to_owned(),
        },
    };
    (outcome, started.elapsed().as_secs_f64())
}

/// The editor's check on the exported pattern: no interior vertex of odd
/// crease degree, Kawasaki within the bar at every even one. `Flat` edges
/// are aux lines, not creases; a vertex on a `Boundary` edge is exempt.
fn exactness(fold: &FoldDocument) -> Exactness {
    let n = fold.vertices_coords.len();
    let mut incident: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut boundary = vec![false; n];
    let mut creases = 0usize;
    for (edge, assignment) in fold.edges_vertices.iter().zip(&fold.edges_assignment) {
        match assignment {
            Assignment::Boundary => {
                boundary[edge[0]] = true;
                boundary[edge[1]] = true;
            }
            Assignment::Mountain | Assignment::Valley | Assignment::Unassigned => {
                creases += 1;
                incident[edge[0]].push(edge[1]);
                incident[edge[1]].push(edge[0]);
            }
            _ => {}
        }
    }
    let mut worst = 0.0_f64;
    let mut odd = 0usize;
    for v in 0..n {
        if boundary[v] || incident[v].is_empty() {
            continue;
        }
        if incident[v].len() % 2 == 1 {
            odd += 1;
            continue;
        }
        let (x, y) = (fold.vertices_coords[v][0], fold.vertices_coords[v][1]);
        let mut angles: Vec<f64> = incident[v]
            .iter()
            .map(|&w| (fold.vertices_coords[w][1] - y).atan2(fold.vertices_coords[w][0] - x))
            .collect();
        angles.sort_by(|a, b| a.total_cmp(b));
        let mut alternating = 0.0_f64;
        for (k, angle) in angles.iter().enumerate() {
            let next = angles[(k + 1) % angles.len()];
            let mut sector = next - angle;
            if sector <= 0.0 {
                sector += std::f64::consts::TAU;
            }
            if k % 2 == 0 {
                alternating += sector;
            } else {
                alternating -= sector;
            }
        }
        worst = worst.max(alternating.abs().to_degrees());
    }
    Exactness {
        exact: odd == 0 && worst <= EXACT_KAWASAKI_DEGREES,
        worst_kawasaki_degrees: worst,
        odd_vertices: odd,
        creases,
    }
}

fn rgb(hex: u32) -> Rgb<u8> {
    Rgb([(hex >> 16) as u8, (hex >> 8) as u8, hex as u8])
}

fn stroke_color(color: LineColor) -> Rgb<u8> {
    match color {
        LineColor::Black0 => rgb(BORDER_COLOR),
        LineColor::Red1 => rgb(MOUNTAIN_COLOR),
        LineColor::Blue2 => rgb(VALLEY_COLOR),
        LineColor::None | LineColor::Angle => rgb(UNASSIGNED_COLOR),
        _ => rgb(FLAT_COLOR),
    }
}

/// Draw order: the paper, aux lines, valleys, mountains, then the border on
/// top, so a boundary stays crisp where creases meet it.
fn draw_rank(color: LineColor) -> u8 {
    match color {
        LineColor::Black0 => 3,
        LineColor::Red1 => 2,
        LineColor::Blue2 => 1,
        _ => 0,
    }
}

/// The export's page: paper inset by the margin, the pattern's paper
/// bounding box mapped onto it with one scale, centred.
fn render(segments: &[LineSegment]) -> RgbImage {
    let paper: Vec<&LineSegment> = {
        let borders: Vec<&LineSegment> = segments
            .iter()
            .filter(|s| s.color == LineColor::Black0)
            .collect();
        if borders.is_empty() {
            segments.iter().collect()
        } else {
            borders
        }
    };
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for s in &paper {
        for p in [s.a, s.b] {
            min_x = min_x.min(p.x);
            min_y = min_y.min(p.y);
            max_x = max_x.max(p.x);
            max_y = max_y.max(p.y);
        }
    }
    let span = CANVAS as f64 - 2.0 * MARGIN;
    let extent = (max_x - min_x).max(max_y - min_y).max(1e-9);
    let scale = span / extent;
    let offset_x = MARGIN + (span - (max_x - min_x) * scale) / 2.0;
    let offset_y = MARGIN + (span - (max_y - min_y) * scale) / 2.0;
    let big = f64::from(SUPERSAMPLE);
    let map = |p: Point| -> (f64, f64) {
        (
            (offset_x + (p.x - min_x) * scale) * big,
            (offset_y + (p.y - min_y) * scale) * big,
        )
    };
    let size = CANVAS * SUPERSAMPLE;
    let mut image = RgbImage::from_pixel(size, size, rgb(CANVAS_COLOR));
    let corners = [
        Point::new(min_x, min_y),
        Point::new(max_x, min_y),
        Point::new(max_x, max_y),
        Point::new(min_x, max_y),
    ]
    .map(|c| {
        let (x, y) = map(c);
        PixelPoint::new(x.round() as i32, y.round() as i32)
    });
    draw_polygon_mut(&mut image, &corners, rgb(PAPER_COLOR));
    let half = STROKE_PX * big / 2.0;
    let radius = half.round() as i32;
    let mut ordered: Vec<&LineSegment> = segments.iter().collect();
    ordered.sort_by_key(|s| draw_rank(s.color));
    for s in ordered {
        let color = stroke_color(s.color);
        let (ax, ay) = map(s.a);
        let (bx, by) = map(s.b);
        let (dx, dy) = (bx - ax, by - ay);
        let len = dx.hypot(dy);
        if len > 0.5 {
            let (nx, ny) = (-dy / len * half, dx / len * half);
            let quad = [
                (ax + nx, ay + ny),
                (bx + nx, by + ny),
                (bx - nx, by - ny),
                (ax - nx, ay - ny),
            ]
            .map(|(x, y)| PixelPoint::new(x.round() as i32, y.round() as i32));
            if quad[0] != quad[3] {
                draw_polygon_mut(&mut image, &quad, color);
            }
        }
        for (x, y) in [(ax, ay), (bx, by)] {
            draw_filled_circle_mut(
                &mut image,
                (x.round() as i32, y.round() as i32),
                radius,
                color,
            );
        }
    }
    imageops::resize(&image, CANVAS, CANVAS, FilterType::Lanczos3)
}

/// The cpoogle drive id in a scraped file name, when there is one. A scraped
/// name is `cpoogle-<id>-<title>` or `cpoogle-<id>-cpoogle-<id>-<title>`, and
/// an id is 28 to 33 characters of letters, digits, `-` and `_`, so it
/// cannot be split on `-`: the doubled form names its own end, the single
/// form is read at each length, longest first.
fn drive_id(stem: &str) -> Option<&str> {
    let rest = stem.strip_prefix("cpoogle-")?;
    if let Some(end) = rest.find("-cpoogle-") {
        return Some(&rest[..end]);
    }
    (28..=33).rev().find_map(|len| {
        let id = rest.get(..len)?;
        let id_like = id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        (id_like && (rest.len() == len || rest.as_bytes().get(len) == Some(&b'-'))).then_some(id)
    })
}

/// A slug from the file name with every scraper prefix removed.
fn slug_for(stem: &str) -> String {
    let mut rest = stem;
    while let Some(after) = rest.strip_prefix("cpoogle-") {
        let Some(id) = drive_id(rest) else {
            break;
        };
        match after.get(id.len()..id.len() + 1) {
            Some("-") => rest = &after[id.len() + 1..],
            _ => break,
        }
    }
    let mut out = String::new();
    let mut dash = false;
    for ch in rest.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    let out: String = out.chars().take(80).collect();
    let out = out.trim_end_matches('-').to_owned();
    if out.is_empty() {
        "case".to_owned()
    } else {
        out
    }
}

/// The segments as a set, so two files of one pattern hash alike.
fn content_hash(segments: &[LineSegment]) -> u64 {
    let mut keys: Vec<(i64, i64, i64, i64, i32)> = segments
        .iter()
        .map(|s| {
            let q = |v: f64| (v * 1000.0).round() as i64;
            let (a, b) = if (q(s.a.x), q(s.a.y)) <= (q(s.b.x), q(s.b.y)) {
                (s.a, s.b)
            } else {
                (s.b, s.a)
            };
            (q(a.x), q(a.y), q(b.x), q(b.y), s.color as i32)
        })
        .collect();
    keys.sort();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    keys.hash(&mut hasher);
    hasher.finish()
}

fn process(file: &Path, slug: &str, into: &Path, fold_seconds: f64, force: bool) -> Record {
    let name = file
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_owned();
    let mut record = Record {
        file: name,
        slug: slug.to_owned(),
        excluded: None,
        segments: 0,
        aux: 0,
        fold: String::new(),
        fold_seconds: 0.0,
        exact: None,
    };
    let model = match import(file) {
        Ok(model) => model,
        Err(error) => {
            record.excluded = Some(error);
            return record;
        }
    };
    record.segments = model.line_segments.len();
    record.aux = model
        .line_segments
        .iter()
        .filter(|s| !is_crease(s.color))
        .count();
    let creases: Vec<LineSegment> = model
        .line_segments
        .iter()
        .filter(|s| is_crease(s.color))
        .cloned()
        .collect();
    if creases.is_empty() {
        record.excluded = Some("no creases".to_owned());
        return record;
    }
    if !creases.iter().all(is_classic_crease) {
        record.excluded = Some("needs_3d: a crease carries a non-180 fold angle".to_owned());
        return record;
    }
    let case_dir = into.join(slug);
    let done = case_dir.join("source.png").is_file()
        && case_dir.join("topology.fold").is_file()
        && case_dir.join("truth.fold").is_file();
    let (outcome, seconds) = fold(&creases, fold_seconds);
    record.fold = outcome.clone();
    record.fold_seconds = seconds;
    let exported = export_fold_document(&model, Some(slug.to_owned()));
    record.exact = Some(exactness(&exported));
    if outcome != "solved" {
        record.excluded = Some(format!("fold: {outcome}"));
        return record;
    }
    if done && !force {
        return record;
    }
    if let Err(error) = std::fs::create_dir_all(&case_dir) {
        record.excluded = Some(format!("mkdir: {error}"));
        return record;
    }
    let image = render(&model.line_segments);
    if let Err(error) = image.save(case_dir.join("source.png")) {
        record.excluded = Some(format!("png: {error}"));
        return record;
    }
    let json = match serde_json::to_string(&exported) {
        Ok(json) => json,
        Err(error) => {
            record.excluded = Some(format!("fold json: {error}"));
            return record;
        }
    };
    for name in ["topology.fold", "truth.fold"] {
        if let Err(error) = std::fs::write(case_dir.join(name), &json) {
            record.excluded = Some(format!("{name}: {error}"));
            return record;
        }
    }
    record
}

// --- the group ---------------------------------------------------------------

fn main() {
    let args = parse_args();
    let Ok(entries) = std::fs::read_dir(&args.from) else {
        panic!("cannot read {}", args.from.display());
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && matches!(
                    p.extension().and_then(|e| e.to_str()),
                    Some("cp") | Some("ori")
                )
        })
        .collect();
    files.sort();
    if let Some(only) = &args.only {
        files.retain(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            only.iter().any(|s| name.contains(s.as_str()))
        });
    }

    // One case per drive id and per segment set; the first file, sorted, wins.
    let mut seen_ids: BTreeSet<String> = BTreeSet::new();
    let mut seen_content: BTreeSet<u64> = BTreeSet::new();
    let mut slugs: BTreeMap<String, usize> = BTreeMap::new();
    let mut work: Vec<(PathBuf, String)> = Vec::new();
    let mut duplicates: Vec<(String, String)> = Vec::new();
    for file in &files {
        let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let name = file
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();
        if let Some(id) = drive_id(stem)
            && !seen_ids.insert(id.to_owned())
        {
            duplicates.push((name, format!("same drive id {id}")));
            continue;
        }
        // An import failure is reported by `process`.
        if let Ok(model) = import(file)
            && !seen_content.insert(content_hash(&model.line_segments))
        {
            duplicates.push((name, "same segments as an earlier file".to_owned()));
            continue;
        }
        let base = slug_for(stem);
        let count = slugs.entry(base.clone()).or_insert(0);
        *count += 1;
        let slug = if *count == 1 {
            base
        } else {
            format!(
                "{base}-{}",
                drive_id(stem).map(|id| &id[..6]).unwrap_or("dup")
            )
        };
        work.push((file.clone(), slug));
    }
    if let Some(limit) = args.limit {
        work.truncate(limit);
    }
    let _ = std::fs::create_dir_all(&args.into);
    eprintln!(
        "[rendered] {} files, {} duplicates set aside, {} to make under {} with {} workers",
        files.len(),
        duplicates.len(),
        work.len(),
        args.into.display(),
        args.jobs
    );

    let started = Instant::now();
    let next = AtomicUsize::new(0);
    let records: Mutex<Vec<Record>> = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..args.jobs.max(1) {
            scope.spawn(|| {
                loop {
                    let index = next.fetch_add(1, Ordering::SeqCst);
                    let Some((file, slug)) = work.get(index) else {
                        break;
                    };
                    let record = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        process(file, slug, &args.into, args.fold_seconds, args.force)
                    }))
                    .unwrap_or_else(|_| Record {
                        file: file
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_owned(),
                        slug: slug.clone(),
                        excluded: Some("panic".to_owned()),
                        segments: 0,
                        aux: 0,
                        fold: "panic".to_owned(),
                        fold_seconds: 0.0,
                        exact: None,
                    });
                    eprintln!(
                        "[{}/{}] {:60} {:5} seg  fold {:16} {:6.1}s  {}",
                        index + 1,
                        work.len(),
                        record.slug.chars().take(60).collect::<String>(),
                        record.segments,
                        record.fold,
                        record.fold_seconds,
                        record.excluded.as_deref().unwrap_or("case written")
                    );
                    records.lock().expect("records").push(record);
                }
            });
        }
    });
    let mut records = records.into_inner().expect("records");
    records.sort_by(|a, b| a.slug.cmp(&b.slug));

    let made: Vec<&Record> = records.iter().filter(|r| r.excluded.is_none()).collect();
    let excluded: Vec<&Record> = records.iter().filter(|r| r.excluded.is_some()).collect();
    let exact = made
        .iter()
        .filter(|r| r.exact.is_some_and(|e| e.exact))
        .count();
    let mut readme = String::new();
    readme.push_str("# Rendered cases\n\n");
    readme.push_str(&format!(
        "Made by `rendered_corpus` from `{}` on {}: {} files, {} set aside as duplicates, {} cases written ({} exact at the editor's 1e-6° bar), {} excluded. Each case is a native crease pattern rendered the way the editor's Export PNG draws it (`source.png`), with the pattern itself as `topology.fold` and `truth.fold`; aux lines are `F` edges. Kept only when the editor's Fold reaches a layer ordering. `detected.fold` comes from `curated_benchmark --write-detected`.\n\n",
        args.from.display(),
        chrono_date(),
        files.len(),
        duplicates.len(),
        made.len(),
        exact,
        excluded.len()
    ));
    readme.push_str("## Cases\n\n| case | file | segments | creases | aux | exact | Kawasaki (°) | odd vertices | fold (s) |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n");
    for r in &made {
        let e = r.exact.expect("made cases were checked");
        readme.push_str(&format!(
            "| `{}` | `{}` | {} | {} | {} | {} | {:.2e} | {} | {:.1} |\n",
            r.slug,
            r.file,
            r.segments,
            e.creases,
            r.aux,
            if e.exact { "yes" } else { "no" },
            e.worst_kawasaki_degrees,
            e.odd_vertices,
            r.fold_seconds
        ));
    }
    readme.push_str(
        "\n## Excluded\n\n| file | segments | reason | fold (s) |\n| --- | --- | --- | --- |\n",
    );
    for r in &excluded {
        readme.push_str(&format!(
            "| `{}` | {} | {} | {:.1} |\n",
            r.file,
            r.segments,
            r.excluded.as_deref().unwrap_or(""),
            r.fold_seconds
        ));
    }
    readme.push_str("\n## Duplicates set aside\n\n| file | reason |\n| --- | --- |\n");
    for (file, reason) in &duplicates {
        readme.push_str(&format!("| `{file}` | {reason} |\n"));
    }
    let _ = std::fs::write(args.into.join("README.md"), readme);
    println!(
        "rendered corpus: {} cases written ({} exact), {} excluded, {} duplicates, {:.0}s",
        made.len(),
        exact,
        excluded.len(),
        duplicates.len(),
        started.elapsed().as_secs_f64()
    );
}

/// Today, as `YYYY-MM-DD`, without a date crate: days since the epoch through
/// the civil calendar.
fn chrono_date() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}
