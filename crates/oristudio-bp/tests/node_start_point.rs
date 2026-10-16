//! Upstream `test/specs/contour.spec.ts`, "River contour shares the boundary
//! with its sibling river" — added in v0.7.16 by `a6c559b5`, which this ports.
//!
//! The junctions a flap forms with flaps *inside* the node being traced do not
//! show on that node's contour. Their regions fill the hinge from the tracing
//! start instead, and the pattern emerges where the filling ends
//! (`Quadrant::start_point_for`). BP Studio v0.7.15, and this port before it,
//! drew both rivers below as plain rectangles with no pattern contour at all.
//!
//! The `re90,94` paths are upstream's own expectations. The `re94,97` paths
//! were captured from the v0.7.17 Core:
//!
//! ```sh
//! bun tools/bp-studio-oracle/layout-graphics.ts <design.json>
//! ```

mod support;

use support::{assert_ring, parse_tree};

/// Derived from a Japanese spiny lobster design.
const EDGES: &str =
    "(90,76,3),(90,94,2),(76,5,1),(94,97,2),(5,31,12),(97,102,23),(97,101,1),(97,100,1)";
const FLAPS: &str = "(31,72,64,0,0),(100,76,87,0,0),(101,76,85,0,0),(102,98,100,0,0)";

/// The same design without flap 101.
const EDGES_WITHOUT_101: &str =
    "(90,76,3),(90,94,2),(76,5,1),(94,97,2),(5,31,12),(97,102,23),(97,100,1)";
const FLAPS_WITHOUT_101: &str = "(31,72,64,0,0),(100,76,87,0,0),(102,98,100,0,0)";

#[test]
fn river_contour_emerges_where_the_inside_flaps_stop_filling_the_hinge() {
    let graphics = support::graphics(&parse_tree(EDGES, FLAPS));

    let outer = support::single_outer(&graphics, "re90,94");
    assert_ring(
        &outer,
        "(71,127),(71,80),(238/3,80),(88,147/2),(88,73),(125,73),(125,127)",
    );
    assert_ring(
        &support::single_outer(&graphics, "re94,97"),
        "(73,125),(73,82),(80,82),(268/3,75),(123,75),(123,125)",
    );
}

#[test]
fn a_smaller_filled_region_shifts_every_diagonal_by_its_size() {
    // Without flap 101, flap 100 alone fills a 2x2 region only, so all the
    // diagonals shift by 2. This is also the case that emits a diagonal ridge
    // from the inner corner of the filled region rather than terminating an
    // outgoing one, and that needs an outgoing ridge to count as a ray.
    let graphics = support::graphics(&parse_tree(EDGES_WITHOUT_101, FLAPS_WITHOUT_101));

    assert_ring(
        &support::single_outer(&graphics, "re90,94"),
        "(71,127),(71,82),(73,82),(73,80),(238/3,80),(88,147/2),(88,73),(125,73),(125,127)",
    );
    assert_ring(
        &support::single_outer(&graphics, "re94,97"),
        "(73,125),(73,84),(75,84),(75,82),(80,82),(268/3,75),(123,75),(123,125)",
    );
}
