use oristudio_bp::layout::generators::{
    GeneralConfigGeneratorContext, config_generator_with_repo, device_generator_with_repo,
    general_config_generator, pattern_generator_with_repo,
};
use oristudio_bp::layout::joiner::{Joinee, JoineeBuilder, Joiner, reverse_shift};
use oristudio_bp::layout::pattern::PatternPiece;
use oristudio_bp::layout::{
    LayoutConfiguration, LayoutRepository, ValidJunction, ValidJunctionData,
};
use oristudio_bp::math::geometry::Point as ExactPoint;
use oristudio_bp::model::{
    Configuration, Edge, Flap, Junction, NodeId, Overlap, Partition, Piece, Point, Strategy,
    Stretch,
};
use oristudio_bp::shared::QuadrantDirection;
use oristudio_bp::tree::BpTree;

#[test]
fn joiner_shell_computes_metadata_and_candidate_pieces() {
    let tree = sample_tree();
    let junctions = sample_junctions(&tree);
    let mut repo = LayoutRepository::new(&tree, "join", &junctions, Some(&prototype())).unwrap();
    let overlaps = vec![
        overlap(repo.junctions[0].clone(), 2.0, 4.0, 0, None),
        overlap(repo.junctions[1].clone(), 4.0, 2.0, 1, None),
    ];

    let joiner = Joiner::new(&overlaps, &mut repo, &tree).unwrap().unwrap();
    assert!(joiner.oriented());
    assert!(!joiner.is_clockwise());
    assert_eq!(
        joiner.quadrant_pair(),
        [QuadrantDirection::Ul, QuadrantDirection::Ll]
    );
    assert_eq!(joiner.shared_quadrant(), QuadrantDirection::Ur);
    assert_eq!(joiner.widths(), [100.0, 100.0]);
    assert!(joiner.intersection_dist() > 0.0);
    assert!(!joiner.pieces().0.is_empty());
    assert!(!joiner.pieces().1.is_empty());
    assert!(joiner.shifts().0.is_none());
    let simple = joiner.simple_join(None).unwrap();
    let perfect = joiner.simple_join(Some(Strategy::Perfect)).unwrap();
    let base = joiner.base_join().unwrap();
    let standard = joiner.standard_join().unwrap();
    assert!(!simple.is_empty() || !perfect.is_empty() || !base.is_empty() || !standard.is_empty());
    let joined = simple
        .iter()
        .chain(perfect.iter())
        .chain(base.iter())
        .chain(standard.iter())
        .next()
        .unwrap();
    assert_eq!(joined.gadgets.len(), 2);
    assert!(joined.offset.is_none());
    assert!(
        joined
            .gadgets
            .iter()
            .all(|gadget| !gadget.pieces.is_empty())
    );

    for strategy in [
        None,
        Some(Strategy::Perfect),
        Some(Strategy::BaseJoin),
        Some(Strategy::StandardJoin),
    ] {
        let devices = device_generator_with_repo(
            &Partition {
                overlaps: overlaps.clone(),
                strategy,
            },
            &mut repo,
            &tree,
        )
        .unwrap();
        if strategy.is_none() {
            assert!(!devices.is_empty());
        }
        if let Some(device) = devices.first() {
            assert_eq!(device.gadgets.len(), 2);
        }
    }

    let config = LayoutConfiguration::new(
        Configuration {
            partitions: vec![Partition {
                overlaps: overlaps.clone(),
                strategy: None,
            }],
            raw: None,
            patterns: None,
            index: None,
        },
        false,
    );
    let patterns = pattern_generator_with_repo(&config, &mut repo, &tree, None).unwrap();
    assert!(patterns.iter().any(|pattern| pattern.valid()));

    let piece = PatternPiece::new(piece(2.0, 2.0, 1.0, 2.0));
    assert!(
        joiner
            .relay_join_intersection(&piece, Point { x: 0.0, y: 0.0 }, QuadrantDirection::Ur,)
            .is_ok()
    );
}

