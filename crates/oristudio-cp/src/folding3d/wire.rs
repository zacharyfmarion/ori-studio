//! Stable codes for everything the 3D fold reports to a caller.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! Every kernel enum the boundary carries is mapped here, by hand, into a
//! `#[serde(tag = "code")]` mirror. Three properties come out of doing it this
//! way rather than deriving `Serialize` on the kernel enums:
//!
//! - **The wire name is stable under a Rust rename.** A frontend keys eight
//!   locales' copy off these strings ([`crate::lib`]'s diagnostics say twice
//!   that the i18n gate cannot see a Rust literal), so a variant renamed for
//!   readability must not silently retire a translation.
//! - **`checks.rs` is untouched.** [`FlatFoldabilityRule`] and [`Indeterminate`]
//!   are Oriedita-derived and the divergence budget allocates nothing to them;
//!   they are read here and mapped onto mirror enums, never annotated there.
//!   Mirror *enums* rather than `&'static str`: the snapshot has to round-trip
//!   through `.osf`, and a borrowed literal cannot deserialize.
//! - **Every match is exhaustive with no `_` arm**, so a refusal added in a
//!   later phase fails to compile until it has a code.
//!
//! Nothing here is a sentence. `Display` still exists on the kernel enums for
//! logs and test failures; it is not what crosses the bridge.

use serde::{Deserialize, Serialize};

use crate::checks::FlatFoldabilityRule;
use crate::checks_spatial::Indeterminate;
use crate::folding3d::cells::CellError;
use crate::folding3d::constraints::{Fold3dCrossing, SeedKind};
use crate::folding3d::order::Fold3dOrderError;
use crate::folding3d::planes::PlaneId;
use crate::folding3d::{Fold3dRefusal, Fold3dTolerances};
use crate::geometry::Point;

/// Why a crease pattern has no computable 3D folded state, on the wire.
///
/// Mirrors [`Fold3dRefusal`] arm for arm. Serializes internally tagged —
/// `{ "code": "vertex_closure", "point": {...}, "residual_degrees": 0.53 }`.
///
/// # Which of these anyone actually meets
///
/// Measured over the whole external non-flat corpus (65 files): **21
/// `flat_foldability`, 8 `vertex_closure`, 7 `interior_cut`, 1 `disconnected`,
/// 26 admitted.** `no_faces`, `faces_unresolved`, `non_crease_join`,
/// `vertex_indeterminate`, `loop_not_closed` and `tolerance_window_closed` are
/// reachable in principle and reached by nothing — copy for them should be
/// budgeted accordingly. Reproduce with `corpus_admission_reports_every_verdict`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum Fold3dRefusalWire {
    NoFaces,
    FacesUnresolved,
    Disconnected {
        reached: usize,
        unreached: usize,
    },
    NonCreaseJoin {
        line: usize,
    },
    InteriorCut {
        line: usize,
        point: Point,
    },
    FlatFoldability {
        point: Point,
        rule: FlatFoldabilityRuleCode,
    },
    VertexIndeterminate {
        point: Point,
        cause: IndeterminateCode,
    },
    VertexClosure {
        point: Point,
        residual_degrees: f64,
    },
    LoopNotClosed {
        worst_edge: Option<usize>,
        gap_radians: f64,
        gap_offset: f64,
    },
    ToleranceWindowClosed {
        faces: [usize; 2],
        normal_radians: f64,
        offset_relative: f64,
        /// `None` means no two distinct planes are parallel at all, which
        /// certifies nothing — it is not an infinity.
        min_inter_separation: Option<f64>,
    },
}

