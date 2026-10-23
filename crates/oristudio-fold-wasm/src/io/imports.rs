//! Import CP's two calls (plan D16): open a file — load it, import it,
//! complete its order — and pick one of the orders, landing the step.
//!
//! An opened import is held under its own handle, like a state, until it is
//! released: the completion can be the costly part, and a picker previews
//! one order after another from it.
//!
//! **An empty target is the flat sheet it adopts.** Importing into a
//! sequence with no steps adopts the pattern's square or rectangle; the
//! caller then stores that paper, and every later replay lands the step after
//! the flat sheet of it. So the import is made after exactly that sheet — the
//! engine's `ImportTarget::Empty` only finds which it is — and a pick lands
//! the step from a sheet of it, as the replay will.

use std::collections::HashMap;

use oristudio_fold::complete::Completions;
use oristudio_fold::{
    Check, CompletionRefusal, CompletionSession, CreasePatternInput, FaceId, FixedKind, FixedPair,
    ImportRefusal, ImportTarget, ImportedPattern, Sheet, StartSide, State,
};
use oristudio_layer_order::LayerOrder;

use super::jump;
use super::kernel::{cp_json, input_of_cp_json, load};
use super::wire::{
    AdoptedPaper, CheckWireLimits, Checked, ComponentCount, CpFile, CpJump, CpOrigin, IoCallError,
    IoRefusal, JumpOp, Landed, Limits, Opened, SessionOpened, SheetFound, Target,
};
use crate::bridge::Bridge;
use crate::wire::{Choices, Op, Outcome, Paper};

/// Every opened import the caller still holds. Handles start at 1 and are
/// never reused while this store lives.
#[derive(Debug, Default)]
pub struct Imports {
    held: HashMap<u32, Held>,
    last: u32,
}

#[derive(Debug)]
struct Held {
    placed: Placed,
    cp_json: String,
    origin: CpOrigin,
    pattern: ImportedPattern,
    completions: Completions,
    /// Opened by [`Imports::open_session`].
    session: Option<Checking>,
}

/// A held import's checking session and the order it shows.
#[derive(Debug)]
struct Checking {
    session: CompletionSession,
    shown: LayerOrder,
}

/// A target whose state, if it names one, is held.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Parent<'a> {
    After(u32, &'a State),
    Empty(StartSide),
}

impl Parent<'_> {
    /// `target` with its state looked up: a handle not held is the caller's
    /// mistake, whatever the file holds.
    pub(crate) fn of(bridge: &Bridge, target: Target) -> Result<Parent<'_>, IoCallError> {
        Ok(match target {
            Target::After { state } => Parent::After(state, bridge.state(state)?),
            Target::Empty { start_side } => Parent::Empty(start_side),
        })
    }
}

/// Where a pattern was imported: after a held state, or after the flat sheet
/// an empty sequence adopts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Placed {
    After(u32),
    Sheet {
        paper: AdoptedPaper,
        start: StartSide,
    },
}

impl Placed {
    fn adopted(&self) -> Option<AdoptedPaper> {
        match self {
            Placed::After(_) => None,
            Placed::Sheet { paper, .. } => Some(*paper),
        }
    }
}

impl Imports {
    pub fn new() -> Imports {
        Imports::default()
    }

    /// Read `bytes` as `file` says, import the crease pattern against
    /// `target` and complete its order within `limits`.
    pub fn open(
        &mut self,
        bridge: &Bridge,
        file: CpFile,
        bytes: &[u8],
        target: Target,
        limits: &Limits,
    ) -> Result<Outcome<Opened>, IoCallError> {
        let parent = Parent::of(bridge, target)?;
        let opened = (|| -> Result<_, IoRefusal> {
            let cp_json = cp_json(&load(file.format, bytes)?)?;
            // The stored text, read back: what every replay will import.
            let input = input_of_cp_json(&cp_json)?;
            let (pattern, placed) = import(&input, parent)?;
            let completions = pattern.complete(&limits.completion())?;
            Ok((cp_json, pattern, placed, completions))
        })();
        let (cp_json, pattern, placed, completions) = match opened {
            Ok(opened) => opened,
            Err(refusal) => return Ok(Outcome::Refused(refusal.into())),
        };
        let summary = pattern.summary().clone();
        let count = completions.count();
        let components = completions
            .components()
            .iter()
            .map(|c| ComponentCount {
                pairs: c.pairs.iter().map(|pair| [pair.lo(), pair.hi()]).collect(),
                orders: c.orders.len(),
                truncated: c.truncated,
            })
            .collect();
        let nodes = completions.nodes();
        let import = self.hold(Held {
            placed,
            cp_json,
            origin: file.origin(),
            pattern,
            completions,
            session: None,
        });
        Ok(Outcome::Ok(Opened {
            import,
            summary,
            paper: placed.adopted(),
            count,
            components,
            nodes,
        }))
    }

