# Junction detection: what's actually the lever (oracle ladder, the primitive cap, box-pleating)

**Date:** 2026-07-01
**Scope:** Following up on the 2026-06-30 report's finding that junction detection is
the dominant lever, this quantifies *which part* of junction detection matters
end-to-end on the native scraped set (`native-cp-v1`, 563 CPs: easy 191 / medium 232
/ hard 140), via a perfect-junction oracle ladder; rules out close pairs as the
system-level lever; finds (and removes) a top-N primitive **cap** that was silently
dropping real detections; tests whether box-pleating is an independent failure mode;
and lands a junction-threshold + solve-budget change worth +27% recovery.
**Branch:** `claude/stupefied-williams-df1c8c`.

> A note on confidence, continuing the prior report's discipline: every headline
> below is backed by a measurement or a code path, not a hunch. Where the evidence
> only supports a direction (not a magnitude), or where a confound is unresolved, it
> is marked. Two things this session *did not* measure are called out explicitly in
> §10 so they are not mistaken for conclusions.

---

## TL;DR

1. **Perfect junction detection ~3× the end-to-end recovery** (62 → 174 of 563 at a
   3s solve cap). Junctions are decisively the #1 lever, and the win is concentrated
   on **easy/medium** (easy 60→129, medium 2→43), not hard. *(High)*
2. **Fixing close pairs specifically buys ~0.** A region-replace oracle that makes
   only close-pair junctions perfect leaves recovery at 62–63 across the entire
   gap-threshold sweep (T = 4/8/12/25px). This is **verified not to be a no-op
   artifact** for pairs ≥3px apart (see §3). *(High for ≥3px; sub-3px untestable — §3)*
3. **The missed junctions are mostly isolated, not close, and not near the border.**
   On medium, 72% of the dense head's misses are isolated (nearest-neighbour ≥12px);
   only ~2.5% of all misses lie within 12px of the paper border (vs 1.2% of all
   junctions — mild, ~2×, but negligible in absolute terms). *(High)*
4. **Junction primitives were truncated top-N by probability** — a hard cap unrelated
   to model quality, and the mechanism behind "the heatmap looks great but junctions
   aren't shown." It only ever bit dense hard CPs (production 500 cap exceeded by 45%
   of hard, the inspector's 240 display cap by 95%; **0% of easy/medium exceed either**).
   **Both caps were removed this session.** Since easy/medium never hit them — and that's
   where the recoverable headroom is — removal leaves those numbers unchanged. *(High —
   code-verified.)*
5. **Box-pleating is not an independent detection failure.** It is heavily
   concentrated in hard (56% of hard CPs vs 6–9% of easy/medium), but *within* hard
   it does not correlate with recall (Spearman +0.02); it correlates with **density**
   (Spearman +0.41 with junctions/CP), and at matched density box-pleats detect as
   well or better. *(High)*
6. **The exact-solve is still a second wall.** Even perfect junctions leave ~389/563
   unrecovered at a 3s cap; hard recovers only 2/140 even with perfect junctions.
   *(Medium-High — consistent with the prior report; the oracle-ladder decomposition
   was only run at 3s — §10.)*
7. **The junction-peak floor was set too high (0.50); 0.40 is the sweet spot — and it
   shipped.** Lowering the floor to 0.40 lifts end-to-end recovery 67→85 (+27%) at a 25s
   solve cap (62→71, +15% at 3s), precision-neutral; below ~0.40 recovery *falls* as
   spurious peaks break topology. The medium share is exact-solve-bound (candidates reach
   correct topology but need >3s to converge), so the solve budget was raised 10→25s in
   step. Landed. *(High; measured through the same benchmark path — §9.)*

---

## 1. The oracle ladder (what was built and measured)

Metric throughout is `solve_recovered_original` — the honest end-to-end bar from the
prior report (exact-solve accepted **and** the solved fold matches GT topology +
assignment within 2px). Config: `--candidate-source junction-first-v1
--line-evidence-source source-image --parity-repair --skip-flat-folder`, strict 2px,
**3s** exact-solve cap (the same convention that produced the prior report's full-set
"61"; this run reproduces it as 62 — the +1 is run-to-run solve variance, not a
change). `--skip-flat-folder` was verified to leave `solve_recovered` and strict
topology identical while removing a 15–20s/sample cost.

