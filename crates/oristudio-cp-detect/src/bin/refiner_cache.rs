//! Vertex-refiner cache builder (the Torch-side bookend of the shared geometry).
//!
//! Mirrors how the dense cache is produced, but split around the refiner forward
//! pass which runs in PyTorch (`scripts/cp-detect/infer-native-cp-refined-vertices.py`):
//!
//!   refiner_cache plan  --manifest <dense-manifest> --out <crops-dir>
//!     -> per sample: [N,11,96,96] crop tensor (`<id>.crops.f32`) + `crops_index.json`
//!        (built with `oristudio_cp_detect::refinement::plan_vertex_refiner`)
//!   <python sidecar runs the refiner over the crop tensors -> `<id>.<head>.f32`>
//!   refiner_cache merge --crops <crops-dir> --outputs <out-dir> --out <cache.json>
//!     -> per sample: decode+merge (`decode_merge_vertex_refiner`) -> refined vertex
//!        pixels, written as `{ sample_id: [[x,y],...] }` for the benchmark's
//!        `--refined-vertices`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use oristudio_cp_detect::decode::{
    RefinedVertexCacheEntry, RefinedVertexPrimitive, RefinedVertexRegion,
};
use oristudio_cp_detect::refinement::{
    Frame, ProposalMode, RefinerOutputs, Tensor, VertexRefinerParams, decode_merge_vertex_refiner,
    plan_vertex_refiner,
};
use serde::{Deserialize, Serialize};

const VERTEX_KIND_NAMES: [&str; 5] = [
    "background",
    "interior_junction",
    "boundary_contact",
    "corner",
    "endpoint_or_dangling",
];

const REFINER_CROP_SIZE: f64 = 96.0;
const HEAD_NAMES: [&str; 7] = [
    "vertex_heatmap",
    "vertex_offset",
    "vertex_kind",
    "degree",
    "incident_rays",
    "boundary_contact_heatmap",
    "boundary_side",
];

type DynError = Box<dyn std::error::Error>;

#[derive(Deserialize)]
struct DenseManifest {
    pack: Option<String>,
    samples: Vec<DenseSample>,
}

#[derive(Deserialize)]
struct DenseSample {
    id: String,
    image_size: u32,
    #[serde(default)]
    input_png: Option<String>,
    junction_logits_f32_path: String,
}

#[derive(Serialize, Deserialize)]
struct CropMeta {
    crop_count: usize,
    crop_size: f64,
    image_size: u32,
    /// `[x_min, y_min, x_max, y_max]` paper frame in pixels.
    frame: [f64; 4],
    /// `[x, y, score]` per proposal (provenance is irrelevant to the merge).
    proposals: Vec<[f64; 3]>,
    /// `[x_min, y_min, x_max, y_max]` refinement region per proposal (pixels).
    #[serde(default)]
    regions: Vec<[f64; 4]>,
}

#[derive(Serialize, Deserialize)]
struct CropsIndex {
    crop_size: f64,
    samples: BTreeMap<String, CropMeta>,
}

/// Per-head tensor descriptor written by the Python sidecar.
#[derive(Deserialize)]
struct HeadFile {
    dims: Vec<usize>,
    file: String,
}

fn main() -> Result<(), DynError> {
    let mut args = std::env::args().skip(1);
    let command = args.next().ok_or("usage: refiner_cache <plan|merge> ...")?;
    let rest: Vec<String> = args.collect();
    match command.as_str() {
        "plan" => run_plan(&rest),
        "merge" => run_merge(&rest),
        other => Err(format!("unknown subcommand {other:?}; expected plan|merge").into()),
    }
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
}

fn required<'a>(args: &'a [String], name: &str) -> Result<&'a str, DynError> {
    flag(args, name).ok_or_else(|| format!("{name} is required").into())
}

