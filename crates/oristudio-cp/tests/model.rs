use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{ActiveState, Circle, LineColor, LineSegment, Point, RgbColor};
use oristudio_cp::model::{
    CreasePatternModel, CustomLineType, GridMetadata, GridState, LineId, LineSegmentSaveData,
    TextElement, custom_color_from_hex, custom_color_hex, fold_angle_for_line_color,
    fold_assignment_for_line_color, line_color_for_fold_assignment,
};
use treemaker_fold::Assignment;

#[test]
fn custom_line_type_matches_oriedita_numbers_and_colors() {
    assert_eq!(CustomLineType::Any.number(), -1);
    assert_eq!(CustomLineType::Any.number_for_line_color(), 0);
    assert_eq!(CustomLineType::Aux.number_for_line_color(), 3);
    assert_eq!(CustomLineType::Mountain.line_color(), LineColor::Red1);
    assert_eq!(CustomLineType::Valley.line_color(), LineColor::Blue2);
    assert!(CustomLineType::MountainAndValley.matches(LineColor::Red1));
    assert!(CustomLineType::MountainAndValley.matches(LineColor::Blue2));
    assert!(!CustomLineType::MountainAndValley.matches(LineColor::Black0));
    assert_eq!(CustomLineType::from_number(4), Ok(CustomLineType::Aux));
    assert!(CustomLineType::from_number(99).is_err());
}

#[test]
fn grid_metadata_preserves_oriedita_defaults_and_clamps() {
    let mut grid = GridMetadata::default();
    assert_eq!(grid.grid_size, 8);
    assert_eq!(grid.interval_grid_size, 4);
    assert_eq!(grid.base_state, GridState::WithinPaper);
    assert_eq!(grid.determine_grid_x_length(), 1.0);
    assert_eq!(grid.determine_grid_y_length(), 1.0);

    grid.set_grid_size(-10);
    grid.set_interval_grid_size(0);
    assert_eq!(grid.grid_size, 1);
    assert_eq!(grid.interval_grid_size, 1);

    grid.set_grid_angle(-100.0);
    assert_eq!(grid.grid_angle, 1.0);
    grid.set_grid_angle(200.0);
    assert_eq!(grid.grid_angle, 179.0);

    grid.apply_grid_x(-1.0, 0.0, 1.0);
    assert_eq!(grid.determine_grid_x_length(), 1.0);
    grid.apply_grid_y(2.0, 3.0, 4.0);
    assert_eq!(grid.determine_grid_y_length(), 8.0);

    assert_eq!(GridState::Hidden.advance(), GridState::WithinPaper);
    assert_eq!(GridState::Full.advance(), GridState::Hidden);
    assert_eq!(GridState::from_state(2), Ok(GridState::Full));
}

#[test]
fn editable_model_keeps_oriedita_one_based_line_access() {
    let mut model = CreasePatternModel::default();
    assert_eq!(
        model.add_line(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Black0
        ),
        LineId(1)
    );
    assert_eq!(
        model.add_line_with_active(
            Point::new(0.0, 1.0),
            Point::new(1.0, 1.0),
            LineColor::Red1,
            ActiveState::ActiveBoth3,
        ),
        LineId(2)
    );

    assert_eq!(model.total(), 2);
    assert!(model.get_one_based(0).is_none());
    assert_eq!(
        model.get_one_based(1).map(|segment| segment.color),
        Some(LineColor::Black0)
    );

    model
        .set_color_one_based(1, LineColor::Blue2)
        .expect("line exists");
    assert_eq!(
        model.get_one_based(1).map(|segment| segment.color),
        Some(LineColor::Blue2)
    );
    assert!(model.set_color_one_based(99, LineColor::Red1).is_err());

    assert_eq!(
        model.delete_line_one_based(1).map(|segment| segment.color),
        Some(LineColor::Blue2)
    );
    assert_eq!(
        model.get_one_based(1).map(|segment| segment.color),
        Some(LineColor::Red1)
    );
}