Three rungs, all on the same 563 samples:

- **Rung 0 — baseline:** the dense head's detections (production path; ran with the
  then-current 500 primitive cap, since removed — §5; easy/medium never hit it, so the
  baseline is unaffected).
- **Rung 1 — close-pair oracle:** the model's real detections everywhere, except that
  inside small boxes around close-pair GT junctions (nearest-neighbour gap < T) the
  detections are replaced by the exact GT junctions. Implemented via the product's
  existing in-regions evidence merge (the same path the deprecated V3 refiner used),
  so it is product-faithful. Swept T ∈ {4, 8, 12, 25}px.
- **Rung 2 — full oracle:** every junction replaced by GT (`--oracle-vertices`), with
  the exact-solve **on** (the prior report only ever ran this with `--skip-exact-solve`
  for the topology ceiling; this is the end-to-end perfect-junction number it never
  reported).

---

## 2. Perfect junctions ~3×; close pairs specifically ~0 *(High)*

`solve_recovered_original`, 3s cap:

| rung | easy | medium | hard | **ALL /563** | candidate exact-topo |
|---|---|---|---|---|---|
| **0 — baseline** | 60 | 2 | 0 | **62** | 113 |
| **1 — close pairs <4px** | 60 | 2 | 0 | **62** | 113 |
| **1 — close pairs <8px** | 60 | 2 | 0 | **62** | 113 |
| **1 — close pairs <12px** | 60 | 3 | — | **63** (easy+med) | 112 |
| **1 — close pairs <25px** | — | — | — | **62** | 93 |
| **2 — all junctions** | 129 | 43 | 2 | **174** | 206 |

- Rung 2's candidate exact-topology (206 = 134+56+16) reproduces the prior report's
  oracle exactly — a clean consistency anchor.
- **Perfect junctions triple recovery** (62→174), overwhelmingly from easy/medium.
- **Close-pair fixing never moves it** (62–63) at any distance threshold. At T=25 the
  aggressive region-replace even *lowers* candidate topology (93 < 113), i.e. there is
  no threshold at which making close pairs perfect pays off end-to-end.

The natural reading of the prior report — "junctions are the lever, and close pairs
are *the* junction problem" — is **half right**: junctions yes, close pairs no. The
per-junction failure does concentrate on close pairs (prior report §3), but those
failures live on dense hard CPs that fail for many other reasons, so fixing them flips
no outcomes. The recoverable junction headroom is in **isolated junctions on
easy/medium** (§4).

---

## 3. The close-pair null is real, not a merge artifact *(High for ≥3px; sub-3px untestable)*

A null result can be faked by an oracle that silently does nothing, so this was
checked directly. `junction_first_v1` merges candidate vertices within
`vertex_merge_radius_px = 3.0`, which *could* collapse injected close pairs. Dumping
the selected candidate graph for every medium sample and asking whether **both**
members of each close pair appear as two *distinct* selected vertices (within 2px):

| gap bin | baseline both-distinct | **oracle (T=12)** |
|---|---|---|
| 0–3px | 0% | **9%** ← merge collapses these; untestable |
| 3–4px | 6% | **94%** |
| 4–6px | 30% | **96%** |
| 6–8px | 47% | **100%** |
| 8–10px | 73% | **97%** |
| 10–12px | 87% | **100%** |

For every bin ≥3px the oracle genuinely represents the close pair as two distinct
selected vertices (94–100%, vs baseline 6–87%) — it is emphatically *not* a no-op — and
recovery still does not move. The **sub-3px bin is a real caveat**: the 3px merge
radius means this oracle cannot represent those pairs, so the ladder can neither
confirm nor deny them. (They are ~1% of junctions and sit on dense hard CPs; the prior
report already called sub-2px a resolution wall.)

