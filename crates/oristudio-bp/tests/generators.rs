use oristudio_bp::layout::generators::{
    ConfigGeneratorContext, JointItem, config_generator_search_unsupported, cover,
    device_generator, get_exposed_part, pattern_generator, search_relay, single_config_generator,
    single_overlap_devices, to_split_items,
};
use oristudio_bp::layout::{CornerType, LayoutConfiguration};
use oristudio_bp::model::{Configuration, Corner, Junction, Overlap, Partition, Point, Strategy};

#[test]
fn config_generator_context_allocates_overlaps_and_cuts_x_and_y() {
    let junction = parent_junction(1, 2, 6.0, 4.0);
    let mut context = ConfigGeneratorContext::from_junctions(vec![junction.clone()], false);
    let overlap = context.to_overlap(&junction, 0);
    assert_eq!(overlap.id, Some(-1));
    assert_eq!(overlap.c, junction.c);
    assert_eq!(overlap.ox, 6.0);
    assert_eq!(overlap.oy, 4.0);
    assert_eq!(overlap.parent, 0);

    let mut context = ConfigGeneratorContext::from_junctions(vec![junction.clone()], false);
    let [left, right] = context.cut(&junction, 0, 2.0, 0.0);
    assert_eq!(left.id, Some(-1));
    assert_eq!(right.id, Some(-2));
    assert_eq!(left.ox, 2.0);
    assert_eq!(right.ox, 4.0);
    assert_eq!(right.shift, Some(Point { x: 2.0, y: 0.0 }));
    assert_corner(&left.c[2], CornerType::Internal, Some(-2), Some(3));
    assert_corner(&left.c[1], CornerType::Socket, Some(-2), Some(0));
    assert_corner(&right.c[3], CornerType::Socket, Some(-1), Some(2));
    assert_corner(&right.c[0], CornerType::Internal, Some(-1), Some(1));

    let [bottom, top] = context.cut(&junction, 0, 0.0, 1.0);
    assert_eq!(bottom.id, Some(-3));
    assert_eq!(top.id, Some(-4));
    assert_eq!(bottom.oy, 1.0);
    assert_eq!(top.oy, 3.0);
    assert_eq!(top.shift, Some(Point { x: 0.0, y: 1.0 }));
    assert_corner(&bottom.c[2], CornerType::Internal, Some(-4), Some(1));
    assert_corner(&bottom.c[3], CornerType::Socket, Some(-4), Some(0));
    assert_corner(&top.c[1], CornerType::Socket, Some(-3), Some(2));
    assert_corner(&top.c[0], CornerType::Internal, Some(-3), Some(3));
}

#[test]
fn config_generator_context_make_cleans_or_preserves_raw_single_mode() {
    let junction = parent_junction(1, 2, 6.0, 4.0);

    let mut base = ConfigGeneratorContext::from_junctions(vec![junction.clone()], false);
    let [left, right] = base.cut(&junction, 0, 2.0, 0.0);
    let cleaned = base.make(
        vec![Partition {
            overlaps: vec![left, right],
            strategy: None,
        }],
        true,
    );
    assert!(!cleaned.single_mode);
    assert!(cleaned.raw_partitions().is_none());
    assert_eq!(cleaned.partitions[0].overlaps[0].id, None);
    assert_eq!(cleaned.partitions[0].overlaps[1].id, None);
    assert_eq!(cleaned.partitions[0].overlaps[0].c[2].e, Some(-2));
    assert_eq!(cleaned.partitions[0].overlaps[1].c[0].e, Some(-1));

    let mut single = ConfigGeneratorContext::from_junctions(vec![junction], true);
    assert!(single.single_mode());
    let config = single
        .single_gadget(0, Some(Strategy::HalfIntegral))
        .unwrap();
    assert!(config.single_mode);
    assert_eq!(config.raw_partitions().unwrap()[0].overlaps[0].id, Some(-1));
    assert_eq!(config.partitions[0].overlaps[0].id, None);
    assert_eq!(
        config.partitions[0].to_json().strategy,
        Some(Strategy::HalfIntegral)
    );
}

