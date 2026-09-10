//! What a planner should do next — the rules, written once, for every driver.
//!
//! Planning a crease pattern is a small loop: close up everything constructible,
//! and when that runs out, search for an auxiliary fold that unlocks more; when
//! *that* runs out, ask ReferenceFinder for an exact construction; and when
//! there is none, ask it for the closest one and fold that, marked as the
//! approximation it is. The loop body cannot live in this crate
//! — ReferenceFinder is vendored C++ that only the browser can reach, the loop
//! has to yield between chunks so a large pattern does not freeze the UI, and it
//! has to be interruptible. All three make it async, and nothing here is.
//!
//! So the *body* is the driver's. The **decisions** are not, and that is the
//! whole point of this module. They used to be written twice — once in
//! [`crate::planner::Planner::plan_without_reference_finder`] and once in the
//! browser's own loop — and the two drifted: the browser grew separate exits for
//! stalling, for off-lattice patterns and for an RF call cap, and answered "why
//! did we stop" with an enum this crate had never heard of. The same pattern
//! could stop for different reasons depending on who ran it.
//!
//! Now a driver reports what it just did ([`LastStep`]) plus the handful of
//! facts only it knows ([`DriverState`]), and is told what to do next
//! ([`PlanAction`]). A driver that cannot call ReferenceFinder says so, and is
//! told to stop — which is the honest form of a branch that used to be missing.

use serde::{Deserialize, Serialize};

/// Why a plan run ended.
///
/// One vocabulary for both drivers. `Complete` and `Unsolved` are properties
/// of the plan; `Budget`, `Aborted` and `PointCap` are properties of the run,
/// and used to exist only in the browser.
///
/// There is no off-lattice stop. A component off the lattice used to close
/// once and report the rest, on the reasoning that an approximation would
/// become a reference for every later step. It would — but the folder has to
/// make those creases either way, and a plan that stops leaves them to guess.
/// So such a component goes round the same loop as any other, and the lines
/// with no exact construction are folded last, by the closest one, and say so.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    /// Every target folded.
    Complete,
    /// The search ran out of ideas with targets left; they become findings.
    Unsolved,
    /// Out of time, or out of ReferenceFinder calls.
    Budget,
    /// The caller asked us to stop.
    Aborted,
    /// The sheet itself was refused; nothing was ever planned.
    RefusedSheet,
    /// The state grew past the point cap.
    PointCap,
}

/// What the driver just finished doing, so the rules know where in the loop it
/// is. A driver that has done nothing yet reports [`LastStep::Nothing`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LastStep {
    /// Nothing yet: the run is starting.
    Nothing,
    /// The closure ran. `stalled` means it neither reached a fixpoint nor made
    /// progress — it is out of budget and going round again would not help.
    Closed { stalled: bool },
    /// The stuck search ran; `found` means it folded something.
    Searched { found: bool },
    /// ReferenceFinder was asked for an exact construction; `folded` means its
    /// answer was certified and folded.
    AskedReferenceFinder { folded: bool },
    /// ReferenceFinder was asked for the closest construction of a remaining
    /// line; `folded` means one was folded, as an approximation.
    Approximated { folded: bool },
}

/// The facts only the driver knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DriverState {
    pub last: LastStep,
    /// The run's own wall-clock budget is spent.
    pub out_of_time: bool,
    /// The caller asked us to stop.
    pub aborted: bool,
    /// This driver can reach ReferenceFinder at all.
    pub reference_finder: bool,
    /// How many times it has been asked for an exact construction, against
    /// its cap.
    pub rf_events: u32,
    pub max_rf_events: u32,
    /// This driver can fold the closest construction of a line that has no
    /// exact one. Not counted against `max_rf_events`: each such event folds
    /// one target, so the targets left bound it.
    #[serde(default)]
    pub approximate: bool,
}

impl Default for DriverState {
    fn default() -> DriverState {
        DriverState {
            last: LastStep::Nothing,
            out_of_time: false,
            aborted: false,
            reference_finder: false,
            rf_events: 0,
            max_rf_events: 0,
            approximate: false,
        }
    }
}

/// What to do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlanAction {
    /// Close up everything constructible. Resumable, so a driver may do this in
    /// chunks and report `Closed` once it has a fixpoint or has stalled.
    Close,
    /// Search for an auxiliary fold that unlocks a target.
    StuckSearch,
    /// Ask ReferenceFinder for an exact construction. Only ever returned to a
    /// driver that said it has one.
    AskReferenceFinder,
    /// Ask ReferenceFinder for the closest construction of each remaining line
    /// and fold the best of them, as an approximation. Only ever returned to a
    /// driver that said it can, and only once nothing exact is left to make.
    Approximate,
    /// Stop, for this reason.
    ///
    /// A struct variant, not a newtype: an internally tagged enum cannot carry
    /// a bare string as its content, and this crosses the wasm boundary as JSON.
    Stop { reason: StopReason },
}

