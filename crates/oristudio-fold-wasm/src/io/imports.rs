//! Import CP's two calls (plan D16): open a file — load it, import it,
//! complete its order — and pick one of the orders, landing the step. Or,
//! with several orders, open it onto the Layer order dialog
//! ([`Imports::layer_opening`]) and land the order its Apply chose
//! ([`Imports::pick_layer_order`], `implementation-plans/layer-order-dialog.md`
//! row H10).
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

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::folding::{FoldedFigureModel, folded_paper_scene_with_order};
use oristudio_cp::session::{CpSession, EngineError, FoldSource};
use oristudio_fold::complete::Completions;
use oristudio_fold::steer::{ImportedFaces, ImportedLook, LayerSource};
use oristudio_fold::{
    Check, CompletionRefusal, CompletionSession, CreasePatternInput, FaceId, FixedKind, FixedPair,
    ImportRefusal, ImportTarget, ImportedPattern, Sheet, StartSide, State,
};
use oristudio_layer_order::LayerOrder;

use super::jump;
use super::kernel::{cp_json, input_of_cp_json, load, model_of_cp_json};
use super::wire::{
    AdoptedPaper, CheckWireLimits, Checked, ComponentCount, CpFile, CpJump, CpOrigin, IoCallError,
    IoRefusal, JumpOp, Landed, LayerOpening, Limits, Opened, SessionOpened, SheetFound, Target,
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
    /// What the completion may spend: the open's, or the last search's.
    limits: Limits,
    /// Opened by [`Imports::open_session`].
    session: Option<Checking>,
    /// Opened by [`Imports::layer_opening`].
    layer: Option<LayerLink>,
    /// How far [`Imports::turn`] has turned the import's view, degrees
    /// clockwise on screen from the target's, in (−180, 180]: what every
    /// step it lands stores (`CpJump::turn_deg`).
    turn_deg: f64,
}