A second confound was found and removed: close-pair boxes that touch the paper border
caused the in-regions merge to *drop* the model's boundary-contact primitives there,
biasing the oracle worse. Clipping the boxes to the interior band (never touching the
32/992 border) makes boundary-contact coverage identical to baseline (95.9% = 95.9%)
while still fixing interior close pairs (81%→98% covered). This clean "clip" oracle
recovers medium 2/232 — same as baseline — so the null holds after the confound is
removed. That boundary contacts sit at 95.9% detected is itself evidence the border is
not a failure locus.

---

## 4. Where the misses actually are: isolated interior, not close pairs, not the border *(High)*

**Operating-threshold correction (2026-07-01).** Per-junction recall here — and in the
prior report's §3 — was first measured at a peak threshold of **0.65**. The pipeline
actually extracts junction peaks at **0.50** (`line_threshold.max(0.50)`; `line_threshold`
≈ 0.29, so the 0.50 floor binds — verified in code and confirmed against the inspector's
primitive count, e.g. 55 peaks @0.50 = 55 displayed primitives on one sample). The 0.65
figures over-count misses. Corrected recall (raw peaks, NMS radius 3, subpixel offset,
matched to interior degree-≥3 GT junctions within 2px):

| bucket | recall @0.65 (as first measured) | recall @0.50 (**operating point**) |
|---|---|---|
| easy | 91.8% | **97.9%** |
| medium | 90.5% | **97.3%** |
| hard | 55.0% | **62.9%** |

This does **not** affect the oracle ladder (§2), which ran the real pipeline at its
then-current 0.50 floor; only the standalone recall figures were off. (That 0.50 floor was
the operating point when these numbers were measured; it has since been lowered to **0.40**
— §9.) Partitioning the misses (at 0.50 unless noted):

- **Isolated vs close (medium):** **72% of misses are isolated** (nearest-neighbour
  ≥12px), 28% close — unchanged from the 0.65 set. This is why the full oracle helps
  (fixes isolated misses) and the close-pair oracle does not.
- **Border proximity:** misses are not concentrated at the paper border — ~2.5% within
  12px, ~10% within 32px, ~24% within 64px, only mildly enriched (~2× at ≤8–12px) over
  the base junction density and decaying to ~1× by 64px. (Computed on the 0.65 miss set;
  it is a relative-enrichment comparison, so the "border is not a locus" conclusion is
  unaffected by the threshold.) Border/edge handling is **not** a lever.

Spatially, the driver of misses is **local junction density** (crowded regions,
wherever they are), not position on the paper.

---

## 5. A top-N primitive cap was silently dropping real detections — now removed *(High — code-verified)*

The junction (and boundary-contact) primitive extractor sorted peaks by probability and
**truncated to a fixed count** (`local_maxima_primitives`:
`sort_by(support desc); truncate(max_count)` in `evidence_extract.rs`). The caps:

| path | cap | CPs exceeding it |
|---|---|---|
| Inspector Stage 1 **display** (`evidence_config_from_decode`) | **240** | **95% of hard** (133/140), 1% medium, 0% easy |
| **Production** candidate pipeline (`junction_carrier_v1::evidence_config`) | **500** | **45% of hard** (63/140), 0% easy/medium |

Median junctions/CP: easy 36, medium 102, **hard 466** — so on nearly every hard CP the
inspector rendered only the top-240 junctions and dropped the rest, the mechanism behind
"the heatmap looks great but junctions aren't displayed." The uncapped raw-peak recall is
higher than what either surface was showing.

**Both caps were removed this session** (set to `usize::MAX`). Because 0% of easy/medium
CPs exceed either cap, removal changes nothing on easy/medium (where the recoverable
headroom is); it only lifts an arbitrary ceiling on dense hard CPs, at a measured ~1.4×
hard candidate-gen cost (99.4s→140.9s over the bucket; O(V³) span generation), ~1.06×
medium, none easy. Whether uncapping changes hard *recovery* was not separately measured
(hard recovery is ~0 for other reasons — §2).

---

## 6. Box-pleating is a density proxy, not an independent failure mode *(High)*