fn run_plan(args: &[String]) -> Result<(), DynError> {
    let manifest_path = PathBuf::from(required(args, "--manifest")?);
    let out_dir = PathBuf::from(required(args, "--out")?);
    let limit = flag(args, "--limit").and_then(|v| v.parse::<usize>().ok());
    fs::create_dir_all(&out_dir)?;

    let manifest: DenseManifest = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let manifest_root = manifest_path.parent().unwrap_or(Path::new("."));
    let pack_root = manifest.pack.as_deref().map(|p| {
        Path::new(p)
            .parent()
            .unwrap_or(Path::new("."))
            .to_path_buf()
    });

    let mut index = CropsIndex {
        crop_size: REFINER_CROP_SIZE,
        samples: BTreeMap::new(),
    };
    let samples = match limit {
        Some(n) => &manifest.samples[..n.min(manifest.samples.len())],
        None => &manifest.samples[..],
    };
    for sample in samples {
        let image_size = sample.image_size;
        let frame = square_frame(image_size);
        let junction = read_f32(&resolve(manifest_root, &sample.junction_logits_f32_path))?;
        let expected = (image_size as usize) * (image_size as usize);
        if junction.len() != expected {
            return Err(format!(
                "sample {} junction logits len {} != image_size^2 {}",
                sample.id,
                junction.len(),
                expected
            )
            .into());
        }
        let junction = Tensor {
            data: junction,
            dims: vec![1, 1, image_size as usize, image_size as usize],
        };
        let input_png = sample
            .input_png
            .as_deref()
            .ok_or_else(|| format!("sample {} has no input_png", sample.id))?;
        let pack_root = pack_root
            .as_deref()
            .ok_or("dense manifest has no pack; cannot resolve input_png")?;
        let image = image::ImageReader::open(resolve(pack_root, input_png))?
            .decode()?
            .into_rgba8();
        let (width, height) = (image.width() as usize, image.height() as usize);

        let params = plan_params(frame);
        let plan = plan_vertex_refiner(image.as_raw(), width, height, Some(&junction), &params);

        write_f32(
            &out_dir.join(format!("{}.crops.f32", sample.id)),
            &plan.crop_tensor,
        )?;
        index.samples.insert(
            sample.id.clone(),
            CropMeta {
                crop_count: plan.proposals.len(),
                crop_size: REFINER_CROP_SIZE,
                image_size,
                frame: [frame.x_min, frame.y_min, frame.x_max, frame.y_max],
                proposals: plan.proposals.iter().map(|p| [p.x, p.y, p.score]).collect(),
                regions: plan
                    .refinement_regions
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .map(|r| [r.x_min, r.y_min, r.x_max, r.y_max])
                    .collect(),
            },
        );
        println!("planned {} -> {} crops", sample.id, plan.proposals.len());
    }
    fs::write(
        out_dir.join("crops_index.json"),
        serde_json::to_string_pretty(&index)?,
    )?;
    Ok(())
}

