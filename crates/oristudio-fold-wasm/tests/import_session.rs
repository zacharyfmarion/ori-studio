//! A held import's checking session across the bridge (`import_session`,
//! `import_check`), natively.
#![cfg(not(target_arch = "wasm32"))]

use oristudio_fold::{FaceId, StartSide};
use oristudio_fold_wasm::bridge::Bridge;
use oristudio_fold_wasm::io::Imports;
use oristudio_fold_wasm::io::wire::{
    CheckWireLimits, Checked, CpFile, CpFormat, Limits, SessionOpened, Target,
};
use oristudio_fold_wasm::wire::Outcome;

fn kabuto(imports: &mut Imports, bridge: &Bridge) -> u32 {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/flat-folder/kabuto.fold");
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{e}"));
    let opened = imports.open(
        bridge,
        CpFile::of(CpFormat::Fold),
        &bytes,
        Target::Empty {
            start_side: StartSide::Front,
        },
        &Limits::default(),
    );
    match opened {
        Ok(Outcome::Ok(opened)) => opened.import,
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_session_checks_choices_on_a_held_import() {
    let bridge = Bridge::new();
    let mut imports = Imports::new();
    let import = kabuto(&mut imports, &bridge);
    let limits = CheckWireLimits::default();
    assert!(
        imports.check(import, &[], &limits).is_err(),
        "no session yet"
    );
    let opened = match imports.open_session(import, &Limits::default()) {
        Ok(Outcome::Ok(opened)) => opened,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        opened,
        SessionOpened {
            import,
            forced: 81,
            nodes: opened.nodes,
        }
    );
    // Nothing asked: the order shown fits as it is.
    assert!(matches!(
        imports.check(import, &[], &limits),
        Ok(Checked::Fits { changed: 0, .. })
    ));
    // Every ordered pair of faces that overlap, both ways: a forced pair
    // one way is refused the other, an open one fits either way.
    let mut fits = 0;
    let mut forced = 0;
    for a in 0..18 {
        for b in 0..18 {
            if a == b {
                continue;
            }
            match imports.check(import, &[[FaceId(a), FaceId(b)]], &limits) {
                Ok(Checked::Fits { .. }) => fits += 1,
                Ok(Checked::Forced { pair, traced }) => {
                    assert_eq!(pair, [FaceId(a), FaceId(b)]);
                    assert!(!traced.is_empty());
                    forced += 1;
                }
                Ok(other) => panic!("{a} over {b}: {other:?}"),
                // Faces that do not overlap.
                Err(_) => {}
            }
        }
    }
    assert_eq!(forced, 81);
    assert_eq!(fits, 2 * 117 - 81);
    assert_eq!(
        imports.check(
            import,
            &[[FaceId(0), FaceId(1)], [FaceId(1), FaceId(0)]],
            &limits
        ),
        Ok(Checked::Contradictory {
            pair: [FaceId(0), FaceId(1)]
        })
    );
    assert!(imports.release(import));
    assert!(imports.check(import, &[], &limits).is_err());
}
