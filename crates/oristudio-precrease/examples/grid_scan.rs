//! What grid, if any, each crease pattern is pleated on.
//!
//! ```sh
//! cargo run -p oristudio-precrease --example grid_scan -- <file.fold|.cp|.osf>... [-v]
//! ```
//!
//! One line per component: the sheet, the exactness class, how the lines
//! sort into 15° buckets by normal, and the grid [`oristudio_precrease::grid::detect`]
//! finds — kind, cells, families with their line counts and how many the
//! pattern contains. `-v` lists every family's offsets.

use std::path::PathBuf;

use oristudio_precrease::analyze;
use oristudio_precrease::closure::Target;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::grid::detect;
use oristudio_precrease::sheet::Sheet;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let verbose = args.iter().any(|a| a == "-v");
    for arg in args.iter().filter(|a| *a != "-v") {
        let file = PathBuf::from(arg);
        let cp = match load_path(&file, None) {
            Ok(cp) => cp,
            Err(e) => {
                println!("{arg}: {e}");
                continue;
            }
        };
        let paper = [-200.0, -200.0, 200.0, 200.0];
        let analysis = match analyze(&cp.segments, &cp.colors, Some(paper)) {
            Ok(a) => a,
            Err(e) => {
                println!("{arg}: {e}");
                continue;
            }
        };
        let name = file
            .parent()
            .and_then(|p| p.file_name())
            .map_or_else(|| arg.clone(), |n| n.to_string_lossy().into_owned());
        let name = if name == "precrease" || name == "default-molecules" {
            file.file_name()
                .map_or(name, |n| n.to_string_lossy().into_owned())
        } else {
            name
        };
        for c in &analysis.components {
            let Some(frame) = &c.frame else { continue };
            let sheet = Sheet::from_frame(frame);
            let ex = c.exactness.as_ref();
            let mut by_bucket: std::collections::BTreeMap<i64, usize> = Default::default();
            let mut other = 0usize;
            for ml in &c.merged_lines {
                if ml.is_border || ml.on_outline {
                    continue;
                }
                let mut theta = ml.line.normal_angle();
                if theta < 0.0 {
                    theta += std::f64::consts::PI;
                }
                if theta >= std::f64::consts::PI - 1e-6 {
                    theta -= std::f64::consts::PI;
                }
                let step = std::f64::consts::PI / 12.0;
                let b = (theta / step).round();
                if (theta - b * step).abs() > 1e-4 {
                    other += 1;
                    continue;
                }
                *by_bucket.entry((b as i64).rem_euclid(12)).or_default() += 1;
            }
            let counts: Vec<String> = by_bucket
                .iter()
                .map(|(k, v)| format!("{}°:{}", k * 15, v))
                .collect();
            let targets: Vec<Target> = c
                .merged_lines
                .iter()
                .map(|ml| {
                    let spans = ml
                        .segment_indices
                        .iter()
                        .filter_map(|&i| {
                            let k = c.segment_indices.iter().position(|&s| s == i)?;
                            c.unit_segments.get(k).map(|s| [[s[0], s[1]], [s[2], s[3]]])
                        })
                        .collect();
                    Target::new(
                        ml.line,
                        ml.segment_indices.iter().map(|&i| i + 1).collect(),
                        spans,
                        ml.mountain_length,
                        ml.valley_length,
                    )
                })
                .collect();
            let grid = detect(&sheet, &targets);
            let grid_text = match &grid {
                None => "no grid".to_string(),
                Some(g) => format!(
                    "{:?} {} [{}]",
                    g.kind,
                    g.n,
                    g.families
                        .iter()
                        .map(|f| format!(
                            "{:.0}°:{}/{} rev {}",
                            f.normal[1].atan2(f.normal[0]).to_degrees(),
                            f.in_pattern(),
                            f.lines.len(),
                            f.reversed()
                        ))
                        .collect::<Vec<_>>()
                        .join(" ")
                ),
            };
            println!(
                "{name} c{} {:.3}x{:.3} {:?} lines={} [{}] other={} → {grid_text}",
                c.id,
                sheet.width,
                sheet.height,
                ex.map(|e| e.class),
                c.merged_lines.len(),
                counts.join(" "),
                other,
            );
            if verbose && let Some(g) = &grid {
                for f in &g.families {
                    println!(
                        "  family {:.0}° spacing {:.5} phase {:.5}",
                        f.normal[1].atan2(f.normal[0]).to_degrees(),
                        f.spacing,
                        f.phase
                    );
                    for l in &f.lines {
                        println!(
                            "    k={:>3} d={:+.5} {:?} target={:?} pattern={:?}",
                            l.index, l.line.d, l.direction, l.target, l.pattern_direction
                        );
                    }
                }
            }
        }
    }
}
