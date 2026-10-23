//! The Fold engine's vertex folds checked from outside (plan D8, D19, Phase
//! 11): the states its squash, petal fold, rabbit ear and swivel land,
//! verified by the two oracles `fold_oracle` uses, which share no code with
//! it.
//!
//! - **The seeded squash campaign** (`r2-spike-squash-petal-rabbit`,
//!   `campaign.mjs`), drawn by `oristudio_fold::random` as the engine's own
//!   `tests/squash.rs` draws it: every squash that lands.
//! - **The spike's named cases** (`cases.mjs`), built by the engine's own
//!   `tests/vertex/cases.rs`: the preliminary base by the diagonal route (and
//!   in mirror image) and the waterbomb base by the midline route, each
//!   squash; the bird base's two petal folds, both ways, over precreases and
//!   with H named by its two ends and creased by the folds (the kites too,
//!   or precreased), and each petal fold with H through two points along
//!   the flap that lands; every rabbit ear's
//!   every emergent ray that lands, valley and mountain (one ear each, its
//!   fourth crease the ridge); every swivel ray that lands.
//! - **The swivel by its edge's classic cases** (`cases::edge_swivel_cases`):
//!   the rabbit ear at its incenter, the fish base's two swivels, an edge
//!   onto the centre crease off the incenter, a two-layer flap both ways
//!   round, and the swivel at Beloch's `swivel-rabbit` pivot; valley and
//!   mountain, each ridge that lands.
//! - **The swivel on a folded edge** (`cases::fold_swivel_cases`):
//!   Abrashi's on the owner's squashed preliminary base, the kite base
//!   narrowed at its tip on either side and on both; open and inside (his
//!   figure 2, the strip tucked between the layers), valley and mountain,
//!   each order that lands.
//!
//! Seeded Oriedita (`fold_support::oriedita`) runs in process; Flat-Folder's
//! `verify` (`fold_support::flat_folder`) when `FLATFOLDER_ORACLE` is set.
//! Each has the negative control `fold_oracle` has: a pair of a state's order
//! flipped where the engine's checker refuses the flip must not verify.

#[path = "../../oristudio-fold/tests/vertex/cases.rs"]
mod cases;
mod fold_support;
mod support;

use fold_support::flat_folder::{self, Job};
use fold_support::oriedita::{Seeded, Verdict};
use fold_support::{flipped, has_flat_creases, pick, verify_frame, verify_order};
use oristudio_fold::random::{self, Rng};
use oristudio_fold::{RabbitEar, State, Swivel, VertexChoices};
use oristudio_layer_order::check;

/// The campaign's first seed and how many of its draws; the engine's own
/// test runs the same draws.
const SEED: u64 = 1;
const SETUPS: u64 = 400;

/// A state a vertex fold landed.
struct Landed {
    label: String,
    state: State,
}

/// Every state the seeded squash campaign lands.
fn campaign() -> Vec<Landed> {
    let mut out = Vec::new();
    for i in 0..SETUPS {
        let mut rng = Rng::new(SEED * 7919 + i);
        let Ok(state) = random::folded(&mut rng) else {
            continue;
        };
        if state.faces().len() > 60 {
            continue;
        }
        let Some(op) = random::squash(&state, &mut rng) else {
            continue;
        };
        for (k, folded) in cases::every(state.squash(&op, &VertexChoices::default()))
            .into_iter()
            .enumerate()
        {
            out.push(Landed {
                label: format!("squash s{SEED}-{i:04}-c{k}"),
                state: folded.state,
            });
        }
    }
    out
}

