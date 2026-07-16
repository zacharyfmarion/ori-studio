use oristudio_bp::layout::pattern::{
    LayoutPattern, PatternAddOn, PatternDevice, PatternGadget, PatternPiece,
};
use oristudio_bp::layout::trace::RepoTrace;
use oristudio_bp::layout::{
    CornerType, LayoutConfiguration, LayoutRepository, ValidJunction, ValidJunctionData,
};
use oristudio_bp::math::geometry::{Line, Point as ExactPoint, Vector as ExactVector};
use oristudio_bp::model::{
    AddOn, Anchor, Configuration, Corner, Device, Edge, Flap, Gadget, Junction, Overlap, Partition,
    Pattern, Piece, Point,
};
use oristudio_bp::shared::QuadrantDirection;
use oristudio_bp::tree::BpTree;
use serde_json::Value;

#[test]
fn piece_shape_anchors_detours_and_reverse_match_bp_geometry() {
    let mut piece = PatternPiece::new(piece(2.0, 3.0, 1.0, 2.0));
    assert_eq!(piece.sx(), 6.0);
    assert_eq!(piece.sy(), 5.0);
    assert_vector(&piece.direction().unwrap(), 9.0, 10.0);

    let shape = piece.shape().unwrap();
    assert_eq!(shape.contour.len(), 4);
    assert_point(&shape.contour[0], 0.0, 0.0);
    assert_point(&shape.contour[1], 1.0, 3.0);
    assert_point(&shape.contour[2], 6.0, 5.0);
    assert_point(&shape.contour[3], 5.0, 2.0);

    let anchors = piece.anchors().unwrap();
    assert!(anchors.iter().all(Option::is_some));

    piece.add_detour(vec![
        Point { x: 1.0, y: 3.0 },
        Point { x: 2.0, y: 4.0 },
        Point { x: 6.0, y: 5.0 },
    ]);
    let shape = piece.shape().unwrap();
    assert_eq!(shape.contour.len(), 6);
    assert_point(&shape.contour[1], 1.0, 3.0);
    assert_point(&shape.contour[2], 2.0, 4.0);
    let anchors = piece.anchors().unwrap();
    assert!(anchors[0].is_some());
    assert!(anchors[1].is_none());
    assert!(anchors[2].is_some());
    assert!(anchors[3].is_some());

    piece.reverse(10.0, 11.0);
    let data = piece.to_json();
    assert_eq!(data.shift, Some(Point { x: 4.0, y: 6.0 }));
    assert_eq!(
        data.detours.unwrap()[0],
        vec![
            Point { x: 5.0, y: 2.0 },
            Point { x: 4.0, y: 1.0 },
            Point { x: 0.0, y: 0.0 },
        ]
    );

    piece.clear_detour();
    assert!(piece.to_json().detours.is_none());
}

#[test]
fn addon_region_shape_direction_and_axis_parallels_are_computed() {
    let add_on = PatternAddOn::new(AddOn {
        contour: vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 4.0, y: 0.0 },
            Point { x: 4.0, y: 4.0 },
            Point { x: 0.0, y: 4.0 },
        ],
        dir: Point { x: 2.0, y: 0.0 },
    });

    let shape = add_on.shape().unwrap();
    assert_eq!(shape.ridges.len(), 4);
    assert_vector(&add_on.direction().unwrap(), 1.0, 0.0);
    let axis_parallels = add_on.axis_parallels().unwrap();
    assert_eq!(axis_parallels.len(), 5);
    let middle = Line::new(
        ExactPoint::from_numbers(0.0, 2.0).unwrap(),
        ExactPoint::from_numbers(4.0, 2.0).unwrap(),
    );
    assert!(axis_parallels.iter().any(|line| line.equals(&middle)));
}

