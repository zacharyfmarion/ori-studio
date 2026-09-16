//! Source-only AUX reconstruction probe. IMAGE AUX_F32 SOLVE_INPUT_JSON OUT_FOLD
//! Reads rectified pixels and a saved recognition input; never reads truth.
use oristudio_cp_detect::auxiliary::{append_auxiliary, extract_auxiliary_segments};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 4 {
        return Err("IMAGE AUX_F32 SOLVE_INPUT_JSON OUT_FOLD".into());
    }
    let image = image::open(&args[0])?.to_rgba8();
    if image.width() != image.height() {
        return Err("expected square rectified image".into());
    }
    let bytes = std::fs::read(&args[1])?;
    if bytes.len() % 4 != 0 {
        return Err("invalid float32 plane".into());
    }
    let p: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|v| f32::from_le_bytes([v[0], v[1], v[2], v[3]]))
        .collect();
    let input = serde_json::from_str(&std::fs::read_to_string(&args[2])?)?;
    let physical = oristudio_cp_compiler::fold_export::export_candidate_to_fold_document(&input)?;
    let started = std::time::Instant::now();
    let aux = extract_auxiliary_segments(image.as_raw(), &p, image.width())?;
    let result = append_auxiliary(&serde_json::to_string(&physical)?, &aux)?;
    std::fs::write(&args[3], &result)?;
    std::fs::write(
        format!("{}.aux.json", &args[3]),
        serde_json::to_string_pretty(&aux)?,
    )?;
    let fold: treemaker_fold::FoldDocument = serde_json::from_str(&result)?;
    println!(
        "{}",
        serde_json::json!({"aux_carriers":aux.len(),"vertices":fold.vertices_coords.len(),"edges":fold.edges_vertices.len(),"seconds":started.elapsed().as_secs_f64()})
    );
    Ok(())
}
