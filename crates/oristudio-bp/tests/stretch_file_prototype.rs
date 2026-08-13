//! A stretch saved in BP Studio's file form must restore the chosen pattern.
//!
//! Upstream strips the session `repo` when serializing a file and keeps
//! `{id, configuration, pattern}` — the selected configuration's partitions
//! plus the selected pattern
//! (`client/project/components/layout/stretch.ts`: `if(!session) delete
//! result.repo`). On load, `configGenerator` yields that prototype **first and
//! then keeps searching**, so the chosen pattern comes back and the rest of the
//! options stay available.
//!
//! Both fixtures were written by BP Studio's own serializer through
//! `tools/bp-studio-oracle`, not by hand — a hand-built prototype does not
//! reproduce upstream's device JSON and quietly measures something else.

use oristudio_bp::engine::BpProjectSession;
use oristudio_bp::io::bps;

const FILE_PATTERN_0: &str =
    include_str!("../../../tests/fixtures/bp-studio/pythagorean-stretch-file-pattern0.sample.json");
const FILE_PATTERN_1: &str =
    include_str!("../../../tests/fixtures/bp-studio/pythagorean-stretch-file-pattern1.sample.json");

/// BP Studio's device ridges on load, per saved pattern, **sorted**: the ridges
/// form a ring and the port walks it from a different vertex, which the oracle
/// harness documents as a harmless difference. Captured by reloading each
/// fixture in a fresh process — `DesignController.init` does not clear
/// `State.$stretches`, so a second `init` in one process reuses the previous
/// stretch and reports the wrong thing.
const ORACLE_RIDGES_PATTERN_0: &str = "[[[10,4],[11,3]],[[10,4],[12,3]],[[10,8],[14,4]],[[10,8],[8.5,8.5]],[[11,6],[10,8]],[[11,6],[8.5,8.5]],[[12,3],[11,6]],[[12,3],[12,3]],[[8.5,8.5],[10,4]],[[8.5,8.5],[8,9]]]";
const ORACLE_RIDGES_PATTERN_1: &str = "[[[10,4],[11,3]],[[10,4],[11.5,3.5]],[[10,8],[14,4]],[[10,8],[8,9]],[[11.5,3.5],[10,8]],[[11.5,3.5],[12,3]],[[8,9],[8,9]],[[8,9],[9,6]],[[9,6],[10,4]],[[9,6],[11.5,3.5]]]";

fn session(text: &str) -> BpProjectSession {
    let project = bps::load_project_str(text).expect("fixture loads");
    let stretch = project
        .design
        .layout
        .stretches
        .first()
        .expect("fixture has a stretch");
    assert!(
        stretch.repo.is_none() && stretch.configuration.is_some() && stretch.pattern.is_some(),
        "fixture must be in the file form, not the session form"
    );
    BpProjectSession::new(project).expect("session builds")
}

fn snapshot(session: &BpProjectSession) -> serde_json::Value {
    let snapshot =
        oristudio_bp::io::cp::project_graphics_snapshot(session.project()).expect("graphics");
    serde_json::to_value(&snapshot).expect("snapshot serializes")
}

