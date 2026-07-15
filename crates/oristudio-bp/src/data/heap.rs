use std::cmp::Ordering;
use std::collections::HashSet;
use std::hash::Hash;

type Comparator<T> = Box<dyn Fn(&T, &T) -> Ordering>;

pub fn min_ordering<T: Ord>(a: &T, b: &T) -> Ordering {
    a.cmp(b)
}

pub struct BinaryHeap<T> {
    data: Vec<T>,
    comparator: Comparator<T>,
}

impl<T> BinaryHeap<T> {
    pub fn new<F>(comparator: F) -> Self
    where
        F: Fn(&T, &T) -> Ordering + 'static,
    {
        Self {
            data: Vec::new(),
            comparator: Box::new(comparator),
        }
    }

    pub fn insert(&mut self, value: T) {
        self.data.push(value);
        self.move_backward(self.data.len());
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn pop(&mut self) -> Option<T> {
        if self.data.is_empty() {
            return None;
        }
        let result = self.data.swap_remove(0);
        if !self.data.is_empty() {
            self.move_forward(1);
        }
        Some(result)
    }

    pub fn peek(&self) -> Option<&T> {
        self.data.first()
    }

    pub fn peek_second(&self) -> Option<&T> {
        if self.data.len() <= 1 {
            return None;
        }
        let mut index = 2;
        if self.should_swap(index, 3) {
            index = 3;
        }
        self.data.get(index - 1)
    }

    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.data.iter()
    }

    fn move_forward(&mut self, mut index: usize) -> bool {
        let mut result = false;
        loop {
            let mut child = index << 1;
            if self.should_swap(child, child + 1) {
                child += 1;
            }
            if !self.try_swap(index, child) {
                break;
            }
            index = child;
            result = true;
        }
        result
    }

    fn move_backward(&mut self, mut index: usize) -> bool {
        let mut result = false;
        loop {
            let parent = index >> 1;
            if parent == 0 || !self.try_swap(parent, index) {
                break;
            }
            index = parent;
            result = true;
        }
        result
    }

    fn should_swap(&self, a: usize, b: usize) -> bool {
        let a = a.checked_sub(1);
        let b = b.checked_sub(1);
        match (
            a.and_then(|i| self.data.get(i)),
            b.and_then(|i| self.data.get(i)),
        ) {
            (Some(a), Some(b)) => (self.comparator)(a, b).is_gt(),
            _ => false,
        }
    }

    fn try_swap(&mut self, a: usize, b: usize) -> bool {
        if !self.should_swap(a, b) {
            return false;
        }
        self.data.swap(a - 1, b - 1);
        true
    }
}

impl<T> IntoIterator for BinaryHeap<T> {
    type IntoIter = std::vec::IntoIter<T>;
    type Item = T;

    fn into_iter(self) -> Self::IntoIter {
        self.data.into_iter()
    }
}

pub struct TernaryHeap<T> {
    data: Vec<T>,
    comparator: Comparator<T>,
}

impl<T> TernaryHeap<T> {
    pub fn new<F>(comparator: F) -> Self
    where
        F: Fn(&T, &T) -> Ordering + 'static,
    {
        Self {
            data: Vec::new(),
            comparator: Box::new(comparator),
        }
    }

    pub fn insert(&mut self, value: T) {
        self.data.push(value);
        self.move_backward(self.data.len() - 1);
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn pop(&mut self) -> Option<T> {
        if self.data.is_empty() {
            return None;
        }
        let result = self.data.swap_remove(0);
        if !self.data.is_empty() {
            self.move_forward(0);
        }
        Some(result)
    }

    pub fn peek(&self) -> Option<&T> {
        self.data.first()
    }

    pub fn peek_second(&self) -> Option<&T> {
        if self.data.len() <= 1 {
            return None;
        }
        let mut index = 1;
        if self.should_swap(index, 2) {
            index = 2;
        }
        if self.should_swap(index, 3) {
            index = 3;
        }
        self.data.get(index)
    }

    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.data.iter()
    }

    fn move_forward(&mut self, index: usize) {
        let mut cursor = index * 3 + 1;
        let mut child = cursor;
        cursor += 1;
        if self.should_swap(child, cursor) {
            child = cursor;
        }
        cursor += 1;
        if self.should_swap(child, cursor) {
            child = cursor;
        }
        if self.try_swap(index, child) {
            self.move_forward(child);
        }
    }

