//! Research-only inference runner. Reads one IMAGE, never benchmark truth.
//!
//! recognition_probe IMAGE OUT_DIR SIZE [CACHE_DIR] [REFINED_VERTICES_JSON] [LINE_F32] [pixel-only]
//!
//! SIZE=1024 reproduces recognize-only; SIZE=2048 tests nine overlapping
//! 1024 tiles, retaining each pixel from the tile with the most context.
//! Model and decode settings come from the product. Not a product option.
use oristudio_cp_detect::decode::{
    DecodeConfig, DecoderBackend, DenseOutputs, RefinedVertexPrimitive,
    decode_dense_outputs_with_backend_and_refined_vertices,
};
use oristudio_cp_detect::native_inference::{
    Heads, IMAGE_SIZE, JUNCTION_OFFSET_RADIUS_PX, NativeSession, THRESHOLD,
};
use oristudio_cp_detect::rectify::auto_rectify_rgba;
use oristudio_cp_detect::source_image_evidence::{
    SourceImageLineEvidenceOptions, line_probability_from_rgba,
};
use serde_json::json;
use std::path::PathBuf;
use std::time::Instant;

fn tiled_inference(
    session: &mut NativeSession,
    rgba: &[u8],
    size: usize,
) -> Result<(Heads, usize), String> {
    let tile = IMAGE_SIZE as usize;
    if size == tile {
        return session.infer(rgba).map(|(heads, _)| (heads, 1));
    }
    let mut positions: Vec<usize> = (0..=size - tile).step_by(tile / 2).collect();
    if positions.last().copied() != Some(size - tile) {
        positions.push(size - tile);
    }
    let mut stitched = Heads::new();
    let mut context = vec![0usize; size * size];
    let mut input = vec![255u8; tile * tile * 4];
    for &y0 in &positions {
        for &x0 in &positions {
            for y in 0..tile {
                let from = ((y0 + y) * size + x0) * 4;
                input[y * tile * 4..(y + 1) * tile * 4]
                    .copy_from_slice(&rgba[from..from + tile * 4]);
            }
            let (heads, _) = session.infer(&input)?;
            let mut owned = Vec::new();
            for y in 0..tile {
                for x in 0..tile {
                    let index = (y0 + y) * size + x0 + x;
                    let margin = 1 + x.min(tile - 1 - x).min(y.min(tile - 1 - y));
                    if margin > context[index] {
                        context[index] = margin;
                        owned.push((y * tile + x, index));
                    }
                }
            }
            for (name, values) in heads {
                // Coordinates from these two heads are local to a tile; the
                // current decoder does not consume them, so do not mislabel
                // them as global coordinates.
                if matches!(name, "boundary_coord" | "boundary_side_logits") {
                    continue;
                }
                let channels = values.len() / (tile * tile);
                let output = stitched
                    .entry(name)
                    .or_insert_with(|| vec![0.0; channels * size * size]);
                for channel in 0..channels {
                    for &(local, global) in &owned {
                        output[channel * size * size + global] =
                            values[channel * tile * tile + local];
                    }
                }
            }
        }
    }
    Ok((stitched, positions.len() * positions.len()))
}