impl From<Fold3dRefusal> for Fold3dRefusalWire {
    fn from(refusal: Fold3dRefusal) -> Self {
        match refusal {
            Fold3dRefusal::NoFaces => Self::NoFaces,
            Fold3dRefusal::FacesUnresolved => Self::FacesUnresolved,
            Fold3dRefusal::Disconnected { reached, unreached } => {
                Self::Disconnected { reached, unreached }
            }
            Fold3dRefusal::NonCreaseJoin { line } => Self::NonCreaseJoin { line },
            Fold3dRefusal::InteriorCut { line, point } => Self::InteriorCut { line, point },
            Fold3dRefusal::FlatFoldability { point, rule } => Self::FlatFoldability {
                point,
                rule: rule.into(),
            },
            Fold3dRefusal::VertexIndeterminate { point, cause } => Self::VertexIndeterminate {
                point,
                cause: cause.into(),
            },
            Fold3dRefusal::VertexClosure {
                point,
                residual_degrees,
            } => Self::VertexClosure {
                point,
                residual_degrees,
            },
            Fold3dRefusal::LoopNotClosed {
                worst_edge,
                gap_radians,
                gap_offset,
            } => Self::LoopNotClosed {
                worst_edge,
                gap_radians,
                gap_offset,
            },
            Fold3dRefusal::ToleranceWindowClosed {
                faces,
                normal_radians,
                offset_relative,
                min_inter_separation,
            } => Self::ToleranceWindowClosed {
                faces: [faces.0, faces.1],
                normal_radians,
                offset_relative,
                min_inter_separation,
            },
        }
    }
}

/// Why a placement has no computable layer order, on the wire.
///
/// Mirrors [`Fold3dOrderError`], flattening [`CellError`] into its own three
/// codes rather than nesting — a consumer switching on `code` should never have
/// to switch twice.
///
/// **None of these is a refusal of the placement.** The figure draws; only the
/// stacking is unavailable. That is why they ride inside
/// [`Fold3dVerdict::NoLayerOrder`] rather than in [`Fold3dRefusalWire`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum Fold3dOrderWire {
    OverlapWithoutCell {
        plane: PlaneId,
        faces: [usize; 2],
    },
    CellWithoutOverlap {
        plane: PlaneId,
        faces: [usize; 2],
    },
    ArrangementRefused {
        plane: PlaneId,
        first_face: usize,
        faces: usize,
    },
    /// Two geometric rules demanded opposite orders for one pair. Both rules
    /// and both creases are named: a bare face pair is not actionable.
    ContradictorySeeds {
        upper: usize,
        lower: usize,
        first_rule: SeedKindCode,
        first_line: usize,
        second_rule: SeedKindCode,
        second_line: usize,
    },
    NoLayerOrder {
        component: usize,
        faces: usize,
        variables: usize,
    },
    /// An internal invariant: a local id escaped its component's range. It
    /// exists because the measured alternative is `found = true` with the face
    /// missing from every stack.
    FaceIdOutOfRange {
        component: usize,
        face: usize,
        faces_total: usize,
    },
    SearchFailed {
        component: usize,
    },
    /// The search spent its whole iteration budget without settling.
    ///
    /// Its own code because it is its own claim: not "this pattern has no layer
    /// order" but "we stopped looking". The UI says so in those words.
    SearchExhausted {
        component: usize,
        iterations: u64,
    },
    /// The user stopped the fold.
    ///
    /// Mirrors `Fold3dOrderError::Cancelled`. Unlike `Fold3dRefusalWire`, this
    /// enum is the wire form of an *error*, not of a verdict about the model, so
    /// carrying a cancel here is consistent rather than a category error. In
    /// practice the entry points convert a cancel into `fold_cancelled` before a
    /// wire value is built, so this arm should not be observed.
    Cancelled,
}

