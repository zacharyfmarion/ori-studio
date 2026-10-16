//! External corpus probe; no input or rendered geometry is written to the repository.
use oristudio_cp::session::CpSession;
use std::{env, fs, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = env::args()
        .nth(1)
        .ok_or("usage: batch_import_bench DIRECTORY [COUNT]")?;
    let limit: usize = env::args()
        .nth(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(usize::MAX);
    let mut paths = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "cp"))
        .collect::<Vec<_>>();
    paths.sort();
    paths.truncate(limit);
    let mut session = CpSession::new();
    let target = session.load_cp("", "batch")?;
    let started = Instant::now();
    let mut parts = Vec::new();
    let mut lines = 0;
    let cols = (paths.len() as f64).sqrt().ceil() as usize;
    for (i, path) in paths.iter().enumerate() {
        let h = session.load_cp(&fs::read_to_string(path)?, "source")?;
        let mut g = session.document_geometry(h)?;
        session.free_document(h)?;
        lines += g.seg_endpoints.len() / 4;
        for xy in g.seg_endpoints.chunks_exact_mut(2) {
            xy[0] += (i % cols) as f64 * 500.;
            xy[1] += (i / cols) as f64 * 500.;
        }
        parts.push(g);
    }
    eprintln!(
        "parse: {}ms, {} sheets, {} segments",
        started.elapsed().as_millis(),
        parts.len(),
        lines
    );
    let at = Instant::now();
    session.append_disjoint(target, &parts, true)?;
    drop(parts);
    eprintln!("append: {}ms", at.elapsed().as_millis());
    let at = Instant::now();
    let fold = session.export_fold(target)?;
    eprintln!(
        "cold FOLD export: {}ms, {} bytes",
        at.elapsed().as_millis(),
        fold.len()
    );
    let at = Instant::now();
    let geometry = session.document_geometry(target)?;
    eprintln!(
        "compact: {}ms, {} endpoint bytes; total {}ms",
        at.elapsed().as_millis(),
        geometry.seg_endpoints.len() * 8,
        started.elapsed().as_millis()
    );
    Ok(())
}