#[test]
fn config_generator_search_boundary_is_explicitly_unsupported() {
    assert!(config_generator_search_unsupported().is_err());
}

#[test]
fn single_config_generator_stops_after_first_valid_generator_group() {
    let mut junction = parent_junction(1, 2, 2.0, 2.0);
    junction.sx = 100.0;
    let mut context = ConfigGeneratorContext::from_junctions(vec![junction], true);
    let configs = single_config_generator(&mut context, 0, None).unwrap();

    assert_eq!(configs.len(), 1);
    assert_eq!(configs[0].partitions.len(), 1);
    assert!(configs[0].pattern().is_some());

    let mut signature_context =
        ConfigGeneratorContext::from_junctions(vec![parent_junction(1, 2, 2.0, 2.0)], true);
    let signature = signature_context
        .single_gadget(0, None)
        .unwrap()
        .signature()
        .unwrap();
    let mut context =
        ConfigGeneratorContext::from_junctions(vec![parent_junction(1, 2, 2.0, 2.0)], true);
    let configs = single_config_generator(&mut context, 0, Some(&signature)).unwrap();
    assert!(configs.is_empty());
}

#[test]
fn single_config_generator_ports_even_area_double_relay() {
    let mut junction = parent_junction(1, 2, 2.0, 5.0);
    junction.sx = 10.0;
    let mut context = ConfigGeneratorContext::from_junctions(vec![junction], true);
    let configs = single_config_generator(&mut context, 0, None).unwrap();

    assert_eq!(configs.len(), 4);
    assert!(
        configs
            .iter()
            .all(|config| config.partitions.len() == 2 && config.pattern().is_some())
    );
}

#[test]
fn single_config_generator_continues_past_odd_area_relay_to_half_integral() {
    let mut junction = parent_junction(1, 2, 3.0, 5.0);
    junction.sx = 100.0;
    let mut context = ConfigGeneratorContext::from_junctions(vec![junction], true);
    let configs = single_config_generator(&mut context, 0, None).unwrap();

    assert_eq!(configs.len(), 1);
    assert_eq!(
        configs[0].partitions[0].to_json().strategy,
        Some(Strategy::HalfIntegral)
    );
    assert!(configs[0].pattern().is_some());
}

#[test]
fn relay_search_rewrites_oriented_overlap_pairs_and_strategy_variants() {
    let items = [
        JointItem {
            split: false,
            ..Default::default()
        },
        JointItem {
            split: false,
            ..Default::default()
        },
    ];
    let results = search_relay(
        &items,
        overlap(-1, 2.0, 5.0, 1, 9),
        overlap(-2, 4.0, 3.0, 3, 9),
        Some(Strategy::HalfIntegral),
        Some(Strategy::Universal),
    );
    assert_eq!(results.len(), 4);

    let x = &results[0];
    assert_eq!(x[0].strategy, Some(Strategy::HalfIntegral));
    assert_eq!(x[1].strategy, Some(Strategy::Universal));
    assert_eq!(x[1].overlaps[0].ox, 2.0);
    assert_eq!(x[1].overlaps[0].shift, None);
    assert_corner(
        &x[1].overlaps[0].c[2],
        CornerType::Internal,
        Some(-1),
        Some(3),
    );
    assert_corner(
        &x[1].overlaps[0].c[1],
        CornerType::Intersection,
        Some(1),
        None,
    );
    assert_corner(
        &x[0].overlaps[0].c[3],
        CornerType::Socket,
        Some(-2),
        Some(2),
    );
    assert_eq!(results[1][0].strategy, Some(Strategy::Universal));
    assert_eq!(results[1][1].strategy, Some(Strategy::HalfIntegral));

    let y = &results[2];
    assert_eq!(y[0].overlaps[0].oy, 2.0);
    assert_corner(
        &y[0].overlaps[0].c[2],
        CornerType::Internal,
        Some(-2),
        Some(1),
    );
    assert_corner(
        &y[0].overlaps[0].c[3],
        CornerType::Intersection,
        Some(3),
        None,
    );
    assert_corner(
        &y[1].overlaps[0].c[1],
        CornerType::Socket,
        Some(-1),
        Some(2),
    );
}