#[test]
fn gadget_anchor_map_spans_slack_reverse_and_intersection_match_bp_rules() {
    let mut gadget = PatternGadget::new(Gadget {
        pieces: vec![piece(2.0, 2.0, 0.0, 0.0)],
        offset: Some(Point { x: 1.0, y: 1.0 }),
        anchors: Some(vec![
            None,
            Some(Anchor {
                slack: Some(2.0),
                location: Some(Point { x: 9.0, y: 9.0 }),
            }),
        ]),
    });

    let anchors = gadget.anchor_map().unwrap();
    assert_point(&anchors[0].point, 1.0, 1.0);
    assert_eq!(anchors[0].piece_index, Some(0));
    assert_point(&anchors[1].point, 10.0, 10.0);
    assert_eq!(anchors[1].piece_index, None);
    assert_eq!(gadget.width_span().unwrap(), 2.0);
    assert_eq!(gadget.height_span().unwrap(), 2.0);
    assert_eq!(gadget.slack(QuadrantDirection::Ul), 2.0);

    gadget.add_slack(QuadrantDirection::Lr, 3.0);
    let anchors = gadget.to_json().anchors.unwrap();
    assert!(anchors[2].is_none());
    assert_eq!(anchors[3].as_ref().unwrap().slack, Some(3.0));

    let contour = gadget.contour().unwrap();
    assert_eq!(contour.len(), 4);
    assert!(
        gadget
            .intersects(
                &ExactPoint::from_numbers(1.0, 1.0).unwrap(),
                &ExactVector::from_numbers(1.0, 1.0).unwrap(),
            )
            .unwrap()
    );

    let gps = PatternGadget::new(Gadget {
        pieces: vec![piece(3.0, 4.0, 1.0, 2.0), piece(2.0, 3.0, 2.0, 1.0)],
        offset: None,
        anchors: None,
    });
    let reversed = gps.reverse_gps().unwrap().to_json();
    assert_eq!(reversed.pieces[0].shift, Some(Point { x: 0.0, y: 0.0 }));
    assert_eq!(reversed.pieces[1].shift, Some(Point { x: 1.0, y: 1.0 }));

    let mut simplified = Gadget {
        pieces: vec![piece(1.0, 1.0, 0.0, 0.0)],
        offset: Some(Point { x: 0.0, y: 0.0 }),
        anchors: Some(vec![Some(Anchor {
            slack: Some(1.0),
            location: None,
        })]),
    };
    PatternGadget::simplify(&mut simplified);
    assert_eq!(simplified.offset, None);
    assert_eq!(simplified.anchors, None);
}

#[test]
fn device_and_seeded_pattern_shell_preserve_json_and_local_geometry() {
    let device_json = Device {
        gadgets: vec![Gadget {
            pieces: vec![piece(2.0, 2.0, 0.0, 0.0)],
            offset: Some(Point { x: 0.0, y: 0.0 }),
            anchors: Some(vec![Some(Anchor {
                slack: Some(1.0),
                location: None,
            })]),
        }],
        offset: None,
        add_ons: Some(vec![AddOn {
            contour: vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: 2.0, y: 0.0 },
                Point { x: 2.0, y: 2.0 },
                Point { x: 0.0, y: 2.0 },
            ],
            dir: Point { x: 2.0, y: 0.0 },
        }]),
    };

    let mut device = PatternDevice::new(device_json.clone());
    assert_eq!(device.offset(), 0.0);
    assert_eq!(device.to_json().offset, Some(0.0));
    assert_eq!(device.to_json().add_ons.as_ref().unwrap().len(), 1);
    assert_eq!(device.contours_local().unwrap().len(), 2);
    assert!(!device.axis_parallels_local().unwrap().is_empty());
    assert!(!device.inner_ridges_local().unwrap().is_empty());
    assert!(device.draw_ridges().is_err());

    device.set_offset_shell(4.0, Point { x: 1.0, y: -1.0 });
    assert_eq!(device.offset(), 4.0);
    assert_eq!(device.location(), Point { x: 4.0, y: -4.0 });

    let signature = PatternDevice::signature(&[device_json]).unwrap();
    let value: Value = serde_json::from_str(&signature).unwrap();
    assert!(value[0].get("offset").is_none());
    assert!(value[0]["gadgets"][0].get("offset").is_none());
    assert!(value[0]["gadgets"][0].get("anchors").is_none());

    let mut pattern = LayoutPattern::new_seeded(Pattern {
        devices: vec![device.to_json()],
    });
    assert!(pattern.valid());
    assert_eq!(pattern.devices().len(), 1);
    assert_eq!(pattern.gadgets().len(), 1);
    assert!(!pattern.origin_dirty());
    pattern.mark_origin_dirty();
    assert!(pattern.try_update_origin_shell());
    assert!(!pattern.try_update_origin_shell());
    assert!(LayoutPattern::new_unpositioned(pattern.to_json()).is_err());
}

