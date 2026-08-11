//! Dump the Rust layout-graphics snapshot for a `.bps` / JDesign file.
//!
//! The Rust counterpart of `tools/bp-studio-oracle/layout-graphics.ts`, so the
//! two can be diffed directly:
//!
//! ```sh
//! cargo run -p oristudio-bp --example layout_graphics_dump -- design.bps
//! bun tools/bp-studio-oracle/layout-graphics.ts design.json
//! ```

use std::fs;

fn main() {
    let path = std::env::args().nth(1).expect("usage: <design.bps>");
    let text = fs::read_to_string(&path).expect("read design");
    let project = oristudio_bp::io::bps::load_project_str(&text).expect("load project");
    let snapshot =
        oristudio_bp::io::cp::project_graphics_snapshot(&project).expect("graphics snapshot");
    println!("{}", serde_json::to_string_pretty(&snapshot).expect("json"));
}