impl From<Fold3dOrderError> for Fold3dOrderWire {
    fn from(error: Fold3dOrderError) -> Self {
        match error {
            // Both routes to the same wire arm; see `Fold3dOrderWire::Cancelled`.
            Fold3dOrderError::Cancelled | Fold3dOrderError::Cells(CellError::Cancelled) => {
                Self::Cancelled
            }
            Fold3dOrderError::Cells(CellError::OverlapWithoutCell { plane, faces }) => {
                Self::OverlapWithoutCell {
                    plane,
                    faces: [faces.0, faces.1],
                }
            }
            Fold3dOrderError::Cells(CellError::CellWithoutOverlap { plane, faces }) => {
                Self::CellWithoutOverlap {
                    plane,
                    faces: [faces.0, faces.1],
                }
            }
            Fold3dOrderError::Cells(CellError::ArrangementRefused {
                plane,
                first_face,
                faces,
            }) => Self::ArrangementRefused {
                plane,
                first_face,
                faces,
            },
            Fold3dOrderError::ContradictorySeeds {
                upper,
                lower,
                first,
                second,
            } => Self::ContradictorySeeds {
                upper,
                lower,
                first_rule: first.0.into(),
                first_line: first.1,
                second_rule: second.0.into(),
                second_line: second.1,
            },
            Fold3dOrderError::NoLayerOrder {
                component,
                faces,
                variables,
            } => Self::NoLayerOrder {
                component,
                faces,
                variables,
            },
            Fold3dOrderError::SearchExhausted {
                component,
                iterations,
            } => Self::SearchExhausted {
                component,
                iterations,
            },
            Fold3dOrderError::FaceIdOutOfRange {
                component,
                face,
                faces_total,
            } => Self::FaceIdOutOfRange {
                component,
                face,
                faces_total,
            },
            Fold3dOrderError::SearchFailed { component } => Self::SearchFailed { component },
        }
    }
}

/// A self-intersection no layer order repairs, on the wire.
///
/// Mirrors [`Fold3dCrossing`]. The predicate behind these is sound but **not
/// complete**, so an empty list is not a certificate: it means none was
/// detected.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum Fold3dCrossingWire {
    /// Two creases on one folded line whose four half-planes interleave with
    /// nothing coplanar left between them to order.
    Chords {
        lines: [usize; 2],
        faces: [usize; 4],
    },
    /// A folded crease passes through a face's interior, entering on one side of
    /// the face's plane and leaving on the other.
    Transversal { line: usize, face: usize },
    /// Two faces in different planes with the same folded line running through
    /// each interior: their sheets meet along that line at an angle.
    Sheets { line: usize, faces: [usize; 2] },
}

impl From<Fold3dCrossing> for Fold3dCrossingWire {
    fn from(crossing: Fold3dCrossing) -> Self {
        match crossing {
            Fold3dCrossing::Chords { lines, faces } => Self::Chords {
                lines: [lines.0, lines.1],
                faces,
            },
            Fold3dCrossing::Transversal { line, face } => Self::Transversal { line, face },
            Fold3dCrossing::Sheets { line, faces } => Self::Sheets {
                line,
                faces: [faces.0, faces.1],
            },
        }
    }
}

/// What the 3D fold concluded about a crease pattern it *placed*.
///
/// Deliberately **not** an extension of [`crate::folding3d::Fold3dOutcome`],
/// which is the admission gate's own two-arm conclusion and is produced by
/// exactly one function. Widening that enum would add arms its producer cannot
/// return, and it is `Copy + Eq` and compared with `assert_eq!` in the corpus
/// harness, which pushes hard against ever giving it a payload.
///
/// [`Fold3dRefusal`] is **not** an arm here either. A verdict only exists when a
/// figure exists, so a `Refused` arm would be structurally unreachable; the
/// refusal is the other arm of [`crate::folding3d::session::Fold3dFoldResult`].
///
/// # Precedence
///
/// The three non-`Folded` conditions are independent and can co-occur, so the
/// composition site applies one documented order and the snapshot carries every
/// count separately, losing nothing:
///
/// 1. `NoLayerOrder` — the ordering solver could not answer at all.
/// 2. `TransversalCrossing` — face-vs-face, a self-intersection **no layer
///    order repairs**.
/// 3. `LocalCrossing` — the folded link at a vertex crosses itself.
/// 4. `Folded`.
///
/// The order runs from "the strongest thing the pipeline can say" outward. Note
/// what `Folded` does and does not mean: the crossing predicate is sound but
/// **not complete**, so it means *no crossing was detected*, never *no crossing
/// exists*.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum Fold3dVerdict {
    Folded,
    /// Vertices whose folded link crosses itself; the count is exact.
    LocalCrossing {
        vertices: usize,
    },
    /// Crossings no layer order repairs; the count is exact.
    TransversalCrossing {
        crossings: usize,
    },
    /// The figure still draws — only the stacking is unavailable.
    NoLayerOrder {
        reason: Fold3dOrderWire,
    },
}

