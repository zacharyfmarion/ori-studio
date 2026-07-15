use oristudio_bp::shared::{
    Direction, DirectionKey, MAX_SHEET_SIZE, MAX_TREE_HEIGHT, MAX_VERTICES, MIN_DIAG_SIZE,
    MIN_RECT_SIZE, QuadrantDirection, SlashDirection, convert_index, create_array, distinct_sorted,
    foreach_pair, get_first, get_node_id, get_or_insert_empty_array, get_or_set_empty_array,
    get_quadrant, make_per_quadrant, make_quadrant_code, opposite, per_quadrant,
    rotate_left_prefix_to_tail, to_hex,
};
use std::collections::HashMap;

#[test]
fn shared_constants_match_upstream_limits() {
    assert_eq!(MAX_SHEET_SIZE, 8192);
    assert_eq!(MAX_TREE_HEIGHT, 11586);
    assert_eq!(MIN_RECT_SIZE, 4);
    assert_eq!(MIN_DIAG_SIZE, 6);
    assert_eq!(MAX_VERTICES, 65535);
}

#[test]
fn direction_values_and_quadrant_codes_match_upstream_encoding() {
    assert_eq!(Direction::Ur as u8, 0);
    assert_eq!(Direction::Ul as u8, 1);
    assert_eq!(Direction::Ll as u8, 2);
    assert_eq!(Direction::Lr as u8, 3);
    assert_eq!(Direction::R as u8, 4);
    assert_eq!(Direction::T as u8, 5);
    assert_eq!(Direction::L as u8, 6);
    assert_eq!(Direction::B as u8, 7);
    assert_eq!(Direction::None as u8, 8);
    assert_eq!(SlashDirection::Fw as u8, 0);
    assert_eq!(SlashDirection::Bw as u8, 1);
    assert_eq!(DirectionKey::Up, DirectionKey::Up);

    assert_eq!(opposite(QuadrantDirection::Ur), QuadrantDirection::Ll);
    assert_eq!(opposite(QuadrantDirection::Ul), QuadrantDirection::Lr);
    assert_eq!(opposite(QuadrantDirection::Ll), QuadrantDirection::Ur);
    assert_eq!(opposite(QuadrantDirection::Lr), QuadrantDirection::Ul);

    let code = make_quadrant_code(17, QuadrantDirection::Ll);
    assert_eq!(code, 70);
    assert_eq!(get_node_id(code), 17);
    assert_eq!(get_quadrant(code), QuadrantDirection::Ll);

    assert_eq!(per_quadrant([0, 1, 2, 3]), [0, 1, 2, 3]);
    assert_eq!(make_per_quadrant(|q| q as u8), [0, 1, 2, 3]);
}

#[test]
fn shared_array_and_map_helpers_match_upstream_behaviors() {
    assert_eq!(create_array(3, -1), vec![-1, -1, -1]);

    let mut pairs = Vec::new();
    foreach_pair(&[1, 2, 3, 4], |a, b| pairs.push((*a, *b)));
    assert_eq!(pairs, vec![(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)]);

    assert_eq!(distinct_sorted(&[1, 1, 2, 2, 1]), vec![1, 2, 1]);

    let mut values = vec![1, 2, 3, 4];
    rotate_left_prefix_to_tail(&mut values, 2);
    assert_eq!(values, vec![3, 4, 1, 2]);
    rotate_left_prefix_to_tail(&mut values, 99);
    assert_eq!(values, vec![3, 4, 1, 2]);

    let mut map: HashMap<&str, Vec<i32>> = HashMap::new();
    get_or_set_empty_array(&mut map, "a", |arr| arr.push(1)).push(2);
    get_or_insert_empty_array(&mut map, "a").push(3);
    assert_eq!(map.get("a"), Some(&vec![1, 2, 3]));
}

#[test]
fn shared_scalar_helpers_match_upstream_behaviors() {
    assert_eq!(to_hex(0), "#000000");
    assert_eq!(to_hex(0x12ab), "#0012ab");
    assert_eq!(to_hex(0x1234567), "#1234567");
    assert_eq!(convert_index(0), -1);
    assert_eq!(convert_index(-4), 3);
    assert_eq!(get_first([4, 5, 6]), Some(4));
}
