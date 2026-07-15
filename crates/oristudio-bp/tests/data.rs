use oristudio_bp::data::{
    AvlTree, BinaryHeap, DiffDoubleSet, DiffSet, HeapSet, IntDoubleMap, ListUnionFind,
    MAX_INT_DOUBLE_MAP_KEY, MutableHeap, RavlTree, RedBlackTree, TernaryHeap, ValuedIntDoubleMap,
    get_int_double_pair, min_ordering,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct Point {
    x: i32,
    y: i32,
}

fn point_order(a: &Point, b: &Point) -> std::cmp::Ordering {
    a.x.cmp(&b.x).then_with(|| a.y.cmp(&b.y))
}

#[test]
fn binary_heap_pops_by_comparator() {
    let mut heap = BinaryHeap::new(min_ordering::<i32>);
    heap.insert(3);
    heap.insert(1);
    heap.insert(2);
    assert_eq!(heap.peek(), Some(&1));
    assert_eq!(heap.peek_second(), Some(&2));
    assert_eq!(heap.pop(), Some(1));
    assert_eq!(heap.pop(), Some(2));
    assert_eq!(heap.pop(), Some(3));
    assert_eq!(heap.pop(), None);
}

#[test]
fn ternary_heap_pops_by_comparator() {
    let mut heap = TernaryHeap::new(min_ordering::<i32>);
    for value in [9, 2, 7, 1, 3] {
        heap.insert(value);
    }
    assert_eq!(heap.peek(), Some(&1));
    assert_eq!(heap.pop(), Some(1));
    assert_eq!(heap.pop(), Some(2));
}

#[test]
fn heap_set_checks_repeated_elements() {
    let mut heap = HeapSet::new(point_order);
    let p1 = Point { x: 1, y: 2 };
    let p2 = Point { x: 0, y: 3 };
    heap.insert(p1);
    heap.insert(p2);
    heap.insert(p1);
    assert!(heap.has(&p1));
    assert_eq!(heap.len(), 2);
    assert_eq!(heap.pop(), Some(p2));
    assert_eq!(heap.pop(), Some(p1));
    assert_eq!(heap.pop(), None);
}

#[test]
fn mutable_heap_ignores_values_not_in_heap() {
    let mut heap = MutableHeap::new(point_order);
    heap.notify_update(&Point { x: 0, y: 0 });
}

#[test]
fn mutable_heap_removes_and_updates_present_values() {
    let mut heap = MutableHeap::new(min_ordering::<i32>);
    heap.insert(3);
    heap.insert(1);
    heap.insert(2);
    heap.remove(&1);
    heap.notify_update(&3);
    assert_eq!(heap.pop(), Some(2));
    assert_eq!(heap.pop(), Some(3));
}

#[test]
fn int_double_map_stores_symmetric_number_indices() {
    let mut map = IntDoubleMap::new();
    map.set(1, 2, "a").unwrap();
    assert_eq!(map.len(), 1);
    assert_eq!(map.keys().count(), 1);
    assert_eq!(map.first_keys().len(), 2);
    assert!(map.has(1, 2));
    assert!(map.has(2, 1));
    assert_eq!(map.get(2, 1), Some(&"a"));
    assert_eq!(map.entries().collect::<Vec<_>>(), vec![(1, 2, &"a")]);

    let mut seen = String::new();
    for (key1, key2, value) in map.entries() {
        seen.push_str(value);
        seen.push_str(&key1.to_string());
        seen.push_str(&key2.to_string());
    }
    assert_eq!(seen, "a12");

    map.set(2, 2, "b").unwrap();
    assert!(map.has_key(2));
    map.set(2, 1, "c").unwrap();
    map.set(2, 3, "d").unwrap();
    assert_eq!(map.keys().count(), 3);

    map.delete(2, 2);
    map.delete(1, 2);
    map.delete(3, 2);
    assert!(!map.has_key(1));
    assert_eq!(map.len(), 0);
}

#[test]
fn int_double_map_checks_index_validity() {
    let mut map = IntDoubleMap::new();
    assert_eq!(MAX_INT_DOUBLE_MAP_KEY, 65_535);
    assert!(map.set(MAX_INT_DOUBLE_MAP_KEY + 1, 0, 0).is_err());
    assert_eq!(map.len(), 0);
    map.set(MAX_INT_DOUBLE_MAP_KEY, 0, 1).unwrap();
    assert_eq!(map.get(0, MAX_INT_DOUBLE_MAP_KEY), Some(&1));
}

#[test]
fn int_double_map_can_navigate_single_index() {
    let mut map = IntDoubleMap::new();
    map.set(1, 2, "a").unwrap();
    map.set(2, 3, "b").unwrap();
    map.set(3, 4, "c").unwrap();
    map.set(5, 5, "d").unwrap();
    assert_eq!(map.len(), 4);

    let sub = map.neighbors(2);
    assert_eq!(sub.len(), 2);
    assert_eq!(
        sub.iter().find(|(key, _)| *key == 1).map(|(_, v)| **v),
        Some("a")
    );
    assert_eq!(
        sub.iter().find(|(key, _)| *key == 3).map(|(_, v)| **v),
        Some("b")
    );

    map.delete_key(3);
    assert!(!map.has_key(4));
    assert_eq!(map.len(), 2);

    assert_eq!(map.neighbors(5).len(), 1);
    map.delete_key(5);
    assert!(!map.has_key(5));
    assert_eq!(map.len(), 1);
}

#[test]
fn valued_int_double_map_can_lookup_values() {
    let mut map = ValuedIntDoubleMap::new();
    let value = "a";
    let other = "other";
    map.set(1, 2, value).unwrap();
    map.set(2, 3, value).unwrap();
    map.set(1, 3, other).unwrap();

    assert!(map.has_value(&value));
    assert!(map.has_value(&other));
    assert!(!map.has_value(&"test"));
    assert_eq!(map.value_keys(&value).len(), 2);

    map.set(2, 3, other).unwrap();
    assert_eq!(map.value_keys(&value).len(), 1);
    assert_eq!(map.value_keys(&other).len(), 2);
}

#[test]
fn valued_int_double_map_can_delete_by_value() {
    let mut map = ValuedIntDoubleMap::new();
    let value = "a";
    map.set(1, 2, value).unwrap();
    map.set(2, 3, value).unwrap();
    map.set(2, 2, value).unwrap();
    map.set(2, 2, value).unwrap();
    map.set(1, 3, "else").unwrap();

    assert_eq!(map.len(), 4);
    assert!(map.delete_value(&value));
    assert!(!map.has_value(&value));
    assert_eq!(map.len(), 1);
    assert!(!map.delete_value(&value));
    assert!(map.value_keys(&value).is_empty());
}

#[test]
fn valued_int_double_map_can_clear_everything() {
    let mut map = ValuedIntDoubleMap::new();
    let value = "a";
    map.set(1, 2, value).unwrap();
    assert_eq!(map.len(), 1);

    map.clear();
    assert_eq!(map.len(), 0);
    assert!(!map.has(1, 2));
}

#[test]
fn diff_set_lists_values_missing_since_last_round() {
    let mut diff = DiffSet::new();
    diff.add("a");
    diff.add("b");
    assert!(diff.diff().is_empty());
    diff.add("b");
    assert_eq!(diff.diff(), vec!["a"]);
}

#[test]
fn diff_double_set_lists_missing_pairs_since_last_round() {
    let mut diff = DiffDoubleSet::new();
    diff.add(1, 3);
    diff.add(2, 4);
    assert!(diff.diff().is_empty());
    diff.add(4, 2);
    assert_eq!(diff.diff(), vec![(1, 3)]);
}

#[test]
fn union_find_reuses_existing_indices_and_unions_sets() {
    let mut uf = ListUnionFind::new(4);
    assert_eq!(uf.add("a").unwrap(), 0);
    assert_eq!(uf.add("a").unwrap(), 0);
    uf.union("a", "b").unwrap();
    uf.union("c", "d").unwrap();
    uf.union("b", "c").unwrap();
    assert_eq!(uf.len(), 4);
    assert_eq!(uf.list().len(), 1);
}

#[test]
fn union_find_reports_capacity_errors() {
    let mut uf = ListUnionFind::new(1);
    uf.add("a").unwrap();
    assert!(uf.add("b").is_err());
}

#[test]
fn int_double_map_key_helpers_match_upstream_encoding() {
    let key = oristudio_bp::data::get_int_double_key(7, 3);
    assert_eq!(get_int_double_pair(key), (3, 7));
}

#[test]
fn ravl_tree_can_be_used_as_tree_map() {
    let mut tree: RavlTree<i32> = RavlTree::new(min_ordering::<i32>);
    tree.insert(1, 2);
    assert_eq!(tree.get(&1), Some(2));
}

#[test]
fn ravl_tree_can_query_emptiness() {
    let mut tree: RavlTree<i32> = RavlTree::new(min_ordering::<i32>);
    assert!(tree.is_empty());
    tree.insert(12, 12);
    assert!(!tree.is_empty());
}

#[test]
fn ravl_tree_ignores_deleting_non_existing_element() {
    let mut tree: RavlTree<i32> = RavlTree::new(min_ordering::<i32>);
    tree.delete(&1);
}

#[test]
fn ravl_tree_can_query_adjacent_elements_after_deletions() {
    let mut tree: RavlTree<i32> = RavlTree::new(min_ordering::<i32>);
    let mut set = std::collections::BTreeSet::new();
    let mut seed = 123_456_789_u64;
    for _ in 0..300 {
        seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        set.insert(((seed / 65_536) % 10_000) as i32);
    }
    let original = set.iter().copied().collect::<Vec<_>>();

    let mut removed = std::collections::BTreeSet::new();
    for i in 0..50 {
        let index = (i * 37 + 11) % original.len();
        let value = original[index];
        removed.insert(value);
        set.remove(&value);
    }

    let sorted = set.iter().copied().collect::<Vec<_>>();
    for value in original {
        tree.insert(value, value);
    }
    for value in removed {
        tree.delete(&value);
    }

    for index in [0, 1, 7, 13, 27, 59, 91, 127, 181, sorted.len() - 1] {
        let value = sorted[index];
        let prev = index.checked_sub(1).map(|i| sorted[i]);
        let next = sorted.get(index + 1).copied();
        assert_eq!(tree.get_prev(&value), prev);
        assert_eq!(tree.get_next(&value), next);
    }
}

#[test]
fn avl_tree_can_be_used_as_tree_map() {
    let mut tree: AvlTree<i32> = AvlTree::new(min_ordering::<i32>);
    tree.insert(1, 2);
    assert_eq!(tree.get(&1), Some(2));
}

#[test]
fn avl_tree_can_pop_minimum_value() {
    let mut tree: AvlTree<i32> = AvlTree::new(min_ordering::<i32>);
    tree.insert(3, 30);
    tree.insert(1, 10);
    tree.insert(2, 20);
    assert_eq!(tree.pop(), Some(10));
    assert_eq!(tree.pop(), Some(20));
    assert_eq!(tree.pop(), Some(30));
    assert_eq!(tree.pop(), None);
}

#[test]
fn avl_tree_can_query_adjacent_elements_after_deletions() {
    let mut tree: AvlTree<i32> = AvlTree::new(min_ordering::<i32>);
    for value in [5, 1, 9, 3, 7, 11, 2, 4, 6, 8, 10] {
        tree.insert(value, value);
    }
    tree.delete(&5);
    tree.delete(&1);
    tree.delete(&11);

    assert_eq!(tree.get_prev(&6), Some(4));
    assert_eq!(tree.get_next(&6), Some(7));
    assert_eq!(tree.get_prev(&2), None);
    assert_eq!(tree.get_next(&10), None);
}

#[test]
fn avl_tree_queries_emptiness_and_ignores_missing_deletes() {
    let mut tree: AvlTree<i32> = AvlTree::new(min_ordering::<i32>);
    assert!(tree.is_empty());
    tree.delete(&10);
    tree.insert(10, 10);
    assert!(!tree.is_empty());
}

#[test]
fn red_black_tree_can_be_used_as_tree_map() {
    let mut tree: RedBlackTree<i32> = RedBlackTree::new(min_ordering::<i32>);
    tree.insert(1, 2);
    assert_eq!(tree.get(&1), Some(2));
}

#[test]
fn red_black_tree_can_query_adjacent_elements_after_deletions() {
    let mut tree: RedBlackTree<i32> = RedBlackTree::new(min_ordering::<i32>);
    for value in [5, 1, 9, 3, 7, 11, 2, 4, 6, 8, 10] {
        tree.insert(value, value);
    }
    tree.delete(&5);
    tree.delete(&1);
    tree.delete(&11);

    assert_eq!(tree.get_prev(&6), Some(4));
    assert_eq!(tree.get_next(&6), Some(7));
    assert_eq!(tree.get_prev(&2), None);
    assert_eq!(tree.get_next(&10), None);
}

#[test]
fn red_black_tree_queries_emptiness_and_ignores_missing_deletes() {
    let mut tree: RedBlackTree<i32> = RedBlackTree::new(min_ordering::<i32>);
    assert!(tree.is_empty());
    tree.delete(&10);
    tree.insert(10, 10);
    assert!(!tree.is_empty());
}

#[test]
fn red_black_tree_updates_duplicate_keys() {
    let mut tree: RedBlackTree<i32> = RedBlackTree::new(min_ordering::<i32>);
    tree.insert(3, 30);
    tree.insert(3, 300);
    assert_eq!(tree.get(&3), Some(300));
    tree.delete(&3);
    assert_eq!(tree.get(&3), None);
}