/// Every device ridge with length, sorted.
///
/// Sorted because the ridges form a ring and the port walks it from a different
/// vertex, which the oracle harness documents as harmless. Zero-length segments
/// are dropped because the port emits more of them than upstream on this
/// pattern — a pre-existing divergence in device-ridge generation, unrelated to
/// prototype restoration: loading this design before any of this work already
/// produced the extra `[8.5,8.5]-[8.5,8.5]` and `[11,6]-[11,6]` segments.
/// Degenerate segments draw nothing, so they cannot answer the question this
/// test asks, which is whether the right pattern came back.
fn sorted_ridges(session: &BpProjectSession) -> String {
    let snapshot = snapshot(session);
    let empty = Vec::new();
    let mut segments = snapshot["deviceGraphics"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .flat_map(|device| {
            device["data"]["ridges"]
                .as_array()
                .cloned()
                .unwrap_or_default()
        })
        .filter(|segment| {
            let points = segment.as_array().cloned().unwrap_or_default();
            points.len() != 2 || points[0] != points[1]
        })
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
    segments.sort();
    format!("[{}]", segments.join(","))
}

/// The oracle's ridges with the same zero-length filter applied.
fn without_degenerate(ridges: &str) -> String {
    let parsed: Vec<serde_json::Value> = serde_json::from_str(ridges).expect("oracle ridges parse");
    let mut segments = parsed
        .iter()
        .filter(|segment| {
            let points = segment.as_array().cloned().unwrap_or_default();
            points.len() != 2 || points[0] != points[1]
        })
        .map(|segment| serde_json::to_string(segment).expect("segment serializes"))
        .collect::<Vec<_>>();
    segments.sort();
    format!("[{}]", segments.join(","))
}

fn number(value: &serde_json::Value) -> String {
    let n = value.as_f64().unwrap_or(f64::NAN);
    if n.fract() == 0.0 {
        format!("{n:.0}")
    } else {
        format!("{n}")
    }
}

#[test]
fn a_saved_file_restores_the_chosen_pattern() {
    assert_eq!(
        sorted_ridges(&session(FILE_PATTERN_0)),
        without_degenerate(ORACLE_RIDGES_PATTERN_0)
    );
    assert_eq!(
        sorted_ridges(&session(FILE_PATTERN_1)),
        without_degenerate(ORACLE_RIDGES_PATTERN_1),
        "saving with pattern 1 and reopening must not silently fall back to pattern 0"
    );
}

#[test]
fn the_two_saved_patterns_differ() {
    // Guards the test above: if the fixtures ever collapse to the same geometry
    // it would pass while measuring nothing.
    assert_ne!(
        sorted_ridges(&session(FILE_PATTERN_0)),
        sorted_ridges(&session(FILE_PATTERN_1))
    );
}

#[test]
fn a_restored_prototype_keeps_the_other_patterns_available() {
    // The prototype is yielded first and the search still runs, so the stretch
    // stays switchable.
    //
    // Upstream reports *three* patterns here, for a configuration that natively
    // generates two: its `patternGenerator` dedup compares the signature of an
    // initialized prototype `Pattern` against freshly generated devices, which
    // do not match, so the restored pattern survives alongside its own
    // duplicate. This port's dedup does match, giving two. The option *set* is
    // identical either way — the extra upstream entry is a copy of one already
    // in the list — so nothing is lost, and a duplicate entry in the pattern
    // switcher is not a quirk worth reproducing.
    for text in [FILE_PATTERN_0, FILE_PATTERN_1] {
        let mut session = session(text);
        let restored = sorted_ridges(&session);
        session.complete_stretch("1,2").expect("complete stretch");
        let snapshot = snapshot(&session);
        let stretch = &snapshot["stretches"][0];
        assert_eq!(stretch["patternCount"], 2);
        assert_eq!(stretch["patternIndex"], 0);
        assert_eq!(stretch["configurationCount"], 1);
        assert_eq!(stretch["configurationIndex"], 0);
        assert_eq!(
            sorted_ridges(&session),
            restored,
            "completing the search must not move the stretch off the saved pattern"
        );
    }
}

#[test]
fn a_restored_prototype_can_still_be_switched() {
    // The user's saved choice is restorable *and* they can move off it — which
    // is what the extra patterns are for.
    let mut session = session(FILE_PATTERN_1);
    session.complete_stretch("1,2").expect("complete stretch");
    let restored = sorted_ridges(&session);
    session
        .switch_stretch_pattern("1,2", 1)
        .expect("switch pattern");
    assert_ne!(
        sorted_ridges(&session),
        restored,
        "a stretch restored from a file must still offer its other patterns"
    );
}

const PINNING: &str =
    include_str!("../../../tests/fixtures/bp-studio/pythagorean-stretch-pinning.sample.json");

/// The session form keeps what only makes sense while running; the file form
/// keeps what upstream's `Project.toJSON()` keeps.
#[test]
fn the_file_form_drops_session_state() {
    let project = bps::load_project_str(PINNING).expect("fixture loads");
    let mut session = BpProjectSession::new(project).expect("session builds");
    session.complete_stretch("1,2").expect("complete stretch");

    let session_form = session.project_for_export();
    let stretch = &session_form.design.layout.stretches[0];
    assert!(stretch.repo.is_some(), "session form keeps the repository");
    assert!(session_form.history.is_some(), "session form keeps history");

    let file_form = session.project_for_file().expect("file form builds");
    let stretch = &file_form.design.layout.stretches[0];
    assert!(stretch.repo.is_none(), "a file must not carry a repository");
    assert!(stretch.configuration.is_some());
    assert!(stretch.pattern.is_some());
    assert!(file_form.history.is_none(), "a file must not carry history");
    assert!(file_form.state.is_none(), "a file must not carry state");
    assert!(
        stretch
            .configuration
            .as_ref()
            .is_some_and(|config| config.patterns.is_none() && config.index.is_none()),
        "`patterns` and `index` are session-only in JConfiguration"
    );

    let text = oristudio_bp::io::bps::save_project_string(&file_form).expect("serializes");
    for session_only in ["\"repo\"", "\"history\"", "\"state\""] {
        assert!(
            !text.contains(session_only),
            "exported .bps still contains {session_only}"
        );
    }
}

/// Save with a chosen pattern, reopen, and get that pattern back — the whole
/// point of the file form.
#[test]
fn a_switched_pattern_survives_a_save_and_reload() {
    let project = bps::load_project_str(PINNING).expect("fixture loads");
    let mut saving = BpProjectSession::new(project).expect("session builds");
    saving.complete_stretch("1,2").expect("complete stretch");
    saving
        .switch_stretch_pattern("1,2", 1)
        .expect("switch to pattern 1");
    let before = sorted_ridges(&saving);

    let file_form = saving.project_for_file().expect("file form builds");
    let text = oristudio_bp::io::bps::save_project_string(&file_form).expect("serializes");

    let reopened = BpProjectSession::new(bps::load_project_str(&text).expect("reloads"))
        .expect("session builds");
    assert_eq!(
        sorted_ridges(&reopened),
        before,
        "reopening must show the pattern that was saved"
    );
    assert_eq!(
        sorted_ridges(&reopened),
        without_degenerate(ORACLE_RIDGES_PATTERN_1),
        "and it must be the pattern BP Studio shows for the same file"
    );
}

/// A file written today must not re-pin: the reopened stretch has to regenerate
/// when a flap moves, which is the bug this whole change is about.
#[test]
fn a_reopened_file_does_not_pin_on_a_flap_move() {
    let project = bps::load_project_str(PINNING).expect("fixture loads");
    let mut saving = BpProjectSession::new(project).expect("session builds");
    saving.complete_stretch("1,2").expect("complete stretch");
    saving
        .switch_stretch_pattern("1,2", 1)
        .expect("switch to pattern 1");
    let text = oristudio_bp::io::bps::save_project_string(
        &saving.project_for_file().expect("file form builds"),
    )
    .expect("serializes");

    let mut reopened = BpProjectSession::new(bps::load_project_str(&text).expect("reloads"))
        .expect("session builds");
    reopened
        .move_flap(1, oristudio_bp::model::Point { x: 13.0, y: 4.0 }, false)
        .expect("move flap 1");

    // Same expectation as the in-session case: the (2,2) overlap, regenerated.
    let overlaps = reopened
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
        .collect::<Vec<_>>();
    assert!(
        !overlaps.contains(&(3.0, 1.0)),
        "the reopened stretch is still pinned to the saved (3,1) overlap"
    );
}
