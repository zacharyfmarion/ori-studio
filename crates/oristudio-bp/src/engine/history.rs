use crate::error::{BpError, BpResult};
use crate::model::{DesignMode, Edit, History, HistoryStep, Memento, NodeId, Point};
use serde::de::{self, Deserializer};
use serde::ser::{SerializeMap, Serializer};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const MAX_STEP: usize = 30;
pub const AUTO_RESET_MS: u64 = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CommandType {
    Field = 0,
    Move = 1,
    Edit = 2,
}

impl TryFrom<u8> for CommandType {
    type Error = BpError;

    fn try_from(value: u8) -> BpResult<Self> {
        match value {
            0 => Ok(Self::Field),
            1 => Ok(Self::Move),
            2 => Ok(Self::Edit),
            _ => Err(BpError::InvalidInput(format!(
                "unknown BP history command type {value}"
            ))),
        }
    }
}

impl From<CommandType> for u8 {
    fn from(value: CommandType) -> Self {
        value as u8
    }
}

impl Serialize for CommandType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8((*self).into())
    }
}

impl<'de> Deserialize<'de> for CommandType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u8::deserialize(deserializer)?;
        Self::try_from(value).map_err(de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum HistoryCommand {
    Field {
        tag: String,
        prop: String,
        old: Value,
        new: Value,
    },
    Move {
        tag: String,
        old: Point,
        new: Point,
    },
    Edit {
        tag: String,
        old: NodeId,
        new: NodeId,
        edits: Vec<Edit>,
    },
}

impl HistoryCommand {
    pub fn field(tag: impl Into<String>, prop: impl Into<String>, old: Value, new: Value) -> Self {
        Self::Field {
            tag: tag.into(),
            prop: prop.into(),
            old,
            new,
        }
    }

    pub fn move_command(tag: impl Into<String>, old: Point, new: Point) -> Self {
        Self::Move {
            tag: tag.into(),
            old,
            new,
        }
    }

    pub fn edit(edits: Vec<Edit>, old: NodeId, new: NodeId) -> Self {
        Self::Edit {
            tag: "tree".to_string(),
            old,
            new,
            edits,
        }
    }

    pub fn command_type(&self) -> CommandType {
        match self {
            Self::Field { .. } => CommandType::Field,
            Self::Move { .. } => CommandType::Move,
            Self::Edit { .. } => CommandType::Edit,
        }
    }

    pub fn tag(&self) -> &str {
        match self {
            Self::Field { tag, .. } | Self::Move { tag, .. } | Self::Edit { tag, .. } => tag,
        }
    }

    pub fn signature(&self) -> String {
        format!("{}:{}", u8::from(self.command_type()), self.tag())
    }

    pub fn is_void(&self) -> bool {
        match self {
            Self::Field { old, new, .. } => old == new,
            Self::Move { old, new, .. } => old == new,
            Self::Edit { .. } => false,
        }
    }

    pub fn can_add_to(&self, command: &HistoryCommand, is_dragging: bool) -> bool {
        match (self, command) {
            (
                Self::Field { tag, prop, old, .. },
                Self::Field {
                    tag: command_tag,
                    prop: command_prop,
                    new: command_new,
                    ..
                },
            ) => tag == command_tag && prop == command_prop && command_new == old,
            (
                Self::Move { tag, old, new },
                Self::Move {
                    tag: command_tag,
                    old: command_old,
                    new: command_new,
                },
            ) => {
                if tag != command_tag {
                    return false;
                }
                if is_dragging {
                    return true;
                }
                command_new == old
                    && (new.x - old.x) * (command_new.x - command_old.x) >= 0.0
                    && (new.y - old.y) * (command_new.y - command_old.y) >= 0.0
            }
            _ => false,
        }
    }

    pub fn add_to(&self, command: &mut HistoryCommand) {
        match (self, command) {
            (
                Self::Field { new, .. },
                Self::Field {
                    new: command_new, ..
                },
            ) => {
                *command_new = new.clone();
            }
            (
                Self::Move { new, .. },
                Self::Move {
                    new: command_new, ..
                },
            ) => {
                *command_new = *new;
            }
            _ => {}
        }
    }
}

impl Serialize for HistoryCommand {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("type", &self.command_type())?;
        map.serialize_entry("tag", self.tag())?;
        match self {
            Self::Field { prop, old, new, .. } => {
                map.serialize_entry("prop", prop)?;
                map.serialize_entry("old", old)?;
                map.serialize_entry("new", new)?;
            }
            Self::Move { old, new, .. } => {
                map.serialize_entry("old", old)?;
                map.serialize_entry("new", new)?;
            }
            Self::Edit {
                old, new, edits, ..
            } => {
                map.serialize_entry("old", old)?;
                map.serialize_entry("new", new)?;
                map.serialize_entry("edits", edits)?;
            }
        }
        map.end()
    }
}

