//! The workspace's serde_json reads back every float it writes, bit for bit
//! (its `float_roundtrip` feature, root `Cargo.toml`).
//!
//! Without the feature serde_json parses long mantissas with a fast path that
//! can land one ulp off: on 2026-10-08, 105,393 of a million uniform values in
//! `[0, 1)` and 99,377 of a million reflected coordinates read back changed,
//! and none with it. JavaScript parses correctly rounded, so a drift is a false
//! disagreement with the JS oracles: before the feature, the Flat-Folder port
//! numbered `r069-s07.fold`'s faces differently from upstream (PORTING.md,
//! "Flat-Folder").

use treemaker_fold::FoldDocument;

/// SplitMix64.
struct Rng(u64);

impl Rng {
    fn bits(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f64 {
        (self.bits() >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[test]
fn floats_read_back_bit_for_bit() {
    let mut rng = Rng(1);
    let values: Vec<f64> = (0..20_000)
        .map(|k| match k % 3 {
            0 => rng.unit(),
            // A reflected coordinate, as a folded vertex image is.
            1 => {
                let angle = 2.0 * std::f64::consts::PI * rng.unit();
                angle.cos() * rng.unit() + angle.sin() * rng.unit()
            }
            _ => f64::from_bits(rng.bits()),
        })
        .filter(|v| v.is_finite())
        .collect();
    let text = serde_json::to_string(&values).unwrap_or_else(|e| panic!("{e}"));
    let back: Vec<f64> = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}"));
    let changed: Vec<String> = values
        .iter()
        .zip(&back)
        .filter(|(v, b)| v.to_bits() != b.to_bits())
        .take(5)
        .map(|(v, b)| format!("{v:e} read back as {b:e}"))
        .collect();
    assert!(changed.is_empty(), "{changed:#?}");
}

#[test]
fn fold_coordinates_survive_a_write_and_a_read() {
    let mut rng = Rng(2);
    let vertices: Vec<Vec<f64>> = (0..5_000).map(|_| vec![rng.unit(), rng.unit()]).collect();
    let edges = (0..vertices.len() - 1).map(|i| [i, i + 1]).collect();
    let document = FoldDocument::new(vertices.clone(), edges);
    let text = serde_json::to_string(&document).unwrap_or_else(|e| panic!("{e}"));
    let back: FoldDocument = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{e}"));
    let same = |a: &[f64], b: &[f64]| a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits());
    let changed = vertices
        .iter()
        .zip(&back.vertices_coords)
        .filter(|(v, b)| !same(v, b))
        .count();
    assert_eq!(changed, 0, "{changed} of {} vertices moved", vertices.len());
}
