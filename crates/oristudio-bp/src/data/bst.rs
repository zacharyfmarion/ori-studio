use std::cmp::Ordering;

type Comparator<K> = Box<dyn Fn(&K, &K) -> Ordering>;

#[derive(Debug, Clone)]
struct AvlNode<K, V> {
    key: K,
    value: V,
    height: i32,
    left: Option<usize>,
    right: Option<usize>,
    alive: bool,
}

pub struct AvlTree<K, V = K> {
    comparator: Comparator<K>,
    nodes: Vec<AvlNode<K, V>>,
    root: Option<usize>,
    last_queried: Option<usize>,
    temp_node: Option<usize>,
}

impl<K, V> AvlTree<K, V>
where
    K: Clone,
    V: Clone,
{
    pub fn new<F>(comparator: F) -> Self
    where
        F: Fn(&K, &K) -> Ordering + 'static,
    {
        Self {
            comparator: Box::new(comparator),
            nodes: Vec::new(),
            root: None,
            last_queried: None,
            temp_node: None,
        }
    }

    pub fn insert(&mut self, key: K, value: V) {
        self.root = Some(self.insert_core(self.root, &key, &value));
        self.last_queried = self.temp_node;
    }

    pub fn delete(&mut self, key: &K) {
        self.root = self.delete_core(self.root, key);
    }

    pub fn pop(&mut self) -> Option<V> {
        let root = self.root?;
        self.root = self.pop_core(root);
        self.temp_node.map(|node| self.nodes[node].value.clone())
    }

    pub fn get(&mut self, key: &K) -> Option<V> {
        let node = self.get_node(key)?;
        Some(self.nodes[node].value.clone())
    }

    pub fn get_prev(&mut self, key: &K) -> Option<V> {
        let node = self.get_node(key)?;
        if let Some(left) = self.nodes[node].left {
            return Some(self.nodes[self.max(left)].value.clone());
        }
        let mut cursor = self.root;
        let mut result = None;
        while let Some(index) = cursor {
            if (self.comparator)(&self.nodes[index].key, &self.nodes[node].key).is_lt() {
                result = Some(index);
                cursor = self.nodes[index].right;
            } else {
                cursor = self.nodes[index].left;
            }
        }
        result.map(|index| self.nodes[index].value.clone())
    }

    pub fn get_next(&mut self, key: &K) -> Option<V> {
        let node = self.get_node(key)?;
        if let Some(right) = self.nodes[node].right {
            return Some(self.nodes[self.min(right)].value.clone());
        }
        let mut cursor = self.root;
        let mut result = None;
        while let Some(index) = cursor {
            if (self.comparator)(&self.nodes[index].key, &self.nodes[node].key).is_gt() {
                result = Some(index);
                cursor = self.nodes[index].left;
            } else {
                cursor = self.nodes[index].right;
            }
        }
        result.map(|index| self.nodes[index].value.clone())
    }

    pub fn is_empty(&self) -> bool {
        self.root.is_none()
    }

    fn insert_core(&mut self, node: Option<usize>, key: &K, value: &V) -> usize {
        let Some(index) = node else {
            let index = self.nodes.len();
            self.nodes.push(AvlNode {
                key: key.clone(),
                value: value.clone(),
                height: 0,
                left: None,
                right: None,
                alive: true,
            });
            self.temp_node = Some(index);
            return index;
        };

        match (self.comparator)(&self.nodes[index].key, key) {
            Ordering::Greater => {
                let left = self.insert_core(self.nodes[index].left, key, value);
                self.nodes[index].left = Some(left);
            }
            Ordering::Less => {
                let right = self.insert_core(self.nodes[index].right, key, value);
                self.nodes[index].right = Some(right);
            }
            Ordering::Equal => {
                self.nodes[index].value = value.clone();
                self.temp_node = Some(index);
                return index;
            }
        }
        self.balance(index)
    }

    fn delete_core(&mut self, node: Option<usize>, key: &K) -> Option<usize> {
        let index = node?;
        match (self.comparator)(&self.nodes[index].key, key) {
            Ordering::Greater => {
                self.nodes[index].left = self.delete_core(self.nodes[index].left, key);
                Some(self.balance(index))
            }
            Ordering::Less => {
                self.nodes[index].right = self.delete_core(self.nodes[index].right, key);
                Some(self.balance(index))
            }
            Ordering::Equal => {
                if self.last_queried == Some(index) {
                    self.last_queried = None;
                }
                let left = self.nodes[index].left;
                let right = self.nodes[index].right;
                self.nodes[index].alive = false;
                match (left, right) {
                    (None, right) => right,
                    (left, None) => left,
                    (Some(left), Some(right)) => {
                        let new_right = self.pop_core(right);
                        let pop = self.temp_node.expect("pop_core selects replacement node");
                        self.nodes[pop].left = Some(left);
                        self.nodes[pop].right = new_right;
                        Some(self.balance(pop))
                    }
                }
            }
        }
    }

    fn pop_core(&mut self, node: usize) -> Option<usize> {
        if self.nodes[node].left.is_none() {
            self.temp_node = Some(node);
            return self.nodes[node].right;
        }
        let left = self.nodes[node].left.expect("left child exists");
        self.nodes[node].left = self.pop_core(left);
        Some(self.balance(node))
    }

    fn balance(&mut self, node: usize) -> usize {
        self.update_height(node);
        let balance = self.height(self.nodes[node].right) - self.height(self.nodes[node].left);
        let mut node = node;
        if balance > 1 {
            let right = self.nodes[node]
                .right
                .expect("right-heavy node has right child");
            if self.height(self.nodes[right].right) <= self.height(self.nodes[right].left) {
                let new_right = self.rotate_right(right);
                self.nodes[node].right = Some(new_right);
            }
            node = self.rotate_left(node);
        } else if balance < -1 {
            let left = self.nodes[node]
                .left
                .expect("left-heavy node has left child");
            if self.height(self.nodes[left].left) <= self.height(self.nodes[left].right) {
                let new_left = self.rotate_left(left);
                self.nodes[node].left = Some(new_left);
            }
            node = self.rotate_right(node);
        }
        node
    }

    fn rotate_right(&mut self, node: usize) -> usize {
        let x = self.nodes[node]
            .left
            .expect("right rotation requires left child");
        self.nodes[node].left = self.nodes[x].right;
        self.nodes[x].right = Some(node);
        self.update_height(node);
        self.update_height(x);
        x
    }

    fn rotate_left(&mut self, node: usize) -> usize {
        let x = self.nodes[node]
            .right
            .expect("left rotation requires right child");
        self.nodes[node].right = self.nodes[x].left;
        self.nodes[x].left = Some(node);
        self.update_height(node);
        self.update_height(x);
        x
    }

    fn update_height(&mut self, node: usize) {
        self.nodes[node].height = 1 + self
            .height(self.nodes[node].left)
            .max(self.height(self.nodes[node].right));
    }

    fn height(&self, node: Option<usize>) -> i32 {
        node.map(|node| self.nodes[node].height).unwrap_or(-1)
    }

    fn get_node(&mut self, key: &K) -> Option<usize> {
        if let Some(last) = self.last_queried
            && self.nodes[last].alive
            && (self.comparator)(&self.nodes[last].key, key).is_eq()
        {
            return Some(last);
        }
        let result = self.get_node_core(key);
        self.last_queried = result;
        result
    }

    fn get_node_core(&self, key: &K) -> Option<usize> {
        let mut cursor = self.root;
        while let Some(index) = cursor {
            match (self.comparator)(&self.nodes[index].key, key) {
                Ordering::Equal => break,
                Ordering::Less => cursor = self.nodes[index].right,
                Ordering::Greater => cursor = self.nodes[index].left,
            }
        }
        cursor
    }

    fn min(&self, mut node: usize) -> usize {
        while let Some(left) = self.nodes[node].left {
            node = left;
        }
        node
    }

    fn max(&self, mut node: usize) -> usize {
        while let Some(right) = self.nodes[node].right {
            node = right;
        }
        node
    }
}

