//! Source-only image-fit research, with no reference-geometry input.
use oristudio_cp_compiler::ExactSolveInput;
use oristudio_cp_detect::source_line_fit::{measure_source_lines, refine_source_border};
use std::{path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if !(4..=5).contains(&args.len()) {
        return Err("usage: source_line_probe INPUT IMAGE QUAD_JSON OUT [refine-border]".into());
    }
    let mut input: ExactSolveInput = serde_json::from_slice(&std::fs::read(&args[0])?)?;
    let image = image::open(&args[1])?.into_rgba8();
    let quad = serde_json::from_str(&args[2])?;
    let start = Instant::now();
    let quad = if args.get(4).is_some_and(|s| s == "refine-border") {
        refine_source_border(image.as_raw(), image.width(), image.height(), quad)?
    } else {
        quad
    };
    let evidence =
        measure_source_lines(&input, image.as_raw(), image.width(), image.height(), quad)?;
    let seconds = start.elapsed().as_secs_f64();
    let out = PathBuf::from(&args[3]);
    std::fs::create_dir_all(&out)?;
    std::fs::write(out.join("evidence.json"), serde_json::to_string(&evidence)?)?;
    let report = serde_json::json!({"seconds":seconds,"lines":evidence.lines.len(),"vertices":evidence.fitted_vertices.len(),"quad":quad});
    input.image_evidence = Some(evidence);
    std::fs::write(out.join("input.json"), serde_json::to_string(&input)?)?;
    std::fs::write(
        out.join("fit-report.json"),
        serde_json::to_string_pretty(&report)?,
    )?;
    println!("{report}");
    Ok(())
}