#[test]
fn save_data_and_selection_helpers_match_base_save_behavior() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(
        LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0)
            .with_line_color(LineColor::Red1)
            .with_selected(2),
    );
    model.add_line_segment(
        LineSegment::from_coordinates(0.0, 1.0, 1.0, 1.0)
            .with_line_color(LineColor::Cyan3)
            .with_selected(2),
    );
    model.add_aux_line_segment(LineSegment::from_coordinates(2.0, 0.0, 3.0, 0.0));
    model.add_circle(Circle::new(5.0, 5.0, 2.0, LineColor::Magenta5));
    model.add_point(Point::new(9.0, 9.0));
    model.add_text(TextElement::new(1.0, 2.0, "note"));

    assert!(!model.is_selection_empty());
    assert_eq!(model.fold_line_total_for_select_folding(), 1);
    assert!(!model.can_save_as_cp());

    let selected_save = model.save_for_select_folding();
    assert_eq!(selected_save.line_segments.len(), 1);
    assert_eq!(selected_save.line_segments[0].color, LineColor::Red1);

    let save = model.to_save(Some("stage3".to_string()));
    assert!(!save.can_save_as_cp());
    assert_eq!(save.title.as_deref(), Some("stage3"));

    let mut target = CreasePatternModel::default();
    assert_eq!(target.set_save(&save).as_deref(), Some("stage3"));
    target.set_aux_save(&save);
    assert_eq!(target.line_segments.len(), 2);
    assert_eq!(target.aux_line_segments.len(), 1);

    let mut appended = CreasePatternModel::default();
    appended.add_save(&save);
    assert_eq!(appended.points, vec![Point::new(9.0, 9.0)]);
    assert_eq!(appended.texts[0].text, "note");
}

#[test]
fn fold_assignment_and_custom_color_mapping_match_oriedita_exporters() {
    assert_eq!(
        fold_assignment_for_line_color(LineColor::Black0),
        Assignment::Boundary
    );
    assert_eq!(
        fold_assignment_for_line_color(LineColor::Red1),
        Assignment::Mountain
    );
    assert_eq!(
        fold_assignment_for_line_color(LineColor::Blue2),
        Assignment::Valley
    );
    assert_eq!(
        fold_assignment_for_line_color(LineColor::Cyan3),
        Assignment::Flat
    );
    assert_eq!(
        fold_assignment_for_line_color(LineColor::Purple8),
        Assignment::Flat
    );
    assert_eq!(
        fold_assignment_for_line_color(LineColor::None),
        Assignment::Unassigned
    );
    assert_eq!(
        line_color_for_fold_assignment(Assignment::Flat),
        LineColor::Cyan3
    );
    assert_eq!(
        line_color_for_fold_assignment(Assignment::Unassigned),
        LineColor::None
    );
    assert_eq!(
        line_color_for_fold_assignment(Assignment::Mountain),
        LineColor::Red1
    );
    assert_eq!(fold_angle_for_line_color(LineColor::Blue2), 180.0);
    assert_eq!(fold_angle_for_line_color(LineColor::Red1), -180.0);
    assert_eq!(fold_angle_for_line_color(LineColor::Black0), 0.0);

    let color = RgbColor::new(100, 200, 200);
    assert_eq!(custom_color_hex(color), "64c8c8");
    assert_eq!(custom_color_from_hex("64c8c8"), Ok(color));
    assert!(custom_color_from_hex("bad").is_err());
}

#[test]
fn canonical_comparison_sorts_semantic_elements_and_quantizes_coordinates() {
    let mut first = CreasePatternModel::default();
    first.add_line(
        Point::new(1.0, 0.0),
        Point::new(0.0, 0.0),
        LineColor::Black0,
    );
    first.add_line(Point::new(0.0, 2.0), Point::new(1.0, 2.0), LineColor::Red1);
    first.add_text(TextElement::new(5.0, 5.0, "b"));
    first.add_text(TextElement::new(1.0, 1.0, "a"));

    let mut second = CreasePatternModel::default();
    second.add_text(TextElement::new(1.0 + 0.0004, 1.0, "a"));
    second.add_line(Point::new(1.0, 2.0), Point::new(0.0, 2.0), LineColor::Red1);
    second.add_text(TextElement::new(5.0, 5.0 + 0.0004, "b"));
    second.add_line(
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Black0,
    );

    assert_eq!(first.canonical(0.001), second.canonical(0.001));

    let document = CreasePatternDocument {
        title: Some("doc".to_string()),
        crease_pattern: first,
        ..CreasePatternDocument::default()
    };
    assert_eq!(document.canonical(0.001).title.as_deref(), Some("doc"));
}

