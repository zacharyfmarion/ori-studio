use crate::model::NodeId;
use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::hash::Hash;

pub const MAX_SHEET_SIZE: usize = 8192;
pub const MAX_TREE_HEIGHT: usize = 11586;
pub const MIN_RECT_SIZE: usize = 4;
pub const MIN_DIAG_SIZE: usize = 6;
pub const MAX_VERTICES: usize = 65535;

pub const QUADRANT_NUMBER: usize = 4;
pub const PREVIOUS_QUADRANT_OFFSET: usize = 3;
pub const NEXT_QUADRANT_OFFSET: usize = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Direction {
    Ur = 0,
    Ul = 1,
    Ll = 2,
    Lr = 3,
    R = 4,
    T = 5,
    L = 6,
    B = 7,
    None = 8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum QuadrantDirection {
    Ur = 0,
    Ul = 1,
    Ll = 2,
    Lr = 3,
}

impl From<QuadrantDirection> for Direction {
    fn from(value: QuadrantDirection) -> Self {
        match value {
            QuadrantDirection::Ur => Direction::Ur,
            QuadrantDirection::Ul => Direction::Ul,
            QuadrantDirection::Ll => Direction::Ll,
            QuadrantDirection::Lr => Direction::Lr,
        }
    }
}

pub fn per_quadrant<T>(args: [T; QUADRANT_NUMBER]) -> [T; QUADRANT_NUMBER] {
    args
}

pub fn make_per_quadrant<T>(mut factory: impl FnMut(QuadrantDirection) -> T) -> [T; 4] {
    [
        factory(QuadrantDirection::Ur),
        factory(QuadrantDirection::Ul),
        factory(QuadrantDirection::Ll),
        factory(QuadrantDirection::Lr),
    ]
}

pub fn opposite(direction: QuadrantDirection) -> QuadrantDirection {
    match direction {
        QuadrantDirection::Ur => QuadrantDirection::Ll,
        QuadrantDirection::Ul => QuadrantDirection::Lr,
        QuadrantDirection::Ll => QuadrantDirection::Ur,
        QuadrantDirection::Lr => QuadrantDirection::Ul,
    }
}

pub type QuadrantCode = u32;

const QUADRANT_MASK: QuadrantCode = 3;

pub fn get_node_id(code: QuadrantCode) -> NodeId {
    code >> 2
}

pub fn get_quadrant(code: QuadrantCode) -> QuadrantDirection {
    match code & QUADRANT_MASK {
        0 => QuadrantDirection::Ur,
        1 => QuadrantDirection::Ul,
        2 => QuadrantDirection::Ll,
        _ => QuadrantDirection::Lr,
    }
}

pub fn make_quadrant_code(id: NodeId, q: QuadrantDirection) -> QuadrantCode {
    (id << 2) | q as QuadrantCode
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SlashDirection {
    Fw = 0,
    Bw = 1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectionKey {
    Up,
    Down,
    Left,
    Right,
}

pub fn create_array<T: Clone>(length: usize, value: T) -> Vec<T> {
    vec![value; length]
}

pub fn foreach_pair<T>(array: &[T], mut action: impl FnMut(&T, &T)) {
    for i in 0..array.len() {
        for j in i + 1..array.len() {
            action(&array[i], &array[j]);
        }
    }
}

pub fn distinct_sorted<T: PartialEq + Clone>(array: &[T]) -> Vec<T> {
    let mut result = Vec::new();
    for item in array {
        if result.last() != Some(item) {
            result.push(item.clone());
        }
    }
    result
}

pub fn rotate_left_prefix_to_tail<T>(array: &mut Vec<T>, j: usize) -> &mut Vec<T> {
    let amount = j.min(array.len());
    array.rotate_left(amount);
    array
}

pub fn to_hex(color: u32) -> String {
    format!("#{color:06x}")
}

pub fn get_or_set_empty_array<K, V>(
    map: &mut HashMap<K, Vec<V>>,
    key: K,
    callback: impl FnOnce(&mut Vec<V>),
) -> &mut Vec<V>
where
    K: Eq + Hash,
{
    match map.entry(key) {
        Entry::Occupied(entry) => entry.into_mut(),
        Entry::Vacant(entry) => {
            let value = entry.insert(Vec::new());
            callback(value);
            value
        }
    }
}

pub fn get_or_insert_empty_array<K, V>(map: &mut HashMap<K, Vec<V>>, key: K) -> &mut Vec<V>
where
    K: Eq + Hash,
{
    get_or_set_empty_array(map, key, |_| {})
}

pub fn convert_index(code: i64) -> i64 {
    -code - 1
}

pub fn get_first<T, I>(set_like: I) -> Option<T>
where
    I: IntoIterator<Item = T>,
{
    set_like.into_iter().next()
}
