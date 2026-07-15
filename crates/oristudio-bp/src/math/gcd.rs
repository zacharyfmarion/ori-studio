pub fn gcd(a: i64, b: i64) -> u64 {
    if a == 0 && b == 0 {
        return 1;
    }
    let mut a = a.unsigned_abs();
    let mut b = b.unsigned_abs();
    while a != 0 && b != 0 {
        a %= b;
        if a != 0 {
            b %= a;
        }
    }
    if a != 0 { a } else { b }
}

pub fn lcm(values: &[u64]) -> u64 {
    let mut result = values[0];
    for value in &values[1..] {
        let divisor = gcd(result as i64, *value as i64);
        result = result * *value / divisor;
    }
    result
}

pub fn reduce_int(a: i64, b: i64) -> (i64, i64, u64) {
    let divisor = gcd(a, b);
    (a / divisor as i64, b / divisor as i64, divisor)
}
