use crate::data::HeapSet;
use crate::engine::EngineState;
use crate::error::BpResult;
use std::cmp::Ordering;
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone)]
pub struct TaskSpec {
    name: &'static str,
    priority: usize,
    dependants: Vec<TaskSpec>,
}

impl TaskSpec {
    pub fn new(name: &'static str, dependants: Vec<TaskSpec>) -> Self {
        let priority = dependants
            .iter()
            .map(|task| task.priority)
            .max()
            .map(|priority| priority + 1)
            .unwrap_or(0);
        Self {
            name,
            priority,
            dependants,
        }
    }

    pub fn leaf(name: &'static str) -> Self {
        Self::new(name, Vec::new())
    }

    pub fn name(&self) -> &'static str {
        self.name
    }

    pub fn priority(&self) -> usize {
        self.priority
    }

    pub fn dependants(&self) -> &[TaskSpec] {
        &self.dependants
    }
}

impl PartialEq for TaskSpec {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name
    }
}

impl Eq for TaskSpec {}

impl Hash for TaskSpec {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.name.hash(state);
    }
}

#[derive(Debug, Clone, Default)]
pub struct Processor;

impl Processor {
    pub fn run<F>(
        state: &mut EngineState,
        tasks: impl IntoIterator<Item = TaskSpec>,
        mut action: F,
    ) -> BpResult<()>
    where
        F: FnMut(&TaskSpec, &mut EngineState) -> BpResult<()>,
    {
        let mut task_heap = HeapSet::new(task_order);
        queue(&mut task_heap, tasks);
        while let Some(task) = task_heap.pop() {
            action(&task, state)?;
            queue(&mut task_heap, task.dependants.clone());
        }
        state.reset();
        Ok(())
    }
}

fn queue(heap: &mut HeapSet<TaskSpec>, tasks: impl IntoIterator<Item = TaskSpec>) {
    for task in tasks {
        heap.insert(task);
    }
}

fn task_order(a: &TaskSpec, b: &TaskSpec) -> Ordering {
    b.priority.cmp(&a.priority)
}