/// A held import opened onto the Layer order dialog's faces (row H10): the
/// digest of the source the dialog was given, and its faces matched with the
/// import's, so its Apply comes back exactly.
#[derive(Debug)]
struct LayerLink {
    digest: String,
    faces: ImportedFaces,
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
            limits: *limits,
            session: None,
            layer: None,
            turn_deg: 0.0,
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
        held.limits = *limits;
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
                    turn_deg: held.turn_deg,
                },
            ),
            Err(refusal) => Ok(Outcome::Refused(refusal.into())),
        }
    }

    /// Turn a held import opened onto the Layer order dialog
    /// ([`Imports::layer_opening`]) so that Fold shows it turned `turn_deg`,
    /// clockwise on screen, from Oriedita's picture of the side it shows: the
    /// dialog's Rotate, in its opening's `look` terms, which the import's
    /// look reads back. Every step it lands after this stores the turn
    /// (`CpJump::turn_deg`), so the imported step is drawn turned, with no
    /// rotate step after it. Answers the look it has now. Not opened onto
    /// the dialog, or a turn that is not a number, is the caller's mistake.
    pub fn turn(&mut self, import: u32, turn_deg: f64) -> Result<ImportedLook, IoCallError> {
        let held = self
            .held
            .get_mut(&import)
            .ok_or(IoCallError::UnknownImport(import))?;
        if !turn_deg.is_finite() {
            return Err(IoCallError::invalid("the turn must be a number of degrees"));
        }
        let link = held.layer.as_ref().ok_or_else(|| {
            IoCallError::invalid(format!(
                "import {import} is not open in the Layer order dialog: open it first"
            ))
        })?;
        let by = link.faces.turn_to(&mut held.pattern, turn_deg);
        // Stored to a millionth of a degree, so a turn of whole steps stores whole degrees.
        held.turn_deg = shorter_turn(((held.turn_deg + by) * 1e6).round() / 1e6);
        Ok(link.faces.look(&held.pattern))
    }

    /// Open a held import onto the Layer order dialog (row H10): the fold the
    /// dialog analyses — the stored crease pattern as Edit folds it whole —
    /// and the order `choice` picks drawn over its faces, which the dialog
    /// opens on, with how Fold shows the state. The import remembers the
    /// match of its faces with the dialog's until it is opened again or
    /// released, for [`Imports::pick_layer_order`].
    ///
    /// Refused as `import_layer_unavailable` when Edit's fold of the creases
    /// is refused or traces other faces than the import; the import is then
    /// as it was, and its own chooser still works.
    pub fn layer_opening(
        &mut self,
        import: u32,
        choice: &[usize],
    ) -> Result<Outcome<LayerOpening>, IoCallError> {
        let held = self
            .held
            .get_mut(&import)
            .ok_or(IoCallError::UnknownImport(import))?;
        let order = held
            .completions
            .order(choice)
            .ok_or_else(|| IoCallError::invalid(format!("choice {choice:?} names no order")))?;
        held.layer = None;
        let opened = (|| -> Result<_, &'static str> {
            let source = edit_fold_source(&held.cp_json)?;
            let layer = LayerSource::from_oriedita(&source).map_err(|refusal| refusal.code())?;
            let faces = ImportedFaces::of(&layer, &held.pattern).map_err(|_| "faces_differ")?;
            let relations = faces.oriedita_relations(&layer, &held.pattern, &order);
            let shown = folded_paper_scene_with_order(
                layer.render_inputs(),
                &relations,
                &source.aux_segments,
                &FoldedFigureModel::default(),
            )
            .map_err(|error| EngineError::from(error).code)?
            .ok_or("no_subfaces")?;
            let look = faces.look(&held.pattern);
            Ok((source, faces, shown, look))
        })();
        Ok(match opened {
            Ok((source, faces, shown, look)) => {
                held.layer = Some(LayerLink {
                    digest: source.digest.clone(),
                    faces,
                });
                Outcome::Ok(LayerOpening {
                    source,
                    shown,
                    look,
                })
            }
            Err(reason) => Outcome::Refused(IoRefusal::LayerUnavailable { reason }.into()),
        })
    }

    /// Land the order the Layer order dialog's Apply chose (row H10):
    /// `relations`, flat `[upper, lower, …]` over the faces of the source
    /// [`Imports::layer_opening`] gave, whose digest is `digest`, in
    /// Oriedita's convention. They become the import's seeds, every pair as
    /// the dialog chose it, and with the letters they must decide every pair
    /// (`import_order_open` otherwise), within the limits the import was
    /// opened with; the step then lands as a pick's does, a `cp-jump` of the
    /// stored crease pattern and that order.
    pub fn pick_layer_order(
        &self,
        bridge: &mut Bridge,
        import: u32,
        digest: &str,
        relations: &[u32],
    ) -> Result<Outcome<Landed>, IoCallError> {
        let held = self
            .held
            .get(&import)
            .ok_or(IoCallError::UnknownImport(import))?;
        let link = held.layer.as_ref().ok_or_else(|| {
            IoCallError::invalid(format!(
                "import {import} is not open in the Layer order dialog: open it first"
            ))
        })?;
        if link.digest != digest {
            return Err(IoCallError::invalid(format!(
                "the relations are over faces {digest}, not the {} this import opened on",
                link.digest
            )));
        }
        if !relations.len().is_multiple_of(2) {
            return Err(IoCallError::invalid(
                "relations must be [upper, lower] pairs",
            ));
        }
        let pairs: Vec<[usize; 2]> = relations
            .chunks_exact(2)
            .map(|pair| [pair[0] as usize, pair[1] as usize])
            .collect();
        let mapped = link.faces.to_imported(&pairs).ok_or_else(|| {
            IoCallError::invalid("a relation names a face the dialog's fold does not have")
        })?;
        let jump = held
            .pattern
            .oriedita_face_seeds(link.faces.start(), &mapped)
            // Within what the import was opened with (or its last search), as its own picks are.
            .and_then(|seeds| held.pattern.decided_by(&seeds, &held.limits.completion()))
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
                    turn_deg: held.turn_deg,
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

/// A stored crease pattern as Edit folds it whole: every folding line of it,
/// from Edit's first face, through the CP kernel's own reading of a selection
/// (`CpSession::fold_source_of_selection`), so the Layer order dialog
/// analyses exactly what Edit would fold. Refused with the kernel's code.
fn edit_fold_source(cp_json: &str) -> Result<FoldSource, &'static str> {
    let model = model_of_cp_json(cp_json).map_err(|refusal| refusal.code())?;
    let lines: Vec<usize> = (1..=model.line_segments.len()).collect();
    let mut kernel = CpSession::new();
    let document = kernel.load_document(CreasePatternDocument {
        crease_pattern: model,
        ..CreasePatternDocument::default()
    });
    kernel
        .fold_source_of_selection(document, &lines, EDIT_STARTING_FACE)
        .map_err(|error| error.code)
}

/// The face Edit's Fold starts from when no other is chosen.
const EDIT_STARTING_FACE: i32 = 1;

/// A turn in degrees, the shorter way round: in (−180, 180], with a hair
/// either side of none as none.
fn shorter_turn(degrees: f64) -> f64 {
    let wrapped = degrees.rem_euclid(360.0);
    let shorter = if wrapped > 180.0 {
        wrapped - 360.0
    } else {
        wrapped
    };
    if shorter.abs() < 1e-9 { 0.0 } else { shorter }
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