impl<'de> Deserialize<'de> for HistoryCommand {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let mut object = Map::<String, Value>::deserialize(deserializer)?;
        let command_type = object
            .remove("type")
            .and_then(|value| value.as_u64().map(|value| value as u8))
            .ok_or_else(|| de::Error::custom("history command is missing numeric type"))?;
        let tag = take_string(&mut object, "tag").map_err(de::Error::custom)?;
        match CommandType::try_from(command_type).map_err(de::Error::custom)? {
            CommandType::Field => Ok(Self::Field {
                tag,
                prop: take_string(&mut object, "prop").map_err(de::Error::custom)?,
                old: object.remove("old").unwrap_or(Value::Null),
                new: object.remove("new").unwrap_or(Value::Null),
            }),
            CommandType::Move => Ok(Self::Move {
                tag,
                old: take_value(&mut object, "old").map_err(de::Error::custom)?,
                new: take_value(&mut object, "new").map_err(de::Error::custom)?,
            }),
            CommandType::Edit => Ok(Self::Edit {
                tag,
                old: take_value(&mut object, "old").map_err(de::Error::custom)?,
                new: take_value(&mut object, "new").map_err(de::Error::custom)?,
                edits: take_value(&mut object, "edits").map_err(de::Error::custom)?,
            }),
        }
    }
}