#[test]
fn relay_search_handles_non_oriented_shifts_and_split_filtering() {
    let items = [
        JointItem {
            split: true,
            ..Default::default()
        },
        JointItem {
            split: false,
            ..Default::default()
        },
    ];
    let results = search_relay(
        &items,
        overlap(-1, 2.0, 5.0, 1, 8),
        overlap(-2, 4.0, 3.0, 3, 9),
        None,
        None,
    );
    assert_eq!(results.len(), 1);
    let y = &results[0];
    assert_eq!(y[0].overlaps[0].shift, Some(Point { x: 0.0, y: 3.0 }));
    assert_corner(
        &y[0].overlaps[0].c[0],
        CornerType::Internal,
        Some(-2),
        Some(3),
    );
    assert_corner(
        &y[0].overlaps[0].c[1],
        CornerType::Intersection,
        Some(9),
        None,
    );
    assert_corner(
        &y[1].overlaps[0].c[3],
        CornerType::Socket,
        Some(-1),
        Some(0),
    );

    let items = [
        JointItem {
            split: false,
            ..Default::default()
        },
        JointItem {
            split: true,
            ..Default::default()
        },
    ];
    let results = search_relay(
        &items,
        overlap(-1, 2.0, 5.0, 1, 8),
        overlap(-2, 4.0, 3.0, 3, 9),
        None,
        None,
    );
    assert_eq!(results.len(), 1);
    let x = &results[0];
    assert_eq!(x[1].overlaps[0].shift, Some(Point { x: 2.0, y: 0.0 }));
    assert_corner(
        &x[1].overlaps[0].c[0],
        CornerType::Internal,
        Some(-1),
        Some(1),
    );
    assert_corner(
        &x[1].overlaps[0].c[3],
        CornerType::Intersection,
        Some(8),
        None,
    );
    assert_corner(
        &x[0].overlaps[0].c[1],
        CornerType::Socket,
        Some(-2),
        Some(0),
    );
}

#[test]
fn split_join_helpers_select_raw_split_items_and_covering() {
    let touching = overlap(-10, 3.0, 5.0, 1, 8);
    let remaining = overlap(-11, 3.0, 2.0, 7, 8);
    let config = LayoutConfiguration::new(
        Configuration {
            partitions: vec![
                Partition {
                    overlaps: vec![touching.clone()],
                    strategy: None,
                },
                Partition {
                    overlaps: vec![remaining.clone()],
                    strategy: None,
                },
            ],
            raw: Some(true),
            patterns: None,
            index: None,
        },
        true,
    );
    let item = JointItem {
        index: 0,
        split: true,
        opposite_node_id: Some(99),
        configs: vec![config],
    };
    let split_items = to_split_items(&item, 1).unwrap();
    assert_eq!(split_items.len(), 1);
    assert_eq!(split_items[0].overlap, touching);
    assert_eq!(split_items[0].opposite_node_id, 99);
    let split = split_items[0].split.as_ref().unwrap();
    assert!(split.is_horizontal);
    assert_eq!(split.remaining_partition.overlaps[0], remaining);
    assert!(cover(
        &overlap(-1, 4.0, 4.0, 1, 2),
        &overlap(-2, 3.0, 4.0, 1, 2)
    ));
    assert!(!cover(
        &overlap(-1, 4.0, 3.0, 1, 2),
        &overlap(-2, 3.0, 4.0, 1, 2)
    ));
}

