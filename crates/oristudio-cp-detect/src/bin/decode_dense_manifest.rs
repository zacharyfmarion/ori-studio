use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use oristudio_cp_detect::decode::{
    DecodeConfig, DecoderBackend, DenseOutputs, decode_dense_outputs_with_backend,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct DenseManifest {
    config: DenseConfig,
    fixtures: Vec<DenseFixture>,
}

#[derive(Debug, Deserialize)]
struct DenseConfig {
    image_size: u32,
    threshold: f32,
}

#[derive(Debug, Deserialize)]
struct DenseFixture {
    id: String,
    #[serde(default)]
    profile: Option<String>,
    line_logits_f32_path: String,
    junction_logits_f32_path: String,
    assignment_logits_f32_path: String,
    non_crease_logits_f32_path: String,
    line_style_logits_f32_path: String,
    boundary_contact_logits_f32_path: String,
}

#[derive(Debug, Serialize)]
struct DecodeManifestOutput {
    schema: &'static str,
    manifest: String,
    decoder_backend: DecoderBackend,
    fixture_count: usize,
    fixtures: Vec<DecodedFixture>,
}

#[derive(Debug, Serialize)]
struct DecodedFixture {
    id: String,
    profile: Option<String>,
    fold: Value,
    report: Value,
}

#[derive(Debug)]
struct Args {
    manifest: PathBuf,
    decoder_backend: DecoderBackend,
    limit: Option<usize>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse()?;
    let manifest_root = args.manifest.parent().unwrap_or_else(|| Path::new("."));
    let manifest: DenseManifest = serde_json::from_str(&fs::read_to_string(&args.manifest)?)?;
    let mut fixtures = Vec::new();

    for fixture in manifest
        .fixtures
        .iter()
        .take(args.limit.unwrap_or(usize::MAX))
    {
        let line_logits =
            read_f32_file(&resolve_path(manifest_root, &fixture.line_logits_f32_path))?;
        let junction_logits = read_f32_file(&resolve_path(
            manifest_root,
            &fixture.junction_logits_f32_path,
        ))?;
        let assignment_logits = read_f32_file(&resolve_path(
            manifest_root,
            &fixture.assignment_logits_f32_path,
        ))?;
        let non_crease_logits = read_f32_file(&resolve_path(
            manifest_root,
            &fixture.non_crease_logits_f32_path,
        ))?;
        let line_style_logits = read_f32_file(&resolve_path(
            manifest_root,
            &fixture.line_style_logits_f32_path,
        ))?;
        let boundary_contact_logits = read_f32_file(&resolve_path(
            manifest_root,
            &fixture.boundary_contact_logits_f32_path,
        ))?;
        let decoded = decode_dense_outputs_with_backend(
            DenseOutputs {
                line_logits: &line_logits,
                junction_logits: &junction_logits,
                assignment_logits: &assignment_logits,
                non_crease_logits: &non_crease_logits,
                line_style_logits: &line_style_logits,
                boundary_contact_logits: &boundary_contact_logits,
            },
            DecodeConfig {
                image_size: manifest.config.image_size,
                threshold: manifest.config.threshold,
                ..DecodeConfig::default()
            },
            args.decoder_backend,
        )?;
        fixtures.push(DecodedFixture {
            id: fixture.id.clone(),
            profile: fixture.profile.clone(),
            fold: serde_json::from_str(&decoded.fold_json)?,
            report: serde_json::to_value(decoded.report)?,
        });
    }

    let output = DecodeManifestOutput {
        schema: "oristudio/cp-detect-native-dense-decode/v1",
        manifest: args.manifest.display().to_string(),
        decoder_backend: args.decoder_backend,
        fixture_count: fixtures.len(),
        fixtures,
    };
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}

impl Args {
    fn parse() -> Result<Self, Box<dyn std::error::Error>> {
        let mut manifest = None;
        let mut decoder_backend = DecoderBackend::LegacyV2;
        let mut limit = None;
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--manifest" => {
                    manifest = Some(PathBuf::from(required_value(&mut iter, "--manifest")?))
                }
                "--decoder-backend" => {
                    decoder_backend =
                        parse_decoder_backend(&required_value(&mut iter, "--decoder-backend")?)?;
                }
                "--limit" => {
                    limit = Some(required_value(&mut iter, "--limit")?.parse()?);
                }
                "--help" | "-h" => {
                    print_usage();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}").into()),
            }
        }
        Ok(Self {
            manifest: manifest.ok_or("--manifest is required")?,
            decoder_backend,
            limit,
        })
    }
}

fn read_f32_file(path: &Path) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    if bytes.len() % 4 != 0 {
        return Err(format!("{} length is not divisible by 4", path.display()).into());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn resolve_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn parse_decoder_backend(value: &str) -> Result<DecoderBackend, Box<dyn std::error::Error>> {
    match value {
        "legacy-v2" | "legacy_v2" | "legacy_v2_decoder" => Ok(DecoderBackend::LegacyV2),
        "constraint-compiler-v1" | "constraint_compiler_v1" => {
            Ok(DecoderBackend::ConstraintCompilerV1)
        }
        "constraint-compiler-v2" | "constraint_compiler_v2" => {
            Ok(DecoderBackend::ConstraintCompilerV2)
        }
        other => Err(format!("unsupported decoder backend: {other}").into()),
    }
}

fn required_value(
    iter: &mut impl Iterator<Item = String>,
    name: &'static str,
) -> Result<String, Box<dyn std::error::Error>> {
    iter.next()
        .ok_or_else(|| format!("{name} requires a value").into())
}

fn print_usage() {
    println!(
        "decode_dense_manifest --manifest PATH [--decoder-backend legacy-v2|constraint-compiler-v1|constraint-compiler-v2] [--limit N]"
    );
}
