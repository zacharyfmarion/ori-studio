//! Raw-mode trace contours must be the ones BP Studio builds.
//!
//! A trace contour is the hinge path pattern contours are traced along. When a
//! node's rough contour hides a critical corner, upstream splits it into "raw"
//! components (`traceContour.ts#createRawContour`). Getting a component wrong
//! used to be invisible: no pattern contour landed on it, so the drawn graphics
//! still agreed with upstream. Since v0.7.16 (`a6c559b5`) the start of tracing
//! moves past the regions of the flaps inside the node, and pattern contours
//! now land on exactly these hinges — so each divergence below became a wrong
//! river once that commit was ported.
//!
//! Both designs perturb the spiny-lobster case of `node_start_point.rs`.
//! Trace contours were captured from the v0.7.17 Core with
//!
//! ```sh
//! bun tools/bp-studio-oracle/trace-contours.ts <design.json>
//! ```
//!
//! and graphics with `tools/bp-studio-oracle/layout-graphics.ts`.

mod support;

use oristudio_bp::layout::contours::TraceContour;
use support::{assert_ring, parse_tree};

/// Leaves and outer path of each raw component, in upstream's order.
type Components<'a> = &'a [(&'a [u32], &'a str)];

#[test]
fn raw_components_group_by_the_node_sets_of_the_missing_corners_only() {
    // Upstream's `checkCriticalCorners` deletes every corner it finds from the
    // map the node sets are then read from, so only the corners the contour
    // misses decide the grouping. Taking every corner's node set instead
    // counted the stretch 31,100,102 twice here, marked 100 and 102 as shared
    // between "two" node sets, and gave each its own component.
    let traces = support::trace_contours(&parse_tree(
        "(90,76,3),(90,94,2),(76,5,1),(94,97,3),(5,31,12),(97,102,23),(97,101,1),(97,100,1)",
        "(31,73,66,0,0),(100,77,87,0,0),(101,74,84,0,0),(102,100,101,0,0)",
    ));

    assert_raw(
        &traces[&94],
        &[
            (
                &[100, 102],
                "(72,129),(72,93),(71,93),(71,81),(72,81),(72,73),(128,73),(128,129)",
            ),
            (&[101], "(68,90),(68,78),(80,78),(80,90)"),
        ],
    );
    assert_raw(
        &traces[&97],
        &[
            (
                &[100, 102],
                "(74,127),(74,91),(73,91),(73,83),(74,83),(74,75),(126,75),(126,127)",
            ),
            (&[101], "(70,88),(70,80),(78,80),(78,88)"),
        ],
    );
}

#[test]
fn rivers_traced_along_the_grouped_component_match_bp_studio() {
    // The graphics the grouping above decides: with 100 and 102 split apart,
    // node 97 drew a pattern contour upstream does not have and node 94 drew
    // its diagonal one unit off.
    let graphics = support::graphics(&parse_tree(
        "(90,76,3),(90,94,2),(76,5,1),(94,97,3),(5,31,12),(97,102,23),(97,101,1),(97,100,1)",
        "(31,73,66,0,0),(100,77,87,0,0),(101,74,84,0,0),(102,100,101,0,0)",
    ));

    assert_ring(
        &support::single_outer(&graphics, "re90,94"),
        "(72,129),(72,93),(71,93),(71,90),(68,90),(68,78),(80,78),(80,159/2),(88,147/2),(88,73),(128,73),(128,129)",
    );
    assert_ring(
        &support::single_outer(&graphics, "re94,97"),
        "(74,127),(74,91),(73,91),(73,88),(70,88),(70,80),(74,80),(74,75),(126,75),(126,127)",
    );
}

#[test]
fn a_leaf_expanded_on_its_own_keeps_its_covered_junction_detour() {
    // Flap 101 is left over after grouping, alone among its siblings, so the
    // raw contour falls back to expanding its own region. Upstream consults
    // the covered-junction map there exactly as for a grouped leaf; this port
    // passed no covered junctions, and lost the detour.
    let traces = support::trace_contours(&parse_tree(
        "(90,76,3),(90,94,2),(76,5,1),(94,97,2),(5,31,13),(97,102,24),(97,101,1),(97,100,1)",
        "(31,72,66,0,0),(100,78,88,0,0),(101,78,83,0,0),(102,99,102,0,0)",
    ));

    assert_raw(
        &traces[&94],
        &[
            (&[100, 102], "(71,130),(71,74),(127,74),(127,130)"),
            (&[101], "(79,84),(79,88),(73,88),(73,78),(83,78),(83,84)"),
        ],
    );
    assert_raw(
        &traces[&97],
        &[
            (&[100, 102], "(73,128),(73,76),(125,76),(125,128)"),
            (&[101], "(79,84),(79,86),(75,86),(75,80),(81,80),(81,84)"),
        ],
    );
}

fn assert_raw(traces: &[TraceContour], expected: Components) {
    assert_eq!(traces.len(), 1, "one trace contour");
    let trace = &traces[0];
    assert!(trace.raw, "trace contour is raw");
    assert_eq!(
        trace.outer.len(),
        expected.len(),
        "raw components: {:?}",
        trace
            .outer
            .iter()
            .map(|outer| &outer.leaves)
            .collect::<Vec<_>>()
    );
    for (outer, (leaves, path)) in trace.outer.iter().zip(expected) {
        let mut actual_leaves = outer.leaves.clone().expect("raw components carry leaves");
        actual_leaves.sort_unstable();
        assert_eq!(actual_leaves, *leaves);
        let points = outer
            .points
            .iter()
            .map(|point| oristudio_bp::model::Point {
                x: point.x,
                y: point.y,
            })
            .collect::<Vec<_>>();
        assert_ring(&points, path);
    }
}