#[test]
fn get_exposed_part_mutates_join_intersections_like_upstream() {
    let mut split_overlap = overlap(-20, 2.0, 5.0, 1, 8);
    split_overlap.parent = 0;
    let mut against_overlap = overlap(-21, 1.0, 3.0, 3, 9);
    against_overlap.parent = 1;
    let mut remaining_overlap = overlap(-30, 2.0, 4.0, 5, 8);
    remaining_overlap.c[3] = corner(CornerType::Internal, Some(-40), Some(0));
    let item = oristudio_bp::layout::generators::SplitItem {
        overlap: split_overlap,
        opposite_node_id: 8,
        split: Some(oristudio_bp::layout::generators::SplitInfo {
            remaining_partition: Partition {
                overlaps: vec![remaining_overlap],
                strategy: None,
            },
            is_horizontal: false,
        }),
    };
    let against = oristudio_bp::layout::generators::SplitItem {
        overlap: against_overlap,
        opposite_node_id: 77,
        split: None,
    };
    let mut join_left = overlap(-40, 2.0, 2.0, 1, 8);
    join_left.parent = 0;
    join_left.c[1] = corner(CornerType::Intersection, Some(42), None);
    let mut join_right = overlap(-41, 1.0, 2.0, 3, 9);
    join_right.parent = 1;
    let mut join = Partition {
        overlaps: vec![join_left, join_right],
        strategy: None,
    };

    let exposed = get_exposed_part(&item, &against, &mut join)
        .unwrap()
        .unwrap();
    assert_eq!(exposed.overlaps[0].oy, 1.0);
    assert_corner(
        &exposed.overlaps[0].c[1],
        CornerType::Intersection,
        Some(42),
        None,
    );
    assert_corner(
        &join.overlaps[0].c[1],
        CornerType::Socket,
        Some(-30),
        Some(3),
    );
    assert_corner(
        &exposed.overlaps[0].c[3],
        CornerType::Internal,
        Some(-40),
        Some(1),
    );
}

#[test]
fn device_generator_ports_single_overlap_gops_and_half_integral_fallthrough() {
    let overlap = overlap(-1, 2.0, 2.0, 1, 2);
    let devices = single_overlap_devices(&overlap, 100.0, None).unwrap();
    assert_eq!(devices.len(), 2);
    assert_eq!(devices[0].gadgets.len(), 1);
    assert_eq!(devices[0].gadgets[0].pieces.len(), 1);
    assert_eq!(devices[0].gadgets[0].pieces[0].u, 1.0);

    let devices = single_overlap_devices(&overlap, 100.0, Some(Strategy::HalfIntegral)).unwrap();
    assert_eq!(devices.len(), 2);
    assert!(
        devices
            .iter()
            .all(|device| device.gadgets[0].pieces.len() == 1)
    );
}

#[test]
fn device_generator_ports_universal_gps_and_unsupported_join_boundaries() {
    let universal = single_overlap_devices(
        &overlap(-1, 3.0, 5.0, 1, 2),
        100.0,
        Some(Strategy::Universal),
    )
    .unwrap();
    assert!(!universal.is_empty());
    assert!(
        universal
            .iter()
            .all(|device| device.gadgets[0].pieces.len() == 2)
    );
    assert!(
        universal
            .iter()
            .any(|device| device.gadgets[0].anchors.is_some())
    );

    let junctions = vec![parent_junction(1, 2, 6.0, 4.0)];
    let one = Partition {
        overlaps: vec![overlap(-1, 2.0, 2.0, 1, 2)],
        strategy: None,
    };
    assert_eq!(device_generator(&one, &junctions).unwrap().len(), 2);

    let join = Partition {
        overlaps: vec![overlap(-1, 2.0, 2.0, 1, 2), overlap(-2, 2.0, 2.0, 1, 3)],
        strategy: None,
    };
    assert!(device_generator(&join, &junctions).is_err());

    let general = Partition {
        overlaps: vec![
            overlap(-1, 2.0, 2.0, 1, 2),
            overlap(-2, 2.0, 2.0, 1, 3),
            overlap(-3, 2.0, 2.0, 1, 4),
        ],
        strategy: None,
    };
    assert!(device_generator(&general, &junctions).is_err());
}

