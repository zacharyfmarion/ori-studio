use oristudio_bp::math::gops::{JsonGadget, JsonOverlap, JsonPiece, JsonPoint, generate, rank};
use oristudio_bp::math::kamiya::kamiya_half_integral;

#[test]
fn gops_rejects_odd_by_odd_overlaps() {
    assert!(generate(3, 5, f64::INFINITY).is_empty());
}

#[test]
fn gops_generates_ranked_integral_pieces() {
    let pieces = generate(2, 2, f64::INFINITY);
    assert_eq!(pieces.len(), 2);
    assert_eq!(pieces[0], JsonPiece::new(2.0, 2.0, 1.0, 2.0));
    assert_eq!(pieces[1], JsonPiece::new(2.0, 2.0, 2.0, 1.0));
    assert_eq!(rank(&pieces[0]), 3);
}

#[test]
fn gops_filters_by_span() {
    let pieces = generate(2, 2, 4.0);
    assert!(pieces.is_empty());
    let pieces = generate(2, 2, 5.0);
    assert_eq!(pieces.len(), 2);
}

#[test]
fn gadget_reverse_gps_reverses_two_piece_detours_and_shift() {
    let mut p1 = JsonPiece::new(3.0, 3.0, 1.0, 2.0);
    p1.detours = Some(vec![vec![
        JsonPoint::new(0.0, 0.0),
        JsonPoint::new(1.0, 1.0),
    ]]);
    let p2 = JsonPiece::new(3.0, 3.0, 2.0, 1.0);
    let reversed = JsonGadget::new(vec![p1, p2]).reverse_gps();
    assert_eq!(reversed.pieces[0].shift.unwrap().x, 0.0);
    assert_eq!(reversed.pieces[0].detours.as_ref().unwrap()[0][0].x, 6.0);
}

#[test]
fn kamiya_half_integral_rejects_even_dimensions() {
    assert!(kamiya_half_integral(&JsonOverlap { ox: 4, oy: 5 }, 100.0).is_empty());
}

#[test]
fn kamiya_half_integral_generates_slacked_gadget_pairs() {
    let gadgets = kamiya_half_integral(&JsonOverlap { ox: 3, oy: 5 }, 100.0);
    assert!(!gadgets.is_empty());
    assert_eq!(gadgets.len() % 2, 0);
    assert!(gadgets.iter().all(|g| g.pieces.len() == 2));
    assert_eq!(
        gadgets[0].anchors.as_ref().unwrap()[2]
            .as_ref()
            .unwrap()
            .slack,
        Some(0.5)
    );
    assert_eq!(
        gadgets[1].anchors.as_ref().unwrap()[0]
            .as_ref()
            .unwrap()
            .slack,
        Some(0.5)
    );
}
