//! Lazy, bounded layer-order inspection shared by the Fold tools.
//! An index is transient UI state; the returned witness is what a step stores.
use oristudio_fold::{
    ChoiceCount, CompletionLimits, Completions, FoldLanding, FoldPlacementSearch, FoldRefusal,
    PlainFold, WitnessOrder,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::bridge::{Bridge, settle};
use crate::resolve::{Resolved, resolve};
use crate::wire::{BridgeError, Choices, Op, Outcome, Refusal};
use crate::{FoldEngine, bridge_error, parse, parse_choices, to_js_value};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderQuery {
    #[serde(default)]
    pub index: u64,
    #[serde(default)]
    pub batch: u64,
    /// Actual local relations to preserve when a larger search changes indices.
    #[serde(default)]
    pub prefer: Option<Vec<[oristudio_fold::FaceId; 2]>>,
    #[serde(default)]
    pub per_component: Option<usize>,
    #[serde(default)]
    pub max_nodes: Option<u64>,
    /// A plain fold's placement search: how long one `batch` may search in
    /// all, in calls of at most [`PLACEMENT_SLICE_MS`] each, asked again
    /// while the answer says it is `searching`, so a caller can stop between
    /// them. Zero reads what is found. Absent, a batch is one call's search.
    #[serde(default)]
    pub search_ms: Option<f64>,
}

/// The longest a single placement call searches.
pub const PLACEMENT_SLICE_MS: f64 = 150.0;

/// The longest one batch of a placement search may search in all.
const PLACEMENT_BATCH_MAX_MS: f64 = 60_000.0;

impl OrderQuery {
    pub fn limits(&self) -> CompletionLimits {
        CompletionLimits {
            per_component: self.per_component.unwrap_or(1000).clamp(1, 64_000),
            max_nodes: Some(self.max_nodes.unwrap_or(200_000).clamp(1, 12_800_000)),
            deadline: None,
        }
    }

    /// How long this batch may search in all, and what a call that searched
    /// for `elapsed` costs it: at least a millisecond, so a call that cannot
    /// advance still spends it; without `search_ms`, all of it.
    fn search_time(&self) -> (f64, impl Fn(f64) -> f64) {
        let asked = self
            .search_ms
            .filter(|ms| ms.is_finite())
            .map(|ms| ms.clamp(0.0, PLACEMENT_BATCH_MAX_MS));
        let allowed = asked.unwrap_or(PLACEMENT_SLICE_MS);
        let cost = move |elapsed: f64| match asked {
            Some(_) => elapsed.max(1.0),
            None => allowed,
        };
        (allowed, cost)
    }
}

#[derive(Debug, Serialize)]
pub struct OrderSelection {
    pub count: ChoiceCount,
    pub index: u64,
    pub completion: Option<WitnessOrder>,
    pub relations: Vec<[oristudio_fold::FaceId; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub landing: Option<FoldLanding>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub moving_varies: bool,
    /// A placement search with time left in this batch: ask again, with the
    /// same query, to search further.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub searching: bool,
}

impl OrderSelection {
    pub fn unique(completion: Option<WitnessOrder>) -> Self {
        Self {
            count: ChoiceCount {
                orders: 1,
                exact: true,
            },
            index: 0,
            completion,
            relations: Vec::new(),
            landing: None,
            moving_varies: false,
            searching: false,
        }
    }

    pub fn pick(
        completions: &Completions,
        query: &OrderQuery,
        pick: impl FnOnce(&[usize]) -> Result<Option<WitnessOrder>, FoldRefusal>,
    ) -> Result<Self, Refusal> {
        let count = completions.count();
        // A changed search may list fewer choices. This only chooses a preview;
        // the UI must still accept the witness it actually sees.
        let mut index = query.index.min(count.orders.saturating_sub(1));
        let mut remainder = index;
        let mut indices = vec![0; completions.components().len()];
        for (i, component) in completions.components().iter().enumerate().rev() {
            let size = component.orders.len() as u64;
            if size > 0 {
                indices[i] = (remainder % size) as usize;
                remainder /= size;
            }
        }
        if let Some(prefer) = &query.prefer {
            let preserved: Option<Vec<usize>> = completions
                .components()
                .iter()
                .map(|component| {
                    component.orders.iter().position(|order| {
                        component.pairs.iter().zip(order).all(|(pair, above)| {
                            let expected = if *above {
                                [pair.lo(), pair.hi()]
                            } else {
                                [pair.hi(), pair.lo()]
                            };
                            prefer.contains(&expected)
                        })
                    })
                })
                .collect();
            if let Some(preserved) = preserved {
                indices = preserved;
                index = completions.components().iter().zip(&indices).fold(
                    0u64,
                    |index, (component, pick)| {
                        index
                            .saturating_mul(component.orders.len() as u64)
                            .saturating_add(*pick as u64)
                    },
                );
            }
        }
        let relations = completions.chosen_pairs(&indices).unwrap_or_default();
        let completion = pick(&indices).map_err(Refusal::from)?;
        Ok(Self {
            count,
            index,
            completion,
            relations,
            landing: None,
            moving_varies: false,
            searching: false,
        })
    }
}

/// A batch of a placement search: its number and its limits.
type BatchKey = (u64, usize, Option<u64>);

#[derive(Debug)]
pub(crate) struct PlacementSession {
    pub parent: u32,
    fold: PlainFold,
    /// The batch searched last, and how long it has searched so far, across
    /// calls.
    batch: Option<(BatchKey, f64)>,
    search: FoldPlacementSearch,
}

impl Bridge {
    fn placement_selection(
        &mut self,
        state: u32,
        op: &Op,
        choices: &Choices,
        query: &OrderQuery,
    ) -> Result<Outcome<OrderSelection>, BridgeError> {
        let mut outer = op.clone();
        if let Op::Valley(a) | Op::Mountain(a) = &mut outer {
            a.landing = FoldLanding::Outer;
        }
        let mut choices = choices.clone();
        choices.completion = None;
        let parent = self.state(state)?;
        let resolved = match settle(resolve(parent, &outer, &choices))? {
            Ok(value) => value,
            Err(refused) => return Ok(Outcome::Refused(refused)),
        };
        let fold = match resolved.plain(parent) {
            Some(Ok(fold)) => fold,
            Some(Err(refused)) => return Ok(Outcome::Refused(refused.into())),
            None => {
                return Err(BridgeError::InvalidInput(
                    "placement needs a plain fold".into(),
                ));
            }
        };
        if !self
            .placements
            .as_ref()
            .is_some_and(|s| s.parent == state && s.fold == fold)
        {
            self.placements = Some(PlacementSession {
                parent: state,
                fold: fold.clone(),
                batch: None,
                search: FoldPlacementSearch::new(parent, &fold),
            });
        }
        let Some(session) = &mut self.placements else {
            return Err(BridgeError::InvalidInput(
                "placement session missing".into(),
            ));
        };
        let mut limits = query.limits();
        let key: BatchKey = (query.batch, limits.per_component, limits.max_nodes);
        // A new batch starts its time afresh; asking again with the same
        // query searches on until the batch's time is spent.
        let (allowed, cost) = query.search_time();
        let mut spent = match session.batch {
            Some((searched, spent)) if searched == key => spent,
            _ => 0.0,
        };
        if spent < allowed && !session.search.count().exact {
            let now_ms = crate::ops_crimp_tuck::clock::now_ms;
            let start = now_ms();
            limits.deadline = Some(oristudio_fold::complete::Deadline {
                now_ms,
                at_ms: start + (allowed - spent).min(PLACEMENT_SLICE_MS),
            });
            session.search.advance(&limits, 128, 1024);
            spent += cost(now_ms() - start);
        }
        session.batch = Some((key, spent));
        let count = session.search.count();
        let searching = !count.exact && spent < allowed;
        if count.exact
            && count.orders == 0
            && let Some(refused) = session.search.refusal()
        {
            return Ok(Outcome::Refused(refused.clone().into()));
        }
        let index = query.index.min(count.orders.saturating_sub(1));
        let candidate = session.search.candidates().get(index as usize);
        let moving_varies = session.search.candidates().first().is_some_and(|first| {
            session
                .search
                .candidates()
                .iter()
                .any(|c| c.moving != first.moving)
        });
        Ok(Outcome::Ok(OrderSelection {
            count,
            index,
            relations: Vec::new(),
            moving_varies,
            searching,
            landing: candidate.map(|c| c.landing.clone()),
            completion: candidate.and_then(|c| c.completion.clone()),
        }))
    }

    pub fn order_selection(
        &mut self,
        state: u32,
        op: &Op,
        choices: &Choices,
        query: &OrderQuery,
    ) -> Result<Outcome<OrderSelection>, BridgeError> {
        if matches!(op, Op::Valley(_) | Op::Mountain(_)) {
            return self.placement_selection(state, op, choices, query);
        }
        self.placements = None;
        let parent = self.state(state)?;
        // Only the order is being explored; roots, openings and pockets remain fixed.
        let mut choices = choices.clone();
        choices.completion = None;
        match settle(resolve(parent, op, &choices))? {
            Ok(Resolved::Compound(compound)) => Ok(compound.order_selection(parent, query).into()),
            Ok(_) => Err(BridgeError::InvalidInput(
                "order_selection needs a compound fold".into(),
            )),
            Err(refused) => Ok(Outcome::Refused(refused)),
        }
    }
}

#[wasm_bindgen]
impl FoldEngine {
    /// Release only this parent's authoring search; saved states are unaffected.
    pub fn release_order_search(&mut self, state: u32) {
        if self
            .inner
            .placements
            .as_ref()
            .is_some_and(|search| search.parent == state)
        {
            self.inner.placements = None;
        }
    }

    pub fn order_selection(
        &mut self,
        state: u32,
        op: JsValue,
        choices: JsValue,
        query: JsValue,
    ) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        let query: OrderQuery = parse("query", query)?;
        to_js_value(
            &self
                .inner
                .order_selection(state, &op, &choices, &query)
                .map_err(bridge_error)?,
        )
    }
}