    /// Expand a held search and locate the previously displayed local order by
    /// its actual relations, never by a potentially shifted enumeration index.
    pub fn search(
        &mut self,
        import: u32,
        choice: &[usize],
        limits: &Limits,
    ) -> Result<Outcome<super::wire::Searched>, IoCallError> {
        let held = self
            .held
            .get_mut(&import)
            .ok_or(IoCallError::UnknownImport(import))?;
        let previous = held
            .completions
            .order(choice)
            .ok_or_else(|| IoCallError::invalid("invalid previous choice"))?;
        let completions = match held.pattern.complete(&limits.completion()) {
            Ok(value) => value,
            Err(error) => return Ok(Outcome::Refused(IoRefusal::from(error).into())),
        };
        let choice = completions
            .choice_of(&previous)
            .ok_or_else(|| IoCallError::invalid("expanded search lost the previous order"))?;
        let opened = Opened {
            import,
            summary: held.pattern.summary().clone(),
            paper: held.placed.adopted(),
            count: completions.count(),
            nodes: completions.nodes(),
            components: completions
                .components()
                .iter()
                .map(|c| ComponentCount {
                    pairs: c.pairs.iter().map(|pair| [pair.lo(), pair.hi()]).collect(),
                    orders: c.orders.len(),
                    truncated: c.truncated,
                })
                .collect(),
        };
        held.completions = completions;
        Ok(Outcome::Ok(super::wire::Searched { opened, choice }))
    }

    /// Land the order `choice` picks — one listed order per component, by
    /// index — as a step: the `cp-jump` op that stores it, and the state that
    /// op lands, held like any step's. A target state must still be held.
    pub fn pick(
        &self,
        bridge: &mut Bridge,
        import: u32,
        choice: &[usize],
    ) -> Result<Outcome<Landed>, IoCallError> {
        let held = self
            .held
            .get(&import)
            .ok_or(IoCallError::UnknownImport(import))?;
        let order = held.completions.order(choice).ok_or_else(|| {
            let sizes: Vec<usize> = held
                .completions
                .components()
                .iter()
                .map(|c| c.orders.len())
                .collect();
            IoCallError::invalid(format!(
                "choice {choice:?} names no order: pick one index below each of {sizes:?}"
            ))
        })?;
        let jump = held
            .pattern
            .state(order)
            .map_err(IoRefusal::from)
            .and_then(|state| jump::order_json(&state));
        match jump {
            Ok(order_json) => land_op(
                bridge,
                held.placed,
                CpJump {
                    cp_json: held.cp_json.clone(),
                    order_json,
                    origin: held.origin,
                },
            ),
            Err(refusal) => Ok(Outcome::Refused(refusal.into())),
        }
    }

    /// Open a checking session on a held import (the Layer order dialog):
    /// propagate its letters, find what they force and a first order, which
    /// becomes the order shown. A session already open is replaced.
    pub fn open_session(
        &mut self,
        import: u32,
        limits: &Limits,
    ) -> Result<Outcome<SessionOpened>, IoCallError> {
        let held = self
            .held
            .get_mut(&import)
            .ok_or(IoCallError::UnknownImport(import))?;
        let session = match held.pattern.session(&limits.completion()) {
            Ok(session) => session,
            Err(refusal) => return Ok(Outcome::Refused(IoRefusal::from(refusal).into())),
        };
        let opened = SessionOpened {
            import,
            forced: session.forced_pairs().len(),
            nodes: session.nodes(),
        };
        held.session = Some(Checking {
            shown: session.first_order(),
            session,
        });
        Ok(Outcome::Ok(opened))
    }

    /// Whether the letters and `pairs` (each `[upper, lower]`) leave an
    /// order. The search prefers the order shown, and a fit becomes it.
    pub fn check(
        &mut self,
        import: u32,
        pairs: &[[FaceId; 2]],
        limits: &CheckWireLimits,
    ) -> Result<Checked, IoCallError> {
        let held = self
            .held
            .get_mut(&import)
            .ok_or(IoCallError::UnknownImport(import))?;
        let Some(checking) = held.session.as_mut() else {
            return Err(IoCallError::invalid(format!(
                "import {import} has no session: open one first"
            )));
        };
        let fixed: Vec<FixedPair> = pairs
            .iter()
            .map(|&[upper, lower]| FixedPair {
                upper,
                lower,
                kind: FixedKind::Seed,
            })
            .collect();
        let check = checking
            .session
            .check(&fixed, Some(&checking.shown), &limits.check());
        Ok(match check {
            Ok(Check::Fits {
                order,
                forced,
                nodes,
                stage,
            }) => {
                let changed = order
                    .pairs()
                    .filter(|(pair, lo_above)| {
                        checking.shown.above(pair.lo(), pair.hi()) != *lo_above
                    })
                    .count();
                checking.shown = order;
                Checked::Fits {
                    nodes,
                    stage,
                    changed,
                    forced: forced.len(),
                }
            }
            Ok(Check::Forced { pair, traced }) => Checked::Forced { pair, traced },
            Ok(Check::Conflict {
                family,
                faces,
                traced,
            }) => Checked::Conflict {
                family,
                faces,
                traced,
            },
            Ok(Check::NoOrder {
                faces,
                traced,
                nodes,
            }) => Checked::NoOrder {
                faces,
                traced,
                nodes,
            },
            Ok(Check::Undecided { limit, nodes }) => Checked::Undecided { limit, nodes },
            Err(CompletionRefusal::FixedContradictory { pair }) => Checked::Contradictory {
                pair: [pair.lo(), pair.hi()],
            },
            Err(refusal) => return Err(IoCallError::invalid(refusal.to_string())),
        })
    }