#[test]
fn general_config_generator_ports_two_junction_joint_search() {
    let tree = sample_tree();
    let junctions = shared_quadrant_junctions(&tree);
    let mut repo = LayoutRepository::new(&tree, "join", &junctions, Some(&prototype())).unwrap();

    let mut context = GeneralConfigGeneratorContext::new(&repo).unwrap();
    assert!(context.check_preconditions());
    assert_eq!(context.max_rank(), 9);
    assert_eq!(context.rank_combinations(0), vec![vec![0]]);
    assert_eq!(context.rank_combinations(4), vec![vec![4]]);
    let rank_zero = context.search(&[0]).unwrap();
    assert!(
        rank_zero
            .iter()
            .any(|config| config.partitions.iter().any(|p| p.overlaps.len() == 2))
    );

    let configs = general_config_generator(&mut repo, &tree, None).unwrap();
    assert!(!configs.is_empty());
    assert!(configs.iter().any(|config| config.pattern().is_some()));

    let via_repo = config_generator_with_repo(&mut repo, &tree, None).unwrap();
    assert!(!via_repo.is_empty());
}

#[test]
fn joiner_skips_equal_span_pairs_and_ports_reverse_shift() {
    let tree = sample_tree();
    let junctions = sample_junctions(&tree);
    let mut repo = LayoutRepository::new(&tree, "join", &junctions, Some(&prototype())).unwrap();
    let overlaps = vec![
        overlap(repo.junctions[0].clone(), 2.0, 4.0, 0, None),
        overlap(repo.junctions[1].clone(), 2.0, 6.0, 1, None),
    ];
    assert!(Joiner::new(&overlaps, &mut repo, &tree).unwrap().is_none());

    let junction = Junction {
        c: vec![],
        f: Point { x: 1.0, y: 1.0 },
        ox: 5.0,
        oy: 5.0,
        sx: 10.0,
    };
    let mut shifted = overlap(
        junction.clone(),
        3.0,
        4.0,
        0,
        Some(Point { x: 1.0, y: 1.0 }),
    );
    assert_eq!(
        reverse_shift(&shifted, &junction),
        Some(Point { x: -1.0, y: 0.0 })
    );
    shifted.shift = Some(Point { x: 2.0, y: 1.0 });
    assert_eq!(reverse_shift(&shifted, &junction), None);
}

#[test]
fn joinee_ports_detour_contains_anchor_and_gadget_export() {
    let mut joinee = Joinee::new(
        PatternPiece::new(piece(2.0, 2.0, 1.0, 1.0)),
        Point { x: 1.0, y: 2.0 },
        Vec::new(),
        &ExactPoint::from_integers(3, 4),
        QuadrantDirection::Ur,
        None,
    )
    .unwrap();

    assert!(joinee.contains(&ExactPoint::from_integers(2, 3)).unwrap());
    assert!(
        !joinee
            .contains(&ExactPoint::from_integers(100, 100))
            .unwrap()
    );

    joinee.setup_detour(
        &[
            ExactPoint::from_integers(1, 2),
            ExactPoint::from_integers(2, 3),
        ],
        false,
    );
    let detoured_piece = joinee.p.to_json();
    assert_eq!(
        detoured_piece.detours.unwrap()[0],
        vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 1.0, y: 1.0 },
            Point { x: 2.0, y: 2.0 },
        ]
    );

    let mut joinee = Joinee::new(
        PatternPiece::new(piece(2.0, 2.0, 1.0, 1.0)),
        Point { x: 1.0, y: 2.0 },
        Vec::new(),
        &ExactPoint::from_integers(3, 4),
        QuadrantDirection::Ur,
        None,
    )
    .unwrap();
    joinee.setup_anchor(true, &ExactPoint::from_integers(5, 6));
    let gadget = joinee.to_gadget(false, true, None).unwrap();
    assert_eq!(gadget.offset, Some(Point { x: 1.0, y: 2.0 }));
    assert_eq!(
        gadget.anchors.unwrap()[QuadrantDirection::Ul as usize]
            .as_ref()
            .unwrap()
            .location,
        Some(Point { x: 4.0, y: 4.0 })
    );
}