    fn move_backward(&mut self, index: usize) {
        if index == 0 {
            return;
        }
        let parent = (index - 1) / 3;
        if self.try_swap(parent, index) {
            self.move_backward(parent);
        }
    }

    fn should_swap(&self, a: usize, b: usize) -> bool {
        match (self.data.get(a), self.data.get(b)) {
            (Some(a), Some(b)) => (self.comparator)(a, b).is_gt(),
            _ => false,
        }
    }

    fn try_swap(&mut self, a: usize, b: usize) -> bool {
        if !self.should_swap(a, b) {
            return false;
        }
        self.data.swap(a, b);
        true
    }
}

pub struct HeapSet<T>
where
    T: Clone + Eq + Hash,
{
    heap: BinaryHeap<T>,
    set: HashSet<T>,
}

impl<T> HeapSet<T>
where
    T: Clone + Eq + Hash,
{
    pub fn new<F>(comparator: F) -> Self
    where
        F: Fn(&T, &T) -> Ordering + 'static,
    {
        Self {
            heap: BinaryHeap::new(comparator),
            set: HashSet::new(),
        }
    }

    pub fn insert(&mut self, value: T) {
        if self.set.insert(value.clone()) {
            self.heap.insert(value);
        }
    }

    pub fn has(&self, value: &T) -> bool {
        self.set.contains(value)
    }

    pub fn is_empty(&self) -> bool {
        self.heap.is_empty()
    }

    pub fn len(&self) -> usize {
        self.heap.len()
    }

    pub fn pop(&mut self) -> Option<T> {
        let result = self.heap.pop()?;
        self.set.remove(&result);
        Some(result)
    }

    pub fn peek(&self) -> Option<&T> {
        self.heap.peek()
    }
}

pub struct MutableHeap<T>
where
    T: Clone + Eq,
{
    data: Vec<T>,
    comparator: Comparator<T>,
}

impl<T> MutableHeap<T>
where
    T: Clone + Eq,
{
    pub fn new<F>(comparator: F) -> Self
    where
        F: Fn(&T, &T) -> Ordering + 'static,
    {
        Self {
            data: Vec::new(),
            comparator: Box::new(comparator),
        }
    }

    pub fn insert(&mut self, value: T) {
        self.data.push(value);
        self.move_backward(self.data.len());
    }

    pub fn remove(&mut self, value: &T) {
        let Some(index) = self.index_of(value) else {
            return;
        };
        let last = self.data.pop().expect("non-empty mutable heap");
        if index == self.data.len() {
            return;
        }
        self.data[index] = last;
        self.move_forward(index + 1);
    }

    pub fn notify_update(&mut self, value: &T) {
        let Some(index) = self.index_of(value) else {
            return;
        };
        let heap_index = index + 1;
        if !self.move_backward(heap_index) {
            self.move_forward(heap_index);
        }
    }

    pub fn pop(&mut self) -> Option<T> {
        if self.data.is_empty() {
            return None;
        }
        let result = self.data.swap_remove(0);
        if !self.data.is_empty() {
            self.move_forward(1);
        }
        Some(result)
    }

    pub fn peek(&self) -> Option<&T> {
        self.data.first()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    fn index_of(&self, value: &T) -> Option<usize> {
        self.data.iter().position(|candidate| candidate == value)
    }

    fn move_forward(&mut self, mut index: usize) -> bool {
        let mut result = false;
        loop {
            let mut child = index << 1;
            if self.should_swap(child, child + 1) {
                child += 1;
            }
            if !self.try_swap(index, child) {
                break;
            }
            index = child;
            result = true;
        }
        result
    }

    fn move_backward(&mut self, mut index: usize) -> bool {
        let mut result = false;
        loop {
            let parent = index >> 1;
            if parent == 0 || !self.try_swap(parent, index) {
                break;
            }
            index = parent;
            result = true;
        }
        result
    }

    fn should_swap(&self, a: usize, b: usize) -> bool {
        let a = a.checked_sub(1);
        let b = b.checked_sub(1);
        match (
            a.and_then(|i| self.data.get(i)),
            b.and_then(|i| self.data.get(i)),
        ) {
            (Some(a), Some(b)) => (self.comparator)(a, b).is_gt(),
            _ => false,
        }
    }

    fn try_swap(&mut self, a: usize, b: usize) -> bool {
        if !self.should_swap(a, b) {
            return false;
        }
        self.data.swap(a - 1, b - 1);
        true
    }
}
