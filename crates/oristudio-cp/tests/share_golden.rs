//! Byte-exactness and cross-platform determinism for the share codec.
//!
//! A share link is a permanent artifact: a URL copied into a chat message today
//! must still decode in five years, on a different machine, in a different
//! engine. That makes the encoder's output a compatibility surface, and these
//! tests are what stop it drifting silently.

use std::path::PathBuf;

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::share::{ShareOptions, b64, decode_share, encode_share};

/// A fixed pattern exercising the border, an interior fan, and both M and V.
fn golden_document() -> CreasePatternDocument {
    let mut model = CreasePatternModel::default();
    let corners = [
        (-200.0, -200.0),
        (200.0, -200.0),
        (200.0, 200.0),
        (-200.0, 200.0),
    ];
    for i in 0..4 {
        let (ax, ay) = corners[i];
        let (bx, by) = corners[(i + 1) % 4];
        model.line_segments.push(LineSegment::with_color(
            Point::new(ax, ay),
            Point::new(bx, by),
            LineColor::Black0,
        ));
    }
    for k in 0..8 {
        let angle = std::f64::consts::FRAC_PI_4 * f64::from(k);
        model.line_segments.push(LineSegment::with_color(
            Point::new(0.0, 0.0),
            Point::new(150.0 * angle.cos(), 150.0 * angle.sin()),
            if k % 2 == 0 {
                LineColor::Red1
            } else {
                LineColor::Blue2
            },
        ));
    }
    CreasePatternDocument {
        crease_pattern: model,
        ..Default::default()
    }
}

fn fixture_path() -> PathBuf {
    fixture_path_for("share-golden.bin")
}

fn fixture_path_for(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/oristudio-cp")
        .join(name)
}

/// The payload must be byte-identical to the committed fixture.
///
/// Set `UPDATE_SHARE_GOLDEN=1` to rewrite it — deliberately explicit, because a
/// changed payload means every previously shared link now decodes through a
/// different path and the change needs a `format_version` bump, not a fixture
/// refresh.
#[test]
fn payload_matches_the_committed_fixture() {
    let payload = encode_share(&golden_document(), ShareOptions::default()).expect("encode");
    let path = fixture_path();

    if std::env::var("UPDATE_SHARE_GOLDEN").is_ok() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("fixture dir");
        }
        std::fs::write(&path, &payload).expect("write fixture");
    }

    let expected = std::fs::read(&path).unwrap_or_else(|_| {
        panic!(
            "missing fixture {}; regenerate with UPDATE_SHARE_GOLDEN=1",
            path.display()
        )
    });
    assert_eq!(
        payload, expected,
        "share payload changed. If this is intentional it needs a new format_version, \
         not a fixture refresh -- old links must keep decoding."
    );
}

/// Every shipped grammar is pinned by its own fixture, forced rather than
/// chosen. The encoder picks whichever is smaller for a given document, so
/// without this a grammar could stop being exercised — and then silently rot —
/// simply by losing the size comparison. Links already shared under it would
/// still be out there.
#[test]
fn every_shipped_grammar_still_decodes() {
    {
        let (version, name) = (oristudio_cp::share::v1::VERSION, "share-v1-golden.bin");
        let path = fixture_path_for(name);
        if std::env::var("UPDATE_SHARE_GOLDEN").is_ok() {
            let body =
                oristudio_cp::share::v1::encode(&golden_document().crease_pattern, None, 36, 36)
                    .expect("encode");
            std::fs::write(&path, oristudio_cp::share::frame::write(version, &body))
                .expect("write fixture");
        }
        let payload = std::fs::read(&path).unwrap_or_else(|_| panic!("missing {name}"));
        assert_eq!(payload[4], version, "{name} must hold a v{version} payload");
        let decoded = decode_share(&payload)
            .unwrap_or_else(|e| panic!("v{version} must decode forever, got {e}"));
        assert_eq!(
            decoded.document.crease_pattern.line_segments.len(),
            golden_document().crease_pattern.line_segments.len(),
            "v{version} lost creases"
        );
    }
}

#[test]
fn the_fixture_decodes_to_the_same_document() {
    let payload = std::fs::read(fixture_path()).expect("fixture");
    let decoded = decode_share(&payload).expect("decode");
    let source = golden_document();
    assert_eq!(
        decoded.document.crease_pattern.line_segments.len(),
        source.crease_pattern.line_segments.len()
    );
    assert_eq!(decoded.skipped_extensions, 0);
}

#[test]
fn encoding_is_deterministic_across_repeated_runs() {
    let document = golden_document();
    let first = encode_share(&document, ShareOptions::default()).expect("encode");
    for _ in 0..8 {
        let again = encode_share(&document, ShareOptions::default()).expect("encode");
        assert_eq!(
            first, again,
            "encoder must not depend on hash iteration order"
        );
    }
}

/// Reconstruction is `(i64 as f64) * 2^-F` — two exact operations. Assert the
/// decoded coordinates land on the quantum grid exactly, which is what makes the
/// output bit-identical on x86-64, aarch64 and wasm32.
#[test]
fn decoded_coordinates_are_exact_multiples_of_the_quantum() {
    let payload = encode_share(&golden_document(), ShareOptions::default()).expect("encode");
    let decoded = decode_share(&payload).expect("decode");
    for f_bits in 8..=60i32 {
        let q = 2f64.powi(-f_bits);
        if decoded
            .document
            .crease_pattern
            .line_segments
            .iter()
            .flat_map(|s| [s.a.x, s.a.y, s.b.x, s.b.y])
            .all(|v| (v / q).fract() == 0.0)
        {
            return;
        }
    }
    panic!("no quantum divides every decoded coordinate exactly");
}

#[test]
fn the_base64url_form_is_url_safe_and_unpadded() {
    let payload = encode_share(&golden_document(), ShareOptions::default()).expect("encode");
    let text = b64::encode(&payload);
    assert!(
        text.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        "payload must need no percent-encoding in a URL fragment"
    );
    assert_eq!(b64::decode(&text).unwrap(), payload);
}

/// The decode path must contain no transcendental or fused-multiply-add calls:
/// libm results are not reproducible across platforms, and FMA changes rounding.
/// A grep is cruder than a type-level guarantee but it is checkable and it is
/// what stops the rule eroding.
#[test]
fn the_decode_path_uses_no_transcendentals() {
    let share_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/share");
    let banned = [
        ".sin(",
        ".cos(",
        ".tan(",
        ".atan(",
        ".atan2(",
        ".hypot(",
        ".exp(",
        ".ln(",
        ".log10(",
        ".powf(",
        ".mul_add(",
    ];
    for entry in std::fs::read_dir(&share_dir).expect("share dir") {
        let path = entry.expect("entry").path();
        if path.extension().is_none_or(|e| e != "rs") {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("read");
        for (n, line) in source.lines().enumerate() {
            // Tests and doc comments may mention them; only real code counts.
            let code = line.split("//").next().unwrap_or("");
            for needle in banned {
                assert!(
                    !code.contains(needle),
                    "{}:{} uses {needle} on the codec path; \
                     libm is not reproducible across platforms",
                    path.display(),
                    n + 1
                );
            }
        }
    }
}