Box-pleat score = length-weighted fraction of interior creases within 3° of a 45°
multiple (0/45/90/135), border excluded. Distribution over 563 CPs: 28.4% score ≥0.80,
19.7% ≥0.90. It is heavily concentrated in hard:

| bucket | box-pleated (≥0.90) | median score |
|---|---|---|
| easy | 18/191 (9.4%) | 0.56 |
| medium | 14/232 (6.0%) | 0.61 |
| hard | **79/140 (56.4%)** | **0.92** |

*Within* the hard bucket, box-pleating does **not** predict detection failure:

- `Spearman(box_score, recall) = +0.02` (nil).
- `Spearman(box_score, junctions/CP) = +0.41` (box-pleats are denser).
- `Spearman(box_score, close-pair fraction) = −0.47` (box-pleats have *fewer* close pairs).
- Recall at matched density is **higher** for box-pleats in every junc/CP band
  (e.g. 600–1200 band: 66.6% BP vs 47.3% non-BP).

So "worse on box-pleated" is the confound of box-pleats being the densest hard CPs;
box-pleating per se is not a detection problem. *(Caveat: 22.5° box-pleat systems are
scored as partly off-grid by the 45°-only definition; not separately analysed.)*

---

## 7. On hard, most misses are "heatmap-absent," not "detected-but-dropped" *(Medium)*

At the 0.50 floor (the operating point when this was measured; now 0.40 — §9), classifying
hard misses by the local-max heatmap activation near the GT junction: **~80% are genuinely
weak** (local-max prob < 0.35, i.e. the model
did not fire), **~17% are just below threshold** (activation 0.35–0.50 — visible but
under the 0.50 floor), and **~2% are localization** (a strong peak within ~2–3px, just
outside the strict 2px match). So on the hard CPs that dominate the miss count, the
limiting factor is the model not firing, not extraction dropping a clear peak. On easy
the mix is different and more actionable: at 0.50 easy recall is already 97.9%, and of
the residual misses a larger share is just-below-threshold or localization rather than
truly absent (see §8). *(Local-max-activation proxy, hence Medium; it does not fully
separate NMS-suppression from sub-threshold beyond the activation bands given.)*

---

## 8. Levers, re-prioritized

