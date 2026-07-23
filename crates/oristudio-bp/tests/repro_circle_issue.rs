//! Probe for the reported "conflict drawn outside the flap circle" case.
use oristudio_bp::layout::{LayoutJunction, create_layout_junctions};
use oristudio_bp::model::{Edge, Flap};
use oristudio_bp::tree::BpTree;

#[test]
fn print_repro_junction_geometry() {
    // minimal_repro_circle_issue.osf: flaps 5 and 7, each a unit-length leaf.
    let tree = BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 1,
                length: 1.0,
            },
            Edge {
                n1: 0,
                n2: 5,
                length: 1.0,
            },
            Edge {
                n1: 1,
                n2: 7,
                length: 1.0,
            },
        ],
        &[
            Flap {
                id: 5,
                x: 9.0,
                y: 8.0,
                width: 0.0,
                height: 0.0,
            },
            Flap {
                id: 7,
                x: 11.0,
                y: 6.0,
                width: 0.0,
                height: 0.0,
            },
        ],
    )
    .unwrap();

    for junction in create_layout_junctions(&tree).unwrap() {
        match junction {
            LayoutJunction::Valid(v) => println!("VALID  a={} b={}", v.a, v.b),
            LayoutJunction::Invalid(mut j) => {
                println!(
                    "INVALID a={} b={} distance_after_flap_radii={}",
                    j.a,
                    j.b,
                    j.distance_after_flap_radii()
                );
                for (i, path) in j.get_polygon(&tree).unwrap().iter().enumerate() {
                    println!("  path {i}:");
                    for point in path {
                        println!(
                            "    ({:.4}, {:.4}) arc={:?} r={:?}",
                            point.point.x, point.point.y, point.arc, point.radius
                        );
                    }
                }
            }
        }
    }
}