#[test]
fn joinee_builder_ports_additional_offset_and_setup_boundary() {
    let tree = sample_tree();
    let junctions = sample_junctions(&tree);
    let mut repo = LayoutRepository::new(&tree, "join", &junctions, Some(&prototype())).unwrap();
    let overlaps = vec![
        overlap(repo.junctions[0].clone(), 2.0, 4.0, 0, None),
        overlap(repo.junctions[1].clone(), 4.0, 2.0, 1, None),
    ];
    let joiner = Joiner::new(&overlaps, &mut repo, &tree).unwrap().unwrap();
    let [q1, q2] = joiner.quadrant_pair();
    let mut builder1 =
        JoineeBuilder::new(PatternPiece::new(piece(2.0, 2.0, 1.0, 2.0)), q1, &joiner);
    let mut builder2 =
        JoineeBuilder::new(PatternPiece::new(piece(2.0, 2.0, 2.0, 1.0)), q2, &joiner);

    let anchor = builder1.anchor().unwrap();
    builder1
        .set_additional_offset(Point { x: 1.0, y: -1.0 })
        .unwrap();
    let shifted = builder1.anchor().unwrap();
    assert_eq!(shifted.x.value(), anchor.x.value() + 1.0);
    assert_eq!(shifted.y.value(), anchor.y.value() - 1.0);

    let _ = builder1
        .setup(&mut builder2, 1, Point { x: 0.0, y: 0.0 }, 100.0)
        .unwrap();
    let joinee = builder1.build(&ExactPoint::from_integers(0, 0)).unwrap();
    assert!(joinee.e.vector().length() > 0.0);
}

fn sample_tree() -> BpTree {
    BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 1,
                length: 10.0,
            },
            Edge {
                n1: 0,
                n2: 2,
                length: 8.0,
            },
            Edge {
                n1: 0,
                n2: 3,
                length: 6.0,
            },
        ],
        &[
            flap(1, 0.0, 0.0, 2.0, 3.0),
            flap(2, 20.0, 0.0, 2.0, 2.0),
            flap(3, 0.0, 20.0, 3.0, 3.0),
        ],
    )
    .unwrap()
}

fn sample_junctions(tree: &BpTree) -> Vec<ValidJunction> {
    vec![
        valid_junction(
            tree,
            1,
            2,
            junction_data(
                QuadrantDirection::Ur,
                Point { x: 2.0, y: 3.0 },
                Point { x: 100.0, y: 100.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 3.0 },
            ),
        ),
        valid_junction(
            tree,
            1,
            3,
            junction_data(
                QuadrantDirection::Lr,
                Point { x: 3.0, y: 1.0 },
                Point { x: 100.0, y: 100.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 0.0 },
            ),
        ),
    ]
}

fn shared_quadrant_junctions(tree: &BpTree) -> Vec<ValidJunction> {
    vec![
        valid_junction(
            tree,
            1,
            2,
            junction_data(
                QuadrantDirection::Ur,
                Point { x: 2.0, y: 3.0 },
                Point { x: 100.0, y: 100.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 3.0 },
            ),
        ),
        valid_junction(
            tree,
            1,
            3,
            junction_data(
                QuadrantDirection::Ur,
                Point { x: 3.0, y: 2.0 },
                Point { x: 100.0, y: 100.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 3.0 },
            ),
        ),
    ]
}

fn overlap(junction: Junction, ox: f64, oy: f64, parent: usize, shift: Option<Point>) -> Overlap {
    Overlap {
        c: junction.c,
        ox,
        oy,
        id: None,
        parent,
        shift,
    }
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

fn prototype() -> Stretch {
    Stretch {
        id: "join".to_string(),
        configuration: None,
        pattern: None,
        repo: None,
    }
}

fn flap(id: NodeId, x: f64, y: f64, width: f64, height: f64) -> Flap {
    Flap {
        id,
        x,
        y,
        width,
        height,
    }
}

fn valid_junction(tree: &BpTree, a: NodeId, b: NodeId, data: ValidJunctionData) -> ValidJunction {
    ValidJunction::new(tree, a, b, data).unwrap()
}

fn junction_data(
    dir: QuadrantDirection,
    o: Point,
    s: Point,
    f: Point,
    tip: Point,
) -> ValidJunctionData {
    ValidJunctionData {
        lca: 0,
        s,
        o,
        f,
        dir,
        tip,
    }
}