#[test]
fn pattern_generator_ports_single_overlap_positioning_and_proto_reuse() {
    let mut junction = parent_junction(1, 2, 2.0, 2.0);
    junction.sx = 100.0;
    let junctions = vec![junction];
    let config = LayoutConfiguration::new(
        Configuration {
            partitions: vec![Partition {
                overlaps: vec![overlap(-1, 2.0, 2.0, 1, 2)],
                strategy: None,
            }],
            raw: None,
            patterns: None,
            index: None,
        },
        true,
    );
    let patterns = pattern_generator(&config, &junctions, Point { x: 1.0, y: 1.0 }, None).unwrap();
    assert_eq!(patterns.len(), 2);
    assert!(patterns.iter().all(|pattern| pattern.valid()));
    assert_eq!(patterns[0].devices()[0].offset(), 47.0);

    let proto = Configuration {
        partitions: config.to_json(false).partitions,
        raw: None,
        patterns: Some(vec![patterns[0].to_json()]),
        index: None,
    };
    let from_proto =
        pattern_generator(&config, &junctions, Point { x: 1.0, y: 1.0 }, Some(&proto)).unwrap();
    assert_eq!(from_proto.len(), 2);
    assert_eq!(from_proto[0].to_json(), patterns[0].to_json());
    assert_eq!(from_proto[1].to_json(), patterns[1].to_json());

    let restored = Configuration {
        partitions: config.to_json(false).partitions,
        raw: None,
        patterns: Some(vec![patterns[1].to_json()]),
        index: Some(0),
    };
    let from_session = pattern_generator(
        &config,
        &junctions,
        Point { x: 1.0, y: 1.0 },
        Some(&restored),
    )
    .unwrap();
    assert_eq!(from_session.len(), 1);
    assert_eq!(from_session[0].to_json(), patterns[1].to_json());
}

#[test]
fn configuration_can_generate_patterns_with_explicit_context() {
    let mut junction = parent_junction(1, 2, 2.0, 2.0);
    junction.sx = 100.0;
    let junctions = vec![junction];
    let mut config = LayoutConfiguration::new(
        Configuration {
            partitions: vec![Partition {
                overlaps: vec![overlap(-1, 2.0, 2.0, 1, 2)],
                strategy: None,
            }],
            raw: None,
            patterns: None,
            index: None,
        },
        true,
    );

    assert_eq!(
        config
            .generate_patterns(&junctions, Point { x: 1.0, y: 1.0 })
            .unwrap(),
        2
    );
    assert_eq!(config.patterns().len(), 2);
    assert!(config.pattern().unwrap().valid());
    assert_eq!(config.to_json(true).patterns.unwrap().len(), 2);
    assert!(config.complete().is_err());
}

fn assert_corner(corner: &Corner, corner_type: CornerType, e: Option<i64>, q: Option<u8>) {
    assert_eq!(corner.corner_type, corner_type as u8);
    assert_eq!(corner.e, e);
    assert_eq!(corner.q, q);
}

fn overlap(id: i64, ox: f64, oy: f64, a: i64, b: i64) -> Overlap {
    Overlap {
        c: vec![
            corner(CornerType::Flap, Some(a), Some(0)),
            corner(CornerType::Side, None, None),
            corner(CornerType::Flap, Some(b), Some(2)),
            corner(CornerType::Side, None, None),
        ],
        ox,
        oy,
        id: Some(id),
        parent: 0,
        shift: None,
    }
}

fn parent_junction(a: i64, b: i64, ox: f64, oy: f64) -> Junction {
    Junction {
        c: vec![
            corner(CornerType::Flap, Some(a), Some(0)),
            corner(CornerType::Side, None, None),
            corner(CornerType::Flap, Some(b), Some(2)),
            corner(CornerType::Side, None, None),
        ],
        f: Point { x: 1.0, y: 1.0 },
        ox,
        oy,
        sx: ox + 1.0,
    }
}

fn corner(corner_type: CornerType, e: Option<i64>, q: Option<u8>) -> Corner {
    Corner {
        corner_type: corner_type as u8,
        e,
        q,
        dynamic: None,
    }
}