#[test]
fn save_data_default_matches_empty_oriedita_base_save_collections() {
    let save = LineSegmentSaveData::default();
    assert!(save.line_segments.is_empty());
    assert!(save.circles.is_empty());
    assert!(save.aux_line_segments.is_empty());
    assert!(save.points.is_empty());
    assert!(save.texts.is_empty());
    assert!(save.can_save_as_cp());
}

/// The `.osf` project file stores a `CreasePatternDocument` snapshot verbatim,
/// so fold magnitudes ride inside it with no `.osf` schema change. This pins
/// that: if the document stops round-tripping, `.osf` silently loses angles.
#[test]
fn document_snapshot_round_trips_fold_magnitudes() {
    use oristudio_cp::CreasePatternDocument;
    use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment};

    let ninety = FoldMagnitude::from_degrees(90.0).expect("in range");
    let mut document = CreasePatternDocument::default();
    document.crease_pattern.line_segments.push(
        LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0)
            .with_line_color(LineColor::Red1)
            .with_fold_magnitude(Some(ninety)),
    );
    document
        .crease_pattern
        .line_segments
        .push(LineSegment::from_coordinates(0.0, 0.0, 0.0, 1.0).with_line_color(LineColor::Blue2));

    let json = serde_json::to_string(&document).expect("serialise");
    let restored: CreasePatternDocument = serde_json::from_str(&json).expect("deserialise");
    assert_eq!(restored, document);
    assert_eq!(
        restored.crease_pattern.line_segments[0].fold_magnitude,
        Some(ninety)
    );
    assert_eq!(
        restored.crease_pattern.line_segments[1].fold_magnitude,
        None
    );

    // The classic crease must not have leaked a key into the snapshot.
    assert_eq!(json.matches("fold_magnitude").count(), 1);
}

/// Lattice points are built as `origin + a*i + b*j`, and `b` comes out of a
/// `cos`/`sin` pair — so a 90-degree grid's points carry the same ~1e-15 dust
/// upstream's do. Compare them the way every consumer does.
#[track_caller]
fn assert_lattice_point(found: Point, expected: Point) {
    assert!(
        (found.x - expected.x).abs() < 1e-9 && (found.y - expected.y).abs() < 1e-9,
        "expected lattice point {expected:?}, got {found:?}"
    );
}

/// Oriedita `Grid.closestGridPoint` (`Grid.java:543`). The default paper is
/// 400 wide, so grid size 8 puts lattice points on every multiple of 50.
#[test]
fn closest_grid_point_finds_the_nearest_lattice_point() {
    let grid = GridMetadata::default();

    assert_lattice_point(
        grid.closest_grid_point(Point::new(52.0, 47.0), GridState::WithinPaper),
        Point::new(50.0, 50.0),
    );
    // Exactly on a lattice point stays put, including the lattice origin.
    assert_lattice_point(
        grid.closest_grid_point(Point::new(-200.0, 200.0), GridState::WithinPaper),
        Point::new(-200.0, 200.0),
    );
    // Dead centre of a cell is equidistant from four corners; upstream keeps the
    // last one it scans rather than reporting no answer.
    let centred = grid.closest_grid_point(Point::new(25.0, 25.0), GridState::WithinPaper);
    let corners = [
        Point::new(0.0, 0.0),
        Point::new(50.0, 0.0),
        Point::new(0.0, 50.0),
        Point::new(50.0, 50.0),
    ];
    assert!(
        corners.iter().any(|corner| corner.distance(centred) < 1e-9),
        "{centred:?}"
    );
}

#[test]
fn closest_grid_point_honours_the_base_state() {
    let grid = GridMetadata::default();
    let outside = Point::new(260.0, 10.0);

    // Hidden: no candidates at all, so the caller sees upstream's origin
    // fallback and rejects it on distance.
    assert_eq!(
        grid.closest_grid_point(outside, GridState::Hidden),
        Point::new(0.0, 0.0)
    );
    // Within paper: the lattice stops at the paper edge.
    assert_lattice_point(
        grid.closest_grid_point(outside, GridState::WithinPaper),
        Point::new(200.0, 0.0),
    );
    // Full: it keeps going.
    assert_lattice_point(
        grid.closest_grid_point(outside, GridState::Full),
        Point::new(250.0, 0.0),
    );
}

