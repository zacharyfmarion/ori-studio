use oristudio_cp::geometry::Point;
use oristudio_cp::operations::measure::{angle_between_three_points, length_between_points};
use oristudio_cp::{
    CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument, OperationId,
    preview_command,
};

#[test]
fn length_between_points_uses_direct_point_distance() {
    assert_eq!(
        length_between_points(Point::new(0.0, 0.0), Point::new(3.0, 4.0)),
        5.0
    );
}

#[test]
fn angle_between_three_points_matches_oriedita_orientation() {
    assert_eq!(
        angle_between_three_points(
            Point::new(1.0, 0.0),
            Point::new(0.0, 0.0),
            Point::new(0.0, 1.0),
        ),
        90.0
    );
    assert_eq!(
        angle_between_three_points(
            Point::new(0.0, 1.0),
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
        ),
        270.0
    );
}

#[test]
fn measure_preview_surfaces_length_and_angle_from_the_kernel() {
    let document = CreasePatternDocument::default();

    let length_preview = preview_command(
        &document,
        CreasePatternCommand::new(OperationId::DisplayLengthBetweenPoints1).with_payload(
            CreasePatternCommandPayload {
                points: vec![Point::new(0.0, 0.0), Point::new(3.0, 4.0)],
                ..Default::default()
            },
        ),
    )
    .expect("length preview");
    assert_eq!(length_preview.measurement, Some(5.0));

    let angle_preview = preview_command(
        &document,
        CreasePatternCommand::new(OperationId::DisplayAngleBetweenThreePoints1).with_payload(
            CreasePatternCommandPayload {
                points: vec![
                    Point::new(1.0, 0.0),
                    Point::new(0.0, 0.0),
                    Point::new(0.0, 1.0),
                ],
                ..Default::default()
            },
        ),
    )
    .expect("angle preview");
    assert_eq!(angle_preview.measurement, Some(90.0));
}