1. **General/isolated junction recall on easy+medium** *(High that it's the lever).*
   Perfect junctions convert to +112 recovered, concentrated on easy/medium isolated
   junctions. This is where detector-repo training effort should go — **not**
   close-pair augmentation (§2/§3) and **not** border/edge handling (§4).
2. **The exact-solve** *(Medium-High).* The 174 perfect-junction ceiling means ~69% of
   the set is unrecoverable even with perfect junctions; carried from the prior report
   as timeouts + convergence drift. Unchanged here.
3. **Uncap the primitive lists** *(done — §5).* Removed an arbitrary ceiling on dense CPs
   at ~1.4× hard candidate-gen cost; leaves easy/medium unchanged (they never hit the cap).
4. **Lower the junction-peak floor to 0.40** *(measured; landed — see §9).* Sweeping the
   floor shows 0.40 is the end-to-end optimum: recovery 67→85 (+27%) at a 25s solve cap,
   precision-neutral. Done.
5. **Not levers (measured):** close-pair-specific detection (§2/§3), paper-border/edge
   detection (§4), box-pleating as such (§6) — alongside the prior report's refiner and
   topology-gate tolerance. (Note: the prior report dismissed *threshold* lowering, but
   that was on hard, where misses are genuinely absent; on easy there is a small,
   precision-free residual — item 4.)

---

## 9. Junction-threshold sweep: the 0.50 floor is too high — 0.40 wins *(High; landed)*

The pipeline extracted junction peaks at a fixed floor of 0.50 (§4). Sweeping that floor —
through `compare_exact_solve_benchmark` (the same binary and `solve_recovered` metric as
every recovery number here; recall/precision from its own `strict_topology.vertices`, **no
numpy**) — shows 0.50 is too strict. A default-inert `--junction-peak-threshold` override
was added and verified (no-flag == explicit-0.50) before trusting any swept number.

End-to-end recovery vs floor (25s solve cap; easy is cap-insensitive, 3s == 25s):

| floor | easy | medium | hard | **TOTAL** | vtx precision (e/m/h) |
|---|---|---|---|---|---|
| 0.50 (old) | 60 | 7 | 0 | **67** | 98.7 / 98.9 / 99.1 |
| 0.45 | 60 | 13 | 0 | 73 | 98.4 / 98.9 / 99.0 |
| **0.40** | **63** | 22 | 0 | **85** | 98.2 / 98.8 / 98.8 |
| 0.35 | 57 | 25 | 0 | 82 | 97.9 / 98.6 / 98.7 |
| 0.30 | 54 | 19 | 0 | 73 | 97.5 / 98.4 / 98.6 |
| 0.25 | 42 | 17 | 0 | 59 | 96.9 / 98.1 / 98.4 |

- **0.40 is the optimum: 67 → 85 (+18, +27%)**, decode-only, precision-neutral. At the
  shipping-relevant 3s cap the same optimum gives 62 → 71 (+9, +15%).
- **A genuine sweet spot — recall alone would mislead.** Below the optimum, vertex recall
  keeps rising (98.0 → 99.0% on easy) but recovery *falls*: a few extra low-confidence
  peaks add misplaced vertices that break all-or-nothing topology. 0.25 (59) is *worse*
  than baseline (67). This is why `solve_recovered`, not recall, is the decider.
- **Hard is unmoved (0 at every floor)** — consistent with the ladder.

**The medium gain is exact-solve-bound, not detection-bound (mechanism, verified).** The
medium jump only appears at a generous solve cap (3s medium@0.40 = 8, 25s = 22). The CPs
that flip from not-recovered@3s to recovered@25s show, at 3s, `status: failed` with the
objective still in the thousands and vertices unmoved — the solver ran out of wall-clock
before converging; at 25s it converges (objective ~tens, accepted). **These candidates
already have correct topology at both caps** — the only barrier is exact-solve convergence
time. So the threshold lever (more candidates reach correct topology) and the solve budget
(time to converge them) are **complementary**. *(Correction: an earlier
`exact_solve.status=='timeout'` proxy read 0 timeouts and wrongly suggested the cap didn't
matter — the cap-hit is labelled `failed`, not `timeout`.)*

**Landed (2026-07-01, one commit):** junction floor lowered 0.50 → 0.40 (single shared
const `JUNCTION_PEAK_THRESHOLD_FLOOR`, used by product wasm + benchmark + inspector) and
the exact-solve budget raised 10 → 25s (single shared const
`DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS`; product + inspector default to it and pass no
override). Verified: the benchmark at default (no flags) reproduces the 0.40/25s cells
(easy 63/81, medium 22/60), and the product wasm rebuilds clean. **Caveat:** 25s means the
browser product can block up to 25s per CP import.

**Net effect of all landed changes (before/after, same tool/flags/data).** Benchmark at
each commit's shipping defaults — `d516cfb0` (session start: 0.50 floor / 3s cap / 500
primitive cap) vs current (0.40 / 25s / uncapped), the before-binary built in an isolated
worktree so its provenance guard is clean:

| bucket | before | after | Δ |
|---|---|---|---|
| easy | 60 | 63 | +3 |
| medium | 3 | 20 | +17 |
| hard | 0 | 0 | 0 |
| **TOTAL** | **63/563** | **83/563** | **+20 (+32%)** |

Candidate-topology moved in step (easy 75→81, medium 33→60, hard 5→11). The easy gain is
the 0.40 floor (cap-insensitive); the medium gain needs *both* the floor (≈2× more
candidates reach correct topology) and the 25s budget (time to converge them). The uncap
contributes **~0** to recovery here (hard-only; hard stays 0) — a correctness/ceiling fix,
not a recovery mover on this set. Run-to-run variance on medium is ±2–3 (the sweep put the
0.40/25s point at 85 / medium 22), so read the delta as **≈ +20 (±3, ~+32%)**.