/// Upstream's `new Point()` fallback: outside the paper by more than a cell
/// diagonal, a within-paper grid answers with the origin rather than with a
/// nearest point. Callers gate on their selection distance, which is what keeps
/// that harmless.
#[test]
fn closest_grid_point_far_outside_a_within_paper_grid_falls_back_to_the_origin() {
    let grid = GridMetadata::default();
    assert_eq!(
        grid.closest_grid_point(Point::new(1_000.0, 1_000.0), GridState::WithinPaper),
        Point::new(0.0, 0.0)
    );
}

/// Oriedita `Grid.resetGrid`: a within-paper grid whose cell is not the unit
/// square is promoted to full-area, so its lattice runs past the paper.
#[test]
fn a_non_square_cell_promotes_a_within_paper_grid_to_full() {
    let mut grid = GridMetadata::default();
    grid.set_grid_angle(60.0);
    assert_eq!(
        grid.effective_base_state(GridState::WithinPaper),
        GridState::Full
    );

    let mut stretched = GridMetadata::default();
    stretched.apply_grid_x(2.0, 0.0, 1.0);
    assert_eq!(
        stretched.effective_base_state(GridState::WithinPaper),
        GridState::Full
    );
    assert_eq!(
        stretched.effective_base_state(GridState::Hidden),
        GridState::Hidden
    );

    // The plain square grid keeps its paper bound.
    assert_eq!(
        GridMetadata::default().effective_base_state(GridState::WithinPaper),
        GridState::WithinPaper
    );
}

/// A rhombic grid: `b` is rotated by the configured angle, which Oriedita
/// stores negated (`Grid.setGrid`), and `a` stays on the x axis.
#[test]
fn closest_grid_point_follows_a_rotated_cell() {
    let mut grid = GridMetadata::default();
    grid.set_grid_size(4); // 100-unit cells
    grid.set_grid_angle(60.0);

    // Lattice point (1, 1): origin + a + b, where a = (100, 0) and
    // b = 100 * (cos -60deg, sin -60deg).
    let radians = (-60.0_f64).to_radians();
    let expected = Point::new(
        -200.0 + 100.0 + 100.0 * radians.cos(),
        200.0 + 100.0 * radians.sin(),
    );
    assert_lattice_point(
        grid.closest_grid_point(
            Point::new(expected.x + 3.0, expected.y - 2.0),
            GridState::WithinPaper,
        ),
        expected,
    );
}

/// A one-cell grid still has the paper corners as lattice points, and a huge
/// one still resolves in constant time because the search window is the cell.
#[test]
fn closest_grid_point_handles_extreme_grid_sizes() {
    let mut coarse = GridMetadata::default();
    coarse.set_grid_size(1);
    assert_lattice_point(
        coarse.closest_grid_point(Point::new(150.0, 150.0), GridState::WithinPaper),
        Point::new(200.0, 200.0),
    );

    let mut fine = GridMetadata::default();
    fine.set_grid_size(512);
    let cell = 400.0 / 512.0;
    assert_lattice_point(
        fine.closest_grid_point(
            Point::new(cell * 3.4 - 200.0, 200.0 - cell * 2.6),
            GridState::WithinPaper,
        ),
        Point::new(cell * 3.0 - 200.0, 200.0 - cell * 3.0),
    );
}

/// A degenerate cell has no lattice to search. Upstream cannot store one
/// (`GridModel` validates the lengths and clamps the angle), so this is about a
/// file that carries one anyway, not about parity.
#[test]
fn closest_grid_point_refuses_a_degenerate_cell() {
    let zero_size = GridMetadata {
        grid_size: 0,
        ..GridMetadata::default()
    };
    assert_eq!(
        zero_size.closest_grid_point(Point::new(10.0, 10.0), GridState::Full),
        Point::new(0.0, 0.0)
    );

    let zero_length = GridMetadata {
        grid_xa: 0.0,
        grid_xb: 0.0,
        ..GridMetadata::default()
    };
    assert_eq!(
        zero_length.closest_grid_point(Point::new(10.0, 10.0), GridState::Full),
        Point::new(0.0, 0.0)
    );
}

#[test]
fn closest_grid_point_survives_a_non_finite_pointer() {
    let grid = GridMetadata::default();
    assert_eq!(
        grid.closest_grid_point(Point::new(f64::INFINITY, 0.0), GridState::Full),
        Point::new(0.0, 0.0)
    );
    assert_eq!(
        grid.closest_grid_point(Point::new(f64::NAN, f64::NAN), GridState::Full),
        Point::new(0.0, 0.0)
    );
}
