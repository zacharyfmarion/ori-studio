//! The layer order record's codec (`steer::read_record`,
//! `steer::encode_record`) held to the golden both codecs share,
//! `tests/fixtures/layer-order/record-v1.json`: what the TypeScript codec
//! (`apps/web/src/lib/layerOrder/layerOrderRecord.ts`) reads and writes, the
//! Rust one reads and writes, byte for byte. That the golden's kabuto record
//! is what a session saves is `tests/steer_session.rs`'s.

#![cfg(feature = "kernel")]

use oristudio_fold::steer::{
    EncodeRefusal, FoldSign, LayerOrderRecord, RECORD_MAX_BYTES, RecordDamage, RecordFace,
    RecordPair, RecordPart, RecordRead, encode_record, js_number, read_record,
};
use serde_json::Value;

fn repo_path(relative: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn golden() -> Value {
    let path = repo_path("tests/fixtures/layer-order/record-v1.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}"))
}

fn cases<'a>(golden: &'a Value, key: &str) -> &'a [Value] {
    golden[key]
        .as_array()
        .unwrap_or_else(|| panic!("the golden has no {key}"))
}

fn text<'a>(case: &'a Value, key: &str) -> &'a str {
    case[key]
        .as_str()
        .unwrap_or_else(|| panic!("{case}: no {key}"))
}

#[test]
fn every_written_record_reads_as_itself_and_writes_back() {
    let golden = golden();
    for case in cases(&golden, "written") {
        let (name, json) = (text(case, "name"), text(case, "json"));
        let RecordRead::Read {
            record,
            json: again,
        } = read_record(json)
        else {
            panic!("{name}: {:?}", read_record(json));
        };
        assert_eq!(again, json, "{name}");
        assert_eq!(encode_record(&record).as_deref(), Ok(json), "{name}");
    }
}

#[test]
fn every_stored_record_reads_as_this_build_writes_it() {
    let golden = golden();
    for case in cases(&golden, "stored") {
        let name = text(case, "name");
        match read_record(text(case, "stored")) {
            RecordRead::Read { json, .. } => assert_eq!(json, text(case, "json"), "{name}"),
            other => panic!("{name}: {other:?}"),
        }
    }
}

#[test]
fn a_newer_build_s_record_is_carried_not_read() {
    let golden = golden();
    let newer = cases(&golden, "newer");
    assert!(newer.len() >= 6);
    for case in newer {
        assert_eq!(
            read_record(text(case, "stored")),
            RecordRead::Newer,
            "{}",
            text(case, "name")
        );
    }
    // More than this build keeps.
    assert_eq!(
        read_record(&" ".repeat(RECORD_MAX_BYTES + 1)),
        RecordRead::Newer
    );
}

#[test]
fn damage_is_named_by_its_part() {
    let golden = golden();
    let damaged = cases(&golden, "damaged");
    assert!(damaged.len() >= 19);
    for case in damaged {
        let name = text(case, "name");
        match read_record(text(case, "stored")) {
            RecordRead::Damaged(damage) => {
                assert_eq!(damage.word(), text(case, "damage"), "{name}")
            }
            other => panic!("{name}: {other:?}"),
        }
    }
    assert_eq!(
        read_record("{\"v\":1,"),
        RecordRead::Damaged(RecordDamage::NotJson)
    );
}

#[test]
fn numbers_are_written_as_json_stringify_writes_them() {
    let golden = golden();
    let numbers = golden["numbers"].as_object().expect("numbers");
    assert!(numbers.len() > 100);
    for (bits, js) in numbers {
        let js = js.as_str().expect("text");
        let value = f64::from_bits(u64::from_str_radix(bits, 16).expect("hex"));
        assert_eq!(js_number(value), js, "{bits}");
        // And reads back to the same double.
        if value != 0.0 {
            assert_eq!(
                js.parse::<f64>().map(f64::to_bits),
                Ok(value.to_bits()),
                "{bits}"
            );
        }
    }
}

#[test]
fn a_record_that_would_not_read_back_is_not_written() {
    let face = RecordFace {
        at: [0.5, 0.25],
        area: 1.0,
    };
    let pair = |f, g| RecordPair {
        f,
        g,
        sign: FoldSign::Front,
    };
    let record = LayerOrderRecord {
        faces: vec![face, face],
        constraints: vec![pair(0, 1)],
        order: vec![pair(1, 0)],
        attention: None,
    };
    assert!(encode_record(&record).is_ok());
    let refused = |record: LayerOrderRecord| match encode_record(&record) {
        Err(EncodeRefusal::Invalid { part }) => Some(part),
        _ => None,
    };
    assert_eq!(
        refused(LayerOrderRecord {
            order: vec![pair(0, 9)],
            ..record.clone()
        }),
        Some(RecordPart::Order)
    );
    assert_eq!(
        refused(LayerOrderRecord {
            constraints: vec![pair(1, 1)],
            ..record.clone()
        }),
        Some(RecordPart::Constraints)
    );
    assert_eq!(
        refused(LayerOrderRecord {
            faces: vec![
                RecordFace {
                    at: [f64::NAN, 0.0],
                    area: 1.0
                },
                face
            ],
            ..record.clone()
        }),
        Some(RecordPart::Faces)
    );
    assert_eq!(
        refused(LayerOrderRecord {
            faces: vec![
                RecordFace {
                    at: [0.0, 0.0],
                    area: 0.0
                },
                face
            ],
            ..record.clone()
        }),
        Some(RecordPart::Faces)
    );
}

/// Exactly the budget is written; one byte more is refused with the size
/// (the TypeScript codec's `layerOrderRecordOfSize`: unit faces, then order
/// pairs, then the bytes left over on the first face's area).
#[test]
fn the_budget_is_one_megabyte() {
    let of_size = |bytes: usize| -> LayerOrderRecord {
        let face = RecordFace {
            at: [0.5, 0.25],
            area: 1.0,
        };
        let length = |record: &LayerOrderRecord| encode_unchecked(record).len();
        let empty = length(&LayerOrderRecord::default());
        let face_bytes = "{\"at\":[0.5,0.25],\"area\":1}".len() + 1;
        let faces = (bytes - empty) / face_bytes - 1;
        let mut record = LayerOrderRecord {
            faces: vec![face; faces],
            ..Default::default()
        };
        let pairs = (bytes - length(&record) + 1) / 8;
        record.order = vec![
            RecordPair {
                f: 0,
                g: 1,
                sign: FoldSign::Front,
            };
            pairs
        ];
        let ones = bytes - length(&record) + 1;
        record.faces[0].area = "1".repeat(ones).parse().expect("a number");
        record
    };
    let at_budget = encode_record(&of_size(RECORD_MAX_BYTES)).expect("at the budget");
    assert_eq!(at_budget.len(), RECORD_MAX_BYTES);
    assert!(matches!(read_record(&at_budget), RecordRead::Read { json, .. } if json == at_budget));
    assert_eq!(
        encode_record(&of_size(RECORD_MAX_BYTES + 1)),
        Err(EncodeRefusal::OverBudget {
            bytes: RECORD_MAX_BYTES + 1,
            budget: RECORD_MAX_BYTES
        })
    );
}

/// What the encoder writes, past the budget too.
fn encode_unchecked(record: &LayerOrderRecord) -> String {
    match encode_record(record) {
        Ok(json) => json,
        Err(_) => panic!("small records encode"),
    }
}