#[derive(Debug, Clone)]
struct Node<K, V> {
    key: K,
    value: V,
    rank: i32,
    parent: Option<usize>,
    left: Option<usize>,
    right: Option<usize>,
    alive: bool,
}

pub struct RavlTree<K, V = K> {
    comparator: Comparator<K>,
    nodes: Vec<Node<K, V>>,
    root: Option<usize>,
    last_queried: Option<usize>,
}

#[derive(Debug, Clone)]
struct RedBlackNode<K, V> {
    key: K,
    value: V,
    is_red: bool,
    parent: Option<usize>,
    left: Option<usize>,
    right: Option<usize>,
    alive: bool,
}

pub struct RedBlackTree<K, V = K> {
    comparator: Comparator<K>,
    nodes: Vec<RedBlackNode<K, V>>,
    root: Option<usize>,
    last_queried: Option<usize>,
}

impl<K, V> RedBlackTree<K, V>
where
    K: Clone,
    V: Clone,
{
    pub fn new<F>(comparator: F) -> Self
    where
        F: Fn(&K, &K) -> Ordering + 'static,
    {
        Self {
            comparator: Box::new(comparator),
            nodes: Vec::new(),
            root: None,
            last_queried: None,
        }
    }

    pub fn insert(&mut self, key: K, value: V) {
        let mut parent = None;
        let mut cursor = self.root;
        let mut compare = Ordering::Equal;
        while let Some(index) = cursor {
            parent = cursor;
            compare = (self.comparator)(&self.nodes[index].key, &key);
            match compare {
                Ordering::Equal => {
                    self.nodes[index].value = value;
                    self.last_queried = Some(index);
                    return;
                }
                Ordering::Less => cursor = self.nodes[index].right,
                Ordering::Greater => cursor = self.nodes[index].left,
            }
        }

        let new_node = self.nodes.len();
        self.nodes.push(RedBlackNode {
            key,
            value,
            is_red: true,
            parent,
            left: None,
            right: None,
            alive: true,
        });
        if let Some(parent) = parent {
            if compare.is_gt() {
                self.nodes[parent].left = Some(new_node);
            } else {
                self.nodes[parent].right = Some(new_node);
            }
        } else {
            self.root = Some(new_node);
        }

        self.fix_insert(new_node);
        self.last_queried = Some(new_node);
    }

    pub fn delete(&mut self, key: &K) {
        let Some(mut node) = self.node_for_delete(key) else {
            return;
        };
        if self.nodes[node].left.is_some() && self.nodes[node].right.is_some() {
            let next = self.min(self.nodes[node].right.expect("right child exists"));
            node = self.replace_key_value(node, next);
        }
        let move_up = self.nodes[node].left.or(self.nodes[node].right);
        let parent = self.nodes[node].parent;
        let deleted_red = self.nodes[node].is_red;
        self.replace_child(parent, Some(node), move_up);
        self.nodes[node].alive = false;
        if self.last_queried == Some(node) {
            self.last_queried = None;
        }
        if !deleted_red {
            self.fix_delete(move_up, parent);
        }
    }

    pub fn get(&mut self, key: &K) -> Option<V> {
        let node = self.get_node(key)?;
        Some(self.nodes[node].value.clone())
    }

    pub fn get_prev(&mut self, key: &K) -> Option<V> {
        let mut node = self.get_node(key)?;
        if let Some(left) = self.nodes[node].left {
            return Some(self.nodes[self.max(left)].value.clone());
        }
        while let Some(parent) = self.nodes[node].parent {
            if self.nodes[parent].left != Some(node) {
                return Some(self.nodes[parent].value.clone());
            }
            node = parent;
        }
        None
    }

    pub fn get_next(&mut self, key: &K) -> Option<V> {
        let mut node = self.get_node(key)?;
        if let Some(right) = self.nodes[node].right {
            return Some(self.nodes[self.min(right)].value.clone());
        }
        while let Some(parent) = self.nodes[node].parent {
            if self.nodes[parent].right != Some(node) {
                return Some(self.nodes[parent].value.clone());
            }
            node = parent;
        }
        None
    }

    pub fn is_empty(&self) -> bool {
        self.root.is_none()
    }

    fn fix_insert(&mut self, node: usize) {
        let Some(mut parent) = self.nodes[node].parent else {
            self.nodes[node].is_red = false;
            return;
        };
        let Some(grandpa) = self.nodes[parent].parent else {
            return;
        };
        if !self.nodes[parent].is_red {
            return;
        }

        let uncle = self.sibling(Some(parent), grandpa);
        if self.is_red(uncle) {
            self.nodes[parent].is_red = false;
            self.nodes[grandpa].is_red = true;
            if let Some(uncle) = uncle {
                self.nodes[uncle].is_red = false;
            }
            self.fix_insert(grandpa);
            return;
        }

        if self.nodes[grandpa].left == Some(parent) {
            if self.nodes[parent].right == Some(node) {
                parent = self.rotate_left(parent);
            }
            self.rotate_right(grandpa);
        } else {
            if self.nodes[parent].left == Some(node) {
                parent = self.rotate_right(parent);
            }
            self.rotate_left(grandpa);
        }
        self.nodes[parent].is_red = false;
        self.nodes[grandpa].is_red = true;
    }

    fn fix_delete(&mut self, node: Option<usize>, parent: Option<usize>) {
        let Some(parent) = parent else {
            return;
        };

        let mut sibling = self.sibling(node, parent);
        if self.is_red(sibling) {
            if let Some(sibling) = sibling {
                self.nodes[sibling].is_red = false;
            }
            self.nodes[parent].is_red = true;
            if self.nodes[parent].left == node {
                self.rotate_left(parent);
            } else {
                self.rotate_right(parent);
            }
            sibling = self.sibling(node, parent);
        }

        let sibling_left = sibling.and_then(|sibling| self.nodes[sibling].left);
        let sibling_right = sibling.and_then(|sibling| self.nodes[sibling].right);
        if !self.is_red(sibling_left) && !self.is_red(sibling_right) {
            if let Some(sibling) = sibling {
                self.nodes[sibling].is_red = true;
            }
            if self.nodes[parent].is_red {
                self.nodes[parent].is_red = false;
            } else {
                self.fix_delete(Some(parent), self.nodes[parent].parent);
            }
            return;
        }

        let is_left = self.nodes[parent].left == node;
        if is_left && !self.is_red(sibling_right) {
            if let Some(left) = sibling_left {
                self.nodes[left].is_red = false;
            }
            if let Some(sibling_node) = sibling {
                self.nodes[sibling_node].is_red = true;
                sibling = Some(self.rotate_right(sibling_node));
            }
        } else if !is_left && !self.is_red(sibling_left) {
            if let Some(right) = sibling_right {
                self.nodes[right].is_red = false;
            }
            if let Some(sibling_node) = sibling {
                self.nodes[sibling_node].is_red = true;
                sibling = Some(self.rotate_left(sibling_node));
            }
        }

        if let Some(sibling) = sibling {
            self.nodes[sibling].is_red = self.nodes[parent].is_red;
            self.nodes[parent].is_red = false;
            if is_left {
                if let Some(right) = self.nodes[sibling].right {
                    self.nodes[right].is_red = false;
                }
                self.rotate_left(parent);
            } else {
                if let Some(left) = self.nodes[sibling].left {
                    self.nodes[left].is_red = false;
                }
                self.rotate_right(parent);
            }
        }
    }

    fn rotate_right(&mut self, node: usize) -> usize {
        let parent = self.nodes[node].parent;
        let x = self.nodes[node]
            .left
            .expect("right rotation requires left child");
        let x_right = self.nodes[x].right;
        self.nodes[node].left = x_right;
        if let Some(child) = x_right {
            self.nodes[child].parent = Some(node);
        }
        self.nodes[x].right = Some(node);
        self.replace_child(parent, Some(node), Some(x));
        self.nodes[node].parent = Some(x);
        x
    }

    fn rotate_left(&mut self, node: usize) -> usize {
        let parent = self.nodes[node].parent;
        let x = self.nodes[node]
            .right
            .expect("left rotation requires right child");
        let x_left = self.nodes[x].left;
        self.nodes[node].right = x_left;
        if let Some(child) = x_left {
            self.nodes[child].parent = Some(node);
        }
        self.nodes[x].left = Some(node);
        self.replace_child(parent, Some(node), Some(x));
        self.nodes[node].parent = Some(x);
        x
    }

    fn replace_child(
        &mut self,
        parent: Option<usize>,
        old_child: Option<usize>,
        new_child: Option<usize>,
    ) {
        if let Some(parent) = parent {
            if self.nodes[parent].left == old_child {
                self.nodes[parent].left = new_child;
            } else {
                self.nodes[parent].right = new_child;
            }
        } else {
            self.root = new_child;
        }
        if let Some(new_child) = new_child {
            self.nodes[new_child].parent = parent;
        }
    }

    fn get_node(&mut self, key: &K) -> Option<usize> {
        if let Some(last) = self.last_queried
            && self.nodes[last].alive
            && (self.comparator)(&self.nodes[last].key, key).is_eq()
        {
            return Some(last);
        }
        let result = self.get_node_core(key);
        self.last_queried = result;
        result
    }

    fn get_node_core(&self, key: &K) -> Option<usize> {
        let mut cursor = self.root;
        while let Some(index) = cursor {
            match (self.comparator)(&self.nodes[index].key, key) {
                Ordering::Equal => break,
                Ordering::Less => cursor = self.nodes[index].right,
                Ordering::Greater => cursor = self.nodes[index].left,
            }
        }
        cursor
    }

    fn node_for_delete(&mut self, key: &K) -> Option<usize> {
        if let Some(last) = self.last_queried
            && self.nodes[last].alive
            && (self.comparator)(&self.nodes[last].key, key).is_eq()
        {
            self.last_queried = None;
            return Some(last);
        }
        self.get_node_core(key)
    }

    fn min(&self, mut node: usize) -> usize {
        while let Some(left) = self.nodes[node].left {
            node = left;
        }
        node
    }

    fn max(&self, mut node: usize) -> usize {
        while let Some(right) = self.nodes[node].right {
            node = right;
        }
        node
    }

    fn replace_key_value(&mut self, node: usize, by: usize) -> usize {
        self.nodes[node].key = self.nodes[by].key.clone();
        self.nodes[node].value = self.nodes[by].value.clone();
        if self.last_queried == Some(by) {
            self.last_queried = Some(node);
        }
        by
    }

    fn sibling(&self, node: Option<usize>, parent: usize) -> Option<usize> {
        if self.nodes[parent].left == node {
            self.nodes[parent].right
        } else {
            self.nodes[parent].left
        }
    }

    fn is_red(&self, node: Option<usize>) -> bool {
        node.map(|node| self.nodes[node].is_red).unwrap_or(false)
    }
}