---

## 10. Open questions & caveats (explicitly not concluded)

- **The oracle ladder (§2) is 3s-only.** The rung 0/1/2 numbers are at a 3s solve cap; a
  25s rerun of the *ladder* was never done. (The threshold *sweep* in §9 was run at both
  3s and 25s, and it confirms medium recovery is heavily solve-cap-sensitive — so the §2
  medium/hard ladder numbers likely understate the perfect-junction ceiling at a generous
  cap. Re-running the ladder at 25s would sharpen the junction-vs-solve split.)
- **Sub-3px close pairs untestable** via this oracle (merge radius 3px) — §3.
- **Uncap → recovery is unmeasured.** §5 measured the candidate-gen slowdown, not whether
  removing the (now-removed) 500 production cap changes hard `solve_recovered`. Don't
  assume either direction. (Easy/medium are unaffected — they never hit it.)
- **"Detected-but-dropped" attribution is coarse** — a per-pixel probability proxy, not
  traced to a specific extraction stage (§7).
- **Box-pleat definition is 45°-only** (3° tolerance); 22.5° systems not separated (§6).

---

## Appendix — key measurements & provenance

- Ladder binary: `compare_exact_solve_benchmark`, provenance-guarded, built and run
  from this worktree (per the worktree/target stale-binary guard). Config as §1; 3s cap.
- §2 (3s): rung0 easy/med/hard = 60/2/0; rung2 = 129/43/2; rung1 sweep ALL = 62/62/63/62.
- §3 representation: dumped selected folds, medium; both-distinct ≥3px = 94–100% (oracle)
  vs 6–87% (baseline); sub-3px oracle = 9%. Clip oracle: boundary 95.9%=95.9%, interior
  junctions in boxes 81%→98%, medium recovery 2/232.
- §4: medium misses 72% isolated (≥12px); border-distance (ALL) misses/all within
  12/32/64px = 2.5/1.2, 10.1/8.6, 24.2/21.2 %. Raw-peak recall (rederive method): easy
  at the 0.65 analysis bar 91.8/90.5/55.0%; at the **0.50 floor then in effect** (correct)
  **97.9/97.3/62.9%** (easy/medium/hard).
- §5: caps 240 (display) / 500 (production), top-N-by-probability truncate — **both removed
  this session**; median junc/CP 36/102/466; >240 exceeded by 95% of hard, >500 by 45% of
  hard, 0% easy/medium; uncap slowdown hard candidate-gen 99.4s→140.9s (1.42×), medium 1.06×.
- §6: box-pleat ≥0.90 = easy 18/medium 14/hard 79; within-hard Spearman(recall)=+0.02,
  (junc/CP)=+0.41, (close-frac)=−0.47.
- §7 (0.50 operating point): hard misses = ~80% weak (local-max <0.35) / ~17%
  just-below-threshold (0.35–0.50) / ~2% localization. Operating junction-peak floor when
  measured was 0.50 (`line_threshold.max(0.50)`), not 0.65 — a correction to this report's
  earlier draft and the prior report's §3; the floor was since lowered to 0.40 (§9).
- §9 sweep (via `compare_exact_solve_benchmark`, `--junction-peak-threshold` override,
  provenance-guarded; recall/precision from `strict_topology.vertices`). 25s cap unless
  noted: floor 0.50/0.45/0.40/0.35/0.30/0.25 → TOTAL 67/73/85/82/73/59; precision stays
  96.9–99.1%. 3s: 0.50→62, 0.40→71. Medium flippers @3s = `status:failed`, objective in
  the thousands, moved 0.000; @25s = `solved`, objective ~tens.
- Code changed this session (committed): production primitive uncap
  (`junction_carrier_v1.rs`); inspector display uncap + `/api/stage1/fullmap` full-res
  dense-map endpoint + "dense" viewer hijack; **junction floor 0.50→0.40**
  (`JUNCTION_PEAK_THRESHOLD_FLOOR`, one shared const) + **exact-solve budget 10→25s**
  (`DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS`, one shared const) across product/benchmark/inspector.