/// E006 ablation: the compact network supplies vertices/crease/AUX evidence;
/// source chroma supplies M/V versus unknown. No old model is run. Grayscale
/// remains unknown so a dark stroke is not arbitrarily called a mountain.
fn source_color_heads(rgba: &[u8], size: usize) -> Heads {
    let n = size * size;
    let mut heads = Heads::new();
    for name in [
        "line_logits",
        "junction_logits",
        "boundary_contact_logits",
        "non_crease_logits",
    ] {
        heads.insert(name, vec![-20.0; n]);
    }
    let mut assignments = vec![-5.0; n * 4];
    let mut styles = vec![-5.0; n * 4];
    for (i, pixel) in rgba.chunks_exact(4).enumerate() {
        let difference = (pixel[0] as f32 - pixel[2] as f32) / 255.0;
        assignments[i] = (difference * 25.0).clamp(-5.0, 5.0);
        assignments[n + i] = (-difference * 25.0).clamp(-5.0, 5.0);
        assignments[3 * n + i] = 1.0;
        styles[i] = 5.0;
    }
    heads.insert("assignment_logits", assignments);
    heads.insert("line_style_logits", styles);
    heads
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 3 {
        return Err(
            "usage: recognition_probe IMAGE OUT_DIR SIZE [CACHE_DIR] [REFINED_VERTICES_JSON]"
                .into(),
        );
    }
    let source = PathBuf::from(&args[0]);
    let out = PathBuf::from(&args[1]);
    let size: u32 = args[2].parse()?;
    let rectify_only = args.get(3).is_some_and(|v| v == "rectify-only");
    let pixel_direct = args.get(6).is_some_and(|v| v == "pixel-direct");
    let pixel_only = pixel_direct || args.get(6).is_some_and(|v| v == "pixel-only");
    if pixel_only && args.len() < 6 {
        return Err("pixel-only requires explicit vertices and a crease probability map".into());
    }
    if !(IMAGE_SIZE..=4096).contains(&size) {
        return Err("SIZE must be 1024..4096".into());
    }
    std::fs::create_dir_all(&out)?;
    let pointer: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(
        "scripts/cp-detect/current-model.json",
    )?)?;
    let model = PathBuf::from(
        pointer["versioned_model_asset_dir"]
            .as_str()
            .ok_or("model dir")?,
    )
    .join(pointer["model_filename"].as_str().ok_or("model file")?);
    let cache = args
        .get(3)
        .map(PathBuf::from)
        .unwrap_or_else(|| out.join(".coreml-cache"));
    let refined: Option<Vec<RefinedVertexPrimitive>> = args
        .get(4)
        .map(|path| -> Result<_, Box<dyn std::error::Error>> {
            Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
        })
        .transpose()?;
    let load_started = Instant::now();
    let mut session = if pixel_only || rectify_only {
        None
    } else {
        Some(NativeSession::open(&model, &cache)?)
    };
    let provider = session.as_ref().map_or("source-color", |s| s.provider);
    let load_seconds = load_started.elapsed().as_secs_f64();
    let started = Instant::now();
    let img = image::open(&source)?.to_rgba8();
    let mut rectified = auto_rectify_rgba(img.as_raw(), img.width(), img.height(), size)?;
    // The current rectifier scales its 32/1024 margin, whereas the decoder's
    // coordinate transform uses a fixed 32 pixels at every size. They agree
    // only at 1024. Align this research canvas explicitly before inference;
    // otherwise a high-resolution probe measures a frame mismatch, not quality.
    let margin = (size as f32 * 32.0 / 1024.0).round();
    oristudio_cp_detect::rectify::remap_to_pixel_inset(&mut rectified)?;
    image::save_buffer(
        out.join("rectified.png"),
        &rectified.rgba,
        size,
        size,
        image::ColorType::Rgba8,
    )?;
    let rectify_seconds = started.elapsed().as_secs_f64();
    if rectify_only {
        std::fs::write(
            out.join("rectification.json"),
            serde_json::to_string_pretty(&json!({
                "size": size, "seconds": rectify_seconds, "report": rectified.report,
            }))?,
        )?;
        return Ok(());
    }
    let inference_started = Instant::now();
    let (heads, tiles) = if let Some(session) = &mut session {
        tiled_inference(session, &rectified.rgba, size as usize)?
    } else if pixel_direct {
        (Heads::new(), 0)
    } else {
        (source_color_heads(&rectified.rgba, size as usize), 0)
    };
    let inference_seconds = inference_started.elapsed().as_secs_f64();
    // Persist before decoding, so an external timeout still leaves inference
    // timing and the exact input. Do not read truth or select by a truth score.
    std::fs::write(
        out.join("inference.json"),
        serde_json::to_string_pretty(&json!({
            "size": size, "tiles": tiles, "provider": provider,
            "research_frame_inset_px": 32, "rectifier_original_inset_px": margin,
            "load_seconds": load_seconds, "rectify_seconds": rectify_seconds,
            "inference_seconds": inference_seconds, "rectification": rectified.report,
        }))?,
    )?;
    let mut line = line_probability_from_rgba(
        &rectified.rgba,
        size,
        size,
        SourceImageLineEvidenceOptions::default(),
    )?;
    if let Some(path) = args.get(5) {
        let bytes = std::fs::read(path)?;
        if bytes.len() != size as usize * size as usize * 4 {
            return Err("research line map must be one little-endian float32 plane".into());
        }
        line = bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        if line
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
        {
            return Err("invalid research line probability".into());
        }
    }
    let decode_started = Instant::now();
    let config = DecodeConfig {
        image_size: size,
        threshold: THRESHOLD,
        junction_offset_cluster_radius_px: JUNCTION_OFFSET_RADIUS_PX,
        recognize_only: !args.iter().any(|v| v == "solve"),
        ..DecodeConfig::default()
    };
    let decoded = if pixel_direct {
        oristudio_cp_detect::decode::decode_pixel_evidence(
            &rectified.rgba,
            &line,
            refined.as_deref().ok_or("vertices required")?,
            config,
        )?
    } else {
        let required = |name: &'static str| -> Result<&[f32], String> {
            heads
                .get(name)
                .map(Vec::as_slice)
                .ok_or_else(|| format!("missing {name}"))
        };
        let dense = DenseOutputs::from_legacy_heads(
            required("line_logits")?,
            required("junction_logits")?,
            required("assignment_logits")?,
            required("non_crease_logits")?,
            required("line_style_logits")?,
            required("boundary_contact_logits")?,
        )
        .with_angle(heads.get("angle").map(Vec::as_slice))
        .with_junction_offset(heads.get("junction_offset").map(Vec::as_slice))
        .with_vertex_type_logits(heads.get("vertex_type_logits").map(Vec::as_slice))
        .with_boundary_side_logits(heads.get("boundary_side_logits").map(Vec::as_slice))
        .with_boundary_offset(heads.get("boundary_offset").map(Vec::as_slice))
        .with_boundary_coord(heads.get("boundary_coord").map(Vec::as_slice))
        .with_line_probability_override(Some(&line));
        decode_dense_outputs_with_backend_and_refined_vertices(
            dense,
            config,
            DecoderBackend::LegacyCandidateExactSolveV1,
            refined.as_deref(),
        )?
    };
    let decode_seconds = decode_started.elapsed().as_secs_f64();
    std::fs::write(out.join("recognized.fold"), &decoded.fold_json)?;
    let record = json!({
        "size": size, "tiles": tiles, "provider": provider,
        "load_seconds": load_seconds, "rectify_seconds": rectify_seconds,
        "inference_seconds": inference_seconds, "decode_seconds": decode_seconds,
        "total_seconds": started.elapsed().as_secs_f64(), "report": decoded.report,
    });
    std::fs::write(
        out.join("result.json"),
        serde_json::to_string_pretty(&record)?,
    )?;
    println!(
        "{}",
        json!({"size": size, "inference_seconds": inference_seconds,
        "decode_seconds": decode_seconds, "total_seconds": started.elapsed().as_secs_f64()})
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