#[test]
fn positioned_pattern_centers_single_device_on_single_junction() {
    let config = layout_config(vec![partition(overlap(0, 2.0, 2.0, None))], true);
    let positioned = LayoutPattern::new_positioned(
        Pattern {
            devices: vec![device(2.0)],
        },
        &config,
        &[junction(10.0)],
        Point { x: 1.0, y: -1.0 },
    )
    .unwrap();

    assert!(positioned.valid());
    assert_eq!(positioned.devices()[0].offset(), 4.0);
    assert_eq!(
        positioned.devices()[0].location(),
        Point { x: 4.0, y: -4.0 }
    );
}

#[test]
fn repo_positioned_pattern_initializes_anchors_and_connection_ridges() {
    let tree = two_leaf_tree();
    let junction = repo_valid_junction(&tree);
    let mut repo = LayoutRepository::new(&tree, "s1,2", &[junction], None).unwrap();
    let config = layout_config(vec![partition(overlap_with_quadrants(0, 2.0, 2.0))], false);
    let positioned = LayoutPattern::new_positioned_with_repo(
        Pattern {
            devices: vec![device(2.0)],
        },
        &config,
        &mut repo,
        &tree,
    )
    .unwrap();

    let device = &positioned.devices()[0];
    assert!(device.initialized());
    let anchors = device.transformed_anchors().unwrap();
    let target = tree.node(1).unwrap().aabb.points[QuadrantDirection::Ur as usize];
    let target = ExactPoint::from_numbers(target.x, target.y).unwrap();
    let expected_anchor =
        target.add_vector(&ExactVector::from_numbers(device.offset(), device.offset()).unwrap());
    assert!(anchors[0][QuadrantDirection::Ur as usize].equals(&expected_anchor));

    let expected_ridge = Line::new(expected_anchor, target);
    let draw_ridges = positioned.draw_ridges(0, &config, &repo, &tree).unwrap();
    assert!(draw_ridges.iter().any(|line| line.equals(&expected_ridge)));
    let trace_ridges = positioned.trace_ridges(0, &config, &repo, &tree).unwrap();
    assert!(
        trace_ridges
            .iter()
            .any(|ridge| ridge.line.equals(&expected_ridge))
    );

    let side_diagonals = config.side_diagonals(&positioned, &repo, &tree).unwrap();
    assert_eq!(side_diagonals.len(), 1);
    let repo_trace = RepoTrace::from_repository(&config, &positioned, &repo, &tree).unwrap();
    assert!(repo_trace.leaves().contains(&1));
    assert!(repo_trace.leaves().contains(&2));
    assert!(!repo_trace.trace().ridges().is_empty());
    assert_eq!(repo_trace.trace().side_diagonals().len(), 1);
}

#[test]
fn positioned_pattern_separates_two_single_junction_devices() {
    let config = layout_config(
        vec![
            partition(overlap(0, 2.0, 2.0, None)),
            partition(overlap(0, 3.0, 3.0, Some(0))),
        ],
        true,
    );
    let positioned = LayoutPattern::new_positioned(
        Pattern {
            devices: vec![device(2.0), device(3.0)],
        },
        &config,
        &[junction(10.0)],
        Point { x: 1.0, y: 1.0 },
    )
    .unwrap();

    assert!(positioned.valid());
    assert_eq!(positioned.devices()[0].offset(), 0.0);
    assert_eq!(positioned.devices()[1].offset(), 7.0);
    assert_eq!(positioned.devices()[1].location(), Point { x: 7.0, y: 7.0 });
}

#[test]
fn positioned_pattern_reports_invalid_when_single_junction_span_does_not_fit() {
    let config = layout_config(
        vec![
            partition(overlap(0, 2.0, 2.0, None)),
            partition(overlap(0, 3.0, 3.0, Some(0))),
        ],
        true,
    );
    let positioned = LayoutPattern::new_positioned(
        Pattern {
            devices: vec![device(2.0), device(3.0)],
        },
        &config,
        &[junction(2.0)],
        Point { x: 1.0, y: 1.0 },
    )
    .unwrap();

    assert!(!positioned.valid());
    assert_eq!(positioned.devices()[1].offset(), 0.0);
}