fn run_merge(args: &[String]) -> Result<(), DynError> {
    let crops_dir = PathBuf::from(required(args, "--crops")?);
    let outputs_dir = PathBuf::from(required(args, "--outputs")?);
    let out_path = PathBuf::from(required(args, "--out")?);

    let index: CropsIndex =
        serde_json::from_str(&fs::read_to_string(crops_dir.join("crops_index.json"))?)?;
    let mut cache: BTreeMap<String, RefinedVertexCacheEntry> = BTreeMap::new();
    for (id, meta) in &index.samples {
        let regions: Vec<RefinedVertexRegion> = meta
            .regions
            .iter()
            .map(|r| RefinedVertexRegion {
                x_min: r[0],
                y_min: r[1],
                x_max: r[2],
                y_max: r[3],
            })
            .collect();
        if meta.crop_count == 0 {
            // No crops -> no refined vertices and no regions: dense-head junctions
            // are kept everywhere (== baseline) by the in-regions override.
            cache.insert(id.clone(), RefinedVertexCacheEntry::default());
            continue;
        }
        let frame = Frame {
            x_min: meta.frame[0],
            y_min: meta.frame[1],
            x_max: meta.frame[2],
            y_max: meta.frame[3],
        };
        let proposals = meta
            .proposals
            .iter()
            .map(|p| oristudio_cp_detect::refinement::Proposal {
                x: p[0],
                y: p[1],
                score: p[2],
                provenance: Vec::new(),
            })
            .collect::<Vec<_>>();
        let outputs = read_refiner_outputs(&outputs_dir, id)?;
        let params = plan_params(frame);
        let merged = decode_merge_vertex_refiner(&outputs, &proposals, &params);
        let vertices = merged
            .iter()
            .map(|v| RefinedVertexPrimitive {
                x: v.x,
                y: v.y,
                score: Some(v.score),
                kind: VERTEX_KIND_NAMES.get(v.kind_id).map(|k| k.to_string()),
                boundary_side: v.boundary_side.map(|s| s.name().to_string()),
                side_coordinate: v.side_coordinate,
            })
            .collect::<Vec<_>>();
        println!("merged {} -> {} refined vertices", id, vertices.len());
        cache.insert(id.clone(), RefinedVertexCacheEntry { vertices, regions });
    }
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(out_path, serde_json::to_string(&cache)?)?;
    Ok(())
}

/// Product geometry params (dense-junction-regions). Manifest-supplied thresholds
/// use the defaults; wire them from the refiner manifest when one is available.
fn plan_params(frame: Frame) -> VertexRefinerParams {
    VertexRefinerParams {
        crop_size: REFINER_CROP_SIZE,
        frame: Some(frame),
        proposal_mode: ProposalMode::DenseJunctionRegions,
        // From the cp-vertex-refiner-v3 manifest (current-vertex-refiner.json).
        heatmap_threshold: 0.25,
        boundary_heatmap_threshold: 0.25,
        ..Default::default()
    }
}

/// Matches `rendered_square_frame_px` in the benchmark (32px paper inset).
fn square_frame(image_size: u32) -> Frame {
    let raw_max = image_size.saturating_sub(1) as f64;
    let inset = if image_size as f64 > 64.0 {
        32.0
    } else {
        raw_max * 0.25
    };
    let frame_max = (image_size as f64 - inset).clamp(inset, raw_max);
    Frame {
        x_min: inset,
        y_min: inset,
        x_max: frame_max,
        y_max: frame_max,
    }
}

fn read_refiner_outputs(outputs_dir: &Path, id: &str) -> Result<RefinerOutputs, DynError> {
    let descriptor: BTreeMap<String, HeadFile> = serde_json::from_str(&fs::read_to_string(
        outputs_dir.join(format!("{id}.outputs.json")),
    )?)?;
    let mut heads: BTreeMap<&str, Tensor> = BTreeMap::new();
    for name in HEAD_NAMES {
        let head = descriptor
            .get(name)
            .ok_or_else(|| format!("sample {id} outputs missing head {name}"))?;
        let data = read_f32(&outputs_dir.join(&head.file))?;
        heads.insert(
            name,
            Tensor {
                data,
                dims: head.dims.clone(),
            },
        );
    }
    let mut take = |name: &str| heads.remove(name).expect("head present");
    Ok(RefinerOutputs {
        vertex_heatmap: take("vertex_heatmap"),
        vertex_offset: take("vertex_offset"),
        vertex_kind: take("vertex_kind"),
        degree: take("degree"),
        incident_rays: take("incident_rays"),
        boundary_contact_heatmap: take("boundary_contact_heatmap"),
        boundary_side: take("boundary_side"),
    })
}

fn resolve(root: &Path, path: &str) -> PathBuf {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    }
}

fn read_f32(path: &Path) -> Result<Vec<f32>, DynError> {
    let bytes = fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

fn write_f32(path: &Path, data: &[f32]) -> Result<(), DynError> {
    let mut bytes = Vec::with_capacity(data.len() * 4);
    for &value in data {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    fs::write(path, bytes)?;
    Ok(())
}
