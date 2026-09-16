//! A millisecond clock the planner's budgets read.
//!
//! `std::time::Instant` panics on `wasm32-unknown-unknown`, so the planner
//! never calls it directly: budgets read a `fn() -> f64` handed in through
//! the options, and [`default_clock`] picks `Instant` natively and
//! `js_sys::Date::now()` in the browser (the `oristudio-cp-detect` pattern).
//! Tests pass their own clock to make budget behaviour deterministic.

/// Milliseconds since some fixed origin; only differences matter.
pub type Clock = fn() -> f64;

#[cfg(not(target_arch = "wasm32"))]
fn native_now_ms() -> f64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    let start = START.get_or_init(Instant::now);
    start.elapsed().as_secs_f64() * 1000.0
}

#[cfg(target_arch = "wasm32")]
fn wasm_now_ms() -> f64 {
    js_sys::Date::now()
}

/// The platform clock.
pub fn default_clock() -> Clock {
    #[cfg(not(target_arch = "wasm32"))]
    {
        native_now_ms
    }
    #[cfg(target_arch = "wasm32")]
    {
        wasm_now_ms
    }
}

/// A clock that never advances, for tests that must not hit a budget.
pub fn frozen_clock() -> Clock {
    fn zero() -> f64 {
        0.0
    }
    zero
}

/// A deadline read through a [`Clock`]; `None` means unbounded.
#[derive(Debug, Clone, Copy)]
pub struct Deadline {
    clock: Clock,
    at_ms: Option<f64>,
}

impl Deadline {
    /// A deadline `budget_ms` from now; a non-positive or non-finite budget
    /// means unbounded.
    pub fn after(clock: Clock, budget_ms: f64) -> Deadline {
        let at_ms = if budget_ms.is_finite() && budget_ms > 0.0 {
            Some(clock() + budget_ms)
        } else {
            None
        };
        Deadline { clock, at_ms }
    }

    /// An unbounded deadline.
    pub fn unbounded(clock: Clock) -> Deadline {
        Deadline { clock, at_ms: None }
    }

    /// Whether the deadline has passed.
    pub fn expired(&self) -> bool {
        match self.at_ms {
            Some(at) => (self.clock)() >= at,
            None => false,
        }
    }

    /// The clock this deadline reads.
    pub fn clock(&self) -> Clock {
        self.clock
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_clock_advances_and_frozen_does_not() {
        let clock = default_clock();
        let a = clock();
        let b = clock();
        assert!(b >= a);
        let frozen = frozen_clock();
        assert_eq!(frozen(), frozen());
        assert!(!Deadline::after(frozen, 10.0).expired());
        assert!(!Deadline::after(frozen, 0.0).expired());
        assert!(!Deadline::unbounded(frozen).expired());
    }
}
