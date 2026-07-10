use crate::error::{BpError, BpResult};
use std::collections::HashMap;
use std::hash::Hash;

#[derive(Debug, Clone)]
pub struct UnionFind<T> {
    elements: Vec<T>,
    map: HashMap<T, usize>,
    parent: Vec<Option<usize>>,
    size: Vec<usize>,
    capacity: usize,
}

impl<T> UnionFind<T>
where
    T: Clone + Eq + Hash,
{
    pub fn new(capacity: usize) -> Self {
        Self {
            elements: Vec::with_capacity(capacity),
            map: HashMap::with_capacity(capacity),
            parent: vec![None; capacity],
            size: vec![1; capacity],
            capacity,
        }
    }

    pub fn add(&mut self, element: T) -> BpResult<usize> {
        if let Some(index) = self.map.get(&element) {
            return Ok(*index);
        }
        if self.elements.len() >= self.capacity {
            return Err(BpError::InvalidInput(
                "union-find capacity exceeded".to_string(),
            ));
        }
        let index = self.elements.len();
        self.map.insert(element.clone(), index);
        self.elements.push(element);
        Ok(index)
    }

    pub fn union(&mut self, a: T, b: T) -> BpResult<()> {
        let a = self.add(a)?;
        let b = self.add(b)?;
        let i = self.find_index(a)?;
        let j = self.find_index(b)?;
        if i == j {
            return Ok(());
        }
        if self.size[i] < self.size[j] {
            self.point_to(i, j);
        } else {
            self.point_to(j, i);
        }
        Ok(())
    }

    pub fn find(&mut self, element: &T) -> Option<usize> {
        let index = *self.map.get(element)?;
        self.find_index(index).ok()
    }

    pub fn len(&self) -> usize {
        self.elements.len()
    }

    pub fn is_empty(&self) -> bool {
        self.elements.is_empty()
    }

    fn point_to(&mut self, i: usize, j: usize) {
        self.parent[i] = Some(j);
        self.size[j] += self.size[i];
    }

    fn find_index(&mut self, cursor: usize) -> BpResult<usize> {
        let Some(parent) = self.parent[cursor] else {
            return Ok(cursor);
        };
        let result = self.find_index(parent)?;
        self.parent[cursor] = Some(result);
        Ok(result)
    }
}

#[derive(Debug, Clone)]
pub struct ListUnionFind<T> {
    union_find: UnionFind<T>,
    first_child: Vec<Option<usize>>,
    next_sibling: Vec<Option<usize>>,
}

impl<T> ListUnionFind<T>
where
    T: Clone + Eq + Hash,
{
    pub fn new(capacity: usize) -> Self {
        Self {
            union_find: UnionFind::new(capacity),
            first_child: vec![None; capacity],
            next_sibling: vec![None; capacity],
        }
    }

    pub fn add(&mut self, element: T) -> BpResult<usize> {
        self.union_find.add(element)
    }

    pub fn union(&mut self, a: T, b: T) -> BpResult<()> {
        let a = self.union_find.add(a)?;
        let b = self.union_find.add(b)?;
        let i = self.union_find.find_index(a)?;
        let j = self.union_find.find_index(b)?;
        if i == j {
            return Ok(());
        }
        if self.union_find.size[i] < self.union_find.size[j] {
            self.point_to(i, j);
        } else {
            self.point_to(j, i);
        }
        Ok(())
    }

    pub fn list(&self) -> Vec<Vec<T>> {
        let mut result = Vec::new();
        for index in 0..self.union_find.elements.len() {
            if self.union_find.parent[index].is_none() {
                let mut set = Vec::new();
                self.collect(index, &mut set);
                result.push(set);
            }
        }
        result
    }

    pub fn len(&self) -> usize {
        self.union_find.len()
    }

    pub fn is_empty(&self) -> bool {
        self.union_find.is_empty()
    }

    fn point_to(&mut self, i: usize, j: usize) {
        self.union_find.point_to(i, j);
        self.next_sibling[i] = self.first_child[j];
        self.first_child[j] = Some(i);
    }

    fn collect(&self, index: usize, result: &mut Vec<T>) {
        result.push(self.union_find.elements[index].clone());
        let mut cursor = self.first_child[index];
        while let Some(child) = cursor {
            self.collect(child, result);
            cursor = self.next_sibling[child];
        }
    }
}