/// What the plan itself says, independent of the driver — supplied by the
/// planner so the rules below stay a pure function.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanState {
    pub refused: bool,
    pub complete: bool,
    pub point_cap_hit: bool,
}

/// The rules. A pure function, so both drivers and a test can ask it.
pub fn next_action(plan: PlanState, driver: DriverState) -> PlanAction {
    // Three answers that do not depend on where in the loop we are.
    if plan.refused {
        return PlanAction::Stop {
            reason: StopReason::RefusedSheet,
        };
    }
    if driver.aborted {
        return PlanAction::Stop {
            reason: StopReason::Aborted,
        };
    }
    if plan.point_cap_hit {
        return PlanAction::Stop {
            reason: StopReason::PointCap,
        };
    }

    match driver.last {
        LastStep::Nothing => PlanAction::Close,

        LastStep::Closed { stalled } => {
            if plan.complete {
                PlanAction::Stop {
                    reason: StopReason::Complete,
                }
            } else if stalled || driver.out_of_time {
                PlanAction::Stop {
                    reason: StopReason::Budget,
                }
            } else {
                PlanAction::StuckSearch
            }
        }

        // Progress: go round again. Anything else is a reason to stop, and the
        // order matters — "we have no ReferenceFinder" is a property of the
        // plan (unsolved), "we have used it up" is a property of the run.
        LastStep::Searched { found: true } => PlanAction::Close,
        LastStep::Searched { found: false } => {
            if !driver.reference_finder {
                PlanAction::Stop {
                    reason: StopReason::Unsolved,
                }
            } else if driver.rf_events >= driver.max_rf_events || driver.out_of_time {
                PlanAction::Stop {
                    reason: StopReason::Budget,
                }
            } else {
                PlanAction::AskReferenceFinder
            }
        }

        LastStep::AskedReferenceFinder { folded: true } => PlanAction::Close,
        // Nothing exact is left to make: the lines still standing have no
        // exact construction from here. Fold the closest one, if this driver
        // can, and go round again — what the pattern derives from it may
        // close exactly relative to it.
        LastStep::AskedReferenceFinder { folded: false }
        | LastStep::Approximated { folded: true } => {
            if !driver.approximate {
                PlanAction::Stop {
                    reason: StopReason::Unsolved,
                }
            } else if driver.out_of_time {
                PlanAction::Stop {
                    reason: StopReason::Budget,
                }
            } else if matches!(driver.last, LastStep::Approximated { .. }) {
                PlanAction::Close
            } else {
                PlanAction::Approximate
            }
        }
        LastStep::Approximated { folded: false } => PlanAction::Stop {
            reason: StopReason::Unsolved,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUNNING: PlanState = PlanState {
        refused: false,
        complete: false,
        point_cap_hit: false,
    };

    fn after(last: LastStep) -> DriverState {
        DriverState {
            last,
            ..DriverState::default()
        }
    }

    /// The wasm bridge sends these across as JSON, and an internally tagged
    /// enum cannot carry a bare string as its content — `Stop(StopReason)`
    /// would compile and then fail at the boundary, where only the browser
    /// would see it.
    #[test]
    fn every_action_survives_the_json_the_bridge_sends_it_as() {
        for action in [
            PlanAction::Close,
            PlanAction::StuckSearch,
            PlanAction::AskReferenceFinder,
            PlanAction::Approximate,
            PlanAction::Stop {
                reason: StopReason::Complete,
            },
            PlanAction::Stop {
                reason: StopReason::PointCap,
            },
        ] {
            let json = serde_json::to_string(&action).expect("serialize");
            assert_eq!(
                serde_json::from_str::<PlanAction>(&json).expect("round trip"),
                action,
                "{json}"
            );
        }
        assert_eq!(
            serde_json::to_string(&PlanAction::Stop {
                reason: StopReason::Budget
            })
            .expect("serialize"),
            r#"{"kind":"stop","reason":"budget"}"#
        );
    }

    #[test]
    fn a_driver_state_survives_the_same_trip() {
        let ds = DriverState {
            last: LastStep::Searched { found: false },
            out_of_time: true,
            aborted: false,
            reference_finder: true,
            rf_events: 2,
            max_rf_events: 5,
            approximate: true,
        };
        let json = serde_json::to_string(&ds).expect("serialize");
        assert_eq!(
            serde_json::from_str::<DriverState>(&json).expect("round trip"),
            ds,
            "{json}"
        );
    }

    #[test]
    fn a_run_starts_by_closing() {
        assert_eq!(
            next_action(RUNNING, DriverState::default()),
            PlanAction::Close
        );
    }

    #[test]
    fn a_driver_without_reference_finder_is_told_so_rather_than_left_to_guess() {
        // This is the branch that used to be missing from the headless loop
        // rather than written down: it stopped because it had no code to ask,
        // not because anything decided it should.
        let ds = after(LastStep::Searched { found: false });
        assert_eq!(
            next_action(RUNNING, ds),
            PlanAction::Stop {
                reason: StopReason::Unsolved
            }
        );
        let with_rf = DriverState {
            reference_finder: true,
            max_rf_events: 3,
            ..ds
        };
        assert_eq!(
            next_action(RUNNING, with_rf),
            PlanAction::AskReferenceFinder
        );
    }

    #[test]
    fn using_up_the_reference_finder_budget_is_a_budget_stop_not_an_unsolved_one() {
        let ds = DriverState {
            last: LastStep::Searched { found: false },
            reference_finder: true,
            rf_events: 3,
            max_rf_events: 3,
            ..DriverState::default()
        };
        assert_eq!(
            next_action(RUNNING, ds),
            PlanAction::Stop {
                reason: StopReason::Budget
            }
        );
    }

    #[test]
    fn progress_of_either_kind_goes_round_again() {
        assert_eq!(
            next_action(RUNNING, after(LastStep::Searched { found: true })),
            PlanAction::Close
        );
        assert_eq!(
            next_action(
                RUNNING,
                after(LastStep::AskedReferenceFinder { folded: true })
            ),
            PlanAction::Close
        );
    }

    #[test]
    fn a_complete_plan_beats_every_other_reason_to_stop() {
        let plan = PlanState {
            complete: true,
            ..RUNNING
        };
        let ds = DriverState {
            out_of_time: true,
            ..after(LastStep::Closed { stalled: true })
        };
        assert_eq!(
            next_action(plan, ds),
            PlanAction::Stop {
                reason: StopReason::Complete
            }
        );
    }

    #[test]
    fn an_abort_beats_everything_except_a_sheet_that_was_never_planned() {
        let ds = DriverState {
            aborted: true,
            ..after(LastStep::Closed { stalled: false })
        };
        assert_eq!(
            next_action(RUNNING, ds),
            PlanAction::Stop {
                reason: StopReason::Aborted
            }
        );
        let refused = PlanState {
            refused: true,
            ..RUNNING
        };
        assert_eq!(
            next_action(refused, ds),
            PlanAction::Stop {
                reason: StopReason::RefusedSheet
            }
        );
    }

    #[test]
    fn a_stalled_closure_stops_on_budget() {
        assert_eq!(
            next_action(RUNNING, after(LastStep::Closed { stalled: true })),
            PlanAction::Stop {
                reason: StopReason::Budget
            }
        );
    }

    /// With nothing exact left, a driver that can fold approximations is told
    /// to; one that cannot stops unsolved, as before. An approximation folded
    /// is progress, so the loop closes again before asking for the next — a
    /// line the pattern derives from it may now close exactly.
    #[test]
    fn approximations_come_only_after_every_exact_avenue_and_one_at_a_time() {
        let exact_failed = after(LastStep::AskedReferenceFinder { folded: false });
        assert_eq!(
            next_action(RUNNING, exact_failed),
            PlanAction::Stop {
                reason: StopReason::Unsolved
            }
        );
        let can = DriverState {
            approximate: true,
            reference_finder: true,
            ..exact_failed
        };
        assert_eq!(next_action(RUNNING, can), PlanAction::Approximate);
        assert_eq!(
            next_action(
                RUNNING,
                DriverState {
                    out_of_time: true,
                    ..can
                }
            ),
            PlanAction::Stop {
                reason: StopReason::Budget
            }
        );
        // The exact cap does not bound approximations: each folds a target.
        assert_eq!(
            next_action(
                RUNNING,
                DriverState {
                    rf_events: 9,
                    max_rf_events: 4,
                    ..can
                }
            ),
            PlanAction::Approximate
        );
        let folded = DriverState {
            last: LastStep::Approximated { folded: true },
            ..can
        };
        assert_eq!(next_action(RUNNING, folded), PlanAction::Close);
        let nothing = DriverState {
            last: LastStep::Approximated { folded: false },
            ..can
        };
        assert_eq!(
            next_action(RUNNING, nothing),
            PlanAction::Stop {
                reason: StopReason::Unsolved
            }
        );
        // And an exact fold is never skipped for an approximation: a closure
        // that is not complete searches first.
        assert_eq!(
            next_action(
                RUNNING,
                DriverState {
                    ..after(LastStep::Closed { stalled: false })
                }
            ),
            PlanAction::StuckSearch
        );
    }
}