impl<K, V> RavlTree<K, V>
where
    K: Clone,
    V: Clone,
{
    pub fn new<F>(comparator: F) -> Self
    where
        F: Fn(&K, &K) -> Ordering + 'static,
    {
        Self {
            comparator: Box::new(comparator),
            nodes: Vec::new(),
            root: None,
            last_queried: None,
        }
    }

    pub fn insert(&mut self, key: K, value: V) {
        let mut parent = None;
        let mut cursor = self.root;
        let mut compare = Ordering::Equal;
        while let Some(index) = cursor {
            parent = cursor;
            compare = (self.comparator)(&self.nodes[index].key, &key);
            match compare {
                Ordering::Equal => {
                    self.nodes[index].value = value;
                    self.last_queried = Some(index);
                    return;
                }
                Ordering::Less => cursor = self.nodes[index].right,
                Ordering::Greater => cursor = self.nodes[index].left,
            }
        }

        let new_node = self.nodes.len();
        self.nodes.push(Node {
            key,
            value,
            rank: 0,
            parent,
            left: None,
            right: None,
            alive: true,
        });
        if let Some(parent) = parent {
            if compare.is_gt() {
                self.nodes[parent].left = Some(new_node);
            } else {
                self.nodes[parent].right = Some(new_node);
            }
        } else {
            self.root = Some(new_node);
        }

        self.fix_insert(new_node);
        self.last_queried = Some(new_node);
    }

    pub fn delete(&mut self, key: &K) {
        let Some(mut node) = self.node_for_delete(key) else {
            return;
        };
        if self.nodes[node].left.is_some() && self.nodes[node].right.is_some() {
            let next = self.min(self.nodes[node].right.expect("right child exists"));
            node = self.replace_key_value(node, next);
        }
        let move_up = self.nodes[node].left.or(self.nodes[node].right);
        let parent = self.nodes[node].parent;
        self.replace_child(parent, Some(node), move_up);
        self.nodes[node].alive = false;
        if self.last_queried == Some(node) {
            self.last_queried = None;
        }
    }

    pub fn get(&mut self, key: &K) -> Option<V> {
        let node = self.get_node(key)?;
        Some(self.nodes[node].value.clone())
    }

    pub fn get_prev(&mut self, key: &K) -> Option<V> {
        let mut node = self.get_node(key)?;
        if let Some(left) = self.nodes[node].left {
            let prev = self.max(left);
            return Some(self.nodes[prev].value.clone());
        }
        while let Some(parent) = self.nodes[node].parent {
            if self.nodes[parent].left != Some(node) {
                return Some(self.nodes[parent].value.clone());
            }
            node = parent;
        }
        None
    }

    pub fn get_next(&mut self, key: &K) -> Option<V> {
        let mut node = self.get_node(key)?;
        if let Some(right) = self.nodes[node].right {
            let next = self.min(right);
            return Some(self.nodes[next].value.clone());
        }
        while let Some(parent) = self.nodes[node].parent {
            if self.nodes[parent].right != Some(node) {
                return Some(self.nodes[parent].value.clone());
            }
            node = parent;
        }
        None
    }

    pub fn is_empty(&self) -> bool {
        self.root.is_none()
    }

    fn get_node(&mut self, key: &K) -> Option<usize> {
        if let Some(last) = self.last_queried
            && self.nodes[last].alive
            && (self.comparator)(&self.nodes[last].key, key).is_eq()
        {
            return Some(last);
        }
        let result = self.get_node_core(key);
        self.last_queried = result;
        result
    }

    fn get_node_core(&self, key: &K) -> Option<usize> {
        let mut cursor = self.root;
        while let Some(index) = cursor {
            match (self.comparator)(&self.nodes[index].key, key) {
                Ordering::Equal => break,
                Ordering::Less => cursor = self.nodes[index].right,
                Ordering::Greater => cursor = self.nodes[index].left,
            }
        }
        cursor
    }

    fn node_for_delete(&mut self, key: &K) -> Option<usize> {
        if let Some(last) = self.last_queried
            && self.nodes[last].alive
            && (self.comparator)(&self.nodes[last].key, key).is_eq()
        {
            self.last_queried = None;
            return Some(last);
        }
        self.get_node_core(key)
    }

    fn fix_insert(&mut self, mut x: usize) {
        while let Some(parent) = self.nodes[x].parent {
            if !self.is_01_node(parent) {
                break;
            }
            self.nodes[parent].rank += 1;
            x = parent;
        }

        let Some(y) = self.nodes[x].parent else {
            return;
        };

        if self.nodes[y].left == Some(x) {
            let z = self.nodes[x].right;
            if z.is_none() || self.nodes[x].rank == self.rank(z) + 2 {
                self.rotate_right(y);
            } else if let Some(z) = z {
                self.double_rotate_right(x, y, z);
                self.nodes[z].rank += 1;
                self.nodes[x].rank -= 1;
            }
        } else {
            let z = self.nodes[x].left;
            if z.is_none() || self.nodes[x].rank == self.rank(z) + 2 {
                self.rotate_left(y);
            } else if let Some(z) = z {
                self.double_rotate_left(x, y, z);
                self.nodes[z].rank += 1;
                self.nodes[x].rank -= 1;
            }
        }
        self.nodes[y].rank -= 1;
    }

    fn rotate_right(&mut self, node: usize) -> usize {
        let parent = self.nodes[node].parent;
        let x = self.nodes[node]
            .left
            .expect("right rotation requires left child");
        let x_right = self.nodes[x].right;
        self.nodes[node].left = x_right;
        if let Some(child) = x_right {
            self.nodes[child].parent = Some(node);
        }
        self.nodes[x].right = Some(node);
        self.replace_child(parent, Some(node), Some(x));
        self.nodes[node].parent = Some(x);
        x
    }

    fn rotate_left(&mut self, node: usize) -> usize {
        let parent = self.nodes[node].parent;
        let x = self.nodes[node]
            .right
            .expect("left rotation requires right child");
        let x_left = self.nodes[x].left;
        self.nodes[node].right = x_left;
        if let Some(child) = x_left {
            self.nodes[child].parent = Some(node);
        }
        self.nodes[x].left = Some(node);
        self.replace_child(parent, Some(node), Some(x));
        self.nodes[node].parent = Some(x);
        x
    }

    fn double_rotate_right(&mut self, x: usize, y: usize, z: usize) {
        let parent = self.nodes[y].parent;
        self.replace_child(parent, Some(y), Some(z));

        let z_left = self.nodes[z].left;
        self.nodes[x].right = z_left;
        if let Some(child) = z_left {
            self.nodes[child].parent = Some(x);
        }

        let z_right = self.nodes[z].right;
        self.nodes[y].left = z_right;
        if let Some(child) = z_right {
            self.nodes[child].parent = Some(y);
        }

        self.nodes[z].left = Some(x);
        self.nodes[x].parent = Some(z);
        self.nodes[z].right = Some(y);
        self.nodes[y].parent = Some(z);
    }

    fn double_rotate_left(&mut self, x: usize, y: usize, z: usize) {
        let parent = self.nodes[y].parent;
        self.replace_child(parent, Some(y), Some(z));

        let z_right = self.nodes[z].right;
        self.nodes[x].left = z_right;
        if let Some(child) = z_right {
            self.nodes[child].parent = Some(x);
        }

        let z_left = self.nodes[z].left;
        self.nodes[y].right = z_left;
        if let Some(child) = z_left {
            self.nodes[child].parent = Some(y);
        }

        self.nodes[z].right = Some(x);
        self.nodes[x].parent = Some(z);
        self.nodes[z].left = Some(y);
        self.nodes[y].parent = Some(z);
    }

    fn replace_child(
        &mut self,
        parent: Option<usize>,
        old_child: Option<usize>,
        new_child: Option<usize>,
    ) {
        if let Some(parent) = parent {
            if self.nodes[parent].left == old_child {
                self.nodes[parent].left = new_child;
            } else {
                self.nodes[parent].right = new_child;
            }
        } else {
            self.root = new_child;
        }
        if let Some(new_child) = new_child {
            self.nodes[new_child].parent = parent;
        }
    }

    fn min(&self, mut node: usize) -> usize {
        while let Some(left) = self.nodes[node].left {
            node = left;
        }
        node
    }

    fn max(&self, mut node: usize) -> usize {
        while let Some(right) = self.nodes[node].right {
            node = right;
        }
        node
    }

    fn replace_key_value(&mut self, node: usize, by: usize) -> usize {
        self.nodes[node].key = self.nodes[by].key.clone();
        self.nodes[node].value = self.nodes[by].value.clone();
        if self.last_queried == Some(by) {
            self.last_queried = Some(node);
        }
        by
    }

    fn is_01_node(&self, node: usize) -> bool {
        self.nodes[node].rank == self.rank(self.nodes[node].left)
            && self.nodes[node].rank == self.rank(self.nodes[node].right) + 1
            || self.nodes[node].rank == self.rank(self.nodes[node].right)
                && self.nodes[node].rank == self.rank(self.nodes[node].left) + 1
    }

    fn rank(&self, node: Option<usize>) -> i32 {
        node.map(|node| self.nodes[node].rank).unwrap_or(-1)
    }
}
