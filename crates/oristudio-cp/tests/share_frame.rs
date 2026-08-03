//! Hostile-input suite for the share decoder.
//!
//! A share payload arrives from a URL, so it is entirely attacker-controlled.
//! Every case here must produce a typed error — never a panic, never an
//! unbounded allocation, never a partially applied document.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::share::{ShareError, ShareOptions, decode_share, encode_share};

fn sample() -> Vec<u8> {
    let mut model = CreasePatternModel::default();
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
    encode_share(
        &CreasePatternDocument {
            crease_pattern: model,
            ..Default::default()
        },
        ShareOptions::default(),
    )
    .expect("encode")
}

#[test]
fn truncation_at_every_offset_is_a_typed_error() {
    let payload = sample();
    for cut in 0..payload.len() {
        let result = decode_share(&payload[..cut]);
        assert!(result.is_err(), "truncation at {cut} decoded successfully");
    }
}

#[test]
fn every_single_byte_flip_is_rejected_or_decodes_cleanly() {
    // The CRC makes almost every flip a detected corruption. What must never
    // happen is a panic or a hang, so exercise the whole payload.
    let payload = sample();
    for i in 0..payload.len() {
        for bit in 0..8 {
            let mut corrupt = payload.clone();
            corrupt[i] ^= 1 << bit;
            let _ = decode_share(&corrupt);
        }
    }
}

#[test]
fn empty_and_tiny_inputs_are_rejected() {
    for len in 0..16usize {
        let bytes = vec![0u8; len];
        assert!(decode_share(&bytes).is_err());
    }
}

#[test]
fn bad_magic_is_rejected() {
    let mut payload = sample();
    payload[0] = b'Z';
    assert_eq!(decode_share(&payload).unwrap_err(), ShareError::BadMagic);
}

#[test]
fn a_future_version_reports_itself_as_future() {
    let mut payload = sample();
    payload[4] = 99;
    // The UI needs to distinguish "this link is from a newer Ori Studio" from
    // "this link is corrupt", so the error must name the version.
    assert_eq!(
        decode_share(&payload).unwrap_err(),
        ShareError::UnknownVersion(99)
    );
}

#[test]
fn a_forged_header_cannot_drive_a_large_allocation() {
    // Claim an 8 MiB body behind a 20-byte payload.
    let mut payload = sample();
    payload.truncate(20);
    payload[6..10].copy_from_slice(&(8_000_000u32).to_le_bytes());
    assert!(matches!(
        decode_share(&payload),
        Err(ShareError::ExpansionRatio { .. } | ShareError::BodyTooLarge { .. })
    ));
}

#[test]
fn an_absurd_declared_body_length_is_rejected() {
    let mut payload = sample();
    payload[6..10].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(matches!(
        decode_share(&payload),
        Err(ShareError::BodyTooLarge { .. })
    ));
}

#[test]
fn reserved_frame_flags_are_rejected() {
    let mut payload = sample();
    payload[10..12].copy_from_slice(&0x8000u16.to_le_bytes());
    assert_eq!(
        decode_share(&payload).unwrap_err(),
        ShareError::ReservedFrameFlags
    );
}

#[test]
fn unknown_compressor_is_rejected() {
    let mut payload = sample();
    payload[5] = 7;
    assert_eq!(
        decode_share(&payload).unwrap_err(),
        ShareError::UnknownCompressor(7)
    );
}

/// A body that claims enormous counts must be rejected from the count itself,
/// before any `Vec::with_capacity`.
#[test]
fn implausible_counts_are_rejected_before_allocating() {
    // version_echo, flags, F, then five 10-byte varints all claiming 2^63.
    let mut body = vec![1u8, 0, 32];
    for _ in 0..5 {
        body.extend_from_slice(&[0xff; 9]);
        body.push(0x7f);
    }
    let payload = framed(&body);
    assert!(matches!(
        decode_share(&payload),
        Err(ShareError::ImplausibleCounts { .. }
            | ShareError::BadVarint
            | ShareError::UnexpectedEnd { .. })
    ));
}

#[test]
fn an_out_of_range_quantum_is_rejected() {
    let body = vec![1u8, 0, 200];
    assert!(matches!(
        decode_share(&framed(&body)),
        Err(ShareError::BadQuantum(_))
    ));
}

#[test]
fn reserved_body_flags_are_rejected() {
    let body = vec![1u8, 0x40, 32];
    assert_eq!(
        decode_share(&framed(&body)).unwrap_err(),
        ShareError::ReservedBodyFlags
    );
}

/// The body repeats its own grammar version; a body that disagrees with the
/// frame is a mis-framed payload, not a decodable one. (1 and 2 are both real
/// grammars, so this uses a third value.)
#[test]
fn a_mismatched_version_echo_is_rejected() {
    let body = vec![7u8, 0, 32];
    assert!(matches!(
        decode_share(&framed(&body)),
        Err(ShareError::VersionEcho { echo: 7, .. })
    ));
}

/// An unknown *critical* extension must hard-reject: omitting it would make the
/// geometry wrong rather than merely incomplete.
#[test]
fn an_unknown_critical_extension_is_rejected() {
    let payload = with_extension(0x8FFF, &[1, 2, 3]);
    assert_eq!(
        decode_share(&payload).unwrap_err(),
        ShareError::UnknownCriticalExtension(0x8FFF)
    );
}

/// An unknown *ancillary* extension is skipped and counted, so the UI can say
/// some content was not loaded.
#[test]
fn an_unknown_ancillary_extension_is_skipped_and_counted() {
    let payload = with_extension(0x0FFF, &[1, 2, 3]);
    let decoded = decode_share(&payload).expect("ancillary tags must not be fatal");
    assert_eq!(decoded.skipped_extensions, 1);
}

/// Build a valid frame around an arbitrary body, mirroring `frame::write`.
fn framed(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"OCS1");
    out.push(1);
    out.push(0); // stored
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&crc32(body).to_le_bytes());
    out.extend_from_slice(body);
    out
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in bytes {
        crc ^= u32::from(b);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

/// Take a real payload and append an extra extension TLV to its body.
fn with_extension(tag: u16, payload: &[u8]) -> Vec<u8> {
    let mut model = CreasePatternModel::default();
    model.line_segments.push(LineSegment::with_color(
        Point::new(0.0, 0.0),
        Point::new(100.0, 0.0),
        LineColor::Red1,
    ));
    let framed_payload = encode_share(
        &CreasePatternDocument {
            crease_pattern: model,
            ..Default::default()
        },
        ShareOptions::default(),
    )
    .expect("encode");
    // Re-frame with the body decoded so the TLV can be appended, then bump the
    // extension count in place.
    let (_, mut body) = oristudio_cp::share::frame::read(&framed_payload, &[1]).expect("read");
    let count_pos = body
        .len()
        .checked_sub(1)
        .expect("body has an extension count");
    assert_eq!(body[count_pos], 0, "sample document has no extensions");
    body[count_pos] = 1;
    let uv = |v: u64, out: &mut Vec<u8>| {
        let mut v = v;
        loop {
            let byte = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(byte);
                break;
            }
            out.push(byte | 0x80);
        }
    };
    uv(u64::from(tag), &mut body);
    uv(payload.len() as u64, &mut body);
    body.extend_from_slice(payload);
    framed(&body)
}