#[test]
fn positioned_pattern_preserves_upstream_gap_for_larger_single_junction_patterns() {
    let config = layout_config(
        vec![
            partition(overlap(0, 1.0, 1.0, None)),
            partition(overlap(0, 1.0, 1.0, Some(0))),
            partition(overlap(0, 1.0, 1.0, Some(0))),
        ],
        true,
    );
    let err = LayoutPattern::new_positioned(
        Pattern {
            devices: vec![device(1.0), device(1.0), device(1.0)],
        },
        &config,
        &[junction(10.0)],
        Point { x: 1.0, y: 1.0 },
    )
    .unwrap_err();

    assert!(err.to_string().contains("four or more devices"));
}

fn piece(ox: f64, oy: f64, u: f64, v: f64) -> Piece {
    Piece {
        ox,
        oy,
        u,
        v,
        detours: None,
        shift: None,
    }
}

fn device(size: f64) -> Device {
    Device {
        gadgets: vec![Gadget {
            pieces: vec![piece(size, size, 0.0, 0.0)],
            offset: None,
            anchors: None,
        }],
        offset: None,
        add_ons: None,
    }
}

fn layout_config(partitions: Vec<Partition>, single_mode: bool) -> LayoutConfiguration {
    LayoutConfiguration::new(
        Configuration {
            partitions,
            raw: None,
            patterns: None,
            index: None,
        },
        single_mode,
    )
}

fn partition(overlap: Overlap) -> Partition {
    Partition {
        overlaps: vec![overlap],
        strategy: None,
    }
}

fn overlap(parent: usize, ox: f64, oy: f64, q0: Option<u8>) -> Overlap {
    Overlap {
        c: vec![
            corner(CornerType::Flap, Some(1), q0),
            corner(CornerType::Flap, Some(1), None),
            corner(CornerType::Flap, Some(2), None),
            corner(CornerType::Flap, Some(2), None),
        ],
        ox,
        oy,
        id: None,
        parent,
        shift: None,
    }
}

fn overlap_with_quadrants(parent: usize, ox: f64, oy: f64) -> Overlap {
    Overlap {
        c: vec![
            corner(CornerType::Flap, Some(1), Some(QuadrantDirection::Ur as u8)),
            corner(CornerType::Side, None, None),
            corner(CornerType::Flap, Some(2), Some(QuadrantDirection::Ll as u8)),
            corner(CornerType::Flap, Some(2), Some(QuadrantDirection::Lr as u8)),
        ],
        ox,
        oy,
        id: None,
        parent,
        shift: None,
    }
}

fn junction(sx: f64) -> Junction {
    Junction {
        c: vec![
            corner(CornerType::Flap, Some(1), None),
            corner(CornerType::Flap, Some(1), None),
            corner(CornerType::Flap, Some(2), None),
            corner(CornerType::Flap, Some(2), None),
        ],
        f: Point { x: 1.0, y: 1.0 },
        ox: 0.0,
        oy: 0.0,
        sx,
    }
}

fn two_leaf_tree() -> BpTree {
    BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 1,
                length: 2.0,
            },
            Edge {
                n1: 0,
                n2: 2,
                length: 2.0,
            },
        ],
        &[
            Flap {
                id: 1,
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            },
            Flap {
                id: 2,
                x: 8.0,
                y: 8.0,
                width: 0.0,
                height: 0.0,
            },
        ],
    )
    .unwrap()
}

fn repo_valid_junction(tree: &BpTree) -> ValidJunction {
    ValidJunction::new(
        tree,
        1,
        2,
        ValidJunctionData {
            lca: 0,
            s: Point { x: 8.0, y: 8.0 },
            o: Point { x: 0.0, y: 0.0 },
            f: Point { x: 1.0, y: 1.0 },
            dir: QuadrantDirection::Ur,
            tip: Point { x: 0.0, y: 0.0 },
        },
    )
    .unwrap()
}

fn corner(corner_type: CornerType, e: Option<i64>, q: Option<u8>) -> Corner {
    Corner {
        corner_type: corner_type as u8,
        e,
        q,
        dynamic: None,
    }
}

fn assert_point(point: &ExactPoint, x: f64, y: f64) {
    assert_eq!(point.value(), (x, y));
}

fn assert_vector(vector: &ExactVector, x: f64, y: f64) {
    assert_eq!((vector.x.value(), vector.y.value()), (x, y));
}