    /// Let an import go; whether it was held.
    pub fn release(&mut self, import: u32) -> bool {
        self.held.remove(&import).is_some()
    }

    /// Let every import go.
    pub fn clear(&mut self) {
        self.held.clear();
    }

    /// How many imports are held.
    pub fn len(&self) -> usize {
        self.held.len()
    }

    pub fn is_empty(&self) -> bool {
        self.held.is_empty()
    }

    fn hold(&mut self, held: Held) -> u32 {
        // As `Bridge`'s handles: wrapping skips 0 and every handle held.
        loop {
            self.last = self.last.wrapping_add(1);
            if self.last != 0 && !self.held.contains_key(&self.last) {
                break;
            }
        }
        self.held.insert(self.last, held);
        self.last
    }
}

/// "Import starting sheet": the sheet the border of the crease pattern in
/// `bytes` outlines, for a sequence to start from — read as an import reads
/// it (the stored text, read back), but only its border: a pattern that does
/// not fold flat, or has too many faces, still gives its sheet. Refused with
/// the import's own codes for a file or a border that does not read, and the
/// sheet's (`sheet_not_convex`, …) for an outline the engine does not fold.
pub fn starting_sheet(file: CpFile, bytes: &[u8]) -> Outcome<SheetFound> {
    let found = (|| -> Result<_, IoRefusal> {
        let input = input_of_cp_json(&cp_json(&load(file.format, bytes)?)?)?;
        Ok(oristudio_fold::starting_sheet(&input)?)
    })();
    match found {
        Ok(Ok(sheet)) => Outcome::Ok(SheetFound { sheet }),
        Ok(Err(refusal)) => Outcome::Refused(refusal.into()),
        Err(refusal) => Outcome::Refused(refusal.into()),
    }
}

/// The pattern imported after `parent`, and where it landed.
pub(crate) fn import(
    input: &CreasePatternInput,
    parent: Parent<'_>,
) -> Result<(ImportedPattern, Placed), IoRefusal> {
    match parent {
        Parent::After(handle, state) => {
            let pattern = ImportedPattern::new(input, ImportTarget::After(state))?;
            Ok((pattern, Placed::After(handle)))
        }
        Parent::Empty(start) => {
            // The sheet the sequence adopts, then the import after the flat
            // sheet of it (see the module docs).
            let found = ImportedPattern::new(input, ImportTarget::Empty { start })?;
            let shape = &found.summary().shape;
            let paper =
                AdoptedPaper::of(shape).ok_or_else(|| internal("an import adopted a polygon"))?;
            let flat = Sheet::new(shape)
                .and_then(|sheet| State::flat(sheet, start))
                .map_err(|refusal| internal(&refusal.to_string()))?;
            let pattern = ImportedPattern::new(input, ImportTarget::After(&flat))?;
            Ok((pattern, Placed::Sheet { paper, start }))
        }
    }
}

fn internal(message: &str) -> IoRefusal {
    IoRefusal::Import(ImportRefusal::Internal {
        message: message.to_string(),
    })
}

/// Land `jump` where its import was made, through `Bridge::apply` — the
/// replay's own path — and return it with the state.
pub(crate) fn land_op(
    bridge: &mut Bridge,
    placed: Placed,
    jump: CpJump,
) -> Result<Outcome<Landed>, IoCallError> {
    let (parent, sheet) = match placed {
        Placed::After(state) => (state, None),
        Placed::Sheet { paper, start } => {
            let made = bridge.sheet(&Paper {
                shape: paper.paper_shape(),
                start_side: start,
            });
            match made {
                Outcome::Ok(made) => (made.state, Some(made.state)),
                Outcome::Refused(refusal) => return Ok(Outcome::Refused(refusal)),
            }
        }
    };
    let op = Op::CpJump(jump.clone());
    let applied = bridge.apply(parent, &op, &Choices::default());
    if let Some(sheet) = sheet {
        bridge.release(sheet);
    }
    Ok(match applied? {
        Outcome::Ok(applied) => Outcome::Ok(Landed {
            state: applied.state,
            summary: applied.summary,
            op: JumpOp::CpJump(jump),
        }),
        Outcome::Refused(refusal) => Outcome::Refused(refusal),
    })
}
