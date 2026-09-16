//! Dump the junction-first candidate pool and the selection verdict for
//! curated-benchmark cases, natively: rectify, infer, extract evidence,
//! generate the candidate graph, run the product selection, and write one JSON
//! per case with every candidate vertex and span (pixel coordinates on the
//! unit paper scaled to 1024), the conflicts, and the selected / rejected ids.
//! An analysis can then ask, for a crease the recognised graph lost, whether it
//! was ever proposed and what removed it. Beside the JSON go the rectified
//! input (`<case>.rect.png`), the dense maps and the raw boundary heads as
//! PNGs, so a question about the ink can be asked of the ink.
//!
//!   cargo run --release -p oristudio-cp-detect --features native-inference \
//!     --example dump_candidate_pool -- <model.onnx> <out dir> <case dir>...
use oristudio_cp_compiler::exact_probe::ExactProbeOptions;
use oristudio_cp_compiler::selection::{SelectionOptions, select_and_finalize_candidate_graph};
use oristudio_cp_detect::candidate_generation::{
    CandidateGenerationOptions, JunctionFirstV1Strategy,
};
use oristudio_cp_detect::decode::{DecodeConfig, DenseOutputs};
use oristudio_cp_detect::evidence_extract::JunctionEvidenceSource;
use oristudio_cp_detect::native_inference::{
    self, IMAGE_SIZE, JUNCTION_OFFSET_RADIUS_PX, NativeSession, THRESHOLD,
};
use oristudio_cp_detect::rectify::auto_rectify_rgba;
use oristudio_cp_detect::source_image_evidence::{
    SourceImageLineEvidenceOptions, line_probability_from_rgba,
};
use serde_json::json;
use std::path::{Path, PathBuf};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let model = PathBuf::from(&args[0]);
    let out = PathBuf::from(&args[1]);
    std::fs::create_dir_all(&out).expect("out dir");
    let mut session =
        NativeSession::open(&model, &out.join(".coreml-cache")).unwrap_or_else(|e| panic!("{e}"));
    eprintln!("session on {}", session.provider);
    for case in &args[2..] {
        let case = Path::new(case);
        let slug = format!(
            "{}__{}",
            case.parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or(""),
            case.file_name().and_then(|n| n.to_str()).unwrap_or("")
        );
        let source = ["png", "jpg", "jpeg", "webp"]
            .iter()
            .map(|ext| case.join(format!("source.{ext}")))
            .find(|p| p.is_file())
            .expect("source image");
        let img = image::open(&source).expect("load").to_rgba8();
        let (w, h) = img.dimensions();
        let rectified = native_inference::rectify(img.as_raw(), w, h).expect("rectify");
        // The full rectification report — mode, chosen and detected quads,
        // every panel candidate the finder ranked — so a frame error can be
        // read against the truth without re-running the finder by hand.
        if let Some(text) = auto_rectify_rgba(img.as_raw(), w, h, IMAGE_SIZE)
            .ok()
            .and_then(|full| serde_json::to_string_pretty(&full.report).ok())
        {
            let _ = std::fs::write(out.join(format!("{slug}.rectify.json")), text);
        }
        let (heads, _ms) = session.infer(&rectified.rgba).expect("infer");
        let required = |name: &'static str| heads.get(name).map(Vec::as_slice).expect(name);
        let line_probability = line_probability_from_rgba(
            &rectified.rgba,
            IMAGE_SIZE,
            IMAGE_SIZE,
            SourceImageLineEvidenceOptions::default(),
        )
        .expect("line evidence");
        let dense = DenseOutputs::from_legacy_heads(
            required("line_logits"),
            required("junction_logits"),
            required("assignment_logits"),
            required("non_crease_logits"),
            required("line_style_logits"),
            required("boundary_contact_logits"),
        )
        .with_angle(heads.get("angle").map(Vec::as_slice))
        .with_junction_offset(heads.get("junction_offset").map(Vec::as_slice))
        .with_vertex_type_logits(heads.get("vertex_type_logits").map(Vec::as_slice))
        .with_boundary_side_logits(heads.get("boundary_side_logits").map(Vec::as_slice))
        .with_boundary_offset(heads.get("boundary_offset").map(Vec::as_slice))
        .with_boundary_coord(heads.get("boundary_coord").map(Vec::as_slice))
        .with_line_probability_override(Some(&line_probability));
        // Sweep hooks: `JUNCTION_PEAK_THRESHOLD` (the product floor is 0.40)
        // and `VERTEX_MERGE_RADIUS_PX` (the product radius is 3.0).
        let junction_peak_threshold = std::env::var("JUNCTION_PEAK_THRESHOLD")
            .ok()
            .and_then(|v| v.parse::<f32>().ok());
        let merge_radius = std::env::var("VERTEX_MERGE_RADIUS_PX")
            .ok()
            .and_then(|v| v.parse::<f64>().ok());
        let config = DecodeConfig {
            image_size: IMAGE_SIZE,
            threshold: THRESHOLD,
            junction_offset_cluster_radius_px: JUNCTION_OFFSET_RADIUS_PX,
            junction_peak_threshold,
            ..DecodeConfig::default()
        };
        // The fused backend's generation options (decode.rs
        // `default_candidate_generation_options`, junction source = model).
        let mut generation_options = CandidateGenerationOptions::default();
        generation_options
            .junction_first_v1
            .junction_offset_cluster_radius_px =
            f64::from(config.junction_offset_cluster_radius_px);
        generation_options
            .junction_first_v1
            .junction_cluster_keep_rule = config.junction_cluster_keep_rule;
        generation_options
            .junction_first_v1
            .junction_evidence_source = JunctionEvidenceSource::Model;
        if let Some(radius) = merge_radius {
            generation_options.junction_first_v1.vertex_merge_radius_px = radius;
        }
        // `JUNCTION_BORDER_PX`: no interior vertex from a junction peak this
        // close to the paper edge.
        if let Some(radius) = std::env::var("JUNCTION_BORDER_PX")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
        {
            generation_options
                .junction_first_v1
                .junction_border_exclusion_px = radius;
        }
        // `WEAK_MERGE_PX`: the merge radius for junction peaks under 0.40.
        if let Some(radius) = std::env::var("WEAK_MERGE_PX")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
        {
            generation_options
                .junction_first_v1
                .weak_junction_merge_radius_px = radius;
        }
        // Boundary-contact sweep hooks: `CONTACT_THRESHOLD` (product 0.50),
        // `CONTACT_RELOCALIZE=0` to switch the ink re-localisation off, and
        // `CONTACT_MERGE_PX` (product 2.5).
        if let Some(threshold) = std::env::var("CONTACT_THRESHOLD")
            .ok()
            .and_then(|v| v.parse::<f32>().ok())
        {
            generation_options
                .junction_first_v1
                .boundary_contact_threshold = Some(threshold);
        }
        if std::env::var("CONTACT_RELOCALIZE").ok().as_deref() == Some("0") {
            generation_options.junction_first_v1.contact_relocalize = false;
        }
        if let Some(merge) = std::env::var("CONTACT_MERGE_PX")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
        {
            generation_options.junction_first_v1.contact_merge_px = merge;
        }
        // `GRID_PRIOR=0`: no box-pleat grid completion of the border.
        if std::env::var("GRID_PRIOR").ok().as_deref() == Some("0") {
            generation_options.junction_first_v1.grid_prior = false;
        }
        let strategy = JunctionFirstV1Strategy::new(generation_options.junction_first_v1);
        let evidence = strategy.extract_evidence(dense, &config).expect("evidence");
        let generation = strategy.generate_from_evidence(&evidence, &config);
        let mut graph = generation.candidate_graph;
        let started = std::time::Instant::now();
        let selection = select_and_finalize_candidate_graph(
            &mut graph,
            SelectionOptions::default(),
            ExactProbeOptions::default(),
        );
        let px = |v: f64| v * 1024.0;
        // The rectified input itself, so an analysis can read the ink the line
        // evidence was computed from.
        if let Some(img) =
            image::RgbaImage::from_raw(IMAGE_SIZE, IMAGE_SIZE, rectified.rgba.clone())
        {
            let _ = image::DynamicImage::ImageRgba8(img)
                .to_luma8()
                .save(out.join(format!("{slug}.rect.png")));
        }
        // The dense maps as 8-bit PNGs, and every local maximum of the junction
        // and boundary-contact maps down to 0.10, so an analysis can tell a head
        // that never fired from one that fired under the threshold.
        let size = IMAGE_SIZE as usize;
        for (name, map) in [
            ("line", &evidence.dense.line_probability),
            ("junction", &evidence.dense.junction_probability),
            ("contact", &evidence.dense.boundary_contact_probability),
        ] {
            let bytes: Vec<u8> = map
                .iter()
                .map(|v| (v.clamp(0.0, 1.0) * 255.0) as u8)
                .collect();
            if let Some(img) = image::GrayImage::from_raw(IMAGE_SIZE, IMAGE_SIZE, bytes) {
                let _ = img.save(out.join(format!("{slug}.{name}.png")));
            }
        }
        // The boundary heads the decode does not read yet: `boundary_coord`
        // (a per-pixel side coordinate in 0..1) as a 16-bit PNG, and the
        // clamped `boundary_offset` (±0.5) as two 8-bit PNGs.
        if let Some(coord) = heads.get("boundary_coord") {
            let words: Vec<u16> = coord
                .iter()
                .map(|v| (v.clamp(0.0, 1.0) * 65535.0) as u16)
                .collect();
            if let Some(img) = image::ImageBuffer::<image::Luma<u16>, Vec<u16>>::from_raw(
                IMAGE_SIZE, IMAGE_SIZE, words,
            ) {
                let _ = img.save(out.join(format!("{slug}.coord.png")));
            }
        }
        if let Some(offset) = heads.get("boundary_offset")
            && offset.len() >= 2 * size * size
        {
            for (name, plane) in [
                ("offx", &offset[..size * size]),
                ("offy", &offset[size * size..2 * size * size]),
            ] {
                let bytes: Vec<u8> = plane
                    .iter()
                    .map(|v| ((v.clamp(-0.5, 0.5) + 0.5) * 255.0) as u8)
                    .collect();
                if let Some(img) = image::GrayImage::from_raw(IMAGE_SIZE, IMAGE_SIZE, bytes) {
                    let _ = img.save(out.join(format!("{slug}.{name}.png")));
                }
            }
        }
        if let Some(side) = heads.get("boundary_side_logits")
            && side.len() >= 4 * size * size
        {
            let n = size * size;
            let bytes: Vec<u8> = (0..n)
                .map(|i| {
                    let mut best = 0u8;
                    for c in 1..4 {
                        if side[c * n + i] > side[best as usize * n + i] {
                            best = c as u8;
                        }
                    }
                    best * 60
                })
                .collect();
            if let Some(img) = image::GrayImage::from_raw(IMAGE_SIZE, IMAGE_SIZE, bytes) {
                let _ = img.save(out.join(format!("{slug}.side.png")));
            }
        }
        let low_maxima = |map: &[f32]| -> Vec<(f32, f32, f32)> {
            let mut peaks = Vec::new();
            for y in 1..size - 1 {
                for x in 1..size - 1 {
                    let v = map[y * size + x];
                    if v < 0.10 {
                        continue;
                    }
                    let mut peak = true;
                    'n: for dy in -2i32..=2 {
                        for dx in -2i32..=2 {
                            if dx == 0 && dy == 0 {
                                continue;
                            }
                            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                            if nx < 0 || ny < 0 || nx >= size as i32 || ny >= size as i32 {
                                continue;
                            }
                            if map[ny as usize * size + nx as usize] > v {
                                peak = false;
                                break 'n;
                            }
                        }
                    }
                    if peak {
                        peaks.push((x as f32, y as f32, v));
                    }
                }
            }
            peaks
        };
        let record = json!({
            "slug": slug,
            "junction_primitives": evidence.junction_primitives.iter().map(|j| json!({"x": j.point[0], "y": j.point[1], "support": j.support})).collect::<Vec<_>>(),
            "contact_primitives": evidence.boundary_contact_primitives.iter().map(|c| json!({"x": c.point[0], "y": c.point[1], "side": format!("{:?}", c.side), "coord": c.side_coordinate, "support": c.support})).collect::<Vec<_>>(),
            "junction_low_maxima": low_maxima(&evidence.dense.junction_probability),
            "contact_low_maxima": low_maxima(&evidence.dense.boundary_contact_probability),
            "selection_seconds": started.elapsed().as_secs_f64(),
            "notes": graph.provenance.notes,
            "vertices": graph.vertices.iter().map(|v| json!({
                "id": v.id, "x": px(v.point.x), "y": px(v.point.y),
                "kind": format!("{:?}", v.kind), "support": v.support,
                "boundary_side": v.boundary_side.map(|s| format!("{s:?}")),
            })).collect::<Vec<_>>(),
            "spans": graph.crease_candidates.iter().map(|s| json!({
                "id": s.id, "vertices": s.vertices, "kind": format!("{:?}", s.kind),
                "presence": s.presence_probability, "line_min": s.line_support_min,
                "line_mean": s.line_support_mean, "non_crease": s.non_crease_support,
                "policy": format!("{:?}", s.selection_policy),
                "source_kind": format!("{:?}", s.source_kind),
                "boundary_role": format!("{:?}", s.boundary_role),
                "reasons": s.reasons,
            })).collect::<Vec<_>>(),
            "conflicts": graph.conflicts.iter().map(|c| json!({
                "kind": format!("{:?}", c.kind), "ids": c.candidate_ids, "hard": c.hard, "reason": c.reason,
            })).collect::<Vec<_>>(),
            "selected": selection.selected_edge_ids,
            "rejected": selection.rejected_edge_ids,
            "structural_edits": serde_json::to_value(&selection.structural_edits).unwrap_or_default(),
            "evidence_report": serde_json::to_value(&evidence.report).unwrap_or_default(),
        });
        std::fs::write(
            out.join(format!("{slug}.pool.json")),
            serde_json::to_string(&record).expect("json"),
        )
        .expect("write");
        eprintln!(
            "{slug}: {} vertices, {} spans, {} conflicts, selected {}, {:.1}s",
            graph.vertices.len(),
            graph.crease_candidates.len(),
            graph.conflicts.len(),
            selection.selected_edge_ids.len(),
            started.elapsed().as_secs_f64()
        );
    }
}