/// The 3D tolerance block, on the wire.
///
/// Crosses the boundary for one reason: the frontend's BSP builder has its own
/// hardcoded coplanarity epsilon, and a renderer that disagrees with the kernel
/// about which faces share a plane draws a stack the kernel never computed.
/// Nothing else about it is policy the frontend may read — no tolerance is
/// exposed to the user, and none is settable from outside.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Fold3dTolerancesWire {
    pub angle_radians: f64,
    pub distance_relative: f64,
    pub flat_snap_degrees: f64,
    pub overlap_area_relative: f64,
}

impl From<Fold3dTolerances> for Fold3dTolerancesWire {
    fn from(tolerances: Fold3dTolerances) -> Self {
        Self {
            angle_radians: tolerances.angle_radians,
            distance_relative: tolerances.distance_relative,
            flat_snap_degrees: tolerances.flat_snap_degrees,
            overlap_area_relative: tolerances.overlap_area_relative,
        }
    }
}

/// Oriedita's five flat rules, as stable codes.
///
/// Mirrored rather than derived on [`FlatFoldabilityRule`]: `checks.rs` is a
/// port and the divergence budget allocates nothing to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlatFoldabilityRuleCode {
    NumberOfFolds,
    Angles,
    Maekawa,
    BigLittleBig,
    None,
}

impl From<FlatFoldabilityRule> for FlatFoldabilityRuleCode {
    fn from(rule: FlatFoldabilityRule) -> Self {
        match rule {
            FlatFoldabilityRule::NumberOfFolds => Self::NumberOfFolds,
            FlatFoldabilityRule::Angles => Self::Angles,
            FlatFoldabilityRule::Maekawa => Self::Maekawa,
            FlatFoldabilityRule::BigLittleBig => Self::BigLittleBig,
            FlatFoldabilityRule::None => Self::None,
        }
    }
}

/// Why a vertex could not be evaluated, as a stable code. Mirrors
/// [`Indeterminate`], which is a different thing from
/// [`Fold3dRefusalWire::NonCreaseJoin`] despite the near-name collision the
/// kernel enum already documents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndeterminateCode {
    UnassignedCrease,
    UnsplitJunction,
}

impl From<Indeterminate> for IndeterminateCode {
    fn from(cause: Indeterminate) -> Self {
        match cause {
            Indeterminate::UnassignedCrease => Self::UnassignedCrease,
            Indeterminate::UnsplitJunction => Self::UnsplitJunction,
        }
    }
}

/// Which geometric rule determined a pair outright, as a stable code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SeedKindCode {
    FullFold,
    Wall,
    SharedSlot,
    Cut,
}

