use crate::error::{BpError, BpResult};
use std::collections::HashSet;
use std::hash::Hash;

pub const SHIFT_INT_DOUBLE_MAP_KEY: usize = 16;
pub const MAX_INT_DOUBLE_MAP_KEY: usize = (1 << SHIFT_INT_DOUBLE_MAP_KEY) - 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntDoubleMapEntry<V> {
    pub key1: usize,
    pub key2: usize,
    pub value: V,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntDoubleMap<V> {
    entries: Vec<IntDoubleMapEntry<V>>,
}

impl<V> Default for IntDoubleMap<V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<V> IntDoubleMap<V> {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    pub fn set(&mut self, key1: usize, key2: usize, value: V) -> BpResult<&mut Self> {
        check_key(key1)?;
        check_key(key2)?;
        let (key1, key2) = ordered_pair(key1, key2);
        if let Some(entry) = self.entries.iter_mut().find(|entry| {
            get_int_double_key(entry.key1, entry.key2) == get_int_double_key(key1, key2)
        }) {
            entry.value = value;
        } else {
            self.entries.push(IntDoubleMapEntry { key1, key2, value });
        }
        Ok(self)
    }

    pub fn has_key(&self, key: usize) -> bool {
        self.entries
            .iter()
            .any(|entry| entry.key1 == key || entry.key2 == key)
    }

    pub fn has(&self, key1: usize, key2: usize) -> bool {
        let key = get_int_double_key(key1, key2);
        self.entries
            .iter()
            .any(|entry| get_int_double_key(entry.key1, entry.key2) == key)
    }

    pub fn get(&self, key1: usize, key2: usize) -> Option<&V> {
        let key = get_int_double_key(key1, key2);
        self.entries
            .iter()
            .find(|entry| get_int_double_key(entry.key1, entry.key2) == key)
            .map(|entry| &entry.value)
    }

    pub fn get_mut(&mut self, key1: usize, key2: usize) -> Option<&mut V> {
        let key = get_int_double_key(key1, key2);
        self.entries
            .iter_mut()
            .find(|entry| get_int_double_key(entry.key1, entry.key2) == key)
            .map(|entry| &mut entry.value)
    }

    pub fn neighbors(&self, key: usize) -> Vec<(usize, &V)> {
        let mut result = Vec::new();
        for entry in &self.entries {
            if entry.key1 == key {
                result.insert(0, (entry.key2, &entry.value));
            } else if entry.key2 == key {
                result.insert(0, (entry.key1, &entry.value));
            }
        }
        result
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn delete(&mut self, key1: usize, key2: usize) -> bool {
        let key = get_int_double_key(key1, key2);
        let old_len = self.entries.len();
        self.entries
            .retain(|entry| get_int_double_key(entry.key1, entry.key2) != key);
        self.entries.len() != old_len
    }

    pub fn delete_key(&mut self, key: usize) -> bool {
        let old_len = self.entries.len();
        self.entries
            .retain(|entry| entry.key1 != key && entry.key2 != key);
        self.entries.len() != old_len
    }

    pub fn entries(&self) -> impl Iterator<Item = (usize, usize, &V)> {
        self.entries
            .iter()
            .map(|entry| (entry.key1, entry.key2, &entry.value))
    }

    pub fn keys(&self) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.entries.iter().map(|entry| (entry.key1, entry.key2))
    }

    pub fn first_keys(&self) -> Vec<usize> {
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        for entry in &self.entries {
            if seen.insert(entry.key1) {
                result.push(entry.key1);
            }
            if entry.key1 != entry.key2 && seen.insert(entry.key2) {
                result.push(entry.key2);
            }
        }
        result
    }

    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.entries.iter().map(|entry| &entry.value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValuedIntDoubleMap<V> {
    map: IntDoubleMap<V>,
}

impl<V> Default for ValuedIntDoubleMap<V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<V> ValuedIntDoubleMap<V> {
    pub fn new() -> Self {
        Self {
            map: IntDoubleMap::new(),
        }
    }

    pub fn inner(&self) -> &IntDoubleMap<V> {
        &self.map
    }

    pub fn inner_mut(&mut self) -> &mut IntDoubleMap<V> {
        &mut self.map
    }

    pub fn set(&mut self, key1: usize, key2: usize, value: V) -> BpResult<&mut Self> {
        self.map.set(key1, key2, value)?;
        Ok(self)
    }

    pub fn has(&self, key1: usize, key2: usize) -> bool {
        self.map.has(key1, key2)
    }

    pub fn get(&self, key1: usize, key2: usize) -> Option<&V> {
        self.map.get(key1, key2)
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn clear(&mut self) {
        self.map.clear();
    }

    pub fn entries(&self) -> impl Iterator<Item = (usize, usize, &V)> {
        self.map.entries()
    }
}

impl<V> ValuedIntDoubleMap<V>
where
    V: Eq,
{
    pub fn has_value(&self, value: &V) -> bool {
        self.map.values().any(|candidate| candidate == value)
    }

    pub fn value_keys(&self, value: &V) -> Vec<(usize, usize)> {
        let mut result = Vec::new();
        for (key1, key2, candidate) in self.map.entries() {
            if candidate == value {
                result.insert(0, (key1, key2));
            }
        }
        result
    }

    pub fn delete_value(&mut self, value: &V) -> bool {
        let old_len = self.map.entries.len();
        self.map.entries.retain(|entry| entry.value != *value);
        self.map.entries.len() != old_len
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoubleMap<K, V> {
    entries: Vec<(K, K, V)>,
}

impl<K, V> Default for DoubleMap<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K, V> DoubleMap<K, V> {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }
}

impl<K, V> DoubleMap<K, V>
where
    K: Clone + Eq + Hash,
{
    pub fn set(&mut self, key1: K, key2: K, value: V) -> &mut Self {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|(a, b, _)| unordered_pair_eq(a, b, &key1, &key2))
        {
            entry.2 = value;
        } else {
            self.entries.push((key1, key2, value));
        }
        self
    }

    pub fn has_key(&self, key: &K) -> bool {
        self.entries
            .iter()
            .any(|(key1, key2, _)| key1 == key || key2 == key)
    }

    pub fn has(&self, key1: &K, key2: &K) -> bool {
        self.entries
            .iter()
            .any(|(a, b, _)| unordered_pair_eq(a, b, key1, key2))
    }

    pub fn get(&self, key1: &K, key2: &K) -> Option<&V> {
        self.entries
            .iter()
            .find(|(a, b, _)| unordered_pair_eq(a, b, key1, key2))
            .map(|(_, _, value)| value)
    }

    pub fn neighbors(&self, key: &K) -> Vec<(K, &V)> {
        let mut result = Vec::new();
        for (key1, key2, value) in &self.entries {
            if key1 == key {
                result.push((key2.clone(), value));
            } else if key2 == key {
                result.push((key1.clone(), value));
            }
        }
        result
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn delete(&mut self, key1: &K, key2: &K) -> bool {
        let old_len = self.entries.len();
        self.entries
            .retain(|(a, b, _)| !unordered_pair_eq(a, b, key1, key2));
        self.entries.len() != old_len
    }

    pub fn delete_key(&mut self, key: &K) -> bool {
        let old_len = self.entries.len();
        self.entries
            .retain(|(key1, key2, _)| key1 != key && key2 != key);
        self.entries.len() != old_len
    }

    pub fn entries(&self) -> impl Iterator<Item = (&K, &K, &V)> {
        self.entries
            .iter()
            .map(|(key1, key2, value)| (key1, key2, value))
    }

    pub fn keys(&self) -> impl Iterator<Item = (&K, &K)> {
        self.entries.iter().map(|(key1, key2, _)| (key1, key2))
    }

    pub fn first_keys(&self) -> Vec<K> {
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        for (key1, key2, _) in &self.entries {
            if seen.insert(key1.clone()) {
                result.push(key1.clone());
            }
            if key1 != key2 && seen.insert(key2.clone()) {
                result.push(key2.clone());
            }
        }
        result
    }
}

pub fn get_int_double_key(key1: usize, key2: usize) -> usize {
    if key1 < key2 {
        get_ordered_int_double_key(key1, key2)
    } else {
        get_ordered_int_double_key(key2, key1)
    }
}

pub fn get_ordered_int_double_key(key1: usize, key2: usize) -> usize {
    (key1 << SHIFT_INT_DOUBLE_MAP_KEY) | key2
}

pub fn get_int_double_pair(key: usize) -> (usize, usize) {
    (
        key >> SHIFT_INT_DOUBLE_MAP_KEY,
        key & MAX_INT_DOUBLE_MAP_KEY,
    )
}

fn check_key(key: usize) -> BpResult<()> {
    if key <= MAX_INT_DOUBLE_MAP_KEY {
        Ok(())
    } else {
        Err(BpError::InvalidInput("Invalid index".to_string()))
    }
}

fn ordered_pair(key1: usize, key2: usize) -> (usize, usize) {
    if key1 < key2 {
        (key1, key2)
    } else {
        (key2, key1)
    }
}

fn unordered_pair_eq<K: Eq>(a: &K, b: &K, key1: &K, key2: &K) -> bool {
    (a == key1 && b == key2) || (a == key2 && b == key1)
}
