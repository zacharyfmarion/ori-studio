//! Which layers of a stack are kept from crossing by a penalty of their own.
//!
//! A stack of `n` layers holds `n²/2` ordered pairs. A penalty for every pair
//! made both solves grow with the square of the depth. Two layers far apart
//! are held in order through the layers between them, each kept from crossing
//! its neighbours, so only pairs near each other are penalized. The flat and
//! the spatial solve share this rule and its fallback.
use crate::SpreadError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reach {
    /// Layers within eight places of each other. At eight the corpus pictures
    /// match the all-pairs solve (`implementation-plans/flat-spread-near-pairs.md`).
    Near,
    /// Only layers lying directly on each other: for a model with too many
    /// near pairs to solve. It still spreads; its deep stacks open less.
    Touching,
}

impl Reach {
    /// How many places apart two penalized layers may lie.
    pub fn places(self) -> usize {
        match self {
            Self::Near => 8,
            Self::Touching => 1,
        }
    }

    /// The places `(upper, lower)` of a stack `depth` deep that are penalized.
    pub fn pairs(self, depth: usize) -> impl Iterator<Item = (usize, usize)> {
        let places = self.places();
        (0..depth).flat_map(move |upper| {
            (upper + 1..depth.min(upper.saturating_add(places).saturating_add(1)))
                .map(move |lower| (upper, lower))
        })
    }

    /// How many ordered pairs of a stack `depth` deep get no penalty.
    pub fn unpenalized(self, depth: usize) -> usize {
        ordered_pairs(depth) - self.pairs(depth).count()
    }

    /// The overlap area the penalties are weighed against, from the area of
    /// the `penalized` overlaps and of every `ordered` one.
    ///
    /// Near pairs are weighed against every ordered overlap, so each is as
    /// stiff as when every pair had a penalty. At that stiffness touching
    /// pairs alone let paper cross far more, so they are weighed against
    /// themselves: that holds the layers in order as well, and closes deep
    /// stacks up.
    pub fn mass(self, penalized: f64, ordered: f64) -> f64 {
        match self {
            Self::Near => ordered,
            Self::Touching => penalized,
        }
    }

    /// `prepare` with near layers penalized, or with touching ones when that
    /// is `too_large` to solve.
    pub fn widest<T>(
        mut prepare: impl FnMut(Self) -> Result<T, SpreadError>,
        too_large: impl Fn(&SpreadError) -> bool,
    ) -> Result<T, SpreadError> {
        match prepare(Self::Near) {
            Err(error) if too_large(&error) => prepare(Self::Touching),
            result => result,
        }
    }
}

/// How many ordered pairs a stack `depth` deep holds.
pub fn ordered_pairs(depth: usize) -> usize {
    depth * depth.saturating_sub(1) / 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn near_pairs_grow_with_the_depth_not_its_square() {
        assert_eq!(Reach::Near.pairs(3).count(), 3);
        assert_eq!(Reach::Near.pairs(9).count(), ordered_pairs(9));
        // Ten deep, the top and the bottom are nine places apart.
        assert_eq!(Reach::Near.pairs(10).count(), ordered_pairs(10) - 1);
        assert!(!Reach::Near.pairs(10).any(|pair| pair == (0, 9)));
        assert_eq!(Reach::Near.pairs(100).count(), 8 * 92 + 28);
        assert_eq!(Reach::Near.unpenalized(100), 4950 - 764);
        assert_eq!(Reach::Touching.pairs(100).count(), 99);
        assert!(
            Reach::Touching
                .pairs(100)
                .all(|(upper, lower)| lower == upper + 1)
        );
        assert_eq!(
            Reach::Near.pairs(0).count() + Reach::Near.pairs(1).count(),
            0
        );
    }

    #[test]
    fn touching_layers_are_tried_only_when_near_ones_are_too_large() {
        let too_large = |error: &SpreadError| matches!(error, SpreadError::Limit("size"));
        let mut tried = Vec::new();
        let fits = Reach::widest(
            |reach| {
                tried.push(reach);
                Ok(reach)
            },
            too_large,
        );
        assert_eq!(
            (fits.unwrap(), tried.as_slice()),
            (Reach::Near, &[Reach::Near][..])
        );
        let falls_back = Reach::widest(
            |reach| match reach {
                Reach::Near => Err(SpreadError::Limit("size")),
                Reach::Touching => Ok(reach),
            },
            too_large,
        );
        assert_eq!(falls_back.unwrap(), Reach::Touching);
        let other = Reach::widest(
            |_| Err::<Reach, _>(SpreadError::Limit("something else")),
            too_large,
        );
        assert!(matches!(other, Err(SpreadError::Limit("something else"))));
        let both = Reach::widest(|_| Err::<Reach, _>(SpreadError::Limit("size")), too_large);
        assert!(matches!(both, Err(SpreadError::Limit("size"))));
    }
}