/// Every state of the spike's named cases.
fn named() -> Vec<Landed> {
    let mut out = Vec::new();
    let mut push = |label: String, state: State| out.push(Landed { label, state });
    for (name, route) in [
        ("preliminary", cases::preliminary(false)),
        ("preliminary mirrored", cases::preliminary(true)),
        ("waterbomb", cases::waterbomb()),
        ("bird base", cases::bird_base(false)),
        ("bird base mirrored", cases::bird_base(true)),
        // H through its two ends, never precreased: creased by the folds.
        (
            "bird base by H's ends",
            cases::bird_base_points(false, false),
        ),
        (
            "bird base by H's ends mirrored",
            cases::bird_base_points(true, false),
        ),
        (
            "bird base by H's ends, kites first",
            cases::bird_base_points(false, true),
        ),
    ] {
        for (k, (_, folded)) in route.steps.into_iter().enumerate() {
            push(format!("{name} step {k}"), folded.state);
        }
    }
    // H through two points anywhere along the flap: each that lands.
    let (base, petals) = cases::petal_sweep();
    for (s, op) in petals {
        for (k, folded) in cases::every(base.petal_fold(&op, &VertexChoices::default()))
            .into_iter()
            .enumerate()
        {
            push(format!("petal by H's ends at {s:.3} c{k}"), folded.state);
        }
    }
    for case in cases::ear_cases()
        .into_iter()
        .chain(cases::mountain_ear_cases())
    {
        for (deg, emergent) in cases::candidates_of(&case.state, &case.op) {
            let op = RabbitEar {
                emergent,
                ..case.op.clone()
            };
            for (k, folded) in cases::every(case.state.rabbit_ear(&op, &VertexChoices::default()))
                .into_iter()
                .enumerate()
            {
                push(format!("{} {deg}° c{k}", case.name), folded.state);
            }
        }
    }
    let (square, op) = cases::swivel_case();
    let analysis = square.analyse_swivel(&op).unwrap_or_else(|e| panic!("{e}"));
    for (k, &emergent) in analysis.candidates.iter().enumerate() {
        let op = Swivel {
            emergent,
            ..op.clone()
        };
        for folded in cases::every(square.swivel(&op, &VertexChoices::default())) {
            push(format!("swivel ray {k}"), folded.state);
        }
    }
    // The swivel by its edge's classic cases (`cases::edge_swivel_cases`),
    // valley and mountain, each ridge that lands; and the fish base's
    // second swivel on its first.
    use oristudio_fold::{Direction, SwivelByEdge};
    for case in cases::edge_swivel_cases() {
        for direction in [Direction::Valley, Direction::Mountain] {
            let op = SwivelByEdge {
                direction,
                ..case.op.clone()
            };
            let Ok(analysis) = case.state.analyse_swivel_by_edge(&op) else {
                continue;
            };
            for (k, &ridge) in analysis.ridges.iter().enumerate() {
                let op = SwivelByEdge {
                    ridge: Some(ridge),
                    ..op.clone()
                };
                for folded in
                    cases::every(case.state.swivel_by_edge(&op, &VertexChoices::default()))
                {
                    push(
                        format!("{} {direction:?} ridge {k}", case.name),
                        folded.state,
                    );
                }
            }
        }
        if case.name == "fish ear 1" {
            let first = cases::landed(
                case.state
                    .swivel_by_edge(&case.op, &VertexChoices::default()),
            );
            let second = cases::landed(
                first
                    .state
                    .swivel_by_edge(&cases::fish_second(), &VertexChoices::default()),
            );
            push("fish base by swivels".to_string(), second.state);
        }
    }
    // The swivel on a folded edge (`cases::fold_swivel_cases`): Abrashi's on
    // the owner's squashed preliminary base, the kite base narrowed at its
    // tip on either side and then on both; open and inside, valley and
    // mountain, each order that lands.
    use oristudio_fold::SwivelKind;
    let mut kite_right = None;
    for case in cases::fold_swivel_cases() {
        for kind in [SwivelKind::Open, SwivelKind::Inside] {
            for direction in [Direction::Valley, Direction::Mountain] {
                let op = SwivelByEdge {
                    direction,
                    kind,
                    ..case.op.clone()
                };
                for (k, folded) in
                    cases::every(case.state.swivel_by_edge(&op, &VertexChoices::default()))
                        .into_iter()
                        .enumerate()
                {
                    let open = kind == SwivelKind::Open;
                    if case.name == "kite narrowed at c, right"
                        && direction == Direction::Valley
                        && open
                    {
                        kite_right = Some(folded.state.clone());
                    }
                    // The open swivel's labels as they always were.
                    let kind = if open { "" } else { " inside" };
                    push(
                        format!("{}{kind} {direction:?} on its folded edge c{k}", case.name),
                        folded.state,
                    );
                }
            }
        }
    }
    let left = cases::fold_swivel_cases()
        .into_iter()
        .find(|c| c.name == "kite narrowed at c, left")
        .unwrap_or_else(|| panic!("no left kite swivel"));
    let first = kite_right.unwrap_or_else(|| panic!("the right kite swivel did not land"));
    let second = cases::on_fold(
        &first,
        left.op.fold.unwrap_or_default(),
        left.op.edge,
        [0.5, 0.5],
    );
    // The second swivel offers an order where the flaps overlap (the engine's
    // `matching_swivels_offer_orders_without_reordering_stationary_paper`):
    // every one of them.
    for (k, both) in cases::every(first.swivel_by_edge(&second, &VertexChoices::default()))
        .into_iter()
        .enumerate()
    {
        push(format!("kite narrowed at c, both c{k}"), both.state);
    }
    out
}

