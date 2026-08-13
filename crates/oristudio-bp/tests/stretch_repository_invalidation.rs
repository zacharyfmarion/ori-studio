//! A stretch's stored repository must not survive a change in junction
//! structure.
//!
//! BP Studio keeps a live `Repository` per stretch and discards it whenever
//! `getStructureSignature(junctions)` changes, rebuilding from index 0
//! (`core/design/layout/stretch.ts#$update`). This port is stateless per call
//! and rebuilds repositories from the persisted stretch JSON, so without an
//! equivalent guard a stored repository outlives the geometry it describes:
//! the old configuration set is reused wholesale and its gadget is rigidly
//! translated onto the new flap position, producing a device that does not fit
//! its own region.
//!
//! Ground truth is BP Studio's headless Core via `tools/bp-studio-oracle`,
//! driven through the real client sequence — `DesignController.init`,
//! `LayoutController.completeStretch`, `LayoutController.switchPattern`, then
//! `DesignController.update` with an **empty** stretch list, because the client
//! calls `$resetPrototype()` after every core response.

use oristudio_bp::engine::BpProjectSession;
use oristudio_bp::io::bps;
use oristudio_bp::model::{Point, Project};

const PINNING: &str =
    include_str!("../../../tests/fixtures/bp-studio/pythagorean-stretch-pinning.sample.json");

/// BP Studio's device ridges for this design after moving flap 1 to (13,4),
/// with the junction overlap regenerated from (3,1) to (2,2). Identical whether
/// or not the user switched pattern beforehand — the stretch is rebuilt either
/// way.
const ORACLE_RIDGES_AT_13_4: &str = "[[[13,4],[12,7]],[[12,7],[8,9]],[[8,9],[9,6]],[[9,6],[13,4]],[[13,4],[13,4]],[[8,9],[8,9]],[[12,7],[14,5]],[[9,6],[12,3]]]";

fn project() -> Project {
    bps::load_project_str(PINNING).expect("pinning fixture loads")
}

/// The device ridges the packing pane draws, as compact `[[x,y],[x,y]]` pairs.
fn device_ridges(session: &BpProjectSession) -> String {
    let snapshot =
        oristudio_bp::io::cp::project_graphics_snapshot(session.project()).expect("graphics");
    let value = serde_json::to_value(&snapshot).expect("snapshot serializes");
    let empty = Vec::new();
    let devices = value["deviceGraphics"].as_array().unwrap_or(&empty);
    let Some(device) = devices.first() else {
        return "<no device>".to_string();
    };
    let segments = device["data"]["ridges"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|segment| {
            let points = segment
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|point| format!("[{},{}]", number(&point["x"]), number(&point["y"])))
                .collect::<Vec<_>>();
            format!("[{}]", points.join(","))
        })
        .collect::<Vec<_>>();
    format!("[{}]", segments.join(","))
}

/// Render integral coordinates without a trailing `.0`, matching the oracle's
/// JSON.
fn number(value: &serde_json::Value) -> String {
    let n = value.as_f64().unwrap_or(f64::NAN);
    if n.fract() == 0.0 {
        format!("{n:.0}")
    } else {
        format!("{n}")
    }
}

/// The junction overlaps every stored configuration was generated for.
fn stored_overlaps(session: &BpProjectSession) -> Vec<(f64, f64)> {
    session
        .project()
        .design
        .layout
        .stretches
        .iter()
        .filter_map(|stretch| stretch.repo.as_ref())
        .flat_map(|repo| repo.configurations.iter())
        .flat_map(|config| config.partitions.iter())
        .flat_map(|partition| partition.overlaps.iter())
        .map(|overlap| (overlap.ox, overlap.oy))
        .collect()
}

#[test]
fn moving_a_flap_regenerates_a_switched_stretch() {
    let mut session = BpProjectSession::new(project()).expect("session builds");
    session.complete_stretch("1,2").expect("complete stretch");
    session
        .switch_stretch_pattern("1,2", 1)
        .expect("switch to pattern 1");
    assert_eq!(
        stored_overlaps(&session),
        vec![(3.0, 1.0)],
        "the switch stores a repository for the (3,1) overlap at (12,3)"
    );

    session
        .move_flap(1, Point { x: 13.0, y: 4.0 }, false)
        .expect("move flap 1 to (13,4)");

    assert_eq!(
        device_ridges(&session),
        ORACLE_RIDGES_AT_13_4,
        "the stretch must regenerate for the new (2,2) overlap, not translate \
         the (3,1) gadget stored by the pattern switch"
    );
}

#[test]
fn a_saved_repository_does_not_survive_a_flap_move() {
    // The fixture is a real saved file: it already carries a stored repository
    // for the (3,1) overlap, so it pins on the very first move with no
    // interaction at all.
    let mut session = BpProjectSession::new(project()).expect("session builds");
    assert_eq!(
        stored_overlaps(&session),
        vec![(3.0, 1.0)],
        "fixture ships a stored repository"
    );

    session
        .move_flap(1, Point { x: 13.0, y: 4.0 }, false)
        .expect("move flap 1 to (13,4)");

    assert_eq!(device_ridges(&session), ORACLE_RIDGES_AT_13_4);
}

#[test]
fn a_stretch_that_never_moved_keeps_its_switched_pattern() {
    // The guard must not reach further than upstream's: while the structure is
    // unchanged, the chosen pattern survives — that is the whole point of
    // storing the repository.
    let mut session = BpProjectSession::new(project()).expect("session builds");
    session.complete_stretch("1,2").expect("complete stretch");
    let before = device_ridges(&session);
    session
        .switch_stretch_pattern("1,2", 1)
        .expect("switch to pattern 1");
    let switched = device_ridges(&session);
    assert_ne!(before, switched, "switching changes the device");

    // A move that leaves the junction structure alone: both flaps travel
    // together, so the overlap is unchanged and only the origin shifts.
    session
        .move_flaps(&[1, 2], Point { x: 11.0, y: 2.0 }, false)
        .expect("move both flaps");

    assert_eq!(
        stored_overlaps(&session),
        vec![(3.0, 1.0)],
        "structure unchanged, so the stored repository is still valid"
    );
    let moved = device_ridges(&session);
    assert_ne!(moved, "<no device>", "the stretch still has a device");
    assert_ne!(
        moved, before,
        "the switched pattern survives a structure-preserving move"
    );
}

#[test]
fn a_repository_without_a_signature_is_not_trusted() {
    // Files written before the signature existed — including the fixture, once
    // its signature is stripped — must regenerate rather than be believed.
    // Select pattern 1 in the stored repository so that trusting it and
    // discarding it give different answers.
    let mut project = project();
    for stretch in &mut project.design.layout.stretches {
        if let Some(repo) = &mut stretch.repo {
            repo.signature = None;
            for config in &mut repo.configurations {
                config.index = Some(1);
            }
        }
    }
    let session = BpProjectSession::new(project).expect("session builds");

    let snapshot =
        oristudio_bp::io::cp::project_graphics_snapshot(session.project()).expect("graphics");
    let value = serde_json::to_value(&snapshot).expect("snapshot serializes");
    assert_eq!(
        value["stretches"][0]["patternIndex"], 0,
        "an unsigned repository is discarded, so the search restarts at index 0"
    );
}
