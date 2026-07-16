use crate::data::double_map::{get_int_double_key, get_int_double_pair};
use std::collections::HashSet;
use std::hash::Hash;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffSet<T> {
    old_set: Vec<T>,
    new_set: Vec<T>,
}

impl<T> Default for DiffSet<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> DiffSet<T> {
    pub fn new() -> Self {
        Self {
            old_set: Vec::new(),
            new_set: Vec::new(),
        }
    }
}

impl<T> DiffSet<T>
where
    T: Clone + Eq + Hash,
{
    pub fn add(&mut self, value: T) {
        if !self.new_set.contains(&value) {
            self.new_set.push(value.clone());
        }
        self.old_set.retain(|old| old != &value);
    }

    pub fn diff(&mut self) -> Vec<T> {
        let result = self.old_set.clone();
        self.old_set = self.new_set.clone();
        self.new_set.clear();
        result
    }

    pub fn clear(&mut self) {
        self.old_set.clear();
        self.new_set.clear();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffDoubleSet {
    old_set: Vec<usize>,
    new_set: Vec<usize>,
}

impl Default for DiffDoubleSet {
    fn default() -> Self {
        Self::new()
    }
}

impl DiffDoubleSet {
    pub fn new() -> Self {
        Self {
            old_set: Vec::new(),
            new_set: Vec::new(),
        }
    }

    pub fn add(&mut self, a: usize, b: usize) {
        let key = get_int_double_key(a, b);
        if !self.new_set.contains(&key) {
            self.new_set.push(key);
        }
        self.old_set.retain(|old| *old != key);
    }

    pub fn diff(&mut self) -> Vec<(usize, usize)> {
        let result = self
            .old_set
            .iter()
            .map(|key| get_int_double_pair(*key))
            .collect();
        self.old_set = self.new_set.clone();
        self.new_set.clear();
        result
    }

    pub fn clear(&mut self) {
        self.old_set.clear();
        self.new_set.clear();
    }
}

pub fn unique_in_order<T>(values: impl IntoIterator<Item = T>) -> Vec<T>
where
    T: Clone + Eq + Hash,
{
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for value in values {
        if seen.insert(value.clone()) {
            result.push(value);
        }
    }
    result
}