#[test]
fn every_vertex_fold_verifies_against_seeded_oriedita() {
    let states: Vec<Landed> = campaign().into_iter().chain(named()).collect();
    let (mut verified, mut unrepresentable, mut seeded_pairs) = (0, 0, 0);
    let mut failures = Vec::new();
    for landed in &states {
        let seeded = Seeded::new(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
        match seeded.verify(landed.state.order()) {
            Verdict::Verified { seeded } => {
                verified += 1;
                seeded_pairs += seeded;
            }
            Verdict::Unrepresentable => unrepresentable += 1,
            other => failures.push(format!("{}: {other:?}", landed.label)),
        }
    }
    eprintln!(
        "{verified} of {} vertex-fold states verified ({unrepresentable} unrepresentable); \
         {seeded_pairs} seeded pairs",
        states.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
    assert!(
        verified >= 80 && seeded_pairs >= 300,
        "{verified} verified, {seeded_pairs} pairs"
    );
}

/// Oriedita sees only folding colours, so the control runs where every face
/// is an Oriedita face of its own: few vertex folds leave none flat (a
/// squash unfolds its spine), so each such state has four pairs flipped.
#[test]
fn seeded_oriedita_refuses_flips_of_vertex_folds() {
    let (mut refused, mut valid) = (0, 0);
    let mut missed = Vec::new();
    for (n, landed) in campaign().into_iter().chain(named()).enumerate() {
        if has_flat_creases(&landed.state) || landed.state.order().is_empty() {
            continue;
        }
        let order = landed.state.order();
        let pairs: Vec<_> = order.pairs().map(|(pair, _)| pair).collect();
        let seeded = Seeded::new(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
        for k in 0..4 {
            let pair = pairs[pick(n as u64, landed.state.step() + k, pairs.len())];
            let Some(flip) = flipped(order, pair) else {
                continue;
            };
            if check(landed.state.folded_view(), &flip).is_valid() {
                valid += 1;
                continue;
            }
            match seeded.verify(&flip) {
                Verdict::Verified { .. } => missed.push(format!("{} {pair}", landed.label)),
                _ => refused += 1,
            }
        }
    }
    eprintln!("{refused} flips refused; {valid} flips valid");
    assert!(missed.is_empty(), "Oriedita verified flips: {missed:#?}");
    assert!(refused >= 20, "only {refused} flips tried");
}

#[test]
fn every_vertex_fold_verifies_with_flat_folder_when_enabled() {
    let Some(oracle) = flat_folder::oracle() else {
        return;
    };
    let states: Vec<Landed> = campaign().into_iter().chain(named()).collect();
    let mut jobs = Vec::new();
    for (n, landed) in states.iter().enumerate() {
        let frame = verify_frame(&landed.state).unwrap_or_else(|e| panic!("{}: {e}", landed.label));
        jobs.push(Job {
            name: landed.label.clone(),
            frame: frame.clone(),
            order: frame.face_orders.clone(),
        });
        let order = landed.state.order();
        let pairs: Vec<_> = order.pairs().map(|(pair, _)| pair).collect();
        if pairs.is_empty() {
            continue;
        }
        let pair = pairs[pick(n as u64, landed.state.step(), pairs.len())];
        if let Some(flip) = flipped(order, pair)
            && !check(landed.state.folded_view(), &flip).is_valid()
        {
            jobs.push(Job {
                name: format!("{}-flip", landed.label),
                frame,
                order: verify_order(&landed.state, &flip)
                    .unwrap_or_else(|e| panic!("{}: {e}", landed.label)),
            });
        }
    }
    let records = flat_folder::verify_all(&oracle, &jobs);
    let (mut valid, mut refused) = (0, 0);
    let mut failures = Vec::new();
    for (Job { name, .. }, record) in jobs.iter().zip(&records) {
        let verdict = record["verify"]["verdict"].as_str().unwrap_or_default();
        if name.ends_with("-flip") {
            if verdict == "valid" {
                failures.push(format!("{name}: Flat-Folder accepted the flip"));
            } else {
                refused += 1;
            }
        } else if record["status"] == "ok" && verdict == "valid" {
            valid += 1;
        } else {
            let mut text = record.to_string();
            text.truncate(400);
            failures.push(format!("{name}: {text}"));
        }
    }
    eprintln!(
        "{valid} of {} vertex-fold states valid, {refused} flips refused",
        states.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
    assert_eq!(valid, states.len());
}
