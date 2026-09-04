//! Where does rectification put the paper, on a real crease pattern?
//!
//! The decoder assumes one answer — `unit_from_px` divides by
//! `image_size - 64`, so the paper is at `[32, 992]` of 1024 — and the training
//! renders use the same box. This checks that rectification agrees, on both the
//! shape it agreed on before (a CP with room around it) and the shape it did
//! not (a CP cropped to its own paper edge, which is what a clean source gives).
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-detect \
//!     --example where_does_the_paper_land -- <input.png>

use image::GenericImageView;
use oristudio_cp_detect::rectify::auto_rectify_rgba;

const SIZE: u32 = 1024;

fn main() {
    let path = std::env::args().nth(1).expect("usage: <input.png>");
    let source = image::open(&path).expect("open").to_rgba8();
    let (w, h) = source.dimensions();
    println!(
        "source {w}x{h}  ({})",
        path.rsplit('/').next().unwrap_or("")
    );

    // As rendered: the paper sits at [32, 992] with a white margin.
    report("as rendered", source.as_raw(), w, h);

    // Cropped to its own paper edge — an already-cropped CP, which is what a
    // screenshot or a tidy export looks like and what takes the resize path.
    let cropped = image::DynamicImage::ImageRgba8(source.clone())
        .view(32, 32, 961, 961)
        .to_image();
    report("cropped to the paper", cropped.as_raw(), 961, 961);
}

fn report(label: &str, rgba: &[u8], w: u32, h: u32) {
    let out = match auto_rectify_rgba(rgba, w, h, SIZE) {
        Ok(out) => out,
        Err(error) => {
            println!("  {label:22} rectify failed: {error:?}");
            return;
        }
    };
    let ink = ink_bounds(&out.rgba, SIZE);
    let target = out.report.target_quad.map(|q| {
        (
            q.top_left.x,
            q.top_left.y,
            q.bottom_right.x,
            q.bottom_right.y,
        )
    });
    println!(
        "  {label:22} mode {:22} target_quad {:?}",
        out.report.mode, target
    );
    match ink {
        Some((min_x, min_y, max_x, max_y)) => {
            let span = ((max_x - min_x) + (max_y - min_y)) as f64 / 2.0;
            println!(
                "  {:22} ink box [{min_x}, {max_x}] x [{min_y}, {max_y}]   span {span:.1}   decoder wants [32, 992] span 960",
                ""
            );
        }
        None => println!("  {:22} no ink found", ""),
    }
}

/// The bounding box of everything that is not background, which for a crease
/// pattern is the paper edge — the thing that has to land on the decoder's box.
fn ink_bounds(rgba: &[u8], size: u32) -> Option<(u32, u32, u32, u32)> {
    let luma = |idx: usize| {
        0.299 * rgba[idx] as f32 + 0.587 * rgba[idx + 1] as f32 + 0.114 * rgba[idx + 2] as f32
    };
    let mut background: Vec<f32> = (0..(size * size) as usize)
        .step_by(97)
        .map(|i| luma(i * 4))
        .collect();
    background.sort_by(f32::total_cmp);
    let median = *background.get(background.len() / 2)?;

    let (mut min_x, mut min_y, mut max_x, mut max_y) = (size, size, 0_u32, 0_u32);
    let mut found = false;
    for y in 0..size {
        for x in 0..size {
            if (luma(((y * size + x) * 4) as usize) - median).abs() < 40.0 {
                continue;
            }
            found = true;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    found.then_some((min_x, min_y, max_x, max_y))
}