impl From<SeedKind> for SeedKindCode {
    fn from(kind: SeedKind) -> Self {
        match kind {
            SeedKind::FullFold => Self::FullFold,
            SeedKind::Wall => Self::Wall,
            SeedKind::SharedSlot => Self::SharedSlot,
            SeedKind::Cut => Self::Cut,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_of(value: &impl Serialize) -> String {
        let json = serde_json::to_value(value).expect("serializes");
        json.get("code")
            .and_then(|code| code.as_str())
            .expect("internally tagged with `code`")
            .to_owned()
    }

    /// The tag is `code` and the payload sits beside it, not nested under it.
    #[test]
    fn a_refusal_serializes_as_a_code_plus_its_numbers() {
        let json = serde_json::to_value(Fold3dRefusalWire::from(Fold3dRefusal::VertexClosure {
            point: Point::new(1.0, 2.0),
            residual_degrees: 0.53,
        }))
        .expect("serializes");
        assert_eq!(json["code"], "vertex_closure");
        assert_eq!(json["residual_degrees"], 0.53);
        assert_eq!(json["point"]["x"], 1.0);
    }

    /// Every refusal has a distinct code, and none of them is a sentence.
    #[test]
    fn every_refusal_code_is_distinct_and_is_a_code() {
        let point = Point::new(0.0, 0.0);
        let all = [
            Fold3dRefusal::NoFaces,
            Fold3dRefusal::FacesUnresolved,
            Fold3dRefusal::Disconnected {
                reached: 1,
                unreached: 2,
            },
            Fold3dRefusal::NonCreaseJoin { line: 3 },
            Fold3dRefusal::InteriorCut { line: 4, point },
            Fold3dRefusal::FlatFoldability {
                point,
                rule: FlatFoldabilityRule::Maekawa,
            },
            Fold3dRefusal::VertexIndeterminate {
                point,
                cause: Indeterminate::UnsplitJunction,
            },
            Fold3dRefusal::VertexClosure {
                point,
                residual_degrees: 1.0,
            },
            Fold3dRefusal::LoopNotClosed {
                worst_edge: None,
                gap_radians: 0.0,
                gap_offset: 0.0,
            },
            Fold3dRefusal::ToleranceWindowClosed {
                faces: (0, 1),
                normal_radians: 0.0,
                offset_relative: 0.0,
                min_inter_separation: None,
            },
        ];
        let codes: Vec<String> = all
            .into_iter()
            .map(|refusal| code_of(&Fold3dRefusalWire::from(refusal)))
            .collect();
        let unique: std::collections::BTreeSet<&String> = codes.iter().collect();
        assert_eq!(
            unique.len(),
            codes.len(),
            "duplicate refusal code in {codes:?}"
        );
        for code in &codes {
            assert!(
                !code.contains(' ') && code.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "`{code}` is not a snake_case code"
            );
        }
        // The count is the arm count of `Fold3dRefusal`. A new arm without a
        // code does not compile; a new arm with one fails here until it is
        // listed above, which is what keeps the i18n table honest.
        assert_eq!(codes.len(), 10);
    }

    /// `CellError` is flattened, not nested: one `switch` on `code` reaches it.
    #[test]
    fn a_cell_error_reaches_the_wire_as_its_own_code() {
        let wire = Fold3dOrderWire::from(Fold3dOrderError::Cells(CellError::ArrangementRefused {
            plane: 2,
            first_face: 7,
            faces: 9,
        }));
        let json = serde_json::to_value(wire).expect("serializes");
        assert_eq!(json["code"], "arrangement_refused");
        assert_eq!(json["first_face"], 7);
        assert!(json.get("Cells").is_none(), "nested arm leaked to the wire");
    }

    /// A contradiction names both rules and both creases.
    #[test]
    fn a_contradiction_names_both_rules_and_both_creases() {
        let wire = Fold3dOrderWire::from(Fold3dOrderError::ContradictorySeeds {
            upper: 3,
            lower: 5,
            first: (SeedKind::FullFold, 11),
            second: (SeedKind::Wall, 13),
        });
        let json = serde_json::to_value(wire).expect("serializes");
        assert_eq!(json["code"], "contradictory_seeds");
        assert_eq!(json["first_rule"], "full_fold");
        assert_eq!(json["first_line"], 11);
        assert_eq!(json["second_rule"], "wall");
        assert_eq!(json["second_line"], 13);
    }

    /// The verdict is tagged `verdict`, so a consumer can hold a refusal and a
    /// verdict in one object without their tags colliding.
    #[test]
    fn the_verdict_tag_does_not_collide_with_the_refusal_tag() {
        let json = serde_json::to_value(Fold3dVerdict::TransversalCrossing { crossings: 4 })
            .expect("serializes");
        assert_eq!(json["verdict"], "transversal_crossing");
        assert_eq!(json["crossings"], 4);
        assert!(json.get("code").is_none());

        let nested = serde_json::to_value(Fold3dVerdict::NoLayerOrder {
            reason: Fold3dOrderWire::SearchFailed { component: 1 },
        })
        .expect("serializes");
        assert_eq!(nested["verdict"], "no_layer_order");
        assert_eq!(nested["reason"]["code"], "search_failed");
    }
}