pub fn command_signature(commands: &[HistoryCommand]) -> String {
    let mut signatures = commands
        .iter()
        .map(HistoryCommand::signature)
        .collect::<Vec<_>>();
    signatures.sort();
    signatures.join(";")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationResult {
    Failed,
    Partial,
    Success,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StepRecord {
    pub commands: Vec<HistoryCommand>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub construct: Vec<Memento>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub destruct: Vec<Memento>,
    pub mode: DesignMode,
    pub before: Vec<String>,
    pub after: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    sealed: bool,
    signature: String,
    commands: Vec<HistoryCommand>,
    construct: Vec<Memento>,
    destruct: Vec<Memento>,
    mode: DesignMode,
    before: Vec<String>,
    after: Vec<String>,
}

impl Step {
    pub fn new(record: StepRecord) -> Self {
        let signature = command_signature(&record.commands);
        Self {
            sealed: false,
            signature,
            commands: record.commands,
            construct: record.construct,
            destruct: record.destruct,
            mode: record.mode,
            before: record.before,
            after: record.after,
        }
    }

    pub fn restore(record: StepRecord) -> Self {
        Self::new(record)
    }

    pub fn to_record(&self) -> StepRecord {
        StepRecord {
            commands: self.commands.clone(),
            construct: self.construct.clone(),
            destruct: self.destruct.clone(),
            mode: self.mode,
            before: self.before.clone(),
            after: self.after.clone(),
        }
    }

    pub fn to_model(&self) -> BpResult<HistoryStep> {
        Ok(HistoryStep {
            commands: self
                .commands
                .iter()
                .map(serde_json::to_value)
                .collect::<Result<Vec<_>, _>>()?,
            construct: (!self.construct.is_empty()).then(|| self.construct.clone()),
            destruct: (!self.destruct.is_empty()).then(|| self.destruct.clone()),
            mode: self.mode,
            before: self.before.clone(),
            after: self.after.clone(),
        })
    }

    pub fn commands(&self) -> &[HistoryCommand] {
        &self.commands
    }

    pub fn construct(&self) -> &[Memento] {
        &self.construct
    }

    pub fn destruct(&self) -> &[Memento] {
        &self.destruct
    }

    pub fn mode(&self) -> DesignMode {
        self.mode
    }

    pub fn before(&self) -> &[String] {
        &self.before
    }

    pub fn after(&self) -> &[String] {
        &self.after
    }

    pub fn is_sealed(&self) -> bool {
        self.sealed
    }

    pub fn seal(&mut self) {
        self.sealed = true;
    }

    pub fn is_void(&self) -> bool {
        self.commands.iter().all(HistoryCommand::is_void)
            && self.construct.is_empty()
            && self.destruct.is_empty()
    }

    pub fn try_add(
        &mut self,
        commands: &[HistoryCommand],
        construct: Vec<Memento>,
        destruct: Vec<Memento>,
        is_dragging: bool,
    ) -> bool {
        if self.sealed || command_signature(commands) != self.signature {
            return false;
        }
        for (incoming, existing) in commands.iter().zip(&self.commands) {
            if !incoming.can_add_to(existing, is_dragging) {
                return false;
            }
        }
        for (incoming, existing) in commands.iter().zip(&mut self.commands) {
            incoming.add_to(existing);
        }
        for memento in destruct {
            self.try_add_destruct(memento);
        }
        for memento in construct {
            self.try_add_construct(memento);
        }
        true
    }

    fn try_add_construct(&mut self, memento: Memento) {
        if let Some(index) = self
            .construct
            .iter()
            .position(|candidate| candidate.0 == memento.0)
        {
            self.construct.remove(index);
        }
        if let Some(index) = self
            .destruct
            .iter()
            .position(|candidate| candidate.0 == memento.0 && json_equal(&candidate.1, &memento.1))
        {
            self.destruct.remove(index);
        } else {
            self.construct.push(memento);
        }
    }

    fn try_add_destruct(&mut self, memento: Memento) {
        if self
            .destruct
            .iter()
            .any(|candidate| candidate.0 == memento.0)
        {
            return;
        }
        if let Some(index) = self
            .construct
            .iter()
            .position(|candidate| candidate.0 == memento.0 && json_equal(&candidate.1, &memento.1))
        {
            self.construct.remove(index);
        } else {
            self.destruct.push(memento);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HistoryManager {
    index: usize,
    saved_index: isize,
    steps: Vec<Step>,
    queue: Vec<HistoryCommand>,
    construct: Vec<Memento>,
    destruct: Vec<Memento>,
    selection: Option<Vec<String>>,
    moving: bool,
    initializing: bool,
    is_dragging: bool,
}

impl Default for HistoryManager {
    fn default() -> Self {
        Self::new()
    }
}

impl HistoryManager {
    pub fn new() -> Self {
        Self {
            index: 0,
            saved_index: 0,
            steps: Vec::new(),
            queue: Vec::new(),
            construct: Vec::new(),
            destruct: Vec::new(),
            selection: Some(Vec::new()),
            moving: false,
            initializing: true,
            is_dragging: false,
        }
    }

    pub fn from_history(history: &History) -> BpResult<Self> {
        let mut manager = Self::new();
        manager.steps = history
            .steps
            .iter()
            .map(step_from_model)
            .collect::<BpResult<Vec<_>>>()?;
        manager.index = history.index;
        manager.saved_index = history.saved_index;
        Ok(manager)
    }

    pub fn to_history(&self) -> BpResult<History> {
        Ok(History {
            index: self.index,
            saved_index: self.saved_index,
            steps: self
                .steps
                .iter()
                .map(Step::to_model)
                .collect::<BpResult<Vec<_>>>()?,
        })
    }

    pub fn index(&self) -> usize {
        self.index
    }

    pub fn saved_index(&self) -> isize {
        self.saved_index
    }

    pub fn steps(&self) -> &[Step] {
        &self.steps
    }

    pub fn is_locked(&self) -> bool {
        self.moving || self.initializing
    }

    pub fn is_modified(&self) -> bool {
        self.is_dragging || self.saved_index != self.index as isize
    }

    pub fn set_dragging(&mut self, dragging: bool) {
        self.is_dragging = dragging;
    }

    pub fn notify_save(&mut self) {
        self.saved_index = self.index as isize;
    }

    pub fn cache_selection(&mut self, selection: Vec<String>) {
        self.selection = Some(selection);
    }

    pub fn field_change(
        &mut self,
        tag: impl Into<String>,
        prop: impl Into<String>,
        old: Value,
        new: Value,
    ) {
        if !self.is_locked() {
            self.enqueue(HistoryCommand::field(tag, prop, old, new));
        }
    }

    pub fn field_change_flush(
        &mut self,
        tag: impl Into<String>,
        prop: impl Into<String>,
        old: Value,
        new: Value,
        mode: DesignMode,
        selection: Vec<String>,
    ) {
        if self.is_locked() {
            return;
        }
        self.field_change(tag, prop, old, new);
        self.flush(mode, selection);
    }

    pub fn move_command(&mut self, tag: impl Into<String>, old: Point, new: Point) {
        if !self.is_locked() {
            self.enqueue(HistoryCommand::move_command(tag, old, new));
        }
    }

    pub fn edit(&mut self, edits: Vec<Edit>, old_root: NodeId, new_root: NodeId) {
        if !self.is_locked() {
            self.enqueue(HistoryCommand::edit(edits, old_root, new_root));
        }
    }

    pub fn construct(&mut self, memento: Memento) {
        if !self.is_locked() {
            self.construct.push(memento);
        }
    }

    pub fn destruct(&mut self, memento: Memento) {
        if !self.is_locked() {
            self.destruct.push(memento);
        }
    }

    pub fn can_undo(&self) -> bool {
        self.index > 0
    }

    pub fn can_redo(&self) -> bool {
        self.index < self.steps.len()
    }

    pub fn apply_undo_result(&mut self, result: OperationResult) {
        if !self.can_undo() {
            return;
        }
        self.index -= 1;
        if result != OperationResult::Success {
            let discard = self.index + usize::from(result == OperationResult::Failed);
            self.steps.drain(0..discard);
            self.index = 0;
        }
        self.finish_navigation();
    }

    pub fn apply_redo_result(&mut self, result: OperationResult) {
        if !self.can_redo() {
            return;
        }
        self.index += 1;
        if result != OperationResult::Success {
            if result == OperationResult::Failed {
                self.index -= 1;
            }
            self.steps.truncate(self.index);
        }
        self.finish_navigation();
    }

    pub fn flush(&mut self, mode: DesignMode, selection: Vec<String>) {
        if self.moving {
            return;
        }
        self.flush_internal(mode, selection);
    }

    fn enqueue(&mut self, command: HistoryCommand) {
        for queued in &mut self.queue {
            if command.can_add_to(queued, self.is_dragging) {
                command.add_to(queued);
                return;
            }
        }
        self.queue.push(command);
    }

    fn flush_internal(&mut self, mode: DesignMode, selection: Vec<String>) {
        if !self.queue.is_empty() {
            let can_add_to_last = self.index != 0 && self.index == self.steps.len();
            if can_add_to_last {
                let last_index = self.index - 1;
                if self.steps[last_index].try_add(
                    &self.queue,
                    std::mem::take(&mut self.construct),
                    std::mem::take(&mut self.destruct),
                    self.is_dragging,
                ) {
                    if self.steps[last_index].is_void() {
                        self.steps.pop();
                        self.index -= 1;
                    }
                    self.queue.clear();
                    self.finish_flush();
                    return;
                }
            }
            let step = Step::new(StepRecord {
                commands: std::mem::take(&mut self.queue),
                construct: std::mem::take(&mut self.construct),
                destruct: std::mem::take(&mut self.destruct),
                mode,
                before: self.selection.clone().unwrap_or_else(|| selection.clone()),
                after: selection,
            });
            if !step.is_void() {
                self.add_step(step);
            }
        }
        self.construct.clear();
        self.destruct.clear();
        self.finish_flush();
    }

    fn finish_flush(&mut self) {
        self.selection = None;
        self.initializing = false;
        self.moving = false;
    }

    fn finish_navigation(&mut self) {
        self.queue.clear();
        self.construct.clear();
        self.destruct.clear();
        self.finish_flush();
    }

    fn add_step(&mut self, step: Step) {
        if self.steps.len() > self.index {
            self.steps.truncate(self.index);
        }
        if self.index == self.steps.len() {
            self.steps.push(step);
        } else {
            self.steps[self.index] = step;
        }
        self.index += 1;
        if self.steps.len() > MAX_STEP {
            self.steps.remove(0);
            self.index -= 1;
            self.saved_index -= 1;
        }
    }
}

fn step_from_model(step: &HistoryStep) -> BpResult<Step> {
    Ok(Step::restore(StepRecord {
        commands: step
            .commands
            .iter()
            .cloned()
            .map(serde_json::from_value)
            .collect::<Result<Vec<_>, _>>()?,
        construct: step.construct.clone().unwrap_or_default(),
        destruct: step.destruct.clone().unwrap_or_default(),
        mode: step.mode,
        before: step.before.clone(),
        after: step.after.clone(),
    }))
}

fn take_string(object: &mut Map<String, Value>, key: &str) -> BpResult<String> {
    object
        .remove(key)
        .and_then(|value| value.as_str().map(ToString::to_string))
        .ok_or_else(|| BpError::InvalidInput(format!("history command is missing {key}")))
}

fn take_value<T>(object: &mut Map<String, Value>, key: &str) -> BpResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(
        object
            .remove(key)
            .ok_or_else(|| BpError::InvalidInput(format!("history command is missing {key}")))?,
    )
    .map_err(BpError::from)
}

fn json_equal(a: &Value, b: &Value) -> bool {
    serde_json::to_string(a).ok() == serde_json::to_string(b).ok()
}
