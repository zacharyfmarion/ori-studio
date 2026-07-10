use oristudio_bp::math::{BpFraction, gcd, lcm, parse_fraction, to_fraction};

#[test]
fn fraction_approximates_using_continued_fraction() {
    let r = to_fraction(std::f64::consts::SQRT_2, 0.01).expect("sqrt2 approximates");
    assert_eq!(r.to_string(), "17/12");
}

#[test]
fn fraction_does_not_get_overly_precise() {
    let f = BpFraction::from_number(-116_293.666_666_666_67).expect("finite number converts");
    assert_eq!(f.denominator(), 3);
    assert_eq!(f.to_string(), "-348881/3");
}

#[test]
fn fraction_rejects_invalid_input() {
    assert!(BpFraction::from_number(f64::INFINITY).is_err());
}

#[test]
fn fraction_rejects_numbers_outside_js_safe_integer_range() {
    assert!(BpFraction::from_number(9_007_199_254_740_992.0).is_err());
}

#[test]
fn fraction_mutation_matches_bp_operation_style() {
    let mut f = parse_fraction("1/2").expect("fraction parses");
    f.add_mut(&parse_fraction("1/3").unwrap())
        .mul_mut(&parse_fraction("6/5").unwrap())
        .sub_mut(&BpFraction::ONE);
    assert_eq!(f.to_string(), "0");
}

#[test]
fn fraction_reduces_pairs() {
    let mut a = parse_fraction("6/10").unwrap();
    let mut b = parse_fraction("9/25").unwrap();
    let (a, b) = a.reduce_with(&mut b).expect("pair reduces");
    assert_eq!(a.to_string(), "1");
    assert_eq!(b.to_string(), "3/5");
}

#[test]
fn gcd_zero_zero_is_one() {
    assert_eq!(gcd(0, 0), 1);
}

#[test]
fn gcd_returns_positive_number() {
    assert_eq!(gcd(-12, 15), 3);
}

#[test]
fn gcd_handles_signed_minimum() {
    assert_eq!(gcd(i64::MIN, 2), 2);
}

#[test]
fn lcm_computes_common_multiple() {
    assert_eq!(lcm(&[12, 15]), 60);
}
